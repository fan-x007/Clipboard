/// <reference types="vite/client" />

export type ClipboardItemType = 'text' | 'file'

export interface ClipboardItem {
  id: string
  type: ClipboardItemType
  text: string
  timestamp: number
  favorite: boolean
  inHistory: boolean
  preview: string
  fileName?: string
  fileSize?: number
  storedPath?: string
}

export interface AppSettings {
  toggleShortcut: string
  maxHistory: number
  maxFiles: number
  filesDir: string
  inlineTranslateLimit?: number
}

// ─── Token Balance Types ────────────────────────────────────

export interface TokenBalanceData {
  isAvailable: boolean
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
  isTokenQuota?: boolean
  remainingRequests?: number
  remainingTokens?: number
  note?: string
}

export interface TokenBalanceResult {
  success: boolean
  data?: TokenBalanceData
  error?: string
}

export interface TokenKeyConfig {
  id: string
  platform: string
  label: string
  createdAt: number
  balance?: TokenBalanceResult
}

export interface TokenPlatformInfo {
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
}

// ─── Rapid Consumption Alert Types ──────────────────────────

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

export interface ConsumptionAlertEvent {
  kind: 'consumption'
  ruleId: string
  ruleName: string
  windowMinutes: number
  threshold: number
  consumed: number
  triggeredAt: number
}

export interface ReminderAlertEvent {
  kind: 'reminder'
  reminderId: string
  title: string
  note: string
  scheduledAt: number
  triggeredAt: number
}

export type AlertEvent = ConsumptionAlertEvent | ReminderAlertEvent

// ─── Scheduled Reminder Types ──────────────────────────────

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

// ─── Auto Typing Types ──────────────────────────────────────

export interface TypingStatus {
  isRunning: boolean
  status: string
  progress: number
  current: number
  total: number
}

declare global {
  interface Window {
    clipboardApi: {
      getHistory: () => Promise<ClipboardItem[]>
      copyItem: (id: string) => Promise<boolean>
      deleteItem: (id: string) => Promise<boolean>
      deleteFromFavorites: (id: string) => Promise<boolean>
      clearHistory: () => Promise<boolean>
      clearFavorites: () => Promise<boolean>
      toggleFavorite: (id: string) => Promise<boolean>
      hideWindow: () => Promise<boolean>
      openFile: (id: string) => Promise<boolean>
      openFileLocation: (id: string) => Promise<boolean>
      onHistoryUpdated: (callback: (items: ClipboardItem[]) => void) => void
      getSettings: () => Promise<AppSettings>
      setToggleShortcut: (shortcut: string) => Promise<boolean>
      setMaxHistory: (max: number) => Promise<boolean>
      setMaxFiles: (max: number) => Promise<boolean>
      selectFilesDirectory: () => Promise<string | null>
      setFilesDirectory: (dir: string) => Promise<boolean>
      getFilesDirectory: () => Promise<string>
      resetFilesDirectory: () => Promise<boolean>
      setInlineTranslateLimit: (limit: number) => Promise<boolean>
    }
    tokenApi: {
      getPlatforms: () => Promise<TokenPlatformInfo[]>
      getKeys: () => Promise<TokenKeyConfig[]>
      addKey: (platform: string, key: string, label: string) => Promise<TokenKeyConfig | null>
      deleteKey: (id: string) => Promise<boolean>
      refreshBalance: (id: string) => Promise<TokenKeyConfig | null>
      refreshAllBalances: () => Promise<boolean>
      openRecharge: (platformId: string) => Promise<boolean>
      getRefreshInterval: () => Promise<number>
      setRefreshInterval: (minutes: number) => Promise<boolean>
      onKeysUpdated: (callback: (keys: TokenKeyConfig[]) => void) => void
      onShowTokenBalance: (callback: () => void) => void
    }
    alertApi: {
      getRules: () => Promise<TokenAlertRule[]>
      getStatus: () => Promise<AlertRuleStatus[]>
      addRule: (input: { name?: string; windowMinutes: number; threshold: number }) => Promise<TokenAlertRule[]>
      deleteRule: (id: string) => Promise<TokenAlertRule[]>
      toggleRule: (id: string, enabled: boolean) => Promise<TokenAlertRule[]>
      testAlert: () => Promise<boolean>
      getEvents: () => Promise<AlertEvent[]>
      close: () => Promise<boolean>
      openTokenPanel: () => Promise<boolean>
      onRulesUpdated: (callback: (rules: TokenAlertRule[]) => void) => void
      onAlerts: (callback: (events: AlertEvent[]) => void) => void
    }
    reminderApi: {
      getAll: () => Promise<Reminder[]>
      add: (input: { title: string; note?: string; time: number; repeat?: ReminderRepeat }) => Promise<Reminder[]>
      update: (id: string, patch: Partial<Reminder>) => Promise<Reminder[]>
      remove: (id: string) => Promise<Reminder[]>
      toggle: (id: string, enabled: boolean) => Promise<Reminder[]>
      test: () => Promise<boolean>
      onUpdated: (callback: (reminders: Reminder[]) => void) => void
    }
    typingApi: {
      getStatus: () => Promise<TypingStatus>
      start: (text: string, delay: number, interval: number, useEnglishSymbols?: boolean) => Promise<{ success: boolean; message: string }>
      stop: () => Promise<{ success: boolean; message: string }>
      onStatusUpdated: (callback: (status: TypingStatus) => void) => void
    }
    imeApi: {
      getEnglishSymbols: () => Promise<boolean>
      setEnglishSymbols: (enabled: boolean) => Promise<boolean>
      onEnglishSymbolsUpdated: (callback: (enabled: boolean) => void) => void
    }
    acceleratorApi: {
      getStatus: () => Promise<{ github: boolean; steam: boolean }>
      setEnabled: (service: 'github' | 'steam', enabled: boolean) => Promise<{ success: boolean; message: string }>
    }
    translateApi: {
      run: (text: string, target: 'en' | 'zh') => Promise<{ success: boolean; text?: string; error?: string }>
      getConfig: () => Promise<{
        apiUrl: string
        apiKey: string
        model: string
        profiles?: { name: string; apiUrl: string; apiKey: string; model: string }[]
      }>
      setConfig: (config: { apiUrl: string; apiKey: string; model: string }) => Promise<boolean>
      setProfiles: (
        profiles: { name: string; apiUrl: string; apiKey: string; model: string }[],
        activeName?: string
      ) => Promise<boolean>
      test: (config: { apiUrl: string; apiKey: string; model: string }) => Promise<{ success: boolean; text?: string; error?: string }>
    }
  }
}

export {}
