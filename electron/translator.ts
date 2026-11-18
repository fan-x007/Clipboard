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

const EXPLAIN_PROMPT = `你是一位技术内容讲解助手。用户会给你一段从剪贴板复制来的文本（可能是英文或中文，可能是代码、文档、报错、文章片段）。请用简体中文把它讲清楚，帮助读者真正理解而不是仅仅看懂字面意思。

按以下结构输出，使用 Markdown 标题与列表：

## 一句话说明
用一到两句话概括这段内容在讲什么、属于什么领域。

## 逐点拆解
把内容拆成若干要点，逐条讲解。每条先给结论（加粗），再用一两句解释它为什么这样、意味着什么。如果原文是代码或报错，说明每一部分的作用和可能的原因。

## 关键术语
列出文中出现的专业名词、缩写、命令、参数，逐条解释含义以及在这里的作用。没有则省略本节。

## 需要注意
指出前提条件、边界情况、容易踩的坑或理解上的常见误区。没有则省略本节。

要求：
1. 不要复述原文，不要客套话，直接讲。
2. 宁可具体，不要空泛；涉及数值、单位、默认值时明确写出。
3. 如果原文本身信息不足以下结论，直接说明缺少什么，不要编造。`

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

async function callChat(
  config: TranslateConfig,
  messages: ChatMessage[],
  temperature: number,
  failPrefix: string
): Promise<TranslateResult> {
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
        temperature,
        messages,
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
      return { success: false, error: `${failPrefix}请求失败: ${detail}` }
    }

    const data = await res.json()
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content) {
      return { success: false, error: 'API 返回内容为空，请检查模型名称是否正确' }
    }
    return { success: true, text: content.trim() }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { success: false, error: `${failPrefix}超时，请检查 API 地址是否可用` }
    }
    return { success: false, error: `${failPrefix}失败: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function translateText(text: string, target: 'en' | 'zh', config: TranslateConfig): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, error: '请输入要翻译的内容' }
  }
  if (!config.apiKey) {
    return { success: false, error: '请先在设置中配置翻译服务的 API Key' }
  }

  return callChat(
    config,
    [
      { role: 'system', content: SYSTEM_PROMPTS[target] },
      { role: 'user', content: trimmed },
    ],
    0.3,
    '翻译'
  )
}

export async function explainText(text: string, config: TranslateConfig): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, error: '请输入要详解的内容' }
  }
  if (!config.apiKey) {
    return { success: false, error: '请先在设置中配置翻译服务的 API Key' }
  }

  return callChat(
    config,
    [
      { role: 'system', content: EXPLAIN_PROMPT },
      { role: 'user', content: trimmed },
    ],
    0.4,
    '详解'
  )
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
