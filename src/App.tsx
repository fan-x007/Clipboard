import { useState, useEffect, useCallback, useRef } from 'react'
import type { ClipboardItem, AppSettings, TokenKeyConfig, TokenPlatformInfo } from './vite-env.d'

type TabType = 'all' | 'files' | 'favorites' | 'token' | 'settings'

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+V'
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

  // Filter items based on search and tab
  const filteredItems = items.filter(item => {
    const matchesSearch = searchQuery === '' ||
      item.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.fileName && item.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesTab = (activeTab === 'all' && item.inHistory) ||
      (activeTab === 'files' && item.type === 'file' && item.inHistory) ||
      (activeTab === 'favorites' && item.favorite)
    return matchesSearch && matchesTab
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

  // ─── Token Balance Effects ────────────────────────────────

  // Load token data on mount
  useEffect(() => {
    if (window.tokenApi) {
      Promise.all([
        window.tokenApi.getPlatforms(),
        window.tokenApi.getKeys(),
      ]).then(([plats, keys]) => {
        setTokenPlatforms(plats)
        setTokenKeys(keys)
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
      if (isRecording || isSettingsTab || activeTab === 'token') return

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

  const showTokenToast = useCallback((msg: string, type = 'success') => {
    setTokenToast({ msg, type })
    if (tokenToastTimerRef.current) clearTimeout(tokenToastTimerRef.current)
    tokenToastTimerRef.current = setTimeout(() => setTokenToast(null), 2500)
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

  const isSettingsTab = activeTab === 'settings'
  const fileCount = items.filter(i => i.type === 'file').length
  const textCount = items.filter(i => i.type === 'text').length

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
              <button
                className="icon-btn danger"
                onClick={handleClearFavorites}
                title="清空收藏"
              >
                🗑️
              </button>
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
          onClick={() => setActiveTab('favorites')}
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
              <button
                className="icon-btn"
                onClick={handleRefreshAllTokens}
                title="刷新所有余额"
              >
                🔄
              </button>
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

          {/* Token Toast */}
          {tokenToast && (
            <div className={`toast toast-${tokenToast.type}`}>
              {tokenToast.msg}
            </div>
          )}
        </div>
      ) : (
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
                          className={`mini-btn favorite ${item.favorite ? 'active' : ''}`}
                          onClick={e => handleToggleFavorite(item.id, e)}
                          title={item.favorite ? '取消收藏' : '收藏'}
                        >
                          {item.favorite ? '⭐' : '☆'}
                        </button>
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
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer */}
      <div className="footer">
        <span>
          {isSettingsTab
            ? '设置'
            : activeTab === 'token'
              ? `Token 余额 (${tokenKeys.length})`
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
