import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { TokenKeyConfig } from './tokenStore'
import type { ConsumptionAlertEvent } from './alertTypes'

// ─── Rapid consumption alerts ───────────────────────────────
//
// Balance samples are recorded every time a balance is refreshed.
// Consumption within a window = sum of balance drops between
// consecutive samples (top-ups are ignored, they only reset the baseline).
//
// Rules live in settings.json; samples live in token-balance-samples.json.
// ─────────────────────────────────────────────────────────────

export const ALERT_MIN_WINDOW = 60 // 1 hour
export const ALERT_MAX_WINDOW = 43200 // 30 days
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000 // at most one popup per rule per 30 min

const MAX_SAMPLE_AGE_MS = 32 * 24 * 60 * 60 * 1000 // keep a bit more than the longest window
const MAX_SAMPLES = 30000

export interface TokenAlertRule {
  id: string
  name: string
  windowMinutes: number
  threshold: number
  enabled: boolean
  createdAt: number
  lastTriggeredAt?: number
}

export interface AlertRuleStatus extends TokenAlertRule {
  consumed: number
}

interface BalanceSample {
  t: number // timestamp
  k: string // key id
  v: number // total balance
}

interface SamplesFile {
  version: number
  samples: BalanceSample[]
}

export class TokenAlertManager {
  private samples: BalanceSample[] = []
  private filePath: string
  // last recorded value per key, used to skip unchanged samples
  private lastValues = new Map<string, number>()

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'token-balance-samples.json')
    this.load()
  }

  private load() {
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as SamplesFile
      if (!parsed || !Array.isArray(parsed.samples)) return
      this.samples = parsed.samples
        .filter(s => s && Number.isFinite(s.t) && Number.isFinite(s.v) && typeof s.k === 'string')
        .sort((a, b) => a.t - b.t)
      for (const s of this.samples) {
        this.lastValues.set(s.k, s.v)
      }
      this.prune(Date.now())
    } catch (e) {
      console.error('Failed to load token balance samples:', e)
      this.samples = []
      this.lastValues.clear()
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const data: SamplesFile = { version: 1, samples: this.samples }
      fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf-8')
    } catch (e) {
      console.error('Failed to save token balance samples:', e)
    }
  }

  private prune(now: number) {
    const cutoff = now - MAX_SAMPLE_AGE_MS
    this.samples = this.samples.filter(s => s.t >= cutoff)
    if (this.samples.length > MAX_SAMPLES) {
      this.samples = this.samples.slice(this.samples.length - MAX_SAMPLES)
    }
  }

  /** Record a balance snapshot for every successfully fetched key. */
  record(keys: TokenKeyConfig[], now = Date.now()): void {
    let changed = false
    for (const key of keys) {
      const result = key.balance
      if (!result?.success || !result.data) continue
      if (result.data.currency && result.data.currency !== 'CNY') continue
      const value = result.data.totalBalance
      if (!Number.isFinite(value)) continue
      const prev = this.lastValues.get(key.id)
      if (prev !== undefined && Math.abs(prev - value) < 0.0001) continue
      this.samples.push({ t: now, k: key.id, v: value })
      this.lastValues.set(key.id, value)
      changed = true
    }
    if (changed) {
      this.prune(now)
      this.save()
    }
  }

  /** Amount consumed in the last `windowMinutes`, optionally broken down by key. */
  getConsumption(windowMinutes: number, now = Date.now()): { total: number; perKey: Record<string, number> } {
    const start = now - windowMinutes * 60 * 1000
    const groups = new Map<string, BalanceSample[]>()

    for (const s of this.samples) {
      if (s.t > now) continue
      const list = groups.get(s.k)
      if (list) list.push(s)
      else groups.set(s.k, [s])
    }

    const perKey: Record<string, number> = {}
    let total = 0

    for (const [keyId, list] of groups) {
      let prevValue: number | null = null
      let consumed = 0
      for (const s of list) {
        if (s.t <= start) {
          // keep the last value before the window as the baseline
          prevValue = s.v
          continue
        }
        if (prevValue !== null && s.v < prevValue) {
          consumed += prevValue - s.v
        }
        prevValue = s.v
      }
      consumed = Math.round(consumed * 100) / 100
      if (consumed > 0) {
        perKey[keyId] = consumed
        total += consumed
      }
    }

    return { total: Math.round(total * 100) / 100, perKey }
  }

  /** Rules plus their current consumption, for the settings UI. */
  getStatus(rules: TokenAlertRule[], now = Date.now()): AlertRuleStatus[] {
    return rules.map(rule => ({
      ...rule,
      consumed: this.getConsumption(rule.windowMinutes, now).total,
    }))
  }

  /**
   * Check all rules against the latest samples.
   * Returns the events that should pop up and the rules with an updated
   * `lastTriggeredAt` (only when something actually triggered).
   */
  evaluate(rules: TokenAlertRule[], now = Date.now()): { events: ConsumptionAlertEvent[]; updatedRules: TokenAlertRule[] } {
    const events: ConsumptionAlertEvent[] = []
    let changed = false

    const updatedRules = rules.map(rule => {
      if (!rule.enabled) return rule
      const windowMinutes = clampWindow(rule.windowMinutes)
      const consumed = this.getConsumption(windowMinutes, now).total
      if (consumed + 1e-9 < rule.threshold) return rule

      const last = rule.lastTriggeredAt || 0
      if (now - last < ALERT_COOLDOWN_MS) return rule

      events.push({
        kind: 'consumption',
        ruleId: rule.id,
        ruleName: rule.name,
        windowMinutes,
        threshold: rule.threshold,
        consumed,
        triggeredAt: now,
      })
      changed = true
      return { ...rule, windowMinutes, lastTriggeredAt: now }
    })

    return { events, updatedRules: changed ? updatedRules : rules }
  }
}

export function clampWindow(minutes: number): number {
  if (!Number.isFinite(minutes)) return ALERT_MIN_WINDOW
  return Math.max(ALERT_MIN_WINDOW, Math.min(ALERT_MAX_WINDOW, Math.floor(minutes)))
}

export function formatAlertWindow(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}
