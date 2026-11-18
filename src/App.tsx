import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  ClipboardItem,
  AppSettings,
  TokenKeyConfig,
  TokenPlatformInfo,
  TokenAlertRule,
  AlertRuleStatus,
  TypingStatus,
  Reminder,
  ReminderRepeat,
  FavoriteFolder,
} from './vite-env.d'

type TabType = 'all' | 'files' | 'favorites' | 'token' | 'typing' | 'settings'

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+V'

// Format a timestamp into the value expected by <input type="datetime-local">
function toDateTimeLocalInput(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Format a timestamp into the value expected by <input type="time">
function toClockInput(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
]

function formatReminderTime(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = `${d.getMonth() + 1}月${d.getDate()}日`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameYear ? `${date} ${time}` : `${d.getFullYear()}年${date} ${time}`
}

const REPEAT_LABELS: Record<ReminderRepeat, string> = {
  none: '一次性',
  daily: '每天',
  weekly: '每周',
}
const DEFAULT_MAX_HISTORY = 200
const DEFAULT_MAX_FILES = 100
// Convert Electron accelerator to display text
function shortcutToDisplay(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Command/g, 'Cmd')
    .replace(/Control/g, 'Ctrl')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift')
    .replace(/\+/g, ' + ')
}

// Convert keyboard event to Electron accelerator string
function eventToAccelerator(e: KeyboardEvent): string | null {
  const keys: string[] = []

  if (e.ctrlKey) keys.push('Control')
  if (e.altKey) keys.push('Alt')
  if (e.shiftKey) keys.push('Shift')
  if (e.metaKey) keys.push('Command')

  // Need at least one modifier
  if (keys.length === 0) return null

  const key = e.key
  if (!key) return null

  // Ignore modifier keys themselves
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(key)) return null

  // Map common keys
  let keyName = key
  if (key === ' ') {
    keyName = 'Space'
  } else if (key.length === 1) {
    keyName = key.toUpperCase()
  } else if (key.startsWith('Arrow')) {
    keyName = key.replace('Arrow', '')
  }

  keys.push(keyName)
  return keys.join('+')
}

// Format file size to human readable
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Get file icon based on extension
function getFileIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    // Images
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', bmp: '🖼️', svg: '🖼️', webp: '🖼️', ico: '🖼️',
    // Documents
    pdf: '📄', doc: '📝', docx: '📝', txt: '📃', md: '📝', rtf: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📽️', pptx: '📽️',
    // Archives
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    // Audio
    mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵', m4a: '🎵',
    // Video
    mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬',
    // Code
    js: '💻', ts: '💻', jsx: '💻', tsx: '💻', html: '💻', css: '💻', scss: '💻',
    py: '💻', java: '💻', cpp: '💻', c: '💻', h: '💻', json: '💻', xml: '💻',
    // Executables
    exe: '⚙️', msi: '⚙️', bat: '⚙️', cmd: '⚙️', ps1: '⚙️', sh: '⚙️',
  }
  return iconMap[ext] || '📄'
}

function App() {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Settings state
  const [settings, setSettings] = useState<AppSettings>({
    toggleShortcut: DEFAULT_SHORTCUT,
    maxHistory: DEFAULT_MAX_HISTORY,
    maxFiles: DEFAULT_MAX_FILES,
    filesDir: '',
  })
  const [isRecording, setIsRecording] = useState(false)
  const [recordedKeys, setRecordedKeys] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const recordBtnRef = useRef<HTMLButtonElement>(null)

  // ─── Token Balance State ────────────────────────────────
  const [tokenPlatforms, setTokenPlatforms] = useState<TokenPlatformInfo[]>([])
  const [tokenKeys, setTokenKeys] = useState<TokenKeyConfig[]>([])
  const [selectedTokenPlatform, setSelectedTokenPlatform] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [accessKeySecret, setAccessKeySecret] = useState('')
  const [apiKeyLabel, setApiKeyLabel] = useState('')
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenToast, setTokenToast] = useState<{ msg: string; type: string } | null>(null)
  const tokenToastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [tokenRefreshInterval, setTokenRefreshInterval] = useState(0) // 0 = off

  // ─── Rapid Consumption Alert State ─────────────────────
  const [alertRules, setAlertRules] = useState<TokenAlertRule[]>([])
  const [alertRuleStatus, setAlertRuleStatus] = useState<AlertRuleStatus[]>([])
  const [newAlertName, setNewAlertName] = useState('')
  const [newAlertWindow, setNewAlertWindow] = useState(60)
  const [newAlertCustomValue, setNewAlertCustomValue] = useState('')
  const [newAlertCustomUnit, setNewAlertCustomUnit] = useState<'hours' | 'days'>('hours')
  const [newAlertThreshold, setNewAlertThreshold] = useState('')
  const [alertAdding, setAlertAdding] = useState(false)

  // ─── Scheduled Reminder State ──────────────────────────
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [reminderTitle, setReminderTitle] = useState('')
  const [reminderNote, setReminderNote] = useState('')
  const [reminderTime, setReminderTime] = useState(() => toDateTimeLocalInput(Date.now() + 5 * 60 * 1000))
  const [reminderClock, setReminderClock] = useState(() => toClockInput(Date.now() + 5 * 60 * 1000))
  const [reminderWeekday, setReminderWeekday] = useState(() => new Date().getDay())
  const [reminderRepeat, setReminderRepeat] = useState<ReminderRepeat>('none')
  const [reminderAdding, setReminderAdding] = useState(false)

  // ─── Website Accelerator State ─────────────────────────
  const [accelStatus, setAccelStatus] = useState({ github: false, steam: false })
  const [accelBusy, setAccelBusy] = useState({ github: false, steam: false })

  // ─── Translator State ──────────────────────────────────
  const [showTranslator, setShowTranslator] = useState(false)
  const [transDir, setTransDir] = useState<'zh-en' | 'en-zh'>('zh-en')
  const [transMode, setTransMode] = useState<'translate' | 'explain'>('translate')
  const [transInput, setTransInput] = useState('')
  const [transOutput, setTransOutput] = useState('')
  const [transLoading, setTransLoading] = useState(false)
  const [transError, setTransError] = useState('')

  // ─── Favorite Folder State ────────────────────────────────
  const [folders, setFolders] = useState<FavoriteFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string>('all') // 'all' | 'none' | folderId
  const [showFolderMenu, setShowFolderMenu] = useState<string | null>(null) // itemId of open folder menu
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const [translateConfig, setTranslateConfig] = useState({
    apiUrl: '',
    apiKey: '',
    model: '',
    profiles: [] as { name: string; apiUrl: string; apiKey: string; model: string }[],
  })
  const [activeProfile, setActiveProfile] = useState('') // current profile name, empty = custom/unsaved
  const [profileName, setProfileName] = useState('') // name input when saving a profile
  const [transSaveStatus, setTransSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [transTesting, setTransTesting] = useState(false)
  const [transTestResult, setTransTestResult] = useState<{ success: boolean; message: string } | null>(null)
  // Inline quick translation for short history items (< 20 chars)
  const [inlineTrans, setInlineTrans] = useState<{ id: string; loading: boolean; text?: string; error?: string } | null>(null)

  // ─── Auto Typing State ────────────────────────────────
  const [typingText, setTypingText] = useState('')
  const [typingDelay, setTypingDelay] = useState(3)
  const [typingInterval, setTypingInterval] = useState(15)
  const [typingEnglishSymbols, setTypingEnglishSymbols] = useState(false)
  const [typingStatus, setTypingStatus] = useState<TypingStatus>({
    isRunning: false,
    status: '就绪',
    progress: 0,
    current: 0,
    total: 0,
  })

  // Filter items based on search and tab
  const filteredItems = items.filter(item => {
    const matchesSearch = searchQuery === '' ||
      item.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.fileName && item.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
    let matchesTab = false
    if (activeTab === 'all') matchesTab = item.inHistory
    else if (activeTab === 'files') matchesTab = item.type === 'file' && item.inHistory
    else if (activeTab === 'favorites') matchesTab = item.favorite

    let matchesFolder = true
    if (activeTab === 'favorites' && matchesTab) {
      if (selectedFolder === 'none') matchesFolder = !item.folderId
      else if (selectedFolder !== 'all') matchesFolder = item.folderId === selectedFolder
    }
    return matchesSearch && matchesTab && matchesFolder
  })

  // Load initial history
  useEffect(() => {
    if (window.clipboardApi) {
      window.clipboardApi.getHistory().then(setItems)
    }
  }, [])

  // Load settings
  useEffect(() => {
    if (window.clipboardApi) {
      window.clipboardApi.getSettings().then(s => setSettings(s))
      window.clipboardApi.getFilesDirectory().then(dir => {
        setSettings(prev => ({ ...prev, filesDir: dir }))
      })
    }
  }, [])

  // Listen for history updates
  useEffect(() => {
    if (window.clipboardApi) {
      window.clipboardApi.onHistoryUpdated((newItems) => {
        setItems(newItems)
        setSelectedIndex(0)
      })
    }
  }, [])

  // Load favorite folders and listen for updates
  useEffect(() => {
    if (!window.clipboardApi) return
    window.clipboardApi.listFavoriteFolders().then(setFolders)
    window.clipboardApi.onFavoriteFoldersUpdated(setFolders)
  }, [])

  // ─── Token Balance Effects ────────────────────────────────

  // Load token data on mount
  useEffect(() => {
    if (window.tokenApi) {
      Promise.all([
        window.tokenApi.getPlatforms(),
        window.tokenApi.getKeys(),
        window.tokenApi.getRefreshInterval(),
      ]).then(([plats, keys, interval]) => {
        setTokenPlatforms(plats)
        setTokenKeys(keys)
        setTokenRefreshInterval(interval)
        if (plats.length > 0) {
          setSelectedTokenPlatform(plats[0].id)
        }
      })
    }
  }, [])

  // Listen for token key updates
  useEffect(() => {
    if (window.tokenApi) {
      window.tokenApi.onKeysUpdated((keys) => {
        setTokenKeys(keys)
      })
    }
  }, [])

  // Listen for show-token-balance from tray
  useEffect(() => {
    if (window.tokenApi) {
      window.tokenApi.onShowTokenBalance(() => {
        setActiveTab('token')
      })
    }
  }, [])

  // Load rapid consumption alert rules
  useEffect(() => {
    if (window.alertApi) {
      window.alertApi.getRules().then(setAlertRules)
      window.alertApi.getStatus().then(setAlertRuleStatus)
      window.alertApi.onRulesUpdated((rules) => {
        setAlertRules(rules)
        window.alertApi.getStatus().then(setAlertRuleStatus)
      })
    }
  }, [])

  // Refresh each rule's current consumption whenever balances update
  useEffect(() => {
    if (window.alertApi) {
      window.alertApi.getStatus().then(setAlertRuleStatus)
    }
  }, [tokenKeys])

  // Load scheduled reminders
  useEffect(() => {
    if (!window.reminderApi) return
    window.reminderApi.getAll().then(setReminders)
    window.reminderApi.onUpdated(setReminders)
  }, [])

  // Load accelerator status on mount
  useEffect(() => {
    if (window.acceleratorApi) {
      window.acceleratorApi.getStatus().then(setAccelStatus)
    }
    if (window.translateApi) {
      window.translateApi.getConfig().then(c => setTranslateConfig({ ...c, profiles: c.profiles || [] }))
    }
  }, [])

  // ─── Auto Typing Effects ────────────────────────────────

  // Load typing status on mount
  useEffect(() => {
    if (window.typingApi) {
      window.typingApi.getStatus().then(setTypingStatus)
    }
  }, [])

  // Listen for typing status updates
  useEffect(() => {
    if (window.typingApi) {
      window.typingApi.onStatusUpdated((status) => {
        setTypingStatus(status)
      })
    }
  }, [])

  // Load english symbols setting and follow external changes (e.g. tray menu)
  useEffect(() => {
    if (window.imeApi) {
      window.imeApi.getEnglishSymbols().then(setTypingEnglishSymbols)
      window.imeApi.onEnglishSymbolsUpdated((enabled) => {
        setTypingEnglishSymbols(enabled)
      })
    }
  }, [])

  // Focus search on mount / tab change
  useEffect(() => {
    if (activeTab !== 'settings') {
      searchRef.current?.focus()
    }
  }, [activeTab])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery, activeTab])

  // Keyboard navigation (only when not in settings/token tab and not recording)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRecording || isSettingsTab || activeTab === 'token' || activeTab === 'typing') return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev =>
          prev < filteredItems.length - 1 ? prev + 1 : prev
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[selectedIndex]) {
          handleCopy(filteredItems[selectedIndex].id)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        window.clipboardApi?.hideWindow()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (filteredItems[selectedIndex] && !searchRef.current?.matches(':focus')) {
          e.preventDefault()
          handleDelete(filteredItems[selectedIndex].id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredItems, selectedIndex, isRecording, activeTab])

  // Shortcut recording handler
  useEffect(() => {
    if (!isRecording) return

    const handleRecordKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const accelerator = eventToAccelerator(e)
      if (accelerator) {
        setRecordedKeys(accelerator)
      } else {
        const mods: string[] = []
        if (e.ctrlKey) mods.push('Ctrl')
        if (e.altKey) mods.push('Alt')
        if (e.shiftKey) mods.push('Shift')
        if (e.metaKey) mods.push('Cmd')
        if (mods.length > 0) {
          setRecordedKeys(mods.join(' + ') + ' + ...')
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const accelerator = eventToAccelerator(e)
      if (accelerator) {
        confirmShortcut(accelerator)
      }
    }

    window.addEventListener('keydown', handleRecordKey, true)
    window.addEventListener('keyup', handleKeyUp, true)

    return () => {
      window.removeEventListener('keydown', handleRecordKey, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [isRecording])

  // Scroll selected item into view
  useEffect(() => {
    const selectedEl = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleCopy = useCallback((id: string) => {
    window.clipboardApi?.copyItem(id)
    window.clipboardApi?.hideWindow()
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (activeTab === 'favorites') {
      await window.clipboardApi?.deleteFromFavorites(id)
    } else {
      await window.clipboardApi?.deleteItem(id)
    }
  }, [activeTab])

  const handleToggleFavorite = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.clipboardApi?.toggleFavorite(id)
  }, [])

  const handleOpenFile = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.clipboardApi?.openFile(id)
  }, [])

  const handleOpenFileLocation = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.clipboardApi?.openFileLocation(id)
  }, [])

  const handleClearHistory = useCallback(() => {
    if (confirm('确定要清空所有剪贴板历史吗？收藏的内容会保留。')) {
      window.clipboardApi?.clearHistory()
    }
  }, [])

  const handleClearFavorites = useCallback(() => {
    if (confirm('确定要清空所有收藏吗？此操作不可恢复。')) {
      window.clipboardApi?.clearFavorites()
    }
  }, [])

  // ─── Favorite Folder Handlers ────────────────────────────

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name) return
    const folder = await window.clipboardApi?.createFavoriteFolder(name)
    if (folder) {
      setNewFolderName('')
      setShowNewFolderInput(false)
      setSelectedFolder(folder.id)
    }
  }, [newFolderName])

  const startRenameFolder = useCallback((id: string, currentName: string) => {
    setRenamingFolderId(id)
    setRenameFolderName(currentName)
    setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }, [])

  const handleRenameFolder = useCallback(async () => {
    if (!renamingFolderId) return
    const name = renameFolderName.trim()
    if (!name) {
      setRenamingFolderId(null)
      return
    }
    await window.clipboardApi?.renameFavoriteFolder(renamingFolderId, name)
    setRenamingFolderId(null)
  }, [renamingFolderId, renameFolderName])

  const handleDeleteFolder = useCallback(async (id: string) => {
    if (!confirm('确定删除该收藏夹吗？收藏项不会被删除，会归入「未分类」。')) return
    await window.clipboardApi?.deleteFavoriteFolder(id)
    if (selectedFolder === id) setSelectedFolder('all')
  }, [selectedFolder])

  const handleMoveToFolder = useCallback(async (itemId: string, folderId: string | undefined) => {
    await window.clipboardApi?.setFavoriteFolder(itemId, folderId)
    setShowFolderMenu(null)
  }, [])

  const toggleFolderMenu = useCallback((itemId: string) => {
    setShowFolderMenu(prev => (prev === itemId ? null : itemId))
  }, [])

  // Close any open folder menu when clicking outside
  useEffect(() => {
    if (!showFolderMenu && !renamingFolderId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (showFolderMenu && !target.closest('.folder-move-menu') && !target.closest('.folder-move-btn')) {
        setShowFolderMenu(null)
      }
      if (renamingFolderId && !target.closest('.folder-chip-rename')) {
        setRenamingFolderId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFolderMenu, renamingFolderId])

  const handleClose = useCallback(() => {
    window.clipboardApi?.hideWindow()
  }, [])

  const startRecording = useCallback(() => {
    setIsRecording(true)
    setRecordedKeys('按下快捷键组合...')
    setSaveStatus('idle')
  }, [])

  const confirmShortcut = useCallback(async (accelerator: string) => {
    setIsRecording(false)
    const success = await window.clipboardApi?.setToggleShortcut(accelerator)
    if (success) {
      setSettings(prev => ({ ...prev, toggleShortcut: accelerator }))
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } else {
      setSaveStatus('error')
      setRecordedKeys('')
    }
  }, [])

  const cancelRecording = useCallback(() => {
    setIsRecording(false)
    setRecordedKeys('')
  }, [])

  const resetShortcut = useCallback(async () => {
    const success = await window.clipboardApi?.setToggleShortcut(DEFAULT_SHORTCUT)
    if (success) {
      setSettings(prev => ({ ...prev, toggleShortcut: DEFAULT_SHORTCUT }))
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }, [])

  const handleMaxHistoryChange = useCallback(async (value: number) => {
    const clamped = Math.max(10, Math.min(1000, Math.floor(value)))
    setSettings(prev => ({ ...prev, maxHistory: clamped }))
    await window.clipboardApi?.setMaxHistory(clamped)
  }, [])

  const handleMaxFilesChange = useCallback(async (value: number) => {
    const clamped = Math.max(1, Math.min(500, Math.floor(value)))
    setSettings(prev => ({ ...prev, maxFiles: clamped }))
    await window.clipboardApi?.setMaxFiles(clamped)
  }, [])

  const handleInlineLimitChange = useCallback(async (value: number) => {
    const clamped = Math.max(0, Math.min(500, Math.floor(value)))
    setSettings(prev => ({ ...prev, inlineTranslateLimit: clamped }))
    await window.clipboardApi?.setInlineTranslateLimit(clamped)
  }, [])

  const handleSelectFilesDir = useCallback(async () => {
    const dir = await window.clipboardApi?.selectFilesDirectory()
    if (dir) {
      const success = await window.clipboardApi?.setFilesDirectory(dir)
      if (success) {
        setSettings(prev => ({ ...prev, filesDir: dir }))
      }
    }
  }, [])

  const handleResetFilesDir = useCallback(async () => {
    const success = await window.clipboardApi?.resetFilesDirectory()
    if (success) {
      setSettings(prev => ({ ...prev, filesDir: '' }))
    }
  }, [])

  const resetAllSettings = useCallback(async () => {
    if (window.clipboardApi) {
      await window.clipboardApi.setToggleShortcut(DEFAULT_SHORTCUT)
      await window.clipboardApi.setMaxHistory(DEFAULT_MAX_HISTORY)
      await window.clipboardApi.setMaxFiles(DEFAULT_MAX_FILES)
      await window.clipboardApi.resetFilesDirectory()
      setSettings({
        toggleShortcut: DEFAULT_SHORTCUT,
        maxHistory: DEFAULT_MAX_HISTORY,
        maxFiles: DEFAULT_MAX_FILES,
        filesDir: '',
      })
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }, [])

  // ─── Token Balance Handlers ────────────────────────────────

  const showTokenToast = useCallback((msg: string, type = 'success', duration = 2500) => {
    setTokenToast({ msg, type })
    if (tokenToastTimerRef.current) clearTimeout(tokenToastTimerRef.current)
    tokenToastTimerRef.current = setTimeout(() => setTokenToast(null), duration)
  }, [])

  const handleAddTokenKey = useCallback(async () => {
    if (!selectedTokenPlatform) {
      showTokenToast('请选择平台', 'error')
      return
    }

    const platform = tokenPlatforms.find(p => p.id === selectedTokenPlatform)
    const isCloudKey = platform && platform.credentialType !== 'api_key'
    let keyValue = ''

    if (isCloudKey) {
      const idLabel = platform?.credentialType === 'tencent_cloud' ? 'SecretId' : 'AccessKey ID'
      const secretLabel = platform?.credentialType === 'tencent_cloud' ? 'SecretKey' : 'AccessKey Secret'
      if (!accessKeyId.trim() || !accessKeySecret.trim()) {
        showTokenToast(`请输入 ${idLabel} 和 ${secretLabel}`, 'error')
        return
      }
      keyValue = `${accessKeyId.trim()}|${accessKeySecret.trim()}`
    } else {
      if (!apiKeyInput.trim()) {
        showTokenToast('请输入 API Key', 'error')
        return
      }
      keyValue = apiKeyInput.trim()
    }

    setTokenLoading(true)
    try {
      const result = await window.tokenApi?.addKey(
        selectedTokenPlatform,
        keyValue,
        apiKeyLabel.trim()
      )
      if (result) {
        showTokenToast('添加成功，正在查询余额...')
        setApiKeyInput('')
        setAccessKeyId('')
        setAccessKeySecret('')
        setApiKeyLabel('')
      }
    } catch (e) {
      showTokenToast(`添加失败: ${(e as Error).message}`, 'error')
    } finally {
      setTokenLoading(false)
    }
  }, [selectedTokenPlatform, tokenPlatforms, apiKeyInput, accessKeyId, accessKeySecret, apiKeyLabel, showTokenToast])

  const handleDeleteTokenKey = useCallback(async (id: string) => {
    try {
      await window.tokenApi?.deleteKey(id)
      showTokenToast('已删除')
    } catch (e) {
      showTokenToast('删除失败', 'error')
    }
  }, [showTokenToast])

  const handleRefreshTokenBalance = useCallback(async (id: string) => {
    try {
      await window.tokenApi?.refreshBalance(id)
    } catch (e) {
      showTokenToast('刷新失败', 'error')
    }
  }, [showTokenToast])

  const handleRefreshAllTokens = useCallback(async () => {
    try {
      await window.tokenApi?.refreshAllBalances()
      showTokenToast('已刷新所有余额')
    } catch (e) {
      showTokenToast('刷新失败', 'error')
    }
  }, [showTokenToast])

  const handleOpenRecharge = useCallback((platformId: string) => {
    window.tokenApi?.openRecharge(platformId)
  }, [])

  const handleSetRefreshInterval = useCallback(async (minutes: number) => {
    try {
      const success = await window.tokenApi?.setRefreshInterval(minutes)
      if (success) {
        setTokenRefreshInterval(minutes)
        showTokenToast(
          minutes === 0 ? '已关闭自动刷新' : `自动刷新已设置为每 ${formatIntervalLabel(minutes)}`,
          'success'
        )
      }
    } catch (e) {
      showTokenToast('设置失败', 'error')
    }
  }, [showTokenToast])

  // ─── Rapid Consumption Alert Handlers ─────────────────

  const refreshAlertStatus = useCallback(async () => {
    try {
      const status = await window.alertApi?.getStatus()
      if (status) setAlertRuleStatus(status)
    } catch {
      // ignore
    }
  }, [])

  const handleAddAlertRule = useCallback(async () => {
    const threshold = Number(newAlertThreshold)
    if (!Number.isFinite(threshold) || threshold <= 0) {
      showTokenToast('请输入大于 0 的金额阈值', 'error')
      return
    }

    let windowMinutes = newAlertWindow
    if (windowMinutes === ALERT_CUSTOM_WINDOW) {
      const value = Number(newAlertCustomValue)
      if (!Number.isFinite(value) || value <= 0) {
        showTokenToast('请输入有效的时间长度', 'error')
        return
      }
      windowMinutes = Math.floor(value * (newAlertCustomUnit === 'days' ? 1440 : 60))
      if (windowMinutes < 60 || windowMinutes > 43200) {
        showTokenToast('时间范围需在 1 小时到 30 天之间', 'error')
        return
      }
    }

    setAlertAdding(true)
    try {
      const rules = await window.alertApi?.addRule({
        name: newAlertName.trim(),
        windowMinutes,
        threshold,
      })
      if (rules) {
        setAlertRules(rules)
        setNewAlertName('')
        setNewAlertThreshold('')
        setNewAlertCustomValue('')
        await refreshAlertStatus()
        showTokenToast('预警已添加')
      }
    } catch (e) {
      showTokenToast(`添加失败: ${(e as Error).message}`, 'error')
    } finally {
      setAlertAdding(false)
    }
  }, [
    newAlertName,
    newAlertWindow,
    newAlertCustomValue,
    newAlertCustomUnit,
    newAlertThreshold,
    refreshAlertStatus,
    showTokenToast,
  ])

  const handleDeleteAlertRule = useCallback(async (id: string) => {
    try {
      const rules = await window.alertApi?.deleteRule(id)
      if (rules) {
        setAlertRules(rules)
        await refreshAlertStatus()
        showTokenToast('预警已删除')
      }
    } catch {
      showTokenToast('删除失败', 'error')
    }
  }, [refreshAlertStatus, showTokenToast])

  const handleToggleAlertRule = useCallback(async (id: string, enabled: boolean) => {
    try {
      const rules = await window.alertApi?.toggleRule(id, enabled)
      if (rules) {
        setAlertRules(rules)
        await refreshAlertStatus()
      }
    } catch {
      showTokenToast('操作失败', 'error')
    }
  }, [refreshAlertStatus, showTokenToast])

  const handleTestAlert = useCallback(async () => {
    try {
      await window.alertApi?.testAlert()
    } catch {
      showTokenToast('测试弹窗失败', 'error')
    }
  }, [showTokenToast])

  // ─── Scheduled Reminder Handlers ─────────────────────

  const handleAddReminder = useCallback(async () => {
    if (!reminderTitle.trim()) {
      showTokenToast('请输入提醒内容', 'error')
      return
    }

    // One-shot reminders pick a full date; recurring ones only pick a clock time
    // (plus a weekday for weekly), and the next occurrence is computed here.
    let time = 0
    if (reminderRepeat === 'none') {
      time = new Date(reminderTime).getTime()
      if (!Number.isFinite(time)) {
        showTokenToast('请选择有效的提醒时间', 'error')
        return
      }
      if (time <= Date.now()) {
        showTokenToast('提醒时间必须晚于当前时间', 'error')
        return
      }
    } else {
      const [hours, minutes] = reminderClock.split(':').map(Number)
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        showTokenToast('请选择有效的提醒时间', 'error')
        return
      }
      const next = new Date()
      next.setSeconds(0, 0)
      next.setHours(hours, minutes, 0, 0)
      if (reminderRepeat === 'weekly') {
        let delta = (reminderWeekday - next.getDay() + 7) % 7
        if (delta === 0 && next.getTime() <= Date.now()) delta = 7
        next.setDate(next.getDate() + delta)
      } else if (next.getTime() <= Date.now()) {
        next.setDate(next.getDate() + 1)
      }
      time = next.getTime()
    }

    setReminderAdding(true)
    try {
      const list = await window.reminderApi?.add({
        title: reminderTitle.trim(),
        note: reminderNote.trim(),
        time,
        repeat: reminderRepeat,
      })
      if (list) {
        setReminders(list)
        setReminderTitle('')
        setReminderNote('')
        setReminderRepeat('none')
        setReminderTime(toDateTimeLocalInput(Date.now() + 5 * 60 * 1000))
        setReminderClock(toClockInput(Date.now() + 5 * 60 * 1000))
        showTokenToast('提醒已添加')
      }
    } catch (e) {
      showTokenToast(`添加失败: ${(e as Error).message}`, 'error')
    } finally {
      setReminderAdding(false)
    }
  }, [
    reminderTitle,
    reminderNote,
    reminderTime,
    reminderClock,
    reminderWeekday,
    reminderRepeat,
    showTokenToast,
  ])

  const handleDeleteReminder = useCallback(async (id: string) => {
    try {
      const list = await window.reminderApi?.remove(id)
      if (list) {
        setReminders(list)
        showTokenToast('提醒已删除')
      }
    } catch {
      showTokenToast('删除失败', 'error')
    }
  }, [showTokenToast])

  const handleToggleReminder = useCallback(async (id: string, enabled: boolean) => {
    try {
      const list = await window.reminderApi?.toggle(id, enabled)
      if (list) setReminders(list)
    } catch {
      showTokenToast('操作失败', 'error')
    }
  }, [showTokenToast])

  const handleTestReminder = useCallback(async () => {
    try {
      await window.reminderApi?.test()
    } catch {
      showTokenToast('测试弹窗失败', 'error')
    }
  }, [showTokenToast])

  // ─── Website Accelerator Handlers ─────────────────────

  const toggleAccelerator = useCallback(async (service: 'github' | 'steam') => {
    const enable = !accelStatus[service]
    setAccelBusy(b => ({ ...b, [service]: true }))
    try {
      const res = await window.acceleratorApi?.setEnabled(service, enable)
      if (res?.success) {
        setAccelStatus(s => ({ ...s, [service]: enable }))
        showTokenToast(res.message || (enable ? '加速已开启' : '已关闭加速'), 'success', 6000)
      } else {
        showTokenToast(res?.message || '操作失败', 'error', 6000)
        // Re-sync actual status from hosts file
        window.acceleratorApi?.getStatus().then(setAccelStatus)
      }
    } catch (e) {
      showTokenToast(`操作失败: ${(e as Error).message}`, 'error')
    } finally {
      setAccelBusy(b => ({ ...b, [service]: false }))
    }
  }, [accelStatus, showTokenToast])

  // ─── Translator Handlers ───────────────────────────────

  const toggleTranslator = useCallback(() => {
    setShowTranslator(v => {
      const next = !v
      // Prefill with the latest clipboard text when opening empty
      if (next && !transInput) {
        const latestText = items.find(i => i.type === 'text')
        if (latestText?.text) setTransInput(latestText.text)
      }
      return next
    })
    setTransError('')
  }, [transInput, items])

  // Open the translator prefilled with a specific history item (per-item button).
  // Text shorter than the configured limit translates inline on the current page; longer text opens the panel.
  const handleTranslateItem = useCallback(async (id: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const limit = settings.inlineTranslateLimit ?? 20
    if (trimmed.length < limit) {
      // Toggle close when clicking the same item again
      if (inlineTrans?.id === id) {
        setInlineTrans(null)
        return
      }
      setInlineTrans({ id, loading: true })
      // Auto-detect direction: contains CJK -> translate to English, otherwise to Chinese
      const target = /[\u4e00-\u9fff]/.test(trimmed) ? 'en' : 'zh'
      try {
        const res = await window.translateApi?.run(trimmed, target)
        setInlineTrans(prev => (prev?.id === id
          ? { id, loading: false, text: res?.text, error: res?.error }
          : prev))
      } catch (e) {
        setInlineTrans(prev => (prev?.id === id
          ? { id, loading: false, error: (e as Error).message }
          : prev))
      }
      return
    }
    setTransInput(trimmed)
    setTransOutput('')
    setTransError('')
    setActiveTab('favorites')
    setShowTranslator(true)
  }, [inlineTrans, settings])

  // Open the detailed-explanation panel with the given history item.
  const handleExplainItem = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setTransInput(trimmed)
    setTransOutput('')
    setTransError('')
    setTransMode('explain')
    setActiveTab('favorites')
    setShowTranslator(true)
  }, [])

  // Copy inline translation result, then close the popup
  const handleCopyInlineTrans = useCallback(async (text?: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
    setInlineTrans(null)
  }, [])

  const handleSwapDirection = useCallback(() => {
    setTransDir(d => (d === 'zh-en' ? 'en-zh' : 'zh-en'))
    // Move previous result into the input for quick re-translation
    setTransInput(transOutput || transInput)
    setTransOutput('')
    setTransError('')
  }, [transInput, transOutput])

  const handleTranslate = useCallback(async () => {
    if (!transInput.trim() || transLoading) return
    setTransLoading(true)
    setTransError('')
    const action = transMode === 'explain' ? '详解' : '翻译'
    try {
      const res = transMode === 'explain'
        ? await window.translateApi?.explain(transInput)
        : await window.translateApi?.run(transInput, transDir === 'zh-en' ? 'en' : 'zh')
      if (res?.success && res.text !== undefined) {
        setTransOutput(res.text)
      } else {
        setTransError(res?.error || `${action}失败`)
      }
    } catch (e) {
      setTransError(`${action}失败: ${(e as Error).message}`)
    } finally {
      setTransLoading(false)
    }
  }, [transInput, transMode, transDir, transLoading])

  const handleCopyTranslation = useCallback(async () => {
    if (!transOutput) return
    try {
      await navigator.clipboard.writeText(transOutput)
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      // ignore
    }
  }, [transOutput])

  const handleSaveTranslateConfig = useCallback(async () => {
    try {
      const ok = await window.translateApi?.setConfig({
        apiUrl: translateConfig.apiUrl,
        apiKey: translateConfig.apiKey,
        model: translateConfig.model,
      })
      setTransSaveStatus(ok ? 'success' : 'error')
    } catch {
      setTransSaveStatus('error')
    }
    setTimeout(() => setTransSaveStatus('idle'), 2000)
  }, [translateConfig])

  const handleTestConnection = useCallback(async () => {
    if (transTesting) return
    setTransTesting(true)
    setTransTestResult(null)
    try {
      // Test with the config currently in the form, no need to save first
      const res = await window.translateApi?.test(translateConfig)
      setTransTestResult(res?.success
        ? { success: true, message: res.text || '连接成功' }
        : { success: false, message: res?.error || '连接失败' })
    } catch (e) {
      setTransTestResult({ success: false, message: `测试失败: ${(e as Error).message}` })
    } finally {
      setTransTesting(false)
    }
  }, [translateConfig, transTesting])

  // Switch to a saved profile: fill the form and activate it (immediate persist)
  const handleSwitchProfile = useCallback(async (name: string) => {
    const p = translateConfig.profiles.find(x => x.name === name)
    if (!p) return
    setActiveProfile(p.name)
    setProfileName('')
    setTranslateConfig(c => ({ ...c, apiUrl: p.apiUrl, apiKey: p.apiKey, model: p.model }))
    try {
      await window.translateApi?.setProfiles(translateConfig.profiles, p.name)
    } catch {
      // ignore
    }
  }, [translateConfig])

  // Save the current form (apiUrl/apiKey/model) as a profile, overwriting same-name ones
  const handleSaveProfile = useCallback(async () => {
    const model = translateConfig.model.trim()
    const apiUrl = translateConfig.apiUrl.trim()
    if (!model || !apiUrl) return
    const name = profileName.trim() || model
    const profile = { name, apiUrl, apiKey: translateConfig.apiKey.trim(), model }
    const profiles = [...translateConfig.profiles.filter(p => p.name !== name), profile]
    setTranslateConfig(c => ({ ...c, profiles }))
    setActiveProfile(name)
    setProfileName('')
    try {
      const ok = await window.translateApi?.setProfiles(profiles, name)
      setTransSaveStatus(ok ? 'success' : 'error')
    } catch {
      setTransSaveStatus('error')
    }
    setTimeout(() => setTransSaveStatus('idle'), 2000)
  }, [translateConfig, profileName])

  // Delete the currently active profile (form values are kept as custom config)
  const handleDeleteProfile = useCallback(async () => {
    if (!activeProfile) return
    const profiles = translateConfig.profiles.filter(p => p.name !== activeProfile)
    setTranslateConfig(c => ({ ...c, profiles }))
    setActiveProfile('')
    try {
      await window.translateApi?.setProfiles(profiles)
    } catch {
      // ignore
    }
  }, [translateConfig, activeProfile])

  const REFRESH_OPTIONS = [
    { value: 0, label: '关闭' },
    { value: 1, label: '1 分钟' },
    { value: 5, label: '5 分钟' },
    { value: 15, label: '15 分钟' },
    { value: 30, label: '30 分钟' },
    { value: 60, label: '1 小时' },
    { value: 180, label: '3 小时' },
    { value: 360, label: '6 小时' },
    { value: 720, label: '12 小时' },
    { value: 1440, label: '24 小时' },
  ]

  const formatIntervalLabel = (minutes: number): string => {
    const opt = REFRESH_OPTIONS.find(o => o.value === minutes)
    return opt?.label || '关闭'
  }

  const ALERT_WINDOW_OPTIONS = [
    { value: 60, label: '1 小时' },
    { value: 360, label: '6 小时' },
    { value: 720, label: '12 小时' },
    { value: 1440, label: '1 天' },
    { value: 4320, label: '3 天' },
    { value: 10080, label: '7 天' },
    { value: 20160, label: '14 天' },
    { value: 43200, label: '30 天' },
    { value: -1, label: '自定义…' },
  ]

  const ALERT_CUSTOM_WINDOW = -1

  const formatAlertWindow = (minutes: number): string => {
    if (minutes % 1440 === 0) return `${minutes / 1440} 天`
    if (minutes % 60 === 0) return `${minutes / 60} 小时`
    return `${minutes} 分钟`
  }

  const getPlatformIcon = (platformId: string): string => {
    const icons: Record<string, string> = {
      deepseek: '🧠',
      kimi: '🌙',
      zhipu: '💎',
      bailian: '☁️',
      tencent: '🐧',
      openai: '🤖',
      anthropic: '🗣️',
    }
    return icons[platformId] || '🔑'
  }

  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`

    const date = new Date(timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === yesterday.toDateString()) {
      return '昨天'
    }

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  // ─── Auto Typing Handlers ────────────────────────────────

  const handleStartTyping = useCallback(async () => {
    if (!typingText.trim()) {
      return
    }
    if (!window.typingApi) return

    const result = await window.typingApi.start(
      typingText,
      typingDelay,
      typingInterval / 1000,
      typingEnglishSymbols
    )
    if (!result.success) {
      alert(result.message)
    }
  }, [typingText, typingDelay, typingInterval, typingEnglishSymbols])

  const handleStopTyping = useCallback(async () => {
    if (!window.typingApi) return
    await window.typingApi.stop()
  }, [])

  const handlePasteTypingText = useCallback(async () => {
    if (!window.clipboardApi) return
    const history = await window.clipboardApi.getHistory()
    const latestText = history.find(i => i.type === 'text')
    if (latestText) {
      setTypingText(latestText.text)
    }
  }, [])

  const handleClearTypingText = useCallback(() => {
    setTypingText('')
  }, [])

  const setTypingSpeed = useCallback((ms: number) => {
    setTypingInterval(ms)
  }, [])

  const toggleEnglishSymbols = useCallback((enabled: boolean) => {
    setTypingEnglishSymbols(enabled)
    if (window.imeApi) {
      window.imeApi.setEnglishSymbols(enabled)
    }
  }, [])

  const isSettingsTab = activeTab === 'settings'
  const fileCount = items.filter(i => i.type === 'file').length
  const textCount = items.filter(i => i.type === 'text').length

  // Count favorites per folder for the toolbar chips
  const favoriteCount = items.filter(i => i.favorite).length
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = { all: favoriteCount, none: 0 }
    for (const it of items) {
      if (!it.favorite) continue
      if (it.folderId) counts[it.folderId] = (counts[it.folderId] || 0) + 1
      else counts.none = (counts.none || 0) + 1
    }
    return counts
  }, [items, favoriteCount])

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="header-top">
          <div className="logo">
            <div className="logo-icon">📋</div>
            <span>Clipboard Vibe</span>
          </div>
          <div className="header-actions">
            {!isSettingsTab && activeTab === 'favorites' && (
              <>
                <button
                  className={`icon-btn ${showTranslator ? 'active' : ''}`}
                  onClick={toggleTranslator}
                  title="翻译"
                >
                  <span className="trans-entry-icon">文A</span>
                </button>
                <button
                  className="icon-btn danger"
                  onClick={handleClearFavorites}
                  title="清空收藏"
                >
                  🗑️
                </button>
              </>
            )}
            {!isSettingsTab && activeTab !== 'favorites' && (
              <button
                className="icon-btn danger"
                onClick={handleClearHistory}
                title="清空历史"
              >
                🗑️
              </button>
            )}
            <button
              className="icon-btn"
              onClick={handleClose}
              title="关闭"
            >
              ✕
            </button>
          </div>
        </div>
        {!isSettingsTab && (
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              ref={searchRef}
              type="text"
              placeholder="搜索剪贴板历史..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          全部 ({items.length})
        </button>
        <button
          className={`tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          📁 文件 ({fileCount})
        </button>
        <button
          className={`tab ${activeTab === 'favorites' ? 'active' : ''}`}
          onClick={() => { setActiveTab('favorites'); setShowTranslator(false) }}
        >
          收藏 ({items.filter(i => i.favorite).length})
        </button>
        <button
          className={`tab ${activeTab === 'token' ? 'active' : ''}`}
          onClick={() => setActiveTab('token')}
        >
          💰 Token
        </button>
        <button
          className={`tab ${activeTab === 'typing' ? 'active' : ''}`}
          onClick={() => setActiveTab('typing')}
        >
          ⌨️ 打字
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ 设置
        </button>
      </div>

      {/* List / Settings / Token */}
      {isSettingsTab ? (
        <div className="settings-panel">
          <div className="setting-section">
            <div className="setting-title">快捷键设置</div>
            <div className="setting-desc">自定义唤出剪贴板窗口的全局快捷键</div>

            <div className="setting-row">
              <div className="setting-label">显示/隐藏窗口</div>
              <div className="setting-control">
                {isRecording ? (
                  <div className="shortcut-record">
                    <span className="recording-dot"></span>
                    <span className="recording-text">{recordedKeys}</span>
                    <button
                      className="btn btn-secondary"
                      onClick={cancelRecording}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    ref={recordBtnRef}
                    className="shortcut-display"
                    onClick={startRecording}
                    title="点击录制新快捷键"
                  >
                    {shortcutToDisplay(settings.toggleShortcut)}
                    <span className="edit-hint">点击修改</span>
                  </button>
                )}
              </div>
            </div>

            {saveStatus === 'success' && (
              <div className="status-message success">✓ 快捷键已保存并生效</div>
            )}
            {saveStatus === 'error' && (
              <div className="status-message error">✗ 快捷键设置失败，请尝试其他组合</div>
            )}

            <div className="setting-hints">
              <div className="hint-title">💡 提示</div>
              <ul>
                <li>点击上方按钮后，按下你想要的快捷键组合</li>
                <li>建议使用 Ctrl / Alt / Shift + 字母键 的组合</li>
                <li>快捷键会立即生效并自动保存</li>
              </ul>
            </div>

            <button
              className="btn btn-ghost"
              onClick={resetShortcut}
            >
              恢复默认快捷键
            </button>
          </div>

          <div className="setting-section">
            <div className="setting-title">文字存储设置</div>
            <div className="setting-desc">调整文字剪贴板历史最多保存的条数</div>

            <div className="setting-row">
              <div className="setting-label">最大存储条数</div>
              <div className="setting-control">
                <input
                  type="number"
                  className="number-input"
                  min={10}
                  max={1000}
                  value={settings.maxHistory}
                  onChange={e => handleMaxHistoryChange(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="slider-row">
              <input
                type="range"
                className="slider"
                min={10}
                max={1000}
                step={10}
                value={settings.maxHistory}
                onChange={e => handleMaxHistoryChange(Number(e.target.value))}
              />
              <div className="slider-labels">
                <span>10</span>
                <span>1000</span>
              </div>
            </div>

            <div className="setting-hints">
              <div className="hint-title">💡 提示</div>
              <ul>
                <li>范围：10 ~ 1000 条</li>
                <li>收藏的内容不会被自动清理</li>
                <li>当前已保存 {textCount} 条文字</li>
              </ul>
            </div>
          </div>

          <div className="setting-section">
            <div className="setting-title">文件存储设置</div>
            <div className="setting-desc">调整文件剪贴板最多保存的文件数量和存储位置</div>

            <div className="setting-row">
              <div className="setting-label">最大文件数</div>
              <div className="setting-control">
                <input
                  type="number"
                  className="number-input"
                  min={1}
                  max={500}
                  value={settings.maxFiles}
                  onChange={e => handleMaxFilesChange(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="slider-row">
              <input
                type="range"
                className="slider"
                min={1}
                max={500}
                step={1}
                value={settings.maxFiles}
                onChange={e => handleMaxFilesChange(Number(e.target.value))}
              />
              <div className="slider-labels">
                <span>1</span>
                <span>500</span>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">存储位置</div>
              <div className="setting-control">
                <button
                  className="btn btn-secondary"
                  onClick={handleSelectFilesDir}
                >
                  📂 选择目录
                </button>
              </div>
            </div>

            <div className="path-display">
              <span className="path-icon">📁</span>
              <span className="path-text">
                {settings.filesDir || '默认位置 (AppData/clipboard-files)'}
              </span>
            </div>

            {settings.filesDir && (
              <button
                className="btn btn-ghost"
                onClick={handleResetFilesDir}
              >
                恢复默认存储位置
              </button>
            )}

            <div className="setting-hints">
              <div className="hint-title">💡 提示</div>
              <ul>
                <li>范围：1 ~ 500 个文件</li>
                <li>文件会保存在本地存储目录中</li>
                <li>收藏的文件不会被自动清理</li>
                <li>当前已保存 {fileCount} 个文件</li>
                <li>更改存储位置会自动迁移已有文件</li>
              </ul>
            </div>
          </div>

          <div className="setting-section">
            <div className="setting-title">翻译服务</div>
            <div className="setting-desc">配置 OpenAI 兼容的大模型 API，用于「收藏」页的翻译功能</div>

            <div className="setting-row">
              <div className="setting-label">配置方案</div>
              <div className="setting-control setting-control-wide">
                <div className="trans-model-row">
                  <select
                    className="text-input trans-model-select"
                    value={activeProfile}
                    onChange={e => handleSwitchProfile(e.target.value)}
                    disabled={translateConfig.profiles.length === 0}
                  >
                    {!activeProfile && (
                      <option value="">
                        {translateConfig.profiles.length === 0 ? '暂无已保存方案' : '自定义配置（未保存为方案）'}
                      </option>
                    )}
                    {translateConfig.profiles.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary"
                    onClick={handleDeleteProfile}
                    disabled={!activeProfile}
                    title="删除当前选中的方案（表单当前值会保留）"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">API 地址</div>
              <div className="setting-control setting-control-wide">
                <input
                  type="text"
                  className="text-input"
                  placeholder="https://api.openai.com/v1/chat/completions"
                  value={translateConfig.apiUrl}
                  onChange={e => {
                    setTranslateConfig(c => ({ ...c, apiUrl: e.target.value }))
                    setActiveProfile('')
                  }}
                />
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">API Key</div>
              <div className="setting-control setting-control-wide">
                <input
                  type="password"
                  className="text-input"
                  placeholder="sk-..."
                  value={translateConfig.apiKey}
                  onChange={e => {
                    setTranslateConfig(c => ({ ...c, apiKey: e.target.value }))
                    setActiveProfile('')
                  }}
                />
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">模型名称</div>
              <div className="setting-control setting-control-wide">
                <input
                  type="text"
                  className="text-input"
                  placeholder="gpt-4o-mini / deepseek-chat / glm-4-flash ..."
                  value={translateConfig.model}
                  onChange={e => {
                    setTranslateConfig(c => ({ ...c, model: e.target.value }))
                    setActiveProfile('')
                  }}
                />
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">保存方案</div>
              <div className="setting-control setting-control-wide">
                <div className="trans-model-row">
                  <input
                    type="text"
                    className="text-input"
                    placeholder="方案名称（留空则使用模型名）"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={handleSaveProfile}
                    disabled={!translateConfig.model.trim() || !translateConfig.apiUrl.trim()}
                    title="将当前 API 地址、Key 和模型保存为一个方案，同名覆盖"
                  >
                    保存为方案
                  </button>
                </div>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">行内翻译阈值</div>
              <div className="setting-control">
                <input
                  type="number"
                  className="number-input"
                  min={0}
                  max={500}
                  value={settings.inlineTranslateLimit ?? 20}
                  onChange={e => handleInlineLimitChange(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="trans-save-row">
              <button className="btn btn-primary" onClick={handleSaveTranslateConfig}>
                保存翻译配置
              </button>
              <button className="btn" onClick={handleTestConnection} disabled={transTesting}>
                {transTesting ? '测试中...' : '测试连接'}
              </button>
              {transSaveStatus === 'success' && <span className="status-message inline success">✓ 已保存</span>}
              {transSaveStatus === 'error' && <span className="status-message inline error">✗ 保存失败</span>}
              {transTestResult && (
                <span className={`status-message inline ${transTestResult.success ? 'success' : 'error'}`}>
                  {transTestResult.success ? '✓ ' : '✗ '}{transTestResult.message}
                </span>
              )}
            </div>

            <div className="setting-hints">
              <div className="hint-title">💡 提示</div>
              <ul>
                <li>兼容所有 OpenAI 格式接口（OpenAI / DeepSeek / 通义 / 智谱 / 本地 Ollama 等）</li>
                <li>不同服务商各自保存为一个方案：填好地址、Key、模型后点「保存为方案」，下拉即可切换</li>
                <li>行内翻译阈值：短于该字数的条目点「文A」直接在列表内显示译文；0 表示始终打开翻译面板</li>
                <li>填入对应的 chat completions 地址，例如 DeepSeek: https://api.deepseek.com/chat/completions</li>
                <li>API Key 仅保存在本机 settings.json，不会上传</li>
              </ul>
            </div>
          </div>

          <div className="setting-section">
            <div className="setting-title">定时提醒</div>
            <div className="setting-desc">
              到点后强制弹出提醒窗口（始终置顶）。一次性选择具体日期时间，每天 / 每周只需选择时间
            </div>

            <div className="reminder-form">
              <input
                type="text"
                className="input"
                placeholder="提醒内容，例如：该喝水了"
                value={reminderTitle}
                onChange={(e) => setReminderTitle(e.target.value)}
              />
              <textarea
                className="input reminder-note-input"
                rows={2}
                placeholder="补充说明（可选）"
                value={reminderNote}
                onChange={(e) => setReminderNote(e.target.value)}
              />
              <div className="token-form-row alert-form-row">
                {reminderRepeat === 'none' ? (
                  <input
                    type="datetime-local"
                    className="input"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                  />
                ) : (
                  <>
                    {reminderRepeat === 'weekly' && (
                      <select
                        className="input reminder-weekday-select"
                        value={reminderWeekday}
                        onChange={(e) => setReminderWeekday(Number(e.target.value))}
                      >
                        {WEEKDAY_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                    <input
                      type="time"
                      className="input"
                      value={reminderClock}
                      onChange={(e) => setReminderClock(e.target.value)}
                    />
                  </>
                )}
                <select
                  className="input reminder-repeat-select"
                  value={reminderRepeat}
                  onChange={(e) => setReminderRepeat(e.target.value as ReminderRepeat)}
                >
                  <option value="none">一次性</option>
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                </select>
              </div>
              <div className="reminder-form-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleAddReminder}
                  disabled={reminderAdding}
                >
                  {reminderAdding ? '添加中...' : '添加提醒'}
                </button>
                <button className="btn" onClick={handleTestReminder}>
                  预览弹窗
                </button>
              </div>
            </div>

            {reminders.length === 0 ? (
              <div className="alert-empty-hint">还没有定时提醒</div>
            ) : (
              <div className="reminder-list">
                {[...reminders]
                  .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.time - b.time)
                  .map(reminder => (
                    <div
                      key={reminder.id}
                      className={`reminder-card ${reminder.enabled ? '' : 'disabled'}`}
                    >
                      <div className="reminder-card-top">
                        <div className="reminder-card-title">{reminder.title}</div>
                        <div className="alert-rule-actions">
                          <span className="reminder-repeat-badge">
                            {REPEAT_LABELS[reminder.repeat]}
                          </span>
                          <button
                            className={`typing-toggle ${reminder.enabled ? 'on' : ''}`}
                            onClick={() => handleToggleReminder(reminder.id, !reminder.enabled)}
                            title={reminder.enabled ? '点击暂停该提醒' : '点击启用该提醒'}
                          >
                            <span className="typing-toggle-knob" />
                          </button>
                          <button
                            className="mini-btn delete"
                            title="删除提醒"
                            onClick={() => handleDeleteReminder(reminder.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      {reminder.note && <div className="reminder-card-note">{reminder.note}</div>}
                      <div className="reminder-card-meta">
                        {reminder.enabled
                          ? `下次提醒：${formatReminderTime(reminder.time)}`
                          : reminder.repeat === 'none' && reminder.lastTriggeredAt
                            ? `已于 ${formatReminderTime(reminder.lastTriggeredAt)} 提醒`
                            : `已暂停 · 原定 ${formatReminderTime(reminder.time)}`}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="setting-section">
            <div className="setting-title">关于</div>
            <div className="setting-desc">
              Clipboard Vibe v1.1.0<br />
              一个现代化的剪贴板历史管理器
            </div>
            <button
              className="btn btn-ghost"
              onClick={resetAllSettings}
            >
              恢复所有默认设置
            </button>
          </div>

          {tokenToast && (
            <div className={`toast toast-${tokenToast.type}`}>
              {tokenToast.msg}
            </div>
          )}
        </div>
      ) : activeTab === 'token' ? (
        <div className="token-panel">
          {/* Token Overview */}
          <div className="token-overview">
            <div className="token-overview-card total">
              <div className="token-overview-label">总余额</div>
              <div className="token-overview-value">
                ¥ {tokenKeys
                  .filter(k => k.balance?.success && k.balance.data?.currency === 'CNY')
                  .reduce((sum, k) => sum + (k.balance!.data!.totalBalance || 0), 0)
                  .toFixed(2)}
              </div>
              <div className="token-overview-sub">所有平台合计</div>
            </div>
            <div className="token-overview-card">
              <div className="token-overview-label">已接入</div>
              <div className="token-overview-value">{new Set(tokenKeys.map(k => k.platform)).size}</div>
              <div className="token-overview-sub">个平台</div>
            </div>
            <div className="token-overview-card">
              <div className="token-overview-label">Key 数</div>
              <div className="token-overview-value">{tokenKeys.length}</div>
              <div className="token-overview-sub">个密钥</div>
            </div>
          </div>

          {/* Add Key Section */}
          <div className="token-add-section">
            <div className="token-section-header">
              <h3>添加 API Key</h3>
            </div>

            <div className="token-form-row">
              <select
                className="input"
                value={selectedTokenPlatform}
                onChange={(e) => setSelectedTokenPlatform(e.target.value)}
              >
                {tokenPlatforms.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {(() => {
              const platform = tokenPlatforms.find(p => p.id === selectedTokenPlatform)
              const isCloudKey = platform && platform.credentialType !== 'api_key'
              const isTencent = platform?.credentialType === 'tencent_cloud'
              const idLabel = isTencent ? 'SecretId' : 'AccessKey ID'
              const secretLabel = isTencent ? 'SecretKey' : 'AccessKey Secret'

              if (isCloudKey) {
                return (
                  <>
                    <div className="token-form-row">
                      <input
                        type="password"
                        className="input"
                        placeholder={`请输入 ${idLabel}`}
                        value={accessKeyId}
                        onChange={(e) => setAccessKeyId(e.target.value)}
                      />
                    </div>
                    <div className="token-form-row">
                      <input
                        type="password"
                        className="input"
                        placeholder={`请输入 ${secretLabel}`}
                        value={accessKeySecret}
                        onChange={(e) => setAccessKeySecret(e.target.value)}
                      />
                    </div>
                  </>
                )
              }

              return (
                <div className="token-form-row">
                  <input
                    type="password"
                    className="input"
                    placeholder="请输入 API Key"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                </div>
              )
            })()}

            <div className="token-form-row">
              <input
                type="text"
                className="input"
                placeholder="备注名称（可选）"
                value={apiKeyLabel}
                onChange={(e) => setApiKeyLabel(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={handleAddTokenKey}
              disabled={tokenLoading}
            >
              {tokenLoading ? '添加中...' : '添加并查询余额'}
            </button>

            {tokenPlatforms.find(p => p.id === selectedTokenPlatform) && (
              <div className="token-platform-hint">
                {tokenPlatforms.find(p => p.id === selectedTokenPlatform)?.name} -{' '}
                {tokenPlatforms.find(p => p.id === selectedTokenPlatform)?.description}
                {tokenPlatforms.find(p => p.id === selectedTokenPlatform)?.note && (
                  <>
                    <br />
                    <span style={{ color: '#f59e0b' }}>
                      ⚠️ {tokenPlatforms.find(p => p.id === selectedTokenPlatform)?.note}
                    </span>
                  </>
                )}
                <br />
                <span style={{ fontSize: '12px', opacity: 0.7 }}>
                  🔒 API Key 使用 AES-256-GCM 加密存储，密钥与本机绑定
                </span>
              </div>
            )}
          </div>

          {/* Balance List */}
          <div className="token-list-section">
            <div className="token-section-header">
              <h3>余额监控</h3>
              <div className="token-auto-refresh">
                <select
                  className="token-refresh-select"
                  value={tokenRefreshInterval}
                  onChange={(e) => handleSetRefreshInterval(Number(e.target.value))}
                  title="自动刷新频率"
                >
                  {REFRESH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === 0 ? '⏸ 自动刷新' : `🔄 每 ${opt.label}`}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-btn"
                  onClick={handleRefreshAllTokens}
                  title="立即刷新所有余额"
                >
                  🔄
                </button>
              </div>
            </div>

            {tokenKeys.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🔑</div>
                <div className="empty-text">还没有添加任何 API Key</div>
                <div className="empty-hint">添加您的第一个 Key 开始监控余额</div>
              </div>
            ) : (
              <div className="token-balance-list">
                {tokenKeys.map(keyConfig => {
                  const platform = tokenPlatforms.find(p => p.id === keyConfig.platform)
                  const balance = keyConfig.balance
                  const d = balance?.data

                  return (
                    <div key={keyConfig.id} className={`token-balance-card ${balance?.success === false ? 'error' : ''}`}>
                      <div className="token-balance-header">
                        <div className="token-platform-row">
                          <span className="token-platform-icon">{getPlatformIcon(keyConfig.platform)}</span>
                          <div className="token-platform-name">
                            <div className="token-platform-title">{platform?.name || keyConfig.platform}</div>
                            <div className="token-key-label">{keyConfig.label}</div>
                          </div>
                        </div>
                        <div className="token-balance-actions">
                          <button className="mini-btn" title="刷新" onClick={() => handleRefreshTokenBalance(keyConfig.id)}>
                            🔄
                          </button>
                          <button className="mini-btn delete" title="删除" onClick={() => handleDeleteTokenKey(keyConfig.id)}>
                            🗑️
                          </button>
                        </div>
                      </div>

                      {!balance ? (
                        <div className="token-balance-body">
                          <div className="token-balance-main"><span className="currency">--</span> --</div>
                          <div className="token-balance-status pending">等待查询</div>
                        </div>
                      ) : !balance.success ? (
                        <div className="token-balance-body">
                          <div className="token-balance-error">
                            <span>❌</span>
                            <div>
                              <div className="token-error-title">查询失败</div>
                              <div className="token-error-hint">{balance.error}</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="token-balance-body">
                          <div className="token-balance-main">
                            <span className="currency">¥</span>
                            {d?.totalBalance.toFixed(2)}
                          </div>
                          <div className={`token-balance-status ${d?.isAvailable ? 'available' : 'unavailable'}`}>
                            {d?.isAvailable ? '✓ 余额充足' : '✗ 余额不足'}
                          </div>
                          <div className="token-balance-details">
                            <div className="token-detail-item">
                              <span className="token-detail-label">充值余额</span>
                              <span className="token-detail-value">¥{d?.toppedUpBalance.toFixed(2)}</span>
                            </div>
                            <div className="token-detail-item">
                              <span className="token-detail-label">赠金余额</span>
                              <span className="token-detail-value">¥{d?.grantedBalance.toFixed(2)}</span>
                            </div>
                          </div>
                          <button
                            className="token-recharge-btn"
                            onClick={(e) => { e.stopPropagation(); handleOpenRecharge(keyConfig.platform) }}
                          >
                            💳 快速充值
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Rapid Consumption Alerts */}
          <div className="token-list-section">
            <div className="token-section-header">
              <h3>快速消耗预警</h3>
              <button className="icon-btn" title="预览预警弹窗" onClick={handleTestAlert}>
                🔔
              </button>
            </div>

            <div className="alert-form">
              <div className="token-form-row">
                <input
                  type="text"
                  className="input"
                  placeholder="预警名称（可选）"
                  value={newAlertName}
                  onChange={(e) => setNewAlertName(e.target.value)}
                />
              </div>
              <div className="token-form-row alert-form-row">
                <select
                  className="input"
                  value={newAlertWindow}
                  onChange={(e) => setNewAlertWindow(Number(e.target.value))}
                >
                  {ALERT_WINDOW_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>最近 {opt.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  className="input"
                  min="0.01"
                  step="0.01"
                  placeholder="消耗阈值（元）"
                  value={newAlertThreshold}
                  onChange={(e) => setNewAlertThreshold(e.target.value)}
                />
              </div>
              {newAlertWindow === ALERT_CUSTOM_WINDOW && (
                <div className="token-form-row alert-form-row">
                  <input
                    type="number"
                    className="input"
                    min="1"
                    step="0.5"
                    placeholder="时间长度"
                    value={newAlertCustomValue}
                    onChange={(e) => setNewAlertCustomValue(e.target.value)}
                  />
                  <select
                    className="input"
                    value={newAlertCustomUnit}
                    onChange={(e) => setNewAlertCustomUnit(e.target.value as 'hours' | 'days')}
                  >
                    <option value="hours">小时</option>
                    <option value="days">天</option>
                  </select>
                </div>
              )}
              <button
                className="btn btn-primary btn-full"
                onClick={handleAddAlertRule}
                disabled={alertAdding}
              >
                {alertAdding ? '添加中...' : '添加预警'}
              </button>
            </div>

            <div className="alert-hint">
              当最近设定时间内的余额消耗达到阈值时，会强制弹出预警页面。消耗数据基于余额快照，
              每次刷新余额时记录，建议开启自动刷新以获得及时预警。同一预警 30 分钟内不会重复弹出。
            </div>

            {alertRules.length === 0 ? (
              <div className="alert-empty-hint">还没有添加预警规则</div>
            ) : (
              <div className="alert-rule-list">
                {alertRules.map(rule => {
                  const status = alertRuleStatus.find(s => s.id === rule.id)
                  const consumed = status?.consumed || 0
                  const ratio = rule.threshold > 0 ? consumed / rule.threshold : 0
                  return (
                    <div key={rule.id} className={`alert-rule-card ${rule.enabled ? '' : 'disabled'}`}>
                      <div className="alert-rule-top">
                        <div className="alert-rule-name">{rule.name}</div>
                        <div className="alert-rule-actions">
                          <button
                            className={`typing-toggle ${rule.enabled ? 'on' : ''}`}
                            onClick={() => handleToggleAlertRule(rule.id, !rule.enabled)}
                            title={rule.enabled ? '点击暂停该预警' : '点击启用该预警'}
                          >
                            <span className="typing-toggle-knob" />
                          </button>
                          <button
                            className="mini-btn delete"
                            title="删除预警"
                            onClick={() => handleDeleteAlertRule(rule.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className="alert-rule-desc">
                        最近 {formatAlertWindow(rule.windowMinutes)} 内消耗 ≥ ¥{rule.threshold.toFixed(2)} 时触发
                      </div>
                      <div className={`alert-rule-consumed ${ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warn' : ''}`}>
                        当前窗口已消耗 <strong>¥{consumed.toFixed(2)}</strong>
                        <span className="alert-rule-percent">（{Math.round(ratio * 100)}%）</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Website Accelerator */}
          <div className="token-list-section">
            <div className="token-section-header">
              <h3>网站加速</h3>
            </div>
            <div className="accel-card">
              <div className="accel-row">
                <div className="accel-info">
                  <span className="accel-icon">🐙</span>
                  <div className="accel-text">
                    <div className="accel-name">GitHub 加速</div>
                    <div className="accel-desc">加速 github.com 及其资源、API 域名</div>
                  </div>
                </div>
                <div className="accel-right">
                  {accelStatus.github && <span className="accel-badge">已加速</span>}
                  <button
                    className={`typing-toggle ${accelStatus.github ? 'on' : ''}`}
                    onClick={() => toggleAccelerator('github')}
                    disabled={accelBusy.github}
                    title="通过优选 IP 写入系统 hosts 加速访问"
                  >
                    <span className="typing-toggle-knob" />
                  </button>
                </div>
              </div>
              <div className="accel-row">
                <div className="accel-info">
                  <span className="accel-icon">🎮</span>
                  <div className="accel-text">
                    <div className="accel-name">Steam 加速</div>
                    <div className="accel-desc">加速商店、社区与 CDN 静态资源</div>
                  </div>
                </div>
                <div className="accel-right">
                  {accelStatus.steam && <span className="accel-badge">已加速</span>}
                  <button
                    className={`typing-toggle ${accelStatus.steam ? 'on' : ''}`}
                    onClick={() => toggleAccelerator('steam')}
                    disabled={accelBusy.steam}
                    title="通过优选 IP 写入系统 hosts 加速访问"
                  >
                    <span className="typing-toggle-knob" />
                  </button>
                </div>
              </div>
              <div className="accel-note">
                原理类似 Watt Toolkit：优选 IP 后写入系统 hosts 并刷新 DNS。
                开启时需要管理员授权（UAC 弹窗），关闭后自动恢复默认解析。若已打开浏览器，建议重启浏览器生效。
              </div>
            </div>
          </div>

          {/* Token Toast */}
          {tokenToast && (
            <div className={`toast toast-${tokenToast.type}`}>
              {tokenToast.msg}
            </div>
          )}
        </div>
      ) : activeTab === 'favorites' && showTranslator ? (
        <div className="translator-panel">
          <div className="trans-toolbar">
            <div className="trans-toolbar-left">
              <button
                className="btn btn-ghost trans-clear-btn"
                onClick={() => setShowTranslator(false)}
                title="返回收藏列表"
              >
                ← 返回
              </button>
              <div className="trans-direction">
                <button
                  className={`trans-dir-btn ${transMode === 'translate' ? 'active' : ''}`}
                  onClick={() => { setTransMode('translate'); setTransOutput(''); setTransError('') }}
                >
                  翻译
                </button>
                <button
                  className={`trans-dir-btn ${transMode === 'explain' ? 'active' : ''}`}
                  onClick={() => { setTransMode('explain'); setTransOutput(''); setTransError('') }}
                >
                  详解
                </button>
              </div>
              {transMode === 'translate' && (
                <div className="trans-direction">
                  <button
                    className={`trans-dir-btn ${transDir === 'zh-en' ? 'active' : ''}`}
                    onClick={() => transDir !== 'zh-en' && handleSwapDirection()}
                  >
                    中 → 英
                  </button>
                  <button
                    className={`trans-dir-btn ${transDir === 'en-zh' ? 'active' : ''}`}
                    onClick={() => transDir !== 'en-zh' && handleSwapDirection()}
                  >
                    英 → 中
                  </button>
                </div>
              )}
            </div>
            <button
              className="btn btn-ghost trans-clear-btn"
              onClick={() => { setTransInput(''); setTransOutput(''); setTransError('') }}
            >
              清空
            </button>
          </div>

          <textarea
            className="trans-input"
            placeholder={
              transMode === 'explain'
                ? '粘贴或输入要详解的内容...'
                : transDir === 'zh-en' ? '输入要翻译的中文...' : '输入要翻译的英文...'
            }
            value={transInput}
            onChange={e => setTransInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleTranslate()
              }
            }}
          />

          <button
            className={`btn btn-primary trans-run-btn ${transLoading ? 'loading' : ''}`}
            onClick={handleTranslate}
            disabled={transLoading || !transInput.trim()}
          >
            {transLoading
              ? (transMode === 'explain' ? '详解中...' : '翻译中...')
              : (transMode === 'explain' ? '详解（Ctrl+Enter）' : '翻译（Ctrl+Enter）')}
          </button>

          {transError && <div className="trans-error">✗ {transError}</div>}

          {transOutput && (
            <div className="trans-result">
              <div className="trans-result-header">
                <span>{transMode === 'explain' ? '详细解释' : '翻译结果'}</span>
                <button
                  className="btn btn-secondary trans-copy-btn"
                  onClick={handleCopyTranslation}
                >
                  复制
                </button>
              </div>
              <div className="trans-result-text">{transOutput}</div>
            </div>
          )}

          <div className="trans-hint">
            💡 使用「设置 → 翻译服务」中配置的大模型 API。「翻译」只输出译文，「详解」会拆解要点、解释术语和注意事项。打开时会自动带入最近复制的文本。
          </div>
        </div>
      ) : activeTab === 'typing' ? (
        <div className="typing-panel">
          {/* Settings */}
          <div className="typing-settings">
            <div className="typing-setting-item">
              <label className="typing-setting-label">启动延迟（秒）</label>
              <input
                type="number"
                className="typing-input"
                value={typingDelay}
                min={0}
                max={60}
                step={1}
                onChange={(e) => setTypingDelay(Number(e.target.value))}
                disabled={typingStatus.isRunning}
              />
              <div className="typing-setting-hint">开始前留出时间切换窗口</div>
            </div>
            <div className="typing-setting-item">
              <label className="typing-setting-label">打字间隔（毫秒/字）</label>
              <input
                type="number"
                className="typing-input"
                value={typingInterval}
                min={0}
                max={500}
                step={1}
                onChange={(e) => setTypingInterval(Number(e.target.value))}
                disabled={typingStatus.isRunning}
              />
              <div className="typing-speed-buttons">
                <button
                  className={`typing-speed-btn ${typingInterval === 50 ? 'active' : ''}`}
                  onClick={() => setTypingSpeed(50)}
                  disabled={typingStatus.isRunning}
                >慢</button>
                <button
                  className={`typing-speed-btn ${typingInterval === 20 ? 'active' : ''}`}
                  onClick={() => setTypingSpeed(20)}
                  disabled={typingStatus.isRunning}
                >中</button>
                <button
                  className={`typing-speed-btn ${typingInterval === 8 ? 'active' : ''}`}
                  onClick={() => setTypingSpeed(8)}
                  disabled={typingStatus.isRunning}
                >快</button>
                <button
                  className={`typing-speed-btn ${typingInterval === 1 ? 'active' : ''}`}
                  onClick={() => setTypingSpeed(1)}
                  disabled={typingStatus.isRunning}
                >极速</button>
              </div>
            </div>
            <div className="typing-setting-item full">
              <div className="typing-toggle-row">
                <label className="typing-setting-label">中文模式下使用英文符号</label>
                <button
                  className={`typing-toggle ${typingEnglishSymbols ? 'on' : ''}`}
                  onClick={() => toggleEnglishSymbols(!typingEnglishSymbols)}
                  title="全局生效：开启后，在任何应用中打字，标点都会保持英文半角（绕过输入法转换）"
                >
                  <span className="typing-toggle-knob" />
                </button>
                <span className={`typing-toggle-state ${typingEnglishSymbols ? 'on' : ''}`}>
                  {typingEnglishSymbols ? '已开启' : '已关闭'}
                </span>
              </div>
              <div className="typing-setting-hint">作用于系统输入法：开启后手动打字时 , . ? 等标点保持英文半角，托盘菜单也可切换</div>
            </div>
          </div>

          {/* Tip */}
          <div className="typing-tip">
            💡 支持中英文直接输入，无需切换输入法。基于 .NET SendKeys 实现，兼容绝大多数应用和网站。
          </div>

          {/* Text area */}
          <div className="typing-text-area">
            <div className="typing-text-header">
              <span className="typing-text-label">📝 要输入的文本</span>
              <span className="typing-char-count">字符数：{typingText.length}</span>
            </div>
            <textarea
              className="typing-textarea"
              value={typingText}
              onChange={(e) => setTypingText(e.target.value)}
              placeholder="在这里粘贴你要输入的文字...&#10;&#10;支持中英文混合、换行、Tab 等。&#10;点击「开始打字」后，快速切换到目标输入框即可。"
              disabled={typingStatus.isRunning}
            />
          </div>

          {/* Buttons */}
          <div className="typing-buttons">
            <button
              className="typing-btn typing-btn-primary"
              onClick={handleStartTyping}
              disabled={typingStatus.isRunning || !typingText.trim()}
            >
              ▶ 开始打字
            </button>
            <button
              className="typing-btn typing-btn-stop"
              onClick={handleStopTyping}
              disabled={!typingStatus.isRunning}
            >
              ⏹ 停止
            </button>
            <button
              className="typing-btn typing-btn-secondary"
              onClick={handlePasteTypingText}
              disabled={typingStatus.isRunning}
            >
              📋 粘贴最新
            </button>
            <button
              className="typing-btn typing-btn-secondary"
              onClick={handleClearTypingText}
              disabled={typingStatus.isRunning}
            >
              🗑 清空
            </button>
          </div>

          {/* Status bar */}
          <div className="typing-status-bar">
            <div className={`typing-status-dot ${typingStatus.isRunning ? 'running' : ''}`}></div>
            <span className="typing-status-text">{typingStatus.status}</span>
            {typingStatus.total > 0 && (
              <div className="typing-progress-bar">
                <div
                  className="typing-progress-fill"
                  style={{ width: `${typingStatus.progress}%` }}
                ></div>
              </div>
            )}
            {typingStatus.total > 0 && (
              <span className="typing-progress-text">
                {typingStatus.current}/{typingStatus.total}
              </span>
            )}
          </div>

          {/* Warning */}
          <div className="typing-warning">
            ⚠️ 打字进行中请勿操作鼠标键盘。如需紧急停止，点击「停止」按钮。
          </div>
        </div>
      ) : (
        <>
          {activeTab === 'favorites' && (
            <div className="folder-toolbar">
              <label className="folder-select-label">收藏夹：</label>
              <select
                className="folder-select"
                value={selectedFolder}
                onChange={e => setSelectedFolder(e.target.value)}
              >
                <option value="all">全部 ({folderCounts.all})</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.emoji} {f.name} ({folderCounts[f.id] || 0})
                  </option>
                ))}
                <option value="none">未分类 ({folderCounts.none || 0})</option>
              </select>

              {/* Rename / delete the currently selected real folder */}
              {selectedFolder !== 'all' && selectedFolder !== 'none' && (
                <>
                  {renamingFolderId === selectedFolder ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="folder-rename-input folder-inline-input"
                      value={renameFolderName}
                      onChange={e => setRenameFolderName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameFolder()
                        if (e.key === 'Escape') setRenamingFolderId(null)
                      }}
                      onBlur={handleRenameFolder}
                    />
                  ) : (
                    <>
                      <button
                        className="mini-btn folder-manage-btn"
                        onClick={() => {
                          const f = folders.find(x => x.id === selectedFolder)
                          if (f) startRenameFolder(f.id, f.name)
                        }}
                        title="重命名当前收藏夹"
                      >✏️</button>
                      <button
                        className="mini-btn folder-manage-btn"
                        onClick={() => handleDeleteFolder(selectedFolder)}
                        title="删除当前收藏夹"
                      >🗑️</button>
                    </>
                  )}
                </>
              )}

              {/* New folder input */}
              {showNewFolderInput ? (
                <input
                  ref={newFolderInputRef}
                  type="text"
                  className="folder-rename-input folder-inline-input"
                  placeholder="新文件夹名"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName('') }
                  }}
                  onBlur={handleCreateFolder}
                />
              ) : (
                <button
                  className="mini-btn folder-manage-btn"
                  onClick={() => setShowNewFolderInput(true)}
                  title="新建收藏夹"
                >+</button>
              )}
            </div>
          )}
          <div className="list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📭</div>
              <div className="empty-text">
                {searchQuery
                  ? '没有找到匹配的内容'
                  : activeTab === 'favorites'
                    ? '还没有收藏的内容'
                    : activeTab === 'files'
                      ? '还没有复制过文件'
                      : '剪贴板历史为空'}
              </div>
              <div className="empty-hint">
                {searchQuery
                  ? '试试其他关键词'
                  : activeTab === 'files'
                    ? '复制一些文件，它们会出现在这里'
                    : '复制一些文字或文件，它们会出现在这里'}
              </div>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <div
                key={item.id}
                data-index={index}
                className={`item ${index === selectedIndex ? 'selected' : ''} ${item.type === 'file' ? 'item-file' : ''}`}
                onClick={() => handleCopy(item.id)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {item.type === 'file' ? (
                  <>
                    <div className="file-icon">{getFileIcon(item.fileName || item.preview)}</div>
                    <div className="item-content">
                      <div className="file-name">{item.fileName || item.preview}</div>
                      <div className="item-meta">
                        <span className="item-time">
                          {item.favorite && '⭐ '}
                          {item.fileSize ? formatFileSize(item.fileSize) : ''} · {formatTime(item.timestamp)}
                        </span>
                        <div className="item-actions">
                          <button
                            className="mini-btn"
                            onClick={e => handleOpenFile(item.id, e)}
                            title="打开文件"
                          >
                            📂
                          </button>
                          <button
                            className="mini-btn"
                            onClick={e => handleOpenFileLocation(item.id, e)}
                            title="打开所在位置"
                          >
                            📁
                          </button>
                          <button
                            className={`mini-btn favorite ${item.favorite ? 'active' : ''}`}
                            onClick={e => handleToggleFavorite(item.id, e)}
                            title={item.favorite ? '取消收藏' : '收藏'}
                          >
                            {item.favorite ? '⭐' : '☆'}
                          </button>
                          {item.favorite && (
                            <button
                              className="mini-btn folder-move-btn"
                              onClick={e => { e.stopPropagation(); toggleFolderMenu(item.id) }}
                              title="移动到收藏夹"
                            >
                              🗂️
                            </button>
                          )}
                          <button
                            className="mini-btn delete"
                            onClick={e => {
                              e.stopPropagation()
                              handleDelete(item.id)
                            }}
                            title="删除"
                          >
                            ✕
                          </button>
                          {showFolderMenu === item.id && item.favorite && (
                            <div className="folder-move-menu" onClick={e => e.stopPropagation()}>
                              {folders.map(f => (
                                <button
                                  key={f.id}
                                  className={`folder-move-option ${item.folderId === f.id ? 'current' : ''}`}
                                  onClick={() => handleMoveToFolder(item.id, f.id)}
                                >
                                  {f.emoji} {f.name}
                                </button>
                              ))}
                              <button
                                className={`folder-move-option ${!item.folderId ? 'current' : ''}`}
                                onClick={() => handleMoveToFolder(item.id, undefined)}
                              >
                                📋 未分类
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="item-preview">{item.preview}</div>
                    <div className="item-meta">
                      <span className="item-time">
                        {item.favorite && '⭐ '}
                        {formatTime(item.timestamp)}
                      </span>
                      <div className="item-actions">
                        <button
                          className={`mini-btn ${inlineTrans?.id === item.id ? 'active' : ''}`}
                          onClick={e => {
                            e.stopPropagation()
                            handleTranslateItem(item.id, item.text)
                          }}
                          title="翻译此条（短文直接显示译文）"
                        >
                          <span className="trans-entry-icon">文A</span>
                        </button>
                        <button
                          className="mini-btn"
                          onClick={e => {
                            e.stopPropagation()
                            handleExplainItem(item.text)
                          }}
                          title="详解此条（打开面板逐点解释）"
                        >
                          <span className="trans-entry-icon">解</span>
                        </button>
                        <button
                          className={`mini-btn favorite ${item.favorite ? 'active' : ''}`}
                          onClick={e => handleToggleFavorite(item.id, e)}
                          title={item.favorite ? '取消收藏' : '收藏'}
                        >
                          {item.favorite ? '⭐' : '☆'}
                        </button>
                        {item.favorite && (
                          <button
                            className="mini-btn folder-move-btn"
                            onClick={e => { e.stopPropagation(); toggleFolderMenu(item.id) }}
                            title="移动到收藏夹"
                          >
                            🗂️
                          </button>
                        )}
                        <button
                          className="mini-btn delete"
                          onClick={e => {
                            e.stopPropagation()
                            handleDelete(item.id)
                          }}
                          title="删除"
                        >
                          ✕
                        </button>
                        {showFolderMenu === item.id && item.favorite && (
                          <div className="folder-move-menu" onClick={e => e.stopPropagation()}>
                            {folders.map(f => (
                              <button
                                key={f.id}
                                className={`folder-move-option ${item.folderId === f.id ? 'current' : ''}`}
                                onClick={() => handleMoveToFolder(item.id, f.id)}
                              >
                                {f.emoji} {f.name}
                              </button>
                            ))}
                            <button
                              className={`folder-move-option ${!item.folderId ? 'current' : ''}`}
                              onClick={() => handleMoveToFolder(item.id, undefined)}
                            >
                              📋 未分类
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {inlineTrans?.id === item.id && (
                      <div className="inline-translation" onClick={e => e.stopPropagation()}>
                        <div className="inline-translation-body">
                          {inlineTrans.loading ? (
                            <span className="inline-translation-loading">翻译中…</span>
                          ) : inlineTrans.error ? (
                            <span className="inline-translation-error">✗ {inlineTrans.error}</span>
                          ) : (
                            <span
                              className="inline-translation-text"
                              title="点击复制译文"
                              onClick={() => handleCopyInlineTrans(inlineTrans.text)}
                            >
                              {inlineTrans.text}
                            </span>
                          )}
                        </div>
                        <button className="mini-btn delete" onClick={() => setInlineTrans(null)} title="关闭">
                          ✕
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
        </>
      )}

      {/* Footer */}
      <div className="footer">
        <span>
          {isSettingsTab
            ? '设置'
            : activeTab === 'token'
              ? `Token 余额 (${tokenKeys.length})`
              : activeTab === 'typing'
                ? '自动打字'
                : `共 ${filteredItems.length} 条`
          }
        </span>
        <div className="shortcut-hint">
          <span className="kbd">↑</span>
          <span className="kbd">↓</span>
          <span>选择</span>
          <span className="kbd">Enter</span>
          <span>复制</span>
          <span className="kbd">Esc</span>
          <span>关闭</span>
        </div>
      </div>
    </div>
  )
}

export default App
