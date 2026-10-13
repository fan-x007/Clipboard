import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export type ClipboardItemType = 'text' | 'file'

export interface ClipboardItem {
  id: string
  type: ClipboardItemType
  text: string // for text items: the text content; for file items: original file path
  preview: string
  timestamp: number
  favorite: boolean
  inHistory: boolean // whether to show in history (all tab)
  // file-specific fields
  fileName?: string
  fileSize?: number
  storedPath?: string // path where we saved the file copy
}

export class ClipboardStore {
  private items: ClipboardItem[] = []
  private filePath: string
  private filesDir: string
  private maxTextItems: number
  private maxFileItems: number

  constructor(maxTextItems: number = 200, maxFileItems: number = 100) {
    this.maxTextItems = maxTextItems
    this.maxFileItems = maxFileItems
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'clipboard-history.json')
    this.filesDir = path.join(userDataPath, 'clipboard-files')
    this.ensureFilesDir()
    this.load()
  }

  private ensureFilesDir() {
    try {
      if (!fs.existsSync(this.filesDir)) {
        fs.mkdirSync(this.filesDir, { recursive: true })
      }
    } catch (e) {
      console.error('Failed to create files directory:', e)
    }
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8')
        this.items = JSON.parse(data)
        // Migrate legacy items
        this.items = this.items.map(item => {
          const migrated = { ...item } as ClipboardItem
          if (!migrated.type) migrated.type = 'text' as ClipboardItemType
          if (migrated.inHistory === undefined) migrated.inHistory = true
          return migrated
        })
      }
    } catch (e) {
      console.error('Failed to load clipboard history:', e)
      this.items = []
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf-8')
    } catch (e) {
      console.error('Failed to save clipboard history:', e)
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
  }

  /**
   * Parse base name and starting counter from a file name.
   * For example:
   *   "report" -> { base: "report", counter: 1 }
   *   "report (1)" -> { base: "report", counter: 2 }
   *   "report (3)" -> { base: "report", counter: 4 }
   *   "file (1) (2)" -> { base: "file (1)", counter: 3 }
   */
  private parseNameAndCounter(fullBaseName: string): { base: string; startCounter: number } {
    const match = fullBaseName.match(/^(.*)\s\((\d+)\)$/)
    if (match) {
      return { base: match[1], startCounter: parseInt(match[2], 10) + 1 }
    }
    return { base: fullBaseName, startCounter: 1 }
  }

  private copyFileToStorage(originalPath: string, id: string): string | null {
    try {
      const fileName = path.basename(originalPath)
      const ext = path.extname(originalPath)
      const fullBaseName = path.basename(originalPath, ext)

      // Parse out any existing " (N)" suffix from the base name
      const { base, startCounter } = this.parseNameAndCounter(fullBaseName)

      // Try original name first
      let storedName = fileName
      let storedPath = path.join(this.filesDir, storedName)
      let counter = startCounter

      while (fs.existsSync(storedPath)) {
        storedName = `${base} (${counter})${ext}`
        storedPath = path.join(this.filesDir, storedName)
        counter++
      }

      // Copy file
      fs.copyFileSync(originalPath, storedPath)
      return storedPath
    } catch (e) {
      console.error('Failed to copy file to storage:', e)
      return null
    }
  }

  private deleteStoredFile(storedPath?: string) {
    if (storedPath && fs.existsSync(storedPath)) {
      try {
        fs.unlinkSync(storedPath)
      } catch (e) {
        console.error('Failed to delete stored file:', e)
      }
    }
  }

  private trimItems() {
    // Trim text items (only count items in history)
    const historyTextItems = this.items.filter(i => i.type === 'text' && i.inHistory)
    if (historyTextItems.length > this.maxTextItems) {
      const favorites = historyTextItems.filter(i => i.favorite)
      const nonFavorites = historyTextItems.filter(i => !i.favorite)
      const keepCount = Math.max(0, this.maxTextItems - favorites.length)
      const itemsToRemoveFromHistory = nonFavorites.slice(keepCount)

      itemsToRemoveFromHistory.forEach(item => {
        // Delete completely since they're not favorited
        const idx = this.items.findIndex(i => i.id === item.id)
        if (idx !== -1) {
          this.items.splice(idx, 1)
        }
      })

      // Also check if favorited items push us over - those just get removed from history
      // (favorites are always kept regardless of max limit)
    }

    // Trim file items (only count items in history)
    const historyFileItems = this.items.filter(i => i.type === 'file' && i.inHistory)
    if (historyFileItems.length > this.maxFileItems) {
      const favorites = historyFileItems.filter(i => i.favorite)
      const nonFavorites = historyFileItems.filter(i => !i.favorite)
      const keepCount = Math.max(0, this.maxFileItems - favorites.length)
      const itemsToRemove = nonFavorites.slice(keepCount)

      itemsToRemove.forEach(item => {
        // Delete completely since they're not favorited
        this.deleteStoredFile(item.storedPath)
        const idx = this.items.findIndex(i => i.id === item.id)
        if (idx !== -1) {
          this.items.splice(idx, 1)
        }
      })
    }
  }

  addText(text: string): ClipboardItem {
    // Check if we already have this text (in history or favorites)
    const existing = this.items.find(
      item => item.type === 'text' && item.text === text
    )
    if (existing) {
      // Move to top of history (restore from favorites if needed)
      this.items = this.items.filter(item => item.id !== existing.id)
      existing.timestamp = Date.now()
      existing.inHistory = true
      this.items.unshift(existing)
      this.trimItems()
      this.save()
      return existing
    }

    const item: ClipboardItem = {
      id: this.generateId(),
      type: 'text',
      text,
      timestamp: Date.now(),
      favorite: false,
      inHistory: true,
      preview: text.length > 200 ? text.substring(0, 200) + '...' : text,
    }

    this.items.unshift(item)
    this.trimItems()
    this.save()
    return item
  }

  addFile(originalPath: string): ClipboardItem | null {
    try {
      if (!fs.existsSync(originalPath)) return null

      const stat = fs.statSync(originalPath)
      if (!stat.isFile()) return null

      const fileName = path.basename(originalPath)
      const fileSize = stat.size

      // Check if we already have this file (by original path or stored path)
      const existing = this.items.find(
        item => item.type === 'file' &&
          (item.text === originalPath || item.storedPath === originalPath)
      )
      if (existing) {
        // Move to top of history (restore from favorites if needed)
        this.items = this.items.filter(item => item.id !== existing.id)
        existing.timestamp = Date.now()
        existing.inHistory = true
        this.items.unshift(existing)
        this.save()
        return existing
      }

      const id = this.generateId()
      const storedPath = this.copyFileToStorage(originalPath, id)
      if (!storedPath) return null

      const storedFileName = path.basename(storedPath)

      const item: ClipboardItem = {
        id,
        type: 'file',
        text: originalPath, // original path
        fileName: storedFileName,
        fileSize,
        storedPath,
        timestamp: Date.now(),
        favorite: false,
        inHistory: true,
        preview: storedFileName,
      }

      this.items.unshift(item)
      this.trimItems()
      this.save()
      return item
    } catch (e) {
      console.error('Failed to add file:', e)
      return null
    }
  }

  getAll(): ClipboardItem[] {
    return this.items
  }

  getFavorites(): ClipboardItem[] {
    return this.items.filter(i => i.favorite)
  }

  getFileItems(): ClipboardItem[] {
    return this.items.filter(i => i.type === 'file')
  }

  getTextItems(): ClipboardItem[] {
    return this.items.filter(i => i.type === 'text')
  }

  delete(id: string) {
    const item = this.items.find(i => i.id === id)
    if (!item) return

    // If item is favorited, just remove from history (keep in favorites)
    if (item.favorite) {
      item.inHistory = false
      this.save()
      return
    }

    // Otherwise, delete completely
    if (item.type === 'file') {
      this.deleteStoredFile(item.storedPath)
    }
    this.items = this.items.filter(item => item.id !== id)
    this.save()
  }

  deleteFromFavorites(id: string) {
    const item = this.items.find(i => i.id === id)
    if (!item) return

    // If item is in history, just unfavorite it
    if (item.inHistory) {
      item.favorite = false
      this.save()
      return
    }

    // Otherwise, delete completely
    if (item.type === 'file') {
      this.deleteStoredFile(item.storedPath)
    }
    this.items = this.items.filter(item => item.id !== id)
    this.save()
  }

  clear() {
    // Remove all non-favorite items from history
    // Favorited items are kept but removed from history view
    const toDelete = this.items.filter(i => !i.favorite)
    toDelete.forEach(item => {
      if (item.type === 'file') {
        this.deleteStoredFile(item.storedPath)
      }
    })
    this.items = this.items.filter(i => i.favorite)
    // Mark all favorites as not in history
    this.items.forEach(i => { i.inHistory = false })
    this.save()
  }

  clearFavorites() {
    // Delete all favorited items completely
    const favorites = this.items.filter(i => i.favorite)
    favorites.forEach(item => {
      if (item.type === 'file') {
        this.deleteStoredFile(item.storedPath)
      }
    })
    this.items = this.items.filter(i => !i.favorite)
    this.save()
  }

  toggleFavorite(id: string) {
    const item = this.items.find(i => i.id === id)
    if (item) {
      item.favorite = !item.favorite
      // When unfavoriting and item is not in history, delete it completely
      if (!item.favorite && !item.inHistory) {
        if (item.type === 'file') {
          this.deleteStoredFile(item.storedPath)
        }
        this.items = this.items.filter(i => i.id !== id)
      }
      this.save()
    }
  }

  setMaxTextItems(max: number) {
    this.maxTextItems = Math.max(10, Math.min(1000, Math.floor(max)))
    this.trimItems()
    this.save()
  }

  setMaxFileItems(max: number) {
    this.maxFileItems = Math.max(1, Math.min(500, Math.floor(max)))
    this.trimItems()
    this.save()
  }

  getMaxTextItems(): number {
    return this.maxTextItems
  }

  getMaxFileItems(): number {
    return this.maxFileItems
  }

  setFilesDir(newDir: string): boolean {
    try {
      if (!newDir || newDir === this.filesDir) return false

      // Ensure new directory exists
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true })
      }

      // Move all stored files to new directory
      const fileItems = this.items.filter(i => i.type === 'file' && i.storedPath)
      for (const item of fileItems) {
        if (item.storedPath && fs.existsSync(item.storedPath)) {
          const fileName = path.basename(item.storedPath)
          const newPath = path.join(newDir, fileName)
          try {
            if (fs.existsSync(newPath)) {
              // If file exists in new location, use a unique name
              const ext = path.extname(fileName)
              const fullBaseName = path.basename(fileName, ext)
              // Parse out any existing " (N)" suffix to avoid " (1) (1)" stacking
              const { base, startCounter } = this.parseNameAndCounter(fullBaseName)
              let counter = startCounter
              let uniquePath = newPath
              while (fs.existsSync(uniquePath)) {
                uniquePath = path.join(newDir, `${base} (${counter})${ext}`)
                counter++
              }
              fs.renameSync(item.storedPath, uniquePath)
              item.storedPath = uniquePath
              item.fileName = path.basename(uniquePath)
              item.preview = path.basename(uniquePath)
            } else {
              fs.renameSync(item.storedPath, newPath)
              item.storedPath = newPath
              if (!item.fileName) {
                item.fileName = fileName
              }
              if (!item.preview) {
                item.preview = fileName
              }
            }
          } catch (e) {
            console.error('Failed to move file:', item.storedPath, e)
          }
        }
      }

      // Update filesDir
      this.filesDir = newDir
      this.save()
      return true
    } catch (e) {
      console.error('Failed to set files directory:', e)
      return false
    }
  }

  getFilesDir(): string {
    return this.filesDir
  }
}

// ─── Settings Store ───────────────────────────────────────────

export interface AppSettings {
  toggleShortcut: string
  maxHistory: number
  maxFiles: number
  filesDir: string
  tokenRefreshInterval: number // in minutes, 0 = off
  englishSymbols: boolean // use English (half-width) symbols while typing in Chinese IME mode
}

const DEFAULT_SETTINGS: AppSettings = {
  toggleShortcut: 'CommandOrControl+Shift+V',
  maxHistory: 200,
  maxFiles: 100,
  filesDir: '',
  tokenRefreshInterval: 0, // 0 = off
  englishSymbols: false,
}

export class SettingsStore {
  private settings: AppSettings
  private filePath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'settings.json')
    this.settings = { ...DEFAULT_SETTINGS }
    this.load()
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(data)
        this.settings = { ...DEFAULT_SETTINGS, ...parsed }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  getToggleShortcut(): string {
    return this.settings.toggleShortcut
  }

  setToggleShortcut(shortcut: string): boolean {
    this.settings.toggleShortcut = shortcut
    this.save()
    return true
  }

  getMaxHistory(): number {
    return this.settings.maxHistory
  }

  setMaxHistory(max: number): boolean {
    const clamped = Math.max(10, Math.min(1000, Math.floor(max)))
    this.settings.maxHistory = clamped
    this.save()
    return true
  }

  getMaxFiles(): number {
    return this.settings.maxFiles
  }

  setMaxFiles(max: number): boolean {
    const clamped = Math.max(1, Math.min(500, Math.floor(max)))
    this.settings.maxFiles = clamped
    this.save()
    return true
  }

  getFilesDir(): string {
    return this.settings.filesDir || ''
  }

  setFilesDir(dir: string): boolean {
    this.settings.filesDir = dir
    this.save()
    return true
  }

  getTokenRefreshInterval(): number {
    return this.settings.tokenRefreshInterval || 0
  }

  getEnglishSymbols(): boolean {
    return !!this.settings.englishSymbols
  }

  setEnglishSymbols(enabled: boolean): boolean {
    this.settings.englishSymbols = !!enabled
    this.save()
    return true
  }

  setTokenRefreshInterval(minutes: number): boolean {
    const validValues = [0, 1, 5, 15, 30, 60, 180, 360, 720, 1440]
    const clamped = validValues.includes(minutes) ? minutes : 0
    this.settings.tokenRefreshInterval = clamped
    this.save()
    return true
  }

  resetToDefaults() {
    this.settings = { ...DEFAULT_SETTINGS }
    this.save()
  }
}
