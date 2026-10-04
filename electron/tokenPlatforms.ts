import * as fs from 'fs'
import * as path from 'path'
import { BalanceData, PlatformInfo } from './tokenStore'

export interface PlatformAdapter {
  id: string
  name: string
  description: string
  website: string
  rechargeUrl: string
  currency: string
  credentialType: string
  credentialHint: string
  isTokenQuota: boolean
  note?: string
  getBalance(apiKey: string): Promise<BalanceData>
}

const platforms: Map<string, PlatformAdapter> = new Map()

export async function loadPlatforms(): Promise<PlatformInfo[]> {
  const platformsDir = path.join(__dirname, 'platforms')

  if (!fs.existsSync(platformsDir)) {
    console.warn('Platforms directory not found:', platformsDir)
    return []
  }

  const files = fs.readdirSync(platformsDir).filter(f => f.endsWith('.js'))

  for (const file of files) {
    try {
      const modulePath = path.join(platformsDir, file)
      const platformModule = require(modulePath)
      const adapter = platformModule.default || platformModule

      if (adapter && adapter.id && adapter.getBalance) {
        platforms.set(adapter.id, adapter)
      }
    } catch (e) {
      console.error(`Failed to load platform ${file}:`, e)
    }
  }

  return getSupportedPlatforms()
}

export function getSupportedPlatforms(): PlatformInfo[] {
  return Array.from(platforms.values()).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    website: p.website,
    rechargeUrl: p.rechargeUrl || p.website,
    currency: p.currency,
    credentialType: p.credentialType || 'api_key',
    credentialHint: p.credentialHint || '',
    isTokenQuota: p.isTokenQuota || false,
    note: p.note || '',
  }))
}

export async function getBalance(platformId: string, apiKey: string): Promise<BalanceData> {
  const platform = platforms.get(platformId)
  if (!platform) {
    throw new Error(`不支持的平台: ${platformId}`)
  }

  return await platform.getBalance(apiKey)
}
