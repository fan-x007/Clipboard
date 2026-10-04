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
    }
    tokenApi: {
      getPlatforms: () => Promise<TokenPlatformInfo[]>
      getKeys: () => Promise<TokenKeyConfig[]>
      addKey: (platform: string, key: string, label: string) => Promise<TokenKeyConfig | null>
      deleteKey: (id: string) => Promise<boolean>
      refreshBalance: (id: string) => Promise<TokenKeyConfig | null>
      refreshAllBalances: () => Promise<boolean>
      openRecharge: (platformId: string) => Promise<boolean>
      onKeysUpdated: (callback: (keys: TokenKeyConfig[]) => void) => void
      onShowTokenBalance: (callback: () => void) => void
    }
  }
}

export {}
