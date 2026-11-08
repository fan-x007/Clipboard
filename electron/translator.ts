export interface TranslateConfig {
  apiUrl: string
  apiKey: string
  model: string
}

export interface TranslateResult {
  success: boolean
  text?: string
  error?: string
}

const TIMEOUT_MS = 30000

const SYSTEM_PROMPTS: Record<'en' | 'zh', string> = {
  en: 'You are a professional translator. Translate the user text into natural, fluent English. Output ONLY the translation — no explanations, no quotes, no extra punctuation.',
  zh: 'You are a professional translator. Translate the user text into natural, fluent Simplified Chinese. Output ONLY the translation — no explanations, no quotes, no extra punctuation.',
}

export async function translateText(text: string, target: 'en' | 'zh', config: TranslateConfig): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, error: '请输入要翻译的内容' }
  }
  if (!config.apiKey) {
    return { success: false, error: '请先在设置中配置翻译服务的 API Key' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[target] },
          { role: 'user', content: trimmed },
        ],
      }),
    })

    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const body = await res.json()
        detail = body?.error?.message || body?.message || detail
      } catch {
        // keep default detail
      }
      return { success: false, error: `翻译请求失败: ${detail}` }
    }

    const data = await res.json()
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content) {
      return { success: false, error: 'API 返回内容为空，请检查模型名称是否正确' }
    }
    return { success: true, text: content.trim() }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { success: false, error: '翻译超时，请检查 API 地址是否可用' }
    }
    return { success: false, error: `翻译失败: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

// Minimal request to verify the API endpoint, key and model actually work
export async function testConnection(config: TranslateConfig): Promise<TranslateResult> {
  if (!config.apiKey) {
    return { success: false, error: '请先填写 API Key' }
  }
  if (!config.apiUrl) {
    return { success: false, error: '请先填写 API 地址' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const start = Date.now()

  try {
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })

    const rtt = Date.now() - start

    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const body = await res.json()
        detail = body?.error?.message || body?.message || detail
      } catch {
        // keep default detail
      }
      return { success: false, error: `连接失败: ${detail}` }
    }

    const data = await res.json()
    if (!data?.choices) {
      return { success: false, error: '接口已连通，但响应格式不是 OpenAI 兼容格式' }
    }
    return { success: true, text: `连接成功 · 模型 ${config.model} 响应 ${rtt}ms` }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { success: false, error: '连接超时（15 秒），请检查 API 地址' }
    }
    return { success: false, error: `连接失败: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}
