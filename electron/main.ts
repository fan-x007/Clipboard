import { app, BrowserWindow, clipboard, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, screen, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { ClipboardStore, SettingsStore } from './store'
import { TokenStore, PlatformInfo } from './tokenStore'
import { loadPlatforms, getBalance, getSupportedPlatforms } from './tokenPlatforms'
import { TokenAlertManager, TokenAlertRule, clampWindow } from './tokenAlerts'
import type { AlertEvent } from './alertTypes'
import { ReminderManager, Reminder, normalizeReminder } from './reminders'
import { typingManager } from './typingManager'
import { imeHook } from './imeHook'
import { acceleratorManager } from './accelerator'
import { translateText, explainText, testConnection } from './translator'
import type { TranslateProfile } from './store'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: ClipboardStore | null = null
let settingsStore: SettingsStore | null = null
let tokenStore: TokenStore | null = null
let tokenPlatforms: PlatformInfo[] = []
let tokenAlerts: TokenAlertManager | null = null
let reminderManager: ReminderManager | null = null
let alertWindow: BrowserWindow | null = null
let pendingAlertEvents: AlertEvent[] = []
let isWatching = false
let lastText = ''
let lastFilePaths: string[] = []
let currentShortcut: string = ''
let tokenAutoRefreshTimer: NodeJS.Timeout | null = null

const POLL_INTERVAL = 500 // ms

// Get icon paths (from build dir in dev, resources dir in packaged app)
function getTrayIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tray.png')
  }
  return path.join(__dirname, '../build/tray.png')
}

function getAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png')
  }
  return path.join(__dirname, '../build/icon.png')
}

function createTrayIcon() {
  try {
    const iconPath = getTrayIconPath()
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16 })
      }
    }
  } catch {
    // fall through to SVG backup
  }
  // Fallback: SVG icon
  const TRAY_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
  <line x1="9" y1="12" x2="15" y2="12"/>
  <line x1="9" y1="16" x2="15" y2="16"/>
</svg>
`
  try {
    const img = nativeImage.createFromDataURL(
      'data:image/svg+xml;base64,' + Buffer.from(TRAY_ICON_SVG).toString('base64')
    )
    return img.resize({ width: 16, height: 16 })
  } catch {
    return nativeImage.createEmpty()
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load the built React app
  const indexPath = path.join(__dirname, '../dist/index.html')
  mainWindow.loadFile(indexPath)

  mainWindow.on('blur', () => {
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示剪贴板', click: () => toggleWindow() },
    { type: 'separator' },
    {
      label: '中文模式下使用英文符号',
      type: 'checkbox',
      checked: settingsStore?.getEnglishSymbols() || false,
      click: (item) => setEnglishSymbolsEnabled(item.checked),
    },
    { type: 'separator' },
    { label: 'Token 余额', click: () => {
      if (!mainWindow) return
      if (!mainWindow.isVisible()) {
        toggleWindow()
      }
      mainWindow.webContents.send('show-token-balance')
    }},
    { type: 'separator' },
    { label: '清空历史', click: () => {
      store?.clear()
      mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    }},
    { type: 'separator' },
    { label: '退出', click: () => {
      app.quit()
    }},
  ])
}

function rebuildTrayMenu() {
  tray?.setContextMenu(buildTrayMenu())
}

// Toggle "English symbols in Chinese IME mode" globally:
// persists the setting, enables/disables the keyboard hook, syncs tray + UI
function setEnglishSymbolsEnabled(enabled: boolean) {
  settingsStore?.setEnglishSymbols(enabled)
  imeHook.setEnabled(enabled)
  rebuildTrayMenu()
  mainWindow?.webContents.send('english-symbols-updated', enabled)
}

function createTray() {
  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('Clipboard Vibe')

  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => toggleWindow())
}

function toggleWindow() {
  if (!mainWindow) return

  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    // Position near cursor
    const cursor = screen.getCursorScreenPoint()
    const [width, height] = mainWindow.getSize()

    let x = cursor.x - Math.floor(width / 2)
    let y = cursor.y - height - 10

    // Clamp to screen bounds
    const display = screen.getDisplayNearestPoint(cursor)
    const bounds = display.workArea
    x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width))
    y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height))

    mainWindow.setPosition(x, y)
    mainWindow.show()
    mainWindow.focus()
  }
}

// Parse FileDrop (CF_HDROP) buffer to get multiple file paths
function parseFileDrop(buffer: Buffer): string[] {
  try {
    // DROPFILES structure:
    //   pFiles:  DWORD (4 bytes) - offset to file list
    //   pt:      POINT (8 bytes) - x, y (LONG each)
    //   fNC:     BOOL  (4 bytes)
    //   fWide:   BOOL  (4 bytes)
    if (buffer.length < 20) return []

    const pFilesOffset = buffer.readUInt32LE(0)
    const fWide = buffer.readUInt32LE(16) !== 0 // offset 20-4 = 16 (fWide is last field)

    if (pFilesOffset >= buffer.length) return []

    const fileData = buffer.slice(pFilesOffset)

    if (fWide) {
      // UTF-16LE, null-separated, double-null terminated
      const paths: string[] = []
      let start = 0
      for (let i = 0; i < fileData.length - 1; i += 2) {
        if (fileData.readUInt16LE(i) === 0) {
          if (i === start) {
            // Double null - end of list
            break
          }
          const str = fileData.toString('utf16le', start, i)
          if (str && fs.existsSync(str)) {
            paths.push(str)
          }
          start = i + 2
        }
      }
      return paths
    } else {
      // ANSI, null-separated, double-null terminated
      const paths: string[] = []
      let start = 0
      for (let i = 0; i < fileData.length; i++) {
        if (fileData[i] === 0) {
          if (i === start) break
          const str = fileData.toString('ascii', start, i)
          if (str && fs.existsSync(str)) {
            paths.push(str)
          }
          start = i + 1
        }
      }
      return paths
    }
  } catch (e) {
    console.error('Error parsing FileDrop:', e)
    return []
  }
}

// Get file paths from clipboard (Windows)
function getClipboardFiles(): string[] {
  try {
    // Try FileDrop (CF_HDROP) first - supports multiple files
    const fileDrop = clipboard.readBuffer('FileDrop')
    if (fileDrop && fileDrop.length > 0) {
      const paths = parseFileDrop(fileDrop)
      if (paths.length > 0) return paths
    }

    // Fallback: FileNameW (single file)
    const fileNameW = clipboard.readBuffer('FileNameW')
    if (fileNameW && fileNameW.length > 0) {
      const text = fileNameW.toString('utf16le').replace(/\0+$/, '')
      if (text && fs.existsSync(text)) {
        return [text]
      }
    }

    // Fallback: text/uri-list
    const uriList = clipboard.read('text/uri-list')
    if (uriList && uriList.trim().length > 0) {
      const paths = uriList
        .split(/\r?\n/)
        .filter(line => line.startsWith('file:///') && !line.startsWith('file:///.file'))
        .map(line => {
          let p = line.replace(/^file:\/\/\//, '')
          p = decodeURIComponent(p)
          p = p.replace(/\//g, '\\')
          return p
        })
        .filter(p => p.length > 0 && fs.existsSync(p))
      if (paths.length > 0) return paths
    }

    return []
  } catch (e) {
    console.error('Error reading clipboard files:', e)
    return []
  }
}

function startClipboardWatcher() {
  if (isWatching) return
  isWatching = true

  setInterval(() => {
    try {
      // Check for text
      const text = clipboard.readText()
      if (text && text.trim().length > 0) {
        if (text !== lastText) {
          lastText = text
          store?.addText(text)
          mainWindow?.webContents.send('history-updated', store?.getAll() || [])
        } else {
          // Same text - ensure it's at the top of history
          const allItems = store?.getAll() || []
          const firstHistoryText = allItems.find(i => i.type === 'text' && i.inHistory)
          const isAtTop = firstHistoryText && firstHistoryText.text === text
          if (!isAtTop) {
            store?.addText(text)
            mainWindow?.webContents.send('history-updated', store?.getAll() || [])
          }
        }
      }

      // Check for files
      const files = getClipboardFiles()
      if (files.length > 0) {
        const filesKey = files.sort().join('|')
        const lastKey = lastFilePaths.sort().join('|')
        if (filesKey !== lastKey) {
          lastFilePaths = [...files]
          let added = false
          for (const filePath of files) {
            const result = store?.addFile(filePath)
            if (result) added = true
          }
          if (added) {
            mainWindow?.webContents.send('history-updated', store?.getAll() || [])
          }
        } else {
          // Same clipboard content - ensure files are at the top of history
          const allItems = store?.getAll() || []
          const firstHistoryFile = allItems.find(i => i.type === 'file' && i.inHistory)
          const firstFilePath = files[0]
          const isAtTop = firstHistoryFile &&
            (firstHistoryFile.text === firstFilePath || firstHistoryFile.storedPath === firstFilePath)
          if (!isAtTop) {
            let added = false
            for (const filePath of files) {
              const result = store?.addFile(filePath)
              if (result) added = true
            }
            if (added) {
              mainWindow?.webContents.send('history-updated', store?.getAll() || [])
            }
          }
        }
      }
    } catch (e) {
      // ignore clipboard errors
    }
  }, POLL_INTERVAL)
}

function registerIpcHandlers() {
  ipcMain.handle('get-history', () => {
    return store?.getAll() || []
  })

  ipcMain.handle('copy-item', (_event, id: string) => {
    const item = store?.getAll().find(i => i.id === id)
    if (!item) return false

    if (item.type === 'text') {
      clipboard.writeText(item.text)
      lastText = item.text
    } else if (item.type === 'file' && item.storedPath) {
      try {
        const storedPath = item.storedPath
        if (!fs.existsSync(storedPath)) return false

        // Use PowerShell to set file to clipboard (proper CF_HDROP format)
        const escapedPath = storedPath.replace(/'/g, "''")
        const psCommand = `Set-Clipboard -Path '${escapedPath}'`
        execSync(`powershell -NoProfile -Command "${psCommand}"`, { windowsHide: true })

        // Update lastFilePaths to prevent re-capturing
        lastFilePaths = [storedPath]
      } catch (e) {
        console.error('Failed to copy file to clipboard:', e)
        return false
      }
    }
    return true
  })

  ipcMain.handle('open-file-location', (_event, id: string) => {
    const item = store?.getAll().find(i => i.id === id)
    if (item && item.type === 'file' && item.storedPath) {
      shell.showItemInFolder(item.storedPath)
      return true
    }
    return false
  })

  ipcMain.handle('open-file', (_event, id: string) => {
    const item = store?.getAll().find(i => i.id === id)
    if (item && item.type === 'file' && item.storedPath) {
      shell.openPath(item.storedPath)
      return true
    }
    return false
  })

  ipcMain.handle('delete-item', (_event, id: string) => {
    store?.delete(id)
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('delete-from-favorites', (_event, id: string) => {
    store?.deleteFromFavorites(id)
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('clear-history', () => {
    store?.clear()
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('clear-favorites', () => {
    store?.clearFavorites()
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('toggle-favorite', (_event, id: string) => {
    store?.toggleFavorite(id)
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('set-favorite-folder', (_event, id: string, folderId: string | undefined) => {
    store?.setFavoriteFolder(id, folderId)
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('favorite-folder:list', () => settingsStore?.getFavoriteFolders() || [])

  ipcMain.handle('favorite-folder:create', (_event, name: string, emoji?: string) => {
    const folder = settingsStore?.addFavoriteFolder(name, emoji)
    mainWindow?.webContents.send('favorite-folders-updated', settingsStore?.getFavoriteFolders() || [])
    return folder
  })

  ipcMain.handle('favorite-folder:rename', (_event, id: string, name: string) => {
    const ok = settingsStore?.renameFavoriteFolder(id, name) || false
    mainWindow?.webContents.send('favorite-folders-updated', settingsStore?.getFavoriteFolders() || [])
    return ok
  })

  ipcMain.handle('favorite-folder:delete', (_event, id: string) => {
    const ok = settingsStore?.deleteFavoriteFolder(id) || false
    // Unassign items from the deleted folder
    if (ok && store) {
      const clipStore = store
      clipStore.getAll().forEach(item => {
        if (item.favorite && item.folderId === id) {
          clipStore.setFavoriteFolder(item.id, undefined)
        }
      })
    }
    mainWindow?.webContents.send('favorite-folders-updated', settingsStore?.getFavoriteFolders() || [])
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return ok
  })

  ipcMain.handle('hide-window', () => {
    mainWindow?.hide()
    return true
  })

  // Settings handlers
  ipcMain.handle('get-settings', () => {
    return settingsStore?.get() || { toggleShortcut: 'CommandOrControl+Shift+V', maxHistory: 200, maxFiles: 100 }
  })

  ipcMain.handle('set-toggle-shortcut', (_event, shortcut: string) => {
    return updateToggleShortcut(shortcut)
  })

  ipcMain.handle('set-max-history', (_event, max: number) => {
    const clamped = Math.max(10, Math.min(1000, Math.floor(max)))
    settingsStore?.setMaxHistory(clamped)
    store?.setMaxTextItems(clamped)
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('set-max-files', (_event, max: number) => {
    const clamped = Math.max(1, Math.min(500, Math.floor(max)))
    settingsStore?.setMaxFiles(clamped)
    store?.setMaxFileItems(clamped)
    mainWindow?.webContents.send('history-updated', store?.getAll() || [])
    return true
  })

  ipcMain.handle('select-files-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件存储目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('set-files-directory', (_event, dir: string) => {
    if (!dir) return false
    const success = store?.setFilesDir(dir)
    if (success) {
      settingsStore?.setFilesDir(dir)
      mainWindow?.webContents.send('history-updated', store?.getAll() || [])
      return true
    }
    return false
  })

  ipcMain.handle('get-files-directory', () => {
    return store?.getFilesDir() || ''
  })

  ipcMain.handle('reset-files-directory', () => {
    const defaultDir = path.join(app.getPath('userData'), 'clipboard-files')
    const success = store?.setFilesDir(defaultDir)
    if (success) {
      settingsStore?.setFilesDir('')
      mainWindow?.webContents.send('history-updated', store?.getAll() || [])
      return true
    }
    return false
  })

  // ─── Token Balance Handlers ────────────────────────────────

  ipcMain.handle('token:get-platforms', () => {
    return tokenPlatforms
  })

  ipcMain.handle('token:get-keys', () => {
    return tokenStore?.getKeys() || []
  })

  ipcMain.handle('token:add-key', async (_event, platform: string, key: string, label: string) => {
    if (!tokenStore) return null
    const keyConfig = tokenStore.addKey(platform, key, label)

    // 异步查询余额
    try {
      const decryptedKey = tokenStore.getDecryptedKey(keyConfig.id)
      if (decryptedKey) {
        const balance = await getBalance(platform, decryptedKey)
        tokenStore.setBalance(keyConfig.id, { success: true, data: balance })
      }
    } catch (e) {
      tokenStore.setBalance(keyConfig.id, { success: false, error: (e as Error).message })
    }

    captureAndEvaluateAlerts()
    mainWindow?.webContents.send('token:keys-updated', tokenStore.getKeys())
    updateTokenTrayTooltip()
    return tokenStore.getKey(keyConfig.id)
  })

  ipcMain.handle('token:delete-key', (_event, id: string) => {
    tokenStore?.deleteKey(id)
    mainWindow?.webContents.send('token:keys-updated', tokenStore?.getKeys() || [])
    updateTokenTrayTooltip()
    return true
  })

  ipcMain.handle('token:refresh-balance', async (_event, id: string) => {
    if (!tokenStore) return null
    const keyConfig = tokenStore.getKey(id)
    if (!keyConfig) return null

    try {
      const decryptedKey = tokenStore.getDecryptedKey(id)
      if (!decryptedKey) {
        throw new Error('无法解密 API Key')
      }
      const balance = await getBalance(keyConfig.platform, decryptedKey)
      tokenStore.setBalance(id, { success: true, data: balance })
    } catch (e) {
      tokenStore.setBalance(id, { success: false, error: (e as Error).message })
    }

    captureAndEvaluateAlerts()
    mainWindow?.webContents.send('token:keys-updated', tokenStore.getKeys())
    updateTokenTrayTooltip()
    return tokenStore.getKey(id)
  })

  ipcMain.handle('token:refresh-all-balances', async () => {
    await refreshAllTokenBalances()
    return true
  })

  ipcMain.handle('token:open-recharge', (_event, platformId: string) => {
    const platform = tokenPlatforms.find(p => p.id === platformId)
    if (platform?.rechargeUrl) {
      shell.openExternal(platform.rechargeUrl)
    }
    return true
  })

  ipcMain.handle('token:get-refresh-interval', () => {
    return settingsStore?.getTokenRefreshInterval() || 0
  })

  ipcMain.handle('token:set-refresh-interval', (_event, minutes: number) => {
    const success = settingsStore?.setTokenRefreshInterval(minutes)
    if (success) {
      startTokenAutoRefresh(minutes)
      return true
    }
    return false
  })

  // ─── Rapid Consumption Alert Handlers ──────────────────────

  ipcMain.handle('alert:get-rules', () => {
    return settingsStore?.getTokenAlertRules() || []
  })

  ipcMain.handle('alert:get-status', () => {
    const rules = settingsStore?.getTokenAlertRules() || []
    if (!tokenAlerts) return rules.map(r => ({ ...r, consumed: 0 }))
    return tokenAlerts.getStatus(rules)
  })

  ipcMain.handle(
    'alert:add-rule',
    (_event, input: { name?: string; windowMinutes: number; threshold: number }) => {
      if (!settingsStore) return []
      const rules = settingsStore.getTokenAlertRules()
      const threshold = Number(input?.threshold)
      if (!Number.isFinite(threshold) || threshold <= 0) return rules

      const rule: TokenAlertRule = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
        name: String(input?.name || '').trim() || `消耗预警 ${rules.length + 1}`,
        windowMinutes: clampWindow(Number(input?.windowMinutes)),
        threshold: Math.round(threshold * 100) / 100,
        enabled: true,
        createdAt: Date.now(),
      }
      rules.push(rule)
      settingsStore.setTokenAlertRules(rules)
      notifyAlertRulesUpdated()
      processTokenAlerts()
      return settingsStore.getTokenAlertRules()
    }
  )

  ipcMain.handle('alert:delete-rule', (_event, id: string) => {
    if (!settingsStore) return []
    const rules = settingsStore.getTokenAlertRules().filter(r => r.id !== id)
    settingsStore.setTokenAlertRules(rules)
    notifyAlertRulesUpdated()
    return settingsStore.getTokenAlertRules()
  })

  ipcMain.handle('alert:toggle-rule', (_event, id: string, enabled: boolean) => {
    if (!settingsStore) return []
    const rules = settingsStore.getTokenAlertRules().map(r =>
      r.id === id ? { ...r, enabled: !!enabled } : r
    )
    settingsStore.setTokenAlertRules(rules)
    notifyAlertRulesUpdated()
    if (enabled) processTokenAlerts()
    return settingsStore.getTokenAlertRules()
  })

  ipcMain.handle('alert:test', () => {
    const rules = settingsStore?.getTokenAlertRules() || []
    const enabledRule = rules.find(r => r.enabled) || rules[0]
    const windowMinutes = enabledRule ? enabledRule.windowMinutes : 60
    const threshold = enabledRule && enabledRule.threshold > 0 ? enabledRule.threshold : 10
    const consumed = tokenAlerts?.getConsumption(windowMinutes).total || 0

    showAlertPopup([{
      kind: 'consumption',
      ruleId: enabledRule ? enabledRule.id : 'test',
      ruleName: enabledRule ? enabledRule.name : '示例预警',
      windowMinutes,
      threshold,
      consumed: Math.max(consumed, threshold * 1.2),
      triggeredAt: Date.now(),
    }])
    return true
  })

  // ─── Scheduled Reminder Handlers ──────────────────────────

  ipcMain.handle('reminder:get-all', () => {
    return settingsStore?.getReminders() || []
  })

  ipcMain.handle(
    'reminder:add',
    (_event, input: { title: string; note?: string; time: number; repeat?: string }) => {
      if (!settingsStore) return []
      const reminder = normalizeReminder({
        title: input?.title,
        note: input?.note,
        time: input?.time,
        repeat: input?.repeat as Reminder['repeat'],
        enabled: true,
        createdAt: Date.now(),
      })
      if (!reminder) return settingsStore.getReminders()

      // Recurring reminders only carry a time of day from the UI; make sure the
      // stored occurrence is the next one in the future even if it arrived late.
      if (reminder.repeat !== 'none') {
        const stepDays = reminder.repeat === 'daily' ? 1 : 7
        const next = new Date(reminder.time)
        while (next.getTime() <= Date.now()) {
          next.setDate(next.getDate() + stepDays)
        }
        reminder.time = next.getTime()
      }

      const reminders = settingsStore.getReminders()
      reminders.push(reminder)
      settingsStore.setReminders(reminders)
      notifyRemindersUpdated()
      reminderManager?.check()
      return settingsStore.getReminders()
    }
  )

  ipcMain.handle('reminder:update', (_event, id: string, patch: Partial<Reminder>) => {
    if (!settingsStore) return []
    const reminders = settingsStore.getReminders().map(r => {
      if (r.id !== id) return r
      const merged = normalizeReminder({ ...r, ...patch, id: r.id, createdAt: r.createdAt })
      return merged || r
    })
    settingsStore.setReminders(reminders)
    notifyRemindersUpdated()
    reminderManager?.check()
    return settingsStore.getReminders()
  })

  ipcMain.handle('reminder:delete', (_event, id: string) => {
    if (!settingsStore) return []
    settingsStore.setReminders(settingsStore.getReminders().filter(r => r.id !== id))
    notifyRemindersUpdated()
    return settingsStore.getReminders()
  })

  ipcMain.handle('reminder:toggle', (_event, id: string, enabled: boolean) => {
    if (!settingsStore) return []
    settingsStore.setReminders(
      settingsStore.getReminders().map(r => (r.id === id ? { ...r, enabled: !!enabled } : r))
    )
    notifyRemindersUpdated()
    if (enabled) reminderManager?.check()
    return settingsStore.getReminders()
  })

  ipcMain.handle('reminder:test', () => {
    showAlertPopup([{
      kind: 'reminder',
      reminderId: 'test',
      title: '示例提醒',
      note: '这是一条定时提醒的预览效果，到时间后会像这样强制弹出。',
      scheduledAt: Date.now(),
      triggeredAt: Date.now(),
    }])
    return true
  })

  ipcMain.handle('alert:get-events', () => pendingAlertEvents)

  ipcMain.handle('alert:close', () => {
    alertWindow?.close()
    return true
  })

  ipcMain.handle('alert:open-token-panel', () => {
    alertWindow?.close()
    showMainWindowOnTokenTab()
    return true
  })

  // ─── Auto Typing Handlers ────────────────────────────────

  ipcMain.handle('typing:get-status', () => {
    return typingManager.getStatus()
  })

  ipcMain.handle('typing:start', (_event, text: string, delay: number, interval: number, useEnglishSymbols: boolean) => {
    return typingManager.startTyping(text, delay, interval, !!useEnglishSymbols)
  })

  ipcMain.handle('typing:stop', () => {
    return typingManager.stopTyping()
  })

  // ─── IME English Symbols (global keyboard hook) ────────────────

  ipcMain.handle('ime:get-english-symbols', () => {
    return settingsStore?.getEnglishSymbols() || false
  })

  ipcMain.handle('ime:set-english-symbols', (_event, enabled: boolean) => {
    setEnglishSymbolsEnabled(!!enabled)
    return true
  })

  // ─── Website Accelerator (hosts-based) ────────────────

  ipcMain.handle('accelerator:get-status', () => {
    return acceleratorManager.getStatus()
  })

  ipcMain.handle('accelerator:set', (_event, service: string, enabled: boolean) => {
    if (service !== 'github' && service !== 'steam') {
      return { success: false, message: '未知服务' }
    }
    return acceleratorManager.setEnabled(service, enabled)
  })

  // ─── Translation (LLM-powered) ─────────────────────────

  ipcMain.handle('translate:run', async (_event, text: string, target: string) => {
    const targetLang = target === 'zh' ? 'zh' : 'en'
    return translateText(String(text || ''), targetLang, {
      apiUrl: settingsStore!.getTranslateApiUrl(),
      apiKey: settingsStore!.getTranslateApiKey(),
      model: settingsStore!.getTranslateModel(),
    })
  })

  ipcMain.handle('translate:explain', async (_event, text: string) => {
    return explainText(String(text || ''), {
      apiUrl: settingsStore!.getTranslateApiUrl(),
      apiKey: settingsStore!.getTranslateApiKey(),
      model: settingsStore!.getTranslateModel(),
    })
  })

  ipcMain.handle('translate:get-config', () => {
    return {
      apiUrl: settingsStore!.getTranslateApiUrl(),
      apiKey: settingsStore!.getTranslateApiKey(),
      model: settingsStore!.getTranslateModel(),
      profiles: settingsStore!.getTranslateProfiles(),
    }
  })

  ipcMain.handle(
    'translate:set-config',
    (_event, config: { apiUrl: string; apiKey: string; model: string }) => {
      return settingsStore!.setTranslateConfig(config.apiUrl || '', config.apiKey || '', config.model || '')
    }
  )

  ipcMain.handle(
    'translate:set-profiles',
    (_event, profiles: unknown, activeName?: string) => {
      return settingsStore!.setTranslateProfiles(
        Array.isArray(profiles) ? (profiles as TranslateProfile[]) : [],
        activeName || undefined
      )
    }
  )

  ipcMain.handle('set-inline-translate-limit', (_event, limit: number) => {
    return settingsStore!.setInlineTranslateLimit(Number(limit) || 0)
  })

  ipcMain.handle('translate:test', (_event, config: { apiUrl: string; apiKey: string; model: string }) => {
    return testConnection({
      apiUrl: String(config?.apiUrl || '').trim(),
      apiKey: String(config?.apiKey || '').trim(),
      model: String(config?.model || '').trim(),
    })
  })
}

function registerShortcuts() {
  const shortcut = settingsStore?.getToggleShortcut() || 'CommandOrControl+Shift+V'
  updateToggleShortcut(shortcut)
}

// ─── Token Balance Helpers ────────────────────────────────

async function refreshAllTokenBalances() {
  if (!tokenStore) return
  const keys = tokenStore.getKeys()
  for (const key of keys) {
    try {
      const decryptedKey = tokenStore.getDecryptedKey(key.id)
      if (decryptedKey) {
        const balance = await getBalance(key.platform, decryptedKey)
        tokenStore.setBalance(key.id, { success: true, data: balance })
      }
    } catch (e) {
      tokenStore.setBalance(key.id, { success: false, error: (e as Error).message })
    }
  }
  mainWindow?.webContents.send('token:keys-updated', tokenStore.getKeys())
  updateTokenTrayTooltip()
  captureAndEvaluateAlerts()
}

// ─── Rapid Consumption Alerts ────────────────────────────────

function captureAndEvaluateAlerts() {
  if (!tokenStore) return
  tokenAlerts?.record(tokenStore.getKeys())
  processTokenAlerts()
}

function processTokenAlerts() {
  if (!tokenAlerts || !settingsStore) return
  const rules = settingsStore.getTokenAlertRules()
  if (rules.length === 0) return

  const { events, updatedRules } = tokenAlerts.evaluate(rules)
  if (events.length > 0) {
    if (updatedRules !== rules) {
      settingsStore.setTokenAlertRules(updatedRules)
      notifyAlertRulesUpdated()
    }
    showAlertPopup(events)
  }
}

function notifyAlertRulesUpdated() {
  const rules = settingsStore?.getTokenAlertRules() || []
  mainWindow?.webContents.send('alert:rules-updated', rules)
}

function notifyRemindersUpdated() {
  const reminders = settingsStore?.getReminders() || []
  mainWindow?.webContents.send('reminder:updated', reminders)
}

function showMainWindowOnTokenTab() {
  if (!mainWindow) return
  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  mainWindow.focus()
  mainWindow.webContents.send('show-token-balance')
}

/** Forced, always-on-top alert popup. Multiple events are shown in one page. */
function showAlertPopup(events: AlertEvent[]) {
  if (events.length === 0) return
  pendingAlertEvents.push(...events)

  if (alertWindow && !alertWindow.isDestroyed()) {
    alertWindow.webContents.send('alert:data', pendingAlertEvents)
    alertWindow.setAlwaysOnTop(true, 'screen-saver')
    alertWindow.show()
    alertWindow.focus()
    return
  }

  alertWindow = new BrowserWindow({
    width: 470,
    height: 480,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    center: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Keep the alert above full-screen apps until the user acknowledges it.
  alertWindow.setAlwaysOnTop(true, 'screen-saver')
  alertWindow.loadFile(path.join(__dirname, '../dist/alert.html'))

  alertWindow.webContents.on('did-finish-load', () => {
    if (!alertWindow) return
    alertWindow.webContents.send('alert:data', pendingAlertEvents)
    alertWindow.show()
    alertWindow.focus()
  })

  alertWindow.on('blur', () => {
    if (alertWindow && !alertWindow.isDestroyed()) {
      alertWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  })

  alertWindow.on('closed', () => {
    alertWindow = null
    pendingAlertEvents = []
  })
}

function updateTokenTrayTooltip() {
  if (!tray || !tokenStore) return
  const keys = tokenStore.getKeys()
  const totalCny = keys
    .filter(k => k.balance?.success && k.balance.data?.currency === 'CNY')
    .reduce((sum, k) => sum + (k.balance!.data!.totalBalance || 0), 0)
  if (totalCny > 0) {
    const availableCount = keys.filter(k => k.balance?.success && k.balance.data?.isAvailable).length
    tray.setToolTip(`Clipboard Vibe  |  Token: ¥${totalCny.toFixed(2)} (${availableCount}/${keys.length})`)
  } else {
    tray.setToolTip('Clipboard Vibe')
  }
}

// ─── Token Auto Refresh ────────────────────────────────

function startTokenAutoRefresh(minutes: number) {
  stopTokenAutoRefresh()
  if (minutes <= 0) return

  const intervalMs = minutes * 60 * 1000
  tokenAutoRefreshTimer = setInterval(() => {
    refreshAllTokenBalances()
  }, intervalMs)
}

function stopTokenAutoRefresh() {
  if (tokenAutoRefreshTimer) {
    clearInterval(tokenAutoRefreshTimer)
    tokenAutoRefreshTimer = null
  }
}

function updateToggleShortcut(newShortcut: string): boolean {
  // Unregister old shortcut if exists
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
  }

  // Register new shortcut
  const ret = globalShortcut.register(newShortcut, () => {
    toggleWindow()
  })

  if (ret) {
    currentShortcut = newShortcut
    settingsStore?.setToggleShortcut(newShortcut)
    return true
  } else {
    console.error('Shortcut registration failed:', newShortcut)
    // Try to re-register old one if new one fails
    if (currentShortcut) {
      globalShortcut.register(currentShortcut, () => toggleWindow())
    }
    return false
  }
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore()
  const maxHistory = settingsStore.getMaxHistory()
  const maxFiles = settingsStore.getMaxFiles()
  const customFilesDir = settingsStore.getFilesDir()
  store = new ClipboardStore(maxHistory, maxFiles)
  // If custom files directory is set, move files there
  if (customFilesDir) {
    store.setFilesDir(customFilesDir)
  }

  // Initialize token balance module
  tokenPlatforms = await loadPlatforms()
  tokenStore = new TokenStore()
  tokenAlerts = new TokenAlertManager()

  // Scheduled reminders: poll every 15s and force the alert popup when due
  reminderManager = new ReminderManager(
    () => settingsStore?.getReminders() || [],
    reminders => settingsStore?.setReminders(reminders),
    events => showAlertPopup(events)
  )

  createWindow()
  createTray()
  registerIpcHandlers()
  registerShortcuts()
  startClipboardWatcher()

  reminderManager.start()

  // Refresh token balances on startup (in background)
  refreshAllTokenBalances()

  // Restore English symbols hook if enabled
  if (settingsStore.getEnglishSymbols()) {
    imeHook.setEnabled(true)
  }

  // Start token auto-refresh if configured
  const refreshInterval = settingsStore.getTokenRefreshInterval()
  if (refreshInterval > 0) {
    startTokenAutoRefresh(refreshInterval)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  imeHook.stop()
})
