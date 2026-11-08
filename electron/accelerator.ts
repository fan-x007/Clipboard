import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as net from 'net'
import { app } from 'electron'
import { spawn } from 'child_process'

const HOSTS_PATH = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')

const BLOCK_MARKER_START = '# >>> CV-Accelerator'
const BLOCK_MARKER_END = '# <<< CV-Accelerator'

interface HostsEntry {
  ip: string
  domain: string
}

interface AcceleratorStatus {
  github: boolean
  steam: boolean
}

interface ApplyResult {
  success: boolean
  message: string
}

interface AcceleratorCache {
  github?: HostsEntry[]
  steam?: HostsEntry[]
  fetchedAt?: number
}

const GITHUB_DOMAINS = [
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'gist.github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'cloud.githubusercontent.com',
  'objects.githubusercontent.com',
  'avatars.githubusercontent.com',
  'github.githubassets.com',
]

const STEAM_DOMAINS = [
  'store.steampowered.com',
  'steamcommunity.com',
  'api.steampowered.com',
  'login.steampowered.com',
  'help.steampowered.com',
  'store.akamai.steamstatic.com',
  'store.cloudflare.steamstatic.com',
  'community.akamai.steamstatic.com',
  'community.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'cdn.cloudflare.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'shared.cloudflare.steamstatic.com',
]

const IP_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/

// TCP connect latency test; resolves with RTT in ms, or null when unreachable
function testTcp(host: string, port = 443, timeout = 2500): Promise<number | null> {
  return new Promise(resolve => {
    const start = Date.now()
    let settled = false
    const socket = net.connect({ host, port })
    const finish = (ms: number | null) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ms)
    }
    socket.setTimeout(timeout)
    socket.on('connect', () => finish(Date.now() - start))
    socket.on('timeout', () => finish(null))
    socket.on('error', () => finish(null))
  })
}

class AcceleratorManager {
  // ─── Hosts file helpers ────────────────────────────────

  private readHosts(): string {
    try {
      return fs.readFileSync(HOSTS_PATH, 'utf-8')
    } catch {
      return ''
    }
  }

  private getCachePath(): string {
    return path.join(app.getPath('userData'), 'accelerator-cache.json')
  }

  getStatus(): AcceleratorStatus {
    const content = this.readHosts()
    return {
      github: content.includes(`${BLOCK_MARKER_START} github`),
      steam: content.includes(`${BLOCK_MARKER_START} steam`),
    }
  }

  // Remove all CV-Accelerator blocks from hosts content
  private stripBlocks(content: string): string {
    const lines = content.split(/\r?\n/)
    const out: string[] = []
    let inBlock = false
    for (const line of lines) {
      if (line.startsWith(BLOCK_MARKER_START)) {
        inBlock = true
        continue
      }
      if (line.startsWith(BLOCK_MARKER_END)) {
        inBlock = false
        continue
      }
      if (!inBlock) out.push(line)
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  }

  // ─── IP sources ────────────────────────────────────────

  private async fetchWithTimeout(url: string, ms: number, headers: Record<string, string> = {}): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
      const res = await fetch(url, { signal: controller.signal, headers })
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }

  // Resolve up to `limit` A records via DNS-over-HTTPS (AliDNS / DNSPod)
  private async dohResolveAll(domain: string, limit = 3): Promise<string[]> {
    const providers = [
      `https://223.5.5.5/resolve?name=${domain}&type=A`,
      `https://1.12.12.12/resolve?name=${domain}&type=A`,
    ]
    for (const url of providers) {
      try {
        const text = await this.fetchWithTimeout(url, 4000, { accept: 'application/dns-json' })
        const data = JSON.parse(text)
        const answers: Array<{ type: number; data: string }> = data?.Answer || []
        const ips = answers
          .filter(x => x.type === 1 && IP_REGEX.test(x.data))
          .map(x => x.data)
          .slice(0, limit)
        if (ips.length) return ips
      } catch {
        // try next provider
      }
    }
    return []
  }

  // GitHub520 community-maintained optimized IP list
  private async fetchGithub520(): Promise<HostsEntry[]> {
    try {
      const text = await this.fetchWithTimeout('https://raw.hellogithub.com/hosts', 6000, { accept: 'text/plain' })
      const entries: HostsEntry[] = []
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([\d.]+)\s+([\w.-]+)\s*$/)
        if (m && IP_REGEX.test(m[1])) entries.push({ ip: m[1], domain: m[2] })
      }
      return entries
    } catch {
      return []
    }
  }

  private readCache(): AcceleratorCache {
    try {
      return JSON.parse(fs.readFileSync(this.getCachePath(), 'utf-8'))
    } catch {
      return {}
    }
  }

  private writeCache(service: 'github' | 'steam', entries: HostsEntry[]) {
    try {
      const cache = this.readCache()
      cache[service] = entries
      cache.fetchedAt = Date.now()
      fs.writeFileSync(this.getCachePath(), JSON.stringify(cache, null, 2))
    } catch {
      // cache is best-effort
    }
  }

  // Collect candidate IPs per domain, then TCP-test each candidate and keep
  // the lowest-latency reachable IP. Domains with no reachable IP are skipped.
  private async collectEntries(service: 'github' | 'steam'): Promise<HostsEntry[]> {
    const domains = service === 'github' ? GITHUB_DOMAINS : STEAM_DOMAINS
    const candidates = new Map<string, string[]>()

    const addCandidate = (domain: string, ip: string) => {
      if (!domains.includes(domain) || !IP_REGEX.test(ip)) return
      const list = candidates.get(domain) || []
      if (!list.includes(ip)) list.push(ip)
      candidates.set(domain, list)
    }

    if (service === 'github') {
      const remote = await this.fetchGithub520()
      for (const e of remote) addCandidate(e.domain, e.ip)
    }

    const missing = domains.filter(d => !candidates.has(d))
    const dohResults = await Promise.all(missing.map(async domain => ({ domain, ips: await this.dohResolveAll(domain) })))
    for (const r of dohResults) {
      for (const ip of r.ips) addCandidate(r.domain, ip)
    }

    // TCP-test every candidate in parallel and pick the fastest reachable one
    const best: HostsEntry[] = []
    await Promise.all(
      Array.from(candidates.entries()).map(async ([domain, ips]) => {
        const rtts = await Promise.all(ips.map(ip => testTcp(ip)))
        let bestIdx = -1
        for (let i = 0; i < rtts.length; i++) {
          if (rtts[i] !== null && (bestIdx === -1 || rtts[i]! < rtts[bestIdx]!)) bestIdx = i
        }
        if (bestIdx >= 0) best.push({ ip: ips[bestIdx], domain })
      })
    )

    if (best.length === 0) {
      // Fall back to cached entries when nothing passes the test right now
      const cache = this.readCache()
      if (cache[service]?.length) return cache[service]
      throw new Error('所有候选 IP 均不可达，请检查网络连接')
    }

    best.sort((a, b) => domains.indexOf(a.domain) - domains.indexOf(b.domain))
    this.writeCache(service, best)
    return best
  }

  // ─── Apply ─────────────────────────────────────────────

  // Run the elevated helper via UAC. Exit codes are unreliable across the
  // Start-Process chain, so the caller verifies the hosts file afterwards.
  private runElevated(tempFile: string): Promise<ApplyResult> {
    const helper = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'hosts-admin.ps1')
      : path.join(__dirname, '..', 'scripts', 'hosts-admin.ps1')

    const cmd =
      `Start-Process powershell -Verb RunAs -Wait ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${helper}','-Source','${tempFile}')`

    return new Promise(resolve => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
        windowsHide: true,
      })
      let stderr = ''
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('error', err => resolve({ success: false, message: err.message }))
      proc.on('close', code => {
        if (code === 0) {
          resolve({ success: true, message: 'ok' })
        } else {
          resolve({
            success: false,
            message: '未获得管理员授权（UAC 被取消）或写入 hosts 失败',
          })
        }
      })
    })
  }

  private async applyContent(content: string): Promise<ApplyResult> {
    const tempFile = path.join(os.tmpdir(), `cv_hosts_${Date.now()}.txt`)
    fs.writeFileSync(tempFile, content, 'utf-8')
    // Clean up later; the elevated process may still be reading it
    setTimeout(() => {
      try { fs.unlinkSync(tempFile) } catch { /* ignore */ }
    }, 15000)

    const result = await this.runElevated(tempFile)
    return result
  }

  // Check the block was actually written, then probe a key domain via the
  // system resolver (which reads the hosts file) and report its latency
  private async verify(service: 'github' | 'steam', enabled: boolean): Promise<string> {
    const content = this.readHosts()
    const present = content.includes(`${BLOCK_MARKER_START} ${service}`)
    if (enabled && !present) {
      return 'hosts 写入未生效，请重试'
    }
    if (!enabled && present) {
      return 'hosts 清理未生效，请重试'
    }
    if (!enabled) {
      return '已关闭加速并恢复默认解析'
    }

    const entries = service === 'github' ? GITHUB_DOMAINS : STEAM_DOMAINS
    const written = content.split(/\r?\n/).filter(l => l.startsWith(BLOCK_MARKER_START)).length
    const probeDomain = service === 'github' ? 'github.com' : 'store.steampowered.com'
    const rtt = await testTcp(probeDomain, 443, 4000)

    if (rtt !== null) {
      return `已加速 ${entries.length} 个域名，${probeDomain} 连通 ${rtt}ms`
    }
    return `已加速 ${entries.length} 个域名，但 ${probeDomain} 暂时无法连通（建议重启浏览器）`
  }

  async setEnabled(service: 'github' | 'steam', enabled: boolean): Promise<ApplyResult> {
    let content = this.stripBlocks(this.readHosts())

    if (enabled) {
      let entries: HostsEntry[]
      try {
        entries = await this.collectEntries(service)
      } catch (e) {
        return { success: false, message: (e as Error).message }
      }
      const block = [
        `${BLOCK_MARKER_START} ${service} >>>`,
        `# ${service} acceleration IPs updated ${new Date().toLocaleString()}`,
        ...entries.map(e => `${e.ip} ${e.domain}`),
        `${BLOCK_MARKER_END} ${service} <<<`,
      ].join('\n')
      content = content.trimEnd() + '\n\n' + block + '\n'
    }

    const result = await this.applyContent(content)
    if (!result.success) return result

    const message = await this.verify(service, enabled)
    if (message.includes('未生效')) {
      return { success: false, message }
    }
    return { success: true, message }
  }
}

export const acceleratorManager = new AcceleratorManager()
