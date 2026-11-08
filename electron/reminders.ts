import type { ReminderAlertEvent } from './alertTypes'

// ─── Scheduled reminders ────────────────────────────────────
//
// Reminders live in settings.json. The manager polls every few
// seconds and calls back with the events that should pop up.
// `time` always stores the next occurrence (timestamp).

export type ReminderRepeat = 'none' | 'daily' | 'weekly'

export interface Reminder {
  id: string
  title: string
  note: string
  time: number
  repeat: ReminderRepeat
  enabled: boolean
  createdAt: number
  lastTriggeredAt?: number
}

/** A one-shot reminder more than this late is considered missed, not popped. */
const ONCE_GRACE_MS = 24 * 60 * 60 * 1000
const CHECK_INTERVAL_MS = 15 * 1000

function nextOccurrence(time: number, repeat: Exclude<ReminderRepeat, 'none'>, now: number): number {
  const stepDays = repeat === 'daily' ? 1 : 7
  const date = new Date(time)
  let result = time
  while (result <= now) {
    date.setDate(date.getDate() + stepDays)
    result = date.getTime()
  }
  return result
}

export class ReminderManager {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private getReminders: () => Reminder[],
    private saveReminders: (reminders: Reminder[]) => void,
    private onTrigger: (events: ReminderAlertEvent[]) => void
  ) {}

  start(): void {
    this.stop()
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Check for due reminders now (used at startup and right after edits). */
  check(now = Date.now()): ReminderAlertEvent[] {
    const reminders = this.getReminders()
    const events: ReminderAlertEvent[] = []
    let changed = false

    const updated = reminders.map(reminder => {
      if (!reminder.enabled) return reminder
      if (!Number.isFinite(reminder.time) || reminder.time > now) return reminder

      if (reminder.repeat === 'none' && now - reminder.time > ONCE_GRACE_MS) {
        changed = true
        return { ...reminder, enabled: false }
      }

      const scheduledAt = reminder.time
      const next: Reminder = {
        ...reminder,
        lastTriggeredAt: now,
        time: reminder.repeat === 'none' ? reminder.time : nextOccurrence(reminder.time, reminder.repeat, now),
        enabled: reminder.repeat !== 'none',
      }
      changed = true
      events.push({
        kind: 'reminder',
        reminderId: reminder.id,
        title: reminder.title,
        note: reminder.note,
        scheduledAt,
        triggeredAt: now,
      })
      return next
    })

    if (changed) {
      this.saveReminders(updated)
    }
    if (events.length > 0) {
      this.onTrigger(events)
    }
    return events
  }
}

export function normalizeReminder(input: Partial<Reminder>): Reminder | null {
  const time = Number(input.time)
  if (!Number.isFinite(time) || time <= 0) return null
  const repeat: ReminderRepeat =
    input.repeat === 'daily' || input.repeat === 'weekly' ? input.repeat : 'none'
  const title = String(input.title || '').trim()
  if (!title) return null
  return {
    id: String(input.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 9)),
    title,
    note: String(input.note || '').trim(),
    time,
    repeat,
    enabled: input.enabled !== false,
    createdAt: Number(input.createdAt) || Date.now(),
    lastTriggeredAt: Number(input.lastTriggeredAt) || undefined,
  }
}
