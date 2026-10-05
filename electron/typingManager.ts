import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { app, BrowserWindow } from 'electron'

export interface TypingStatus {
  isRunning: boolean
  status: string
  progress: number
  current: number
  total: number
}

class TypingManager {
  private isRunning = false
  private status = '就绪'
  private progress = 0
  private current = 0
  private total = 0
  private process: ChildProcess | null = null

  getStatus(): TypingStatus {
    return {
      isRunning: this.isRunning,
      status: this.status,
      progress: this.progress,
      current: this.current,
      total: this.total,
    }
  }

  private setStatus(status: string, current = 0, total = 0) {
    this.status = status
    this.current = current
    this.total = total
    this.progress = total > 0 ? Math.floor((current / total) * 100) : 0
    this.broadcastStatus()
  }

  private broadcastStatus() {
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      win.webContents.send('typing:status-updated', this.getStatus())
    }
  }

  private getTyperScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'typer.ps1')
    }
    return path.join(__dirname, '../scripts/typer.ps1')
  }

  startTyping(text: string, delay: number, interval: number): { success: boolean; message: string } {
    if (this.isRunning) {
      return { success: false, message: '正在打字中，请先停止' }
    }
    if (!text || !text.trim()) {
      return { success: false, message: '文本为空' }
    }

    this.isRunning = true
    this.setStatus('准备中...', 0, text.length)

    const delayMs = Math.round(delay * 1000)
    const intervalMs = Math.round(interval * 1000)
    const scriptPath = this.getTyperScriptPath()

    // Write text to temp file to avoid encoding issues
    const tempFile = path.join(os.tmpdir(), `clipboard_vibe_typer_${Date.now()}.txt`)
    try {
      fs.writeFileSync(tempFile, text, 'utf-8')
    } catch (e) {
      this.isRunning = false
      this.setStatus('就绪', 0, 0)
      return { success: false, message: `写入临时文件失败：${(e as Error).message}` }
    }

    // Start PowerShell typing process
    this.process = spawn(
      'powershell.exe',
      [
        '-ExecutionPolicy', 'Bypass',
        '-NoProfile',
        '-File', scriptPath,
        String(delayMs),
        String(intervalMs),
        tempFile,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    const totalChars = text.length
    let cleanupDone = false

    const cleanup = () => {
      if (cleanupDone) return
      cleanupDone = true
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch {
        // ignore
      }
      this.isRunning = false
      this.process = null
      this.broadcastStatus()
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString('utf-8').split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed.startsWith('COUNTDOWN:')) {
          const secs = trimmed.split(':')[1]
          this.setStatus(`${secs} 秒后开始打字，请切换到目标输入框...`, 0, totalChars)
        } else if (trimmed === 'STARTED') {
          this.setStatus('正在打字中...', 0, totalChars)
        } else if (trimmed.startsWith('PROGRESS:')) {
          const parts = trimmed.split(':')[1].split('/')
          const current = parseInt(parts[0], 10)
          const total = parseInt(parts[1], 10)
          if (!isNaN(current) && !isNaN(total)) {
            this.setStatus('打字中...', current, total)
          }
        } else if (trimmed.startsWith('DONE:')) {
          const sent = parseInt(trimmed.split(':')[1], 10)
          if (!isNaN(sent)) {
            this.setStatus(`完成！共输入 ${sent} 个字符`, sent, sent)
          }
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('Typer stderr:', data.toString())
    })

    this.process.on('error', (err) => {
      this.setStatus(`出错：${err.message}`, 0, 0)
      cleanup()
    })

    this.process.on('close', () => {
      cleanup()
    })

    return { success: true, message: '已开始' }
  }

  stopTyping(): { success: boolean; message: string } {
    if (!this.isRunning || !this.process) {
      return { success: false, message: '当前没有在打字' }
    }
    try {
      this.process.kill()
    } catch (e) {
      console.error('Failed to kill typing process:', e)
    }
    this.setStatus('已停止', 0, 0)
    this.isRunning = false
    this.process = null
    return { success: true, message: '已停止' }
  }
}

export const typingManager = new TypingManager()
