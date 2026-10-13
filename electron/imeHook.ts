import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { app } from 'electron'

// Manages the helper PowerShell process that installs a global keyboard hook.
// When enabled, punctuation keys typed anywhere in the system are re-injected
// as exact ASCII symbols so the Chinese IME cannot convert them to full-width.
class ImeHook {
  private proc: ChildProcess | null = null
  private enabled = false

  private getScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'hook.ps1')
    }
    return path.join(__dirname, '../scripts/hook.ps1')
  }

  private ensureProcess() {
    if (this.proc && this.proc.exitCode === null) return

    this.proc = spawn(
      'powershell.exe',
      [
        '-ExecutionPolicy', 'Bypass',
        '-NoProfile',
        '-File', this.getScriptPath(),
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )

    this.proc.stdout?.on('data', (data: Buffer) => {
      const out = data.toString('utf-8').trim()
      if (out) console.log('[ime-hook]', out)
    })

    this.proc.stderr?.on('data', (data: Buffer) => {
      console.error('[ime-hook] stderr:', data.toString())
    })

    this.proc.on('error', (err) => {
      console.error('[ime-hook] process error:', err)
      this.proc = null
    })

    this.proc.on('close', () => {
      this.proc = null
    })
  }

  private send(cmd: string) {
    try {
      this.proc?.stdin?.write(cmd + '\n')
    } catch (e) {
      console.error('[ime-hook] failed to send command:', cmd, e)
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (enabled) {
      this.ensureProcess()
      this.send('ON')
    } else if (this.proc && this.proc.exitCode === null) {
      // Keep the helper process alive (avoid slow re-compile), just disable the hook
      this.send('OFF')
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  stop() {
    this.enabled = false
    if (this.proc && this.proc.exitCode === null) {
      this.send('EXIT')
    }
    const proc = this.proc
    this.proc = null
    // Fallback: kill if it doesn't exit on its own
    setTimeout(() => {
      try {
        if (proc && proc.exitCode === null) {
          proc.kill()
        }
      } catch {
        // ignore
      }
    }, 2000)
  }
}

export const imeHook = new ImeHook()
