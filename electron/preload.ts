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
}

// ─── Token Balance API ──────────────────────────────────────

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

  onKeysUpdated: (callback: (keys: TokenKeyConfig[]) => void) => {
    ipcRenderer.on('token:keys-updated', (_event, keys) => callback(keys))
  },

  onShowTokenBalance: (callback: () => void) => {
    ipcRenderer.on('show-token-balance', () => callback())
  },
}

contextBridge.exposeInMainWorld('clipboardApi', clipboardApi)
contextBridge.exposeInMainWorld('tokenApi', tokenApi)
