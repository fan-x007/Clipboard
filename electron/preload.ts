import { contextBridge, ipcRenderer } from 'electron'

export type ClipboardItemType = 'text' | 'file'

export interface ClipboardItem {
  id: string
  type: ClipboardItemType
  text: string
  timestamp: number
  favorite: boolean
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

export const clipboardApi = {
  getHistory: (): Promise<ClipboardItem[]> => ipcRenderer.invoke('get-history'),
  copyItem: (id: string): Promise<boolean> => ipcRenderer.invoke('copy-item', id),
  deleteItem: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-item', id),
  deleteFromFavorites: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-from-favorites', id),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('clear-history'),
  clearFavorites: (): Promise<boolean> => ipcRenderer.invoke('clear-favorites'),
  toggleFavorite: (id: string): Promise<boolean> => ipcRenderer.invoke('toggle-favorite', id),
  hideWindow: (): Promise<boolean> => ipcRenderer.invoke('hide-window'),
  openFile: (id: string): Promise<boolean> => ipcRenderer.invoke('open-file', id),
  openFileLocation: (id: string): Promise<boolean> => ipcRenderer.invoke('open-file-location', id),
  onHistoryUpdated: (callback: (items: ClipboardItem[]) => void) => {
    ipcRenderer.on('history-updated', (_event, items) => callback(items))
  },
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  setToggleShortcut: (shortcut: string): Promise<boolean> => ipcRenderer.invoke('set-toggle-shortcut', shortcut),
  setMaxHistory: (max: number): Promise<boolean> => ipcRenderer.invoke('set-max-history', max),
  setMaxFiles: (max: number): Promise<boolean> => ipcRenderer.invoke('set-max-files', max),
  selectFilesDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-files-directory'),
  setFilesDirectory: (dir: string): Promise<boolean> => ipcRenderer.invoke('set-files-directory', dir),
  getFilesDirectory: (): Promise<string> => ipcRenderer.invoke('get-files-directory'),
  resetFilesDirectory: (): Promise<boolean> => ipcRenderer.invoke('reset-files-directory'),
  setInlineTranslateLimit: (limit: number): Promise<boolean> =>
    ipcRenderer.invoke('set-inline-translate-limit', limit),
}

// ─── Token Balance API ──────────────────────────────────────

export interface TokenAlertRule {
  id: string
  name: string
  windowMinutes: number
  threshold: number
  enabled: boolean
  createdAt: number
  lastTriggeredAt?: number
}

export interface AlertEvent {
  kind: 'consumption' | 'reminder'
  // consumption
  ruleId?: string
  ruleName?: string
  windowMinutes?: number
  threshold?: number
  consumed?: number
  triggeredAt: number
  // reminder
  reminderId?: string
  title?: string
  note?: string
  scheduledAt?: number
}

export interface AlertRuleStatus extends TokenAlertRule {
  consumed: number
}

export const tokenApi = {
  getPlatforms: (): Promise<TokenPlatformInfo[]> => ipcRenderer.invoke('token:get-platforms'),
  getKeys: (): Promise<TokenKeyConfig[]> => ipcRenderer.invoke('token:get-keys'),
  addKey: (platform: string, key: string, label: string): Promise<TokenKeyConfig | null> =>
    ipcRenderer.invoke('token:add-key', platform, key, label),
  deleteKey: (id: string): Promise<boolean> => ipcRenderer.invoke('token:delete-key', id),
  refreshBalance: (id: string): Promise<TokenKeyConfig | null> =>
    ipcRenderer.invoke('token:refresh-balance', id),
  refreshAllBalances: (): Promise<boolean> => ipcRenderer.invoke('token:refresh-all-balances'),
  openRecharge: (platformId: string): Promise<boolean> =>
    ipcRenderer.invoke('token:open-recharge', platformId),
  getRefreshInterval: (): Promise<number> =>
    ipcRenderer.invoke('token:get-refresh-interval'),
  setRefreshInterval: (minutes: number): Promise<boolean> =>
    ipcRenderer.invoke('token:set-refresh-interval', minutes),

  onKeysUpdated: (callback: (keys: TokenKeyConfig[]) => void) => {
    ipcRenderer.on('token:keys-updated', (_event, keys) => callback(keys))
  },

  onShowTokenBalance: (callback: () => void) => {
    ipcRenderer.on('show-token-balance', () => callback())
  },
}

// ─── Rapid Consumption Alert API ───────────────────────────

export const alertApi = {
  getRules: (): Promise<TokenAlertRule[]> => ipcRenderer.invoke('alert:get-rules'),
  getStatus: (): Promise<AlertRuleStatus[]> => ipcRenderer.invoke('alert:get-status'),
  addRule: (input: { name?: string; windowMinutes: number; threshold: number }): Promise<TokenAlertRule[]> =>
    ipcRenderer.invoke('alert:add-rule', input),
  deleteRule: (id: string): Promise<TokenAlertRule[]> => ipcRenderer.invoke('alert:delete-rule', id),
  toggleRule: (id: string, enabled: boolean): Promise<TokenAlertRule[]> =>
    ipcRenderer.invoke('alert:toggle-rule', id, enabled),
  testAlert: (): Promise<boolean> => ipcRenderer.invoke('alert:test'),
  getEvents: (): Promise<AlertEvent[]> => ipcRenderer.invoke('alert:get-events'),
  close: (): Promise<boolean> => ipcRenderer.invoke('alert:close'),
  openTokenPanel: (): Promise<boolean> => ipcRenderer.invoke('alert:open-token-panel'),

  onRulesUpdated: (callback: (rules: TokenAlertRule[]) => void) => {
    ipcRenderer.on('alert:rules-updated', (_event, rules) => callback(rules))
  },
  onAlerts: (callback: (events: AlertEvent[]) => void) => {
    ipcRenderer.on('alert:data', (_event, events) => callback(events))
  },
}

// ─── Scheduled Reminder API ────────────────────────────────

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

export const reminderApi = {
  getAll: (): Promise<Reminder[]> => ipcRenderer.invoke('reminder:get-all'),
  add: (input: { title: string; note?: string; time: number; repeat?: ReminderRepeat }): Promise<Reminder[]> =>
    ipcRenderer.invoke('reminder:add', input),
  update: (id: string, patch: Partial<Reminder>): Promise<Reminder[]> =>
    ipcRenderer.invoke('reminder:update', id, patch),
  remove: (id: string): Promise<Reminder[]> => ipcRenderer.invoke('reminder:delete', id),
  toggle: (id: string, enabled: boolean): Promise<Reminder[]> =>
    ipcRenderer.invoke('reminder:toggle', id, enabled),
  test: (): Promise<boolean> => ipcRenderer.invoke('reminder:test'),

  onUpdated: (callback: (reminders: Reminder[]) => void) => {
    ipcRenderer.on('reminder:updated', (_event, reminders) => callback(reminders))
  },
}

// ─── Auto Typing API ──────────────────────────────────────

export interface TypingStatus {
  isRunning: boolean
  status: string
  progress: number
  current: number
  total: number
}

export const typingApi = {
  getStatus: (): Promise<TypingStatus> => ipcRenderer.invoke('typing:get-status'),
  start: (text: string, delay: number, interval: number, useEnglishSymbols?: boolean): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('typing:start', text, delay, interval, useEnglishSymbols ?? false),
  stop: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('typing:stop'),

  onStatusUpdated: (callback: (status: TypingStatus) => void) => {
    ipcRenderer.on('typing:status-updated', (_event, status) => callback(status))
  },
}

// ─── IME English Symbols API ──────────────────────────────

export const imeApi = {
  getEnglishSymbols: (): Promise<boolean> => ipcRenderer.invoke('ime:get-english-symbols'),
  setEnglishSymbols: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('ime:set-english-symbols', enabled),
  onEnglishSymbolsUpdated: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('english-symbols-updated', (_event, enabled) => callback(enabled))
  },
}

// ─── Website Accelerator API ──────────────────────────────

export const acceleratorApi = {
  getStatus: (): Promise<{ github: boolean; steam: boolean }> => ipcRenderer.invoke('accelerator:get-status'),
  setEnabled: (service: 'github' | 'steam', enabled: boolean): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('accelerator:set', service, enabled),
}

// ─── Translation API ──────────────────────────────────────

export interface TranslateConfig {
  apiUrl: string
  apiKey: string
  model: string
  profiles?: TranslateProfile[]
}

export interface TranslateProfile {
  name: string
  apiUrl: string
  apiKey: string
  model: string
}

export const translateApi = {
  run: (text: string, target: 'en' | 'zh'): Promise<{ success: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('translate:run', text, target),
  getConfig: (): Promise<TranslateConfig> => ipcRenderer.invoke('translate:get-config'),
  setConfig: (config: TranslateConfig): Promise<boolean> => ipcRenderer.invoke('translate:set-config', config),
  setProfiles: (profiles: TranslateProfile[], activeName?: string): Promise<boolean> =>
    ipcRenderer.invoke('translate:set-profiles', profiles, activeName),
  test: (config: TranslateConfig): Promise<{ success: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('translate:test', config),
}

contextBridge.exposeInMainWorld('clipboardApi', clipboardApi)
contextBridge.exposeInMainWorld('tokenApi', tokenApi)
contextBridge.exposeInMainWorld('alertApi', alertApi)
contextBridge.exposeInMainWorld('reminderApi', reminderApi)
contextBridge.exposeInMainWorld('typingApi', typingApi)
contextBridge.exposeInMainWorld('imeApi', imeApi)
contextBridge.exposeInMainWorld('acceleratorApi', acceleratorApi)
contextBridge.exposeInMainWorld('translateApi', translateApi)
