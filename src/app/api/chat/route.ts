import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted, runAgentAutomationCycle } from '@/lib/agent-automation'
import { buildOpportunityFeed, buildWhatsNewBriefing } from '@/lib/core-brain'
import { buildSwayPulse } from '@/lib/sway-planner'
import { handleSenderPropertyWatch } from './handlers/sender-property-watch'
import { db } from '@/lib/db'
import { forwardGmailMessages, getRecentGmailMessages } from '@/lib/gmail-api'
import { getUnifiedInbox, searchUnifiedInbox } from '@/lib/email-hub'
import { getMailboxSenderRules, messageMatchesSenderPattern, upsertMailboxSenderRule } from '@/lib/mailbox-rules'
import { forwardMessages, getRecentMessages } from '@/lib/outlook-graph'
import { activateBrain, detectBrainDomain, type BrainDomain } from '@/lib/specialist-brains'

export const runtime = 'nodejs'

type ChatProvider =
  | 'ollama'
  | 'openai'
  | 'gemini'
  | 'qwen'
  | 'grok'
  | 'glm'
  | 'deepseek'
  | 'mistral'
  | 'minimax'
  | 'openrouter'
  | 'huggingface'

const CHAT_PROVIDER_POLICY = {
  ollamaPrimary: true,
  allowCloudFallbackOnUrgent: true,
}

const systemPrompt = `You are a helpful AI assistant integrated into a professional services management application.
You help users with:
- UK Legal matters and solicitor management
- UK Accounting and tax-related questions
- Supplier tracking and management
- Email management and communication

When appropriate, delegate tasks to specialized agents:
- Legal Agent: For solicitor-related questions, legal documents, and UK law
- Financial Agent: For accounting, tax deadlines, and financial matters
- Supplier Agent: For supplier orders, invoices, and communications
- Email Agent: For email management and communications
- Research Agent: For gathering information and analysis

Always be helpful, professional, and provide accurate information. If you're unsure about legal or financial matters, recommend consulting with a qualified professional.`

function detectProvider(model?: string): ChatProvider {
  const requested = model?.toLowerCase() ?? ''
  if (requested.startsWith('gemini')) return 'gemini'
  if (requested.startsWith('qwen')) return 'qwen'
  if (requested.startsWith('grok')) return 'grok'
  if (requested.startsWith('glm')) return 'glm'
  if (requested.startsWith('deepseek')) return 'deepseek'
  if (requested.startsWith('mistral')) return 'mistral'
  if (requested.startsWith('minimax')) return 'minimax'
  if (requested.startsWith('openrouter')) return 'openrouter'
  if (requested.startsWith('huggingface')) return 'huggingface'
  if (requested === 'openai' || requested.startsWith('gpt')) return 'openai'
  if (requested.startsWith('ollama')) return 'ollama'
  return 'ollama'
}

function providerReady(provider: ChatProvider) {
  switch (provider) {
    case 'gemini':
      return !!process.env.GEMINI_API_KEY
    case 'openai':
      return !!process.env.OPENAI_API_KEY
    case 'qwen':
      return !!process.env.QWEN_API_KEY
    case 'grok':
      return !!process.env.GROK_API_KEY
    case 'glm':
      return !!process.env.GLM_API_KEY
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY
    case 'mistral':
      return !!process.env.MISTRAL_API_KEY
    case 'minimax':
      return !!process.env.MINIMAX_API_KEY
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY
    case 'huggingface':
      return !!process.env.HUGGINGFACE_API_KEY
    case 'ollama':
    default:
      return true
  }
}

async function callOllama(messages: { role: string; content: string }[]) {
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const configured = process.env.OLLAMA_MODEL || 'llama3.1'

  // Query local Ollama catalog so we only try models the user actually has.
  const tagsRes = await fetch(`${base}/api/tags`, { cache: 'no-store' })
  let installed: string[] = []
  if (tagsRes.ok) {
    const tagsData = await tagsRes.json()
    installed = (tagsData.models || [])
      .map((m: { name?: string }) => m.name)
      .filter((name: string | undefined): name is string => !!name)
  }

  const preferred = [
    configured,
    configured.includes(':') ? configured.split(':')[0] : `${configured}:latest`,
    'llama3',
    'llama3:instruct',
    'qwen2.5-coder:latest',
    'qwen3-coder:latest',
    'mistral:7b',
  ]

  const candidates = (installed.length > 0
    ? [...preferred.filter(m => installed.includes(m)), ...installed]
    : preferred
  ).filter((model, idx, arr) => arr.indexOf(model) === idx)

  let lastErr: any
  for (const model of candidates) {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
      cache: 'no-store',
    })

    if (res.ok) {
      const data = await res.json()
      return data.message?.content || data.response || ''
    }

    const text = await res.text()
    lastErr = `Ollama model ${model} error: ${res.status} ${text}`
    // If model missing, try next
    if (res.status === 404 && text.includes('not found')) continue
    break
  }
  const available = installed.length > 0 ? installed.join(', ') : 'none detected'
  throw new Error(`${lastErr || 'Ollama error'}. Installed models: ${available}`)
}

async function callOpenAICompatible({
  messages,
  apiKey,
  base,
  model,
}: {
  messages: { role: string; content: string }[]
  apiKey?: string
  base: string
  model: string
}) {
  if (!apiKey) throw new Error('Missing API key')

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      stream: false,
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Chat API error: ${res.status} ${text}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callOpenAI(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.OPENAI_API_KEY,
    base: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  })
}

async function callDeepSeek(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.DEEPSEEK_API_KEY,
    base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  })
}

async function callMistral(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.MISTRAL_API_KEY,
    base: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
  })
}

async function callQwen(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.QWEN_API_KEY,
    base: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: process.env.QWEN_MODEL || 'qwen-max',
  })
}

async function callGrok(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.GROK_API_KEY,
    base: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    model: process.env.GROK_MODEL || 'grok-beta',
  })
}

async function callGLM(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.GLM_API_KEY,
    base: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.GLM_MODEL || 'glm-4-plus',
  })
}

async function callMinimax(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.MINIMAX_API_KEY,
    base: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
    model: process.env.MINIMAX_MODEL || 'abab6.5s-chat',
  })
}

async function callOpenRouter(messages: { role: string; content: string }[]) {
  return callOpenAICompatible({
    messages,
    apiKey: process.env.OPENROUTER_API_KEY,
    base: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
  })
}

async function callHuggingFace(messages: { role: string; content: string }[]) {
  const apiKey = process.env.HUGGINGFACE_API_KEY
  const model = process.env.HUGGINGFACE_MODEL || 'mistralai/Mixtral-8x7B-Instruct-v0.1'
  const base = process.env.HUGGINGFACE_BASE_URL || 'https://api-inference.huggingface.co/models'

  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not set')

  const res = await fetch(`${base}/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ inputs: messages.map(m => `${m.role}: ${m.content}`).join('\n') }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HuggingFace error: ${res.status} ${text}`)
  }

  const data = await res.json()
  if (Array.isArray(data) && data[0]?.generated_text) {
    const gen = data[0].generated_text as string
    return gen.replace(/user:.*assistant:/i, '').trim() || gen.trim()
  }
  return data.generated_text || data.content || JSON.stringify(data)
}

async function callGemini(messages: { role: string; content: string }[]) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest'
  const url = `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'}/models/${model}:generateContent?key=${apiKey}`

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini error: ${res.status} ${text}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

function parseUpdatesQuery(input: string): { person: string; topic?: string } | null {
  const withTopic = input.match(/(?:updates?|ubdates?)\s+from\s+(.+?)\s+about\s+(.+?)[?.!]*$/i)
  if (withTopic) return { person: withTopic[1].trim(), topic: withTopic[2].trim() }
  const withoutTopic = input.match(/(?:what(?:'s|\s+is)?\s+)?(?:full\s+)?(?:updates?|ubdates?)\s+from\s+(.+?)[?.!]*$/i)
  if (!withoutTopic) return null
  return { person: withoutTopic[1].trim() }
}

function parsePersonProgressQuery(input: string): { person: string; topic?: string } | null {
  const lower = normalizeInput(input)
  const asksProgress = containsAny(lower, [
    'has done so far',
    'done so far',
    'progress so far',
    'what has',
    'whats',
    "what's",
    'what is',
  ])
  if (!asksProgress) return null

  const emailMatch = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
  if (emailMatch?.[0]) {
    return { person: emailMatch[0].trim() }
  }

  if (lower.includes('alicea') || lower.includes('aliceamclellan') || lower.includes('aliceamcllelan')) {
    return { person: 'aliceamclellan@rc.legal' }
  }

  const tokenMatch = input.match(/\b([A-Za-z][A-Za-z'\-]{2,})\b/)
  if (!tokenMatch) return null
  return { person: tokenMatch[1].trim() }
}

function splitNaturalList(input: string): string[] {
  const normalized = input
    .replace(/\s+(and|&)\s+/gi, ',')
    .replace(/\s+\/\s+/g, ',')
  return uniqueStrings(
    normalized
      .split(',')
      .map((part) => part.replace(/\b(multiple emails?)\b/gi, '').trim())
      .filter(Boolean)
      .filter((part) => part.length > 1)
  )
}

function parseCaseDossierQuery(input: string): {
  senders: string[]
  topics: string[]
  sinceDate: string
  maxFetchPerProvider: number
} | null {
  const lower = normalizeInput(input)
  const hasSignal =
    containsAny(lower, [
      'communications from',
      'emails from',
      'messages from',
      'search inbox',
      'search outlook',
      'search gmail',
      'find emails from',
      'find communications from',
    ]) &&
    containsAny(lower, ['regarding', 'about', 'property', 'refund', 'registration', 'land registry', 'delay', 'claim', 'compensation'])

  if (!hasSignal) return null

  const senderMatch = input.match(
    /(?:communications?|emails?|messages?)\s+from\s+(.+?)(?:(?:\s+(?:regarding|about|on)\s+)|[?.!]|$)/i
  )
  if (!senderMatch) return null

  const senders = splitNaturalList(senderMatch[1])
  if (senders.length === 0) return null

  const topicMatch = input.match(/\b(?:regarding|about|on)\s+(.+?)(?:[?.!]|$)/i)
  const topics = topicMatch ? splitNaturalList(topicMatch[1]) : []

  const yearMatch = lower.match(/\b(20\d{2})\b/)
  const year = yearMatch ? Number(yearMatch[1]) : 2024
  const safeYear = Number.isFinite(year) ? Math.min(Math.max(year, 2018), new Date().getUTCFullYear()) : 2024
  const envCap = Math.max(Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 1000)
  const boundedCap = Math.min(envCap, 80)

  return {
    senders,
    topics,
    sinceDate: `${safeYear}-01-01T00:00:00.000Z`,
    maxFetchPerProvider: boundedCap,
  }
}

function parsePropertyMailboxQuery(input: string): {
  sinceDate: string
  textQuery: string
  nameHints: string[]
  maxFetchPerProvider: number
} | null {
  const lower = normalizeInput(input)
  const hasPropertySignal = containsAny(lower, [
    'property',
    'properties',
    'land registry',
    'lease',
    'leasehold',
    'freehold',
    'title',
    'deed',
    'conveyancing',
  ])
  const hasSearchIntent = containsAny(lower, [
    'find',
    'search',
    'check',
    'show',
    'scan',
    'related my name',
    'see what you can find',
    'look up',
    'my email',
    'my emails',
    'inbox',
    'mailbox',
    'emails',
    'email',
  ])
  const topicOnlyFollowUp = hasPropertySignal && lower.split(' ').filter(Boolean).length <= 6
  if (!hasPropertySignal || (!hasSearchIntent && !topicOnlyFollowUp)) return null

  const yearMatch = lower.match(/\b(20\d{2})\b/)
  const year = yearMatch ? Number(yearMatch[1]) : 2023
  const safeYear = Number.isFinite(year) ? Math.min(Math.max(year, 2018), new Date().getUTCFullYear()) : 2023

  const detectedNames = uniqueStrings(
    Array.from(
      input.matchAll(
        /\b(?:i am|i'm|im|my name is)\s+([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+){0,2})/gi
      ),
      (m) => m[1].trim()
    )
  )

  const topicTerms: string[] = []
  if (lower.includes('land registry')) topicTerms.push('land registry')
  if (containsAny(lower, ['lease', 'leasehold'])) topicTerms.push('lease')
  if (containsAny(lower, ['property', 'properties'])) topicTerms.push('property')
  if (containsAny(lower, ['title', 'deed'])) topicTerms.push('title deed')
  if (lower.includes('conveyancing')) topicTerms.push('conveyancing')

  const textQuery = uniqueStrings(topicTerms).join(' ').trim() || 'property lease land registry'
  const envCap = Math.max(Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 1000)

  return {
    sinceDate: `${safeYear}-01-01T00:00:00.000Z`,
    textQuery,
    nameHints: detectedNames.slice(0, 8),
    maxFetchPerProvider: envCap,
  }
}

function parseSenderPropertyWatchQuery(input: string): {
  sinceDate: string
  senderHints: string[]
  propertyHints: string[]
  includeLandRegistry: boolean
} | null {
  const lower = normalizeInput(input)
  const hasWatchIntent = containsAny(lower, [
    'look out for',
    'look outfor',
    'watch',
    'monitor',
    'keep updates',
    'save history',
    'save all',
    'find and save',
    'chase',
  ])
  const hasPropertySignal = containsAny(lower, [
    'property',
    'steamer street',
    'streamer street',
    '6f steamer',
    '6f streamer',
    'land registry',
    'lease',
    'conveyancing',
  ])

  const senderHints = uniqueStrings([
    ...Array.from(input.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi), (m) => m[0].trim()),
    ...(lower.includes('alicea') ? ['alicea', 'aliceamclellan', 'rc.legal'] : []),
    ...(lower.includes('aliceamclellan') ? ['aliceamclellan', 'rc.legal'] : []),
    ...(lower.includes('rc.legal') ? ['rc.legal'] : []),
  ])
  if (!hasPropertySignal || senderHints.length === 0) return null
  if (!hasWatchIntent && !containsAny(lower, ['regarding', 'about', 'find'])) return null

  const propertyHints = uniqueStrings([
    ...(containsAny(lower, ['6f steamer', '6f streamer']) ? ['6F Steamer Street'] : []),
    ...(containsAny(lower, ['steamer street', 'streamer street']) ? ['Steamer Street'] : []),
    ...(lower.includes('barrow') ? ['Barrow-in-Furness'] : []),
    ...(lower.includes('property') ? ['property'] : []),
    ...(lower.includes('lease') ? ['lease'] : []),
    ...(lower.includes('land registry') ? ['land registry'] : []),
  ])

  const yearMatch = lower.match(/\b(20\d{2})\b/)
  const year = yearMatch ? Number(yearMatch[1]) : 2023
  const safeYear = Number.isFinite(year) ? Math.min(Math.max(year, 2018), new Date().getUTCFullYear()) : 2023

  return {
    sinceDate: `${safeYear}-01-01T00:00:00.000Z`,
    senderHints,
    propertyHints: propertyHints.length > 0 ? propertyHints : ['Steamer Street', 'property', 'land registry'],
    includeLandRegistry: containsAny(lower, ['land registry', 'registry']),
  }
}

function normalizeInput(input: string) {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function containsAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value))
}

function parseForwardQuery(input: string): { hours: number; senders: string[]; to: string } | null {
  const match = input.match(/forward\s+last\s+(\d+)\s*h(?:ours?)?\s+emails?\s+from\s+(.+?)\s+to\s+([^\s]+@[^\s]+)[?.!]*$/i)
  if (!match) return null
  const hours = Number(match[1])
  const senders = match[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { hours, senders, to: match[3].trim() }
}

function parseMailboxAnalysisQuery(input: string): { provider: 'outlook' | 'gmail' | 'all'; top: number } | null {
  const lower = normalizeInput(input)
  const asksAllHistorical = containsAny(lower, [
    'all emails',
    'all emailes',
    'all email',
    'all mail',
    'search all email',
    'search all emailes',
  ])
  if (asksAllHistorical) return null

  const analysisSignals = ['analyse', 'analyze', 'analysis', 'review', 'summarize', 'summary']
  const mailboxSignals = ['outlook', 'gmail', 'inbox', 'mailbox', 'email', 'emails', 'mail']
  const hasAnalysisSignal = containsAny(lower, analysisSignals)
  const hasMailboxSignal = containsAny(lower, mailboxSignals)
  if (!hasAnalysisSignal || !hasMailboxSignal) return null

  const topMatch = lower.match(/(?:last|latest|top|analy[sz]e|review)\s+(\d+)\s+(?:emails|messages|mails)?/)
  const top = topMatch ? Math.min(Math.max(Number(topMatch[1]), 3), 30) : 15

  if (lower.includes('outlook')) return { provider: 'outlook', top }
  if (lower.includes('gmail')) return { provider: 'gmail', top }
  return { provider: 'all', top }
}

function parseSenderFocusedAnalysisQuery(input: string): {
  senderHints: string[]
  topicHints: string[]
  sinceDate: string
  askNeedReply: boolean
} | null {
  const lower = normalizeInput(input)
  const asksAnalysis = containsAny(lower, ['analyse', 'analyze', 'analysis', 'updates', 'ubdates', 'status'])
  const asksEmailTopic = containsAny(lower, ['email', 'emails', 'emailes', 'communications', 'messages', 'inbox'])
  const asksNeedReply = containsAny(lower, [
    'need send another email',
    'should we send another email',
    'do we need send',
    'need to chase',
    'chase again',
    'follow up',
    'follow-up',
  ])

  const senderHints = uniqueStrings([
    ...Array.from(input.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi), (m) => m[0].trim()),
    ...(containsAny(lower, ['alicea', 'aliceamclellan', 'aliceamcllelan', 'rc.legal'])
      ? ['aliceamclellan@rc.legal', 'aliceamclellan', 'rc.legal', 'alicea']
      : []),
  ])

  if (senderHints.length === 0) return null
  if (!asksAnalysis && !asksNeedReply) return null
  if (!asksEmailTopic && !asksNeedReply) return null

  const topicHints = uniqueStrings([
    ...(containsAny(lower, ['land registry', 'registry']) ? ['land registry'] : []),
    ...(containsAny(lower, ['6f', 'steamer', 'streamer', 'property']) ? ['6f steamer street', 'property'] : []),
    ...(containsAny(lower, ['lease', 'title', 'deed']) ? ['lease', 'title', 'deed'] : []),
  ])

  return {
    senderHints,
    topicHints,
    sinceDate: '2023-01-01T00:00:00.000Z',
    askNeedReply: asksNeedReply,
  }
}

function parseMailboxUpdatesQuery(input: string): { provider: 'outlook' | 'gmail' | 'all'; top: number } | null {
  const lower = normalizeInput(input)
  const updateSignals = ['update', 'updates', 'inbox', 'emails', 'messages', 'new mail', 'latest', 'new']
  const actionSignals = ['check', 'show', "what's", 'whats', 'what is', 'latest', 'recent', 'tell me', 'give me', 'any']
  const hasUpdateSignal = containsAny(lower, updateSignals)
  const hasActionSignal = containsAny(lower, actionSignals) || lower.endsWith('?')
  if (!hasUpdateSignal || !hasActionSignal) return null

  const topMatch = lower.match(/(?:last|latest|top|show)\s+(\d+)\s+(?:emails|messages|mails)?/)
  const top = topMatch ? Math.min(Math.max(Number(topMatch[1]), 1), 20) : 8

  if (lower.includes('outlook')) return { provider: 'outlook', top }
  if (lower.includes('gmail')) return { provider: 'gmail', top }
  return { provider: 'all', top }
}

function parseAgentTypeHint(lower: string): string | undefined {
  if (containsAny(lower, ['solicitor', 'solicister', 'legal'])) return 'solicitor'
  if (containsAny(lower, ['accountant', 'accounting', 'financial', 'hmrc', 'tax', 'vat'])) return 'accountant'
  if (containsAny(lower, ['supplier', 'suppliers', 'vendor', 'procurement'])) return 'supplier'
  if (containsAny(lower, ['business', 'bank', 'banking', 'mortgage', 'utility', 'insurance', 'property', 'council tax'])) return 'business'
  if (lower.includes('research')) return 'research'
  return undefined
}

function parseEntityDashboardQuery(input: string): { agentType?: string } | null {
  const lower = normalizeInput(input)
  const hasSecondaryAnalysisIntent =
    containsAny(lower, ['analyse', 'analyze', 'analysis']) &&
    (containsAny(lower, ['alicea', 'aliceamclellan', 'rc.legal', '@']) ||
      containsAny(lower, ['do we need to chase', 'need to chase', 'send another email']))
  if (hasSecondaryAnalysisIntent) return null

  const generic =
    lower.includes('any updates') ||
    lower.includes("what's happening") ||
    lower.includes('whats happening') ||
    lower.includes('what is happening') ||
    lower.includes('status update') ||
    lower.includes('whats updates') ||
    lower.includes("what's updates") ||
    lower === 'updates' ||
    lower === 'updates?' ||
    lower.includes('what should i do next')
  const scoped =
    (lower.includes('update') || lower.includes('updates') || lower.includes('status')) &&
    (lower.includes('solicitor') ||
      lower.includes('solicister') ||
      lower.includes('accountant') ||
      lower.includes('accounting') ||
      lower.includes('supplier') ||
      lower.includes('suppliers') ||
      lower.includes('business') ||
      lower.includes('bank') ||
      lower.includes('property') ||
      lower.includes('research'))

  if (!generic && !scoped) return null

  const agentType = parseAgentTypeHint(lower)
  if (agentType) return { agentType }
  return {}
}

function parseSolicitorAndAliceaCombinedQuery(input: string): {
  providerHint: 'outlook' | 'gmail' | 'all'
} | null {
  const lower = normalizeInput(input)
  const asksSolicitorStatus = containsAny(lower, [
    'show solicitor-only status',
    'show solicitor status',
    'solicitor-only status',
  ])
  const asksAliceaAnalysis =
    containsAny(lower, ['alicea', 'aliceamclellan', 'aliceamcllelan', 'rc.legal']) &&
    containsAny(lower, ['analyse', 'analyze', 'updates', 'chase', 'send another email'])
  if (!(asksSolicitorStatus && asksAliceaAnalysis)) return null
  if (lower.includes('outlook')) return { providerHint: 'outlook' }
  if (lower.includes('gmail')) return { providerHint: 'gmail' }
  return { providerHint: 'all' }
}

function parseGeneralUpdatesQuery(input: string): { top: number } | null {
  const lower = normalizeInput(input)
  const hasTaskIntent =
    containsAny(lower, [
      'look out',
      'look outfor',
      'regarding',
      'about',
      'find',
      'search',
      'analyze',
      'analyse',
      'chase',
      'keep chasing',
      'save',
      'emails from',
      'communications from',
      'messages from',
      'updates from',
      'ubdates from',
    ]) || lower.includes('@')
  if (hasTaskIntent) return null

  const looksMailboxSpecific = containsAny(lower, ['gmail', 'outlook', 'mailbox', 'inbox', 'email', 'emails'])
  const asksUpdate = containsAny(lower, [
    'update',
    'updates',
    'latest',
    'status',
    'what is new',
    "what's new",
    'whats new',
    'what is happening',
    "what's happening",
    'whats happening',
  ])
  const asksQuestion = containsAny(lower, [
    'what',
    "what's",
    'whats',
    'show',
    'check',
    'tell',
    'give',
    'any',
  ]) || lower.endsWith('?')

  if (looksMailboxSpecific) return null
  if (!asksUpdate || !asksQuestion) return null

  const topMatch = lower.match(/(?:last|latest|top|show)\s+(\d+)\s+(?:emails|messages|mails|updates)?/)
  const top = topMatch ? Math.min(Math.max(Number(topMatch[1]), 3), 20) : 8

  return { top }
}

function parseCasualGreetingQuery(input: string): boolean {
  const lower = normalizeInput(input)
  const greeting = containsAny(lower, [
    'hey beema',
    'hi beema',
    'hello beema',
    'hey bema',
    'hi bema',
    'hello bema',
    'how are you today',
    'how are you',
  ])
  const asksWork = containsAny(lower, [
    'update',
    'updates',
    'ubdates',
    'status',
    'what is new',
    "what's new",
    'whats new',
    'look out',
    'search',
    'find',
    'draft',
    'email',
  ])
  return greeting && !asksWork
}

function parseReadCoverageQuery(input: string): boolean {
  const lower = normalizeInput(input)
  return containsAny(lower, [
    'did you read all',
    'did u read all',
    'read them all',
    'understand them all',
    'did you read all emails',
    'read all emailes',
    'did you analyse all',
    'did you analyze all',
    'did you scan all',
  ])
}

function parseBeemaGreetingQuery(input: string): { top: number } | null {
  const lower = normalizeInput(input)
  const directGreeting = containsAny(lower, [
    'hey beema',
    'hi beema',
    'hello beema',
    'good morning beema',
    'good afternoon beema',
    'good evening beema',
  ])
  const explicitPulseIntent = containsAny(lower, [
    'beema pulse',
    'daily pulse',
    'brief me',
    'daily briefing',
    'what matters now',
  ])
  const asksStatus = containsAny(lower, [
    "what's new",
    'whats new',
    'what is new',
    'what is happening',
    "what's happening",
    'status',
    'updates',
  ])
  const hasEntitySpecificIntent =
    containsAny(lower, [
      'status of',
      'status for',
      'where are we with',
      'thread for',
      'case for',
      'matter for',
      'progress for',
    ]) ||
    containsAny(lower, [
      '6f',
      'steamer street',
      'streamer street',
      'land registry',
      'alicea',
      'rc.legal',
      'hmrc',
    ])
  const hasTaskIntent = containsAny(lower, [
    'look out',
    'look outfor',
    'regarding',
    'about',
    'find',
    'search',
    'analyze',
    'analyse',
    'chase',
    'keep chasing',
    'save',
    'emails from',
    'communications from',
    'messages from',
    'updates from',
    'ubdates from',
    'draft email',
    'email to',
  ]) || lower.includes('@')

  if (hasTaskIntent) return null
  if (hasEntitySpecificIntent) return null

  // Keep BEEMA pulse explicit so focused status queries are not intercepted.
  if (!directGreeting && !explicitPulseIntent) return null
  if (!asksStatus && !explicitPulseIntent) return null

  return { top: 5 }
}

function parseWhatsNewBriefingQuery(input: string): { max: number } | null {
  const lower = normalizeInput(input)
  const hasTaskIntent =
    containsAny(lower, [
      'look out',
      'look outfor',
      'regarding',
      'about',
      'find',
      'search',
      'analyze',
      'analyse',
      'chase',
      'keep chasing',
      'save',
      'emails from',
      'communications from',
      'messages from',
      'updates from',
      'ubdates from',
      'draft email',
      'email to',
    ]) || lower.includes('@')
  if (hasTaskIntent) return null

  const asksBriefing = containsAny(lower, [
    "what's new",
    'whats new',
    'what is new',
    'daily briefing',
    'brief me',
    'briefing',
    'latest priorities',
    'important updates',
  ])
  const greetingPlusUpdate =
    containsAny(lower, ['good morning', 'good afternoon', 'good evening', 'hey', 'hello']) &&
    containsAny(lower, ['updates', 'ubdates', "what's new", 'whats new', 'what is new'])

  if (!asksBriefing && !greetingPlusUpdate) return null
  const maxMatch = lower.match(/\b(?:top|show|give)\s+(\d+)\b/)
  const max = maxMatch ? Math.min(Math.max(Number(maxMatch[1]), 3), 12) : 7
  return { max }
}

function parseDraftLandRegistryEmailQuery(input: string): { toHint: string; topic: string } | null {
  const lower = normalizeInput(input)
  const asksDraft = containsAny(lower, ['draft email', 'draft an email', 'write email', 'email to'])
  const asksLandRegistry = containsAny(lower, ['land registry', 'registry', 'title', 'deed'])
  if (!asksDraft || !asksLandRegistry) return null

  const toMatch = input.match(/(?:to|for)\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|alicea(?:mclellan)?)/i)
  const toHint = toMatch?.[1]?.trim() || 'aliceamclellan@rc.legal'
  return { toHint, topic: 'Land Registry status update for 6F Steamer Street' }
}

function parseOpportunityFeedQuery(input: string): { max: number } | null {
  const lower = normalizeInput(input)
  const asksOpportunities = containsAny(lower, [
    'opportunities',
    'find opportunities',
    'more business',
    'more properties',
    'property opportunities',
    'business opportunities',
    'what opportunities',
    'best opportunities',
    'deals i can do',
  ])
  if (!asksOpportunities) return null
  const maxMatch = lower.match(/\b(?:top|show|give)\s+(\d+)\b/)
  const max = maxMatch ? Math.min(Math.max(Number(maxMatch[1]), 3), 20) : 10
  return { max }
}

function parseTopEntityTimelineQuery(input: string): { agentType?: string; limit: number } | null {
  const lower = normalizeInput(input)
  const timelineSignal = lower.includes('timeline')
  const topEntitySignal =
    containsAny(lower, [
      'top entity',
      'top case',
      'top item',
      'show timeline for top',
      'timeline for top',
      'show top timeline',
    ]) || (lower.includes('show timeline') && containsAny(lower, ['entity', 'case']))

  if (!timelineSignal || !topEntitySignal) return null

  const limitMatch = lower.match(/(?:last|top|show)\s+(\d+)\s+(?:events|items|updates)/)
  const limit = limitMatch ? Math.min(Math.max(Number(limitMatch[1]), 3), 50) : 12

  const agentType = parseAgentTypeHint(lower)
  if (agentType) return { agentType, limit }
  if (lower.includes('email')) return { agentType: 'email', limit }
  return { limit }
}

function parseCentralTimelineQuery(input: string): { agentType?: string; limit: number } | null {
  const lower = normalizeInput(input)
  const timelineSignal = lower.includes('timeline')
  const centralSignal =
    containsAny(lower, [
      'central timeline',
      'global timeline',
      'full timeline',
      'master timeline',
      'all timeline',
      'everything timeline',
      'timeline from day 1',
      'from day 1',
      'day 1 to now',
      'all events timeline',
    ]) || (lower.includes('show timeline') && containsAny(lower, ['all', 'everything', 'global', 'central']))

  if (!timelineSignal || !centralSignal) return null
  if (containsAny(lower, ['top entity', 'top case', 'timeline for top'])) return null

  const limitMatch = lower.match(/(?:last|top|show)\s+(\d+)\s+(?:events|items|updates)/)
  const limit = limitMatch ? Math.min(Math.max(Number(limitMatch[1]), 10), 500) : 120
  const agentType = parseAgentTypeHint(lower)
  return agentType ? { agentType, limit } : { limit }
}

function parseThreadStatusQuery(input: string): { entityQuery: string; agentType?: string; limit: number } | null {
  const lower = normalizeInput(input)
  const trigger = containsAny(lower, [
    'where are we with',
    'status for',
    'status of',
    'thread for',
    'case for',
    'matter for',
    'progress for',
    'next action for',
    'next actions for',
    'what is next for',
    "what's next for",
    'state for',
  ])
  if (!trigger) return null

  const match = input.match(
    /(?:where are we with|status for|status of|thread for|case for|matter for|progress for|next actions? for|what(?:'s| is)? next for|state for)\s+(.+?)[?.!]*$/i
  )
  if (!match) return null

  const entityQuery = match[1].replace(/^the\s+/i, '').trim()
  if (entityQuery.length < 2) return null

  const limitMatch = lower.match(/(?:last|top|show)\s+(\d+)\s+(?:events|items|updates)/)
  const limit = limitMatch ? Math.min(Math.max(Number(limitMatch[1]), 3), 30) : 10
  const agentType = parseAgentTypeHint(lower)
  return agentType ? { entityQuery, agentType, limit } : { entityQuery, limit }
}

function parseFocusItemQuery(input: string): { entityQuery: string; agentType?: string } | null {
  const lower = normalizeInput(input)
  const focusIntent = containsAny(lower, ['focus on this', 'focus this', 'focus now', 'focus on'])
  if (!focusIntent) return null

  const agentType = parseAgentTypeHint(lower)
  if (containsAny(lower, ['6f steamer', 'steamer street', 'streamer street'])) {
    return { entityQuery: '6f steamer street', ...(agentType ? { agentType } : {}) }
  }

  const entityGuess = input
    .replace(/^.*focus on this[^a-z0-9]*/i, '')
    .replace(/^\d+\.\s*/, '')
    .trim()
  if (!entityGuess) return null
  return { entityQuery: entityGuess, ...(agentType ? { agentType } : {}) }
}

function parseWorkerSyncQuery(input: string): boolean {
  const lower = normalizeInput(input)
  return containsAny(lower, [
    'run worker sync now',
    'worker sync now',
    'run sync now',
    'sync worker now',
    'sync mailbox now',
    'run worker now',
    'run worker sync',
  ])
}

function normalizeSenderPattern(input: string) {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"']/g, '')
    .replace(/\((.*?)\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSenderCandidates(input: string): string[] {
  const lines = input.split(/\r?\n/).map((line) => line.trim())
  const bulletSenders = lines
    .map((line) => line.replace(/^[•\-*]\s*/, '').trim())
    .filter((line) => !!line && !line.startsWith('#'))
    .filter((line) => !/^(email addresses|senders detected|here are all senders|toolstation clean list)/i.test(line))
    .filter((line) => !/^senders detected:?$/i.test(line))
    .filter((line) => lines.some((src) => src.startsWith('•') || src.startsWith('-') || src.startsWith('*')))

  const emails = Array.from(
    input.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
    (match) => match[0]
  )

  return uniqueStrings([...bulletSenders, ...emails])
}

function parseImportantSendersCommand(input: string): { senderPatterns: string[] } | null {
  const lower = normalizeInput(input)
  const hasIntent = containsAny(lower, [
    'important',
    'importons',
    'save as important',
    'remember all',
    'must know all',
    'senders detected',
    'email addresses / senders found',
    'all related emails',
  ])
  if (!hasIntent) return null

  const rawSenders = extractSenderCandidates(input)
  if (rawSenders.length < 2) return null

  const senderPatterns = uniqueStrings(rawSenders.map(normalizeSenderPattern)).filter((value) => value.length > 1)
  if (senderPatterns.length === 0) return null

  return { senderPatterns: senderPatterns.slice(0, 120) }
}

type IntentDomain = 'general' | 'legal' | 'financial' | 'supplier' | 'email' | 'research'

function detectIntentDomain(input: string): IntentDomain {
  const lower = normalizeInput(input)
  if (containsAny(lower, ['solicitor', 'solicister', 'legal', 'law', 'contract', 'compliance'])) return 'legal'
  if (containsAny(lower, ['accountant', 'accounting', 'finance', 'financial', 'tax', 'vat', 'invoice'])) return 'financial'
  if (containsAny(lower, ['supplier', 'suppliers', 'vendor', 'procurement', 'delivery', 'purchase'])) return 'supplier'
  if (containsAny(lower, ['email', 'emails', 'mail', 'inbox', 'outlook', 'gmail'])) return 'email'
  if (containsAny(lower, ['research', 'investigate', 'findings', 'analysis'])) return 'research'
  return 'general'
}

type MasterProfileState = {
  aliases: string[]
  businesses: string[]
  activeBusinesses: string[]
  addresses: string[]
  propertyAssets: string[]
  coreSuppliers: string[]
  bankRelationships: string[]
  personalAccounts: string[]
  businessAccounts: string[]
  leaseBusiness: string[]
  leaseResidential: string[]
  refundCases: string[]
  insurancePolicies: string[]
  telecomContracts: string[]
  focusAreas: string[]
  importantSenders: string[]
  notes: string[]
  updatedAt?: string
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values.map((v) => v.trim()).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function parseMasterProfileUpdate(input: string): Partial<MasterProfileState> | null {
  const lower = normalizeInput(input)
  const profileTopicSignals = containsAny(lower, [
    'bank',
    'banks',
    'lease',
    'property',
    'supplier',
    'account',
    'accounts',
    'refund',
    'refung',
    'insurance',
    'mobile',
    'landline',
    'contract',
    'telecom',
    'business',
    'accounting',
  ])
  const explicitProfileIntent = containsAny(lower, [
    'i have',
    'i want it to help me with all',
    'help me with all',
    'everything anything',
    'my business',
    'i have changed names',
    'remember all',
    'keep remember',
    'keep this info',
    'save profile',
    'store profile',
    'kandasamy',
    'silva retail ltd',
    'newton newsagent',
    'personal accounts',
    'business accounts',
    'lease apartmeant',
    'lease apartment',
    'car insurance',
    'landline',
    'mobilephone',
    'mobile phone',
  ])

  const looksLikeSearchQuery =
    containsAny(lower, [
      'search',
      'find',
      'show',
      'check',
      'analyze',
      'analyse',
      'summarize',
      'communications from',
      'emails from',
      'messages from',
      'regarding',
      'about',
      'updates from',
    ]) &&
    containsAny(lower, ['email', 'emails', 'inbox', 'mailbox', 'communications', 'messages'])

  if (!explicitProfileIntent) return null
  if (lower.includes('i have') && !profileTopicSignals && !containsAny(lower, ['remember', 'save profile', 'store profile'])) {
    return null
  }
  if (looksLikeSearchQuery && !containsAny(lower, ['remember', 'keep remember', 'save profile', 'store profile'])) {
    return null
  }

  const aliases = [
    lower.includes('silva kandasamy') ? 'Silva Kandasamy' : '',
    lower.includes('shiva kandasamy') ? 'Shiva Kandasamy' : '',
    lower.includes('siyanthank kandasamy') ? 'Siyanthank Kandasamy' : '',
  ].filter(Boolean)

  const businesses = [
    lower.includes('yourshop1 ltd') ? 'YourShop1 Ltd (closed)' : '',
    lower.includes('newton store ltd') ? 'Newton Store Ltd (closed)' : '',
    lower.includes('silva retail ltd') ? 'Silva Retail Ltd (active)' : '',
    lower.includes('newton newsagent') ? 'Newton Newsagent (trading name, active)' : '',
  ].filter(Boolean)

  const addresses = [
    lower.includes('3 langdale place') ? '3 Langdale Place, Lancaster, LA1 3NS' : '',
    lower.includes('6f steamer') ? '6F Steamer Street, Barrow-in-Furness, LA14 5SG' : '',
  ].filter(Boolean)

  const propertyAssets = [
    lower.includes('05 sep 2024') || lower.includes('5 sep 2024')
      ? 'Flat purchased 05 Sep 2024: 6F Steamer Street, Barrow-in-Furness, LA14 5SG'
      : '',
  ].filter(Boolean)

  const coreSuppliers = [
    lower.includes('booker.co.uk') ? 'booker.co.uk' : '',
    lower.includes('parfetts') ? 'parfetts.co.uk' : '',
    lower.includes('bestways.co.uk') || lower.includes('batleys') ? 'bestways.co.uk (Batleys)' : '',
    lower.includes('handcocks.co.uk') ? 'handcocks.co.uk' : '',
    lower.includes('damecha.co.uk') ? 'damecha.co.uk' : '',
    lower.includes('khanjra.co.uk') ? 'khanjra.co.uk' : '',
  ].filter(Boolean)

  const bankRelationships = [
    containsAny(lower, ['bank', 'banks', 'banking']) ? 'Multiple banking relationships' : '',
    containsAny(lower, ['personal account', 'personal accounts']) ? 'Personal bank accounts' : '',
    containsAny(lower, ['business account', 'business accounts']) ? 'Business bank accounts' : '',
  ].filter(Boolean)

  const personalAccounts = [
    containsAny(lower, ['personal account', 'personal accounts']) ? 'Personal accounts (tracked)' : '',
  ].filter(Boolean)

  const businessAccounts = [
    containsAny(lower, ['business account', 'business accounts']) ? 'Business accounts (tracked)' : '',
  ].filter(Boolean)

  const leaseBusiness = [
    containsAny(lower, ['lease business', 'business lease', 'shop lease']) ? 'Business lease obligations (tracked)' : '',
  ].filter(Boolean)

  const leaseResidential = [
    containsAny(lower, ['lease apartment', 'lease apartmeant', 'apartment lease', 'flat lease']) ? 'Residential/apartment lease obligations (tracked)' : '',
  ].filter(Boolean)

  const refundCases = [
    containsAny(lower, ['refund', 'refung', 'bpaution.co.uk', 'bpaution']) ? 'Refund case: bpaution.co.uk' : '',
  ].filter(Boolean)

  const insurancePolicies = [
    containsAny(lower, ['car insurance', 'insurance']) ? 'Car insurance policies (tracked)' : '',
  ].filter(Boolean)

  const telecomContracts = [
    containsAny(lower, ['mobilephone', 'mobile phone', 'landline', 'landlines', 'contract', 'contracts'])
      ? 'Telecom contracts: mobile + landline'
      : '',
  ].filter(Boolean)

  const focusAreas = [
    lower.includes('solicister') || lower.includes('solicitor') ? 'Solicitors and legal matters' : '',
    lower.includes('accountant') || lower.includes('accounting') ? 'Accountants and tax/finance' : '',
    lower.includes('supplier') ? 'Suppliers and wholesale operations' : '',
    lower.includes('banks') ? 'Banking and lending' : '',
    lower.includes('properties') || lower.includes('property') ? 'Properties and conveyancing' : '',
    containsAny(lower, ['refund', 'refung']) ? 'Refund and dispute recovery' : '',
    containsAny(lower, ['insurance', 'car insurance']) ? 'Insurance management' : '',
    containsAny(lower, ['mobilephone', 'mobile phone', 'landline', 'landlines', 'contract', 'contracts'])
      ? 'Telecom and contract management'
      : '',
    lower.includes('shop bussiness') || lower.includes('shop business') || lower.includes('newton newsagent')
      ? 'Shop business operations'
      : '',
  ].filter(Boolean)

  const notes = [
    lower.includes('safe secures') || lower.includes('safe secure') ? 'User requested secure handling and persistent memory.' : '',
  ].filter(Boolean)

  return {
    aliases,
    businesses,
    activeBusinesses: businesses.filter((b) => b.toLowerCase().includes('(active)')),
    addresses,
    propertyAssets,
    coreSuppliers,
    bankRelationships,
    personalAccounts,
    businessAccounts,
    leaseBusiness,
    leaseResidential,
    refundCases,
    insurancePolicies,
    telecomContracts,
    focusAreas,
    importantSenders: [],
    notes,
  }
}

async function upsertMasterProfileMemory(patch: Partial<MasterProfileState>) {
  const entity = await db.agentEntity.upsert({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: 'silva-master-profile',
      },
    },
    update: {
      title: 'Research - Silva Master Profile',
      status: 'open',
      lastUpdateAt: new Date(),
    },
    create: {
      agentType: 'research',
      entityKey: 'silva-master-profile',
      title: 'Research - Silva Master Profile',
      status: 'open',
      lastUpdateAt: new Date(),
    },
  })

  const existing = await db.agentEntityState.findUnique({ where: { agentEntityId: entity.id } })
  const current = existing?.stateJson ? (JSON.parse(existing.stateJson) as MasterProfileState) : ({
    aliases: [],
    businesses: [],
    activeBusinesses: [],
    addresses: [],
    propertyAssets: [],
    coreSuppliers: [],
    bankRelationships: [],
    personalAccounts: [],
    businessAccounts: [],
    leaseBusiness: [],
    leaseResidential: [],
    refundCases: [],
    insurancePolicies: [],
    telecomContracts: [],
    focusAreas: [],
    importantSenders: [],
    notes: [],
  } satisfies MasterProfileState)

  const merged: MasterProfileState = {
    aliases: uniqueStrings([...(current.aliases || []), ...((patch.aliases as string[]) || [])]),
    businesses: uniqueStrings([...(current.businesses || []), ...((patch.businesses as string[]) || [])]),
    activeBusinesses: uniqueStrings([...(current.activeBusinesses || []), ...((patch.activeBusinesses as string[]) || [])]),
    addresses: uniqueStrings([...(current.addresses || []), ...((patch.addresses as string[]) || [])]),
    propertyAssets: uniqueStrings([...(current.propertyAssets || []), ...((patch.propertyAssets as string[]) || [])]),
    coreSuppliers: uniqueStrings([...(current.coreSuppliers || []), ...((patch.coreSuppliers as string[]) || [])]),
    bankRelationships: uniqueStrings([...(current.bankRelationships || []), ...((patch.bankRelationships as string[]) || [])]),
    personalAccounts: uniqueStrings([...(current.personalAccounts || []), ...((patch.personalAccounts as string[]) || [])]),
    businessAccounts: uniqueStrings([...(current.businessAccounts || []), ...((patch.businessAccounts as string[]) || [])]),
    leaseBusiness: uniqueStrings([...(current.leaseBusiness || []), ...((patch.leaseBusiness as string[]) || [])]),
    leaseResidential: uniqueStrings([...(current.leaseResidential || []), ...((patch.leaseResidential as string[]) || [])]),
    refundCases: uniqueStrings([...(current.refundCases || []), ...((patch.refundCases as string[]) || [])]),
    insurancePolicies: uniqueStrings([...(current.insurancePolicies || []), ...((patch.insurancePolicies as string[]) || [])]),
    telecomContracts: uniqueStrings([...(current.telecomContracts || []), ...((patch.telecomContracts as string[]) || [])]),
    focusAreas: uniqueStrings([...(current.focusAreas || []), ...((patch.focusAreas as string[]) || [])]),
    importantSenders: uniqueStrings([...(current.importantSenders || []), ...((patch.importantSenders as string[]) || [])]),
    notes: uniqueStrings([...(current.notes || []), ...((patch.notes as string[]) || [])]),
    updatedAt: new Date().toISOString(),
  }

  await db.agentEntityState.upsert({
    where: { agentEntityId: entity.id },
    update: { stateJson: JSON.stringify(merged), updatedAt: new Date() },
    create: { agentEntityId: entity.id, stateJson: JSON.stringify(merged) },
  })

  return merged
}

async function getMasterProfileMemory(): Promise<MasterProfileState | null> {
  const entity = await db.agentEntity.findUnique({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: 'silva-master-profile',
      },
    },
    select: { id: true },
  })
  if (!entity) return null
  const state = await db.agentEntityState.findUnique({
    where: { agentEntityId: entity.id },
    select: { stateJson: true },
  })
  if (!state?.stateJson) return null
  try {
    return JSON.parse(state.stateJson) as MasterProfileState
  } catch {
    return null
  }
}

async function upsertMailboxAuditMemory(snapshot: {
  sinceDate: string
  scanned: number
  providerSplit: { outlook: number; gmail: number }
  flagged: number
  important: number
  unread: number
  categoryCounts: Record<string, number>
  topJunkSenders: string[]
  topImportantSenders: string[]
  senderRules?: {
    total: number
    importantRules: number
    junkRules: number
    importantMatches: number
    junkMatches: number
  }
}) {
  const entity = await db.agentEntity.upsert({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: 'mailbox-master-audit',
      },
    },
    update: {
      title: 'Research - Mailbox Master Audit',
      status: 'open',
      lastUpdateAt: new Date(),
    },
    create: {
      agentType: 'research',
      entityKey: 'mailbox-master-audit',
      title: 'Research - Mailbox Master Audit',
      status: 'open',
      lastUpdateAt: new Date(),
    },
  })

  const existing = await db.agentEntityState.findUnique({ where: { agentEntityId: entity.id } })
  const current = existing?.stateJson
    ? (JSON.parse(existing.stateJson) as { history?: Array<Record<string, unknown>> })
    : { history: [] as Array<Record<string, unknown>> }

  const history = Array.isArray(current.history) ? current.history : []
  history.push({
    ...snapshot,
    createdAt: new Date().toISOString(),
  })
  const trimmedHistory = history.slice(-30)

  await db.agentEntityState.upsert({
    where: { agentEntityId: entity.id },
    update: {
      stateJson: JSON.stringify({
        latest: snapshot,
        history: trimmedHistory,
        updatedAt: new Date().toISOString(),
      }),
      updatedAt: new Date(),
    },
    create: {
      agentEntityId: entity.id,
      stateJson: JSON.stringify({
        latest: snapshot,
        history: trimmedHistory,
        updatedAt: new Date().toISOString(),
      }),
    },
  })
}

async function getLatestMailboxAuditMemory(): Promise<{
  latest?: {
    sinceDate: string
    scanned: number
    providerSplit: { outlook: number; gmail: number }
    flagged: number
    important: number
    unread: number
    categoryCounts: Record<string, number>
    topJunkSenders: string[]
    topImportantSenders: string[]
    senderRules?: {
      total: number
      importantRules: number
      junkRules: number
      importantMatches: number
      junkMatches: number
    }
    createdAt?: string
  }
  updatedAt?: string
} | null> {
  const entity = await db.agentEntity.findUnique({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: 'mailbox-master-audit',
      },
    },
    select: { id: true },
  })
  if (!entity) return null
  const state = await db.agentEntityState.findUnique({
    where: { agentEntityId: entity.id },
    select: { stateJson: true },
  })
  if (!state?.stateJson) return null
  try {
    return JSON.parse(state.stateJson) as {
      latest?: {
        sinceDate: string
        scanned: number
        providerSplit: { outlook: number; gmail: number }
        flagged: number
        important: number
        unread: number
        categoryCounts: Record<string, number>
        topJunkSenders: string[]
        topImportantSenders: string[]
        senderRules?: {
          total: number
          importantRules: number
          junkRules: number
          importantMatches: number
          junkMatches: number
        }
        createdAt?: string
      }
      updatedAt?: string
    }
  } catch {
    return null
  }
}

async function getConnectedMailboxProviderCounts() {
  const accounts = await db.emailAccount.findMany({
    where: {
      status: 'connected',
      provider: { in: ['outlook', 'gmail'] },
    },
    select: { provider: true },
  })

  const outlook = accounts.filter((a) => a.provider === 'outlook').length
  const gmail = accounts.filter((a) => a.provider === 'gmail').length
  return {
    outlook,
    gmail,
    total: outlook + gmail,
  }
}

type MailboxReadiness = {
  connectedCount: { outlook: number; gmail: number; total: number }
  reachable: { outlook: boolean; gmail: boolean; total: number }
  probes: {
    outlook: { connected: boolean; canRead: boolean; sampleCount: number; error?: string }
    gmail: { connected: boolean; canRead: boolean; sampleCount: number; error?: string }
  }
}

function toSingleLineError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error')
  return raw.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function mailboxReadinessDiagnostics(readiness: MailboxReadiness) {
  const issues: string[] = []
  if (readiness.probes.outlook.connected && !readiness.probes.outlook.canRead) {
    issues.push(`Outlook read failed: ${readiness.probes.outlook.error || 'unknown error'}`)
  }
  if (readiness.probes.gmail.connected && !readiness.probes.gmail.canRead) {
    issues.push(`Gmail read failed: ${readiness.probes.gmail.error || 'unknown error'}`)
  }
  return issues.join(' | ')
}

async function getMailboxReadiness(): Promise<MailboxReadiness> {
  const connectedCount = await getConnectedMailboxProviderCounts()
  const [outlookProbe, gmailProbe] = await Promise.all([
    (async () => {
      if (connectedCount.outlook === 0) {
        return { connected: false, canRead: false, sampleCount: 0 }
      }
      try {
        const rows = await getRecentMessages(1)
        return { connected: true, canRead: true, sampleCount: rows.length }
      } catch (error) {
        return {
          connected: true,
          canRead: false,
          sampleCount: 0,
          error: toSingleLineError(error),
        }
      }
    })(),
    (async () => {
      if (connectedCount.gmail === 0) {
        return { connected: false, canRead: false, sampleCount: 0 }
      }
      try {
        const rows = await getRecentGmailMessages(1)
        return { connected: true, canRead: true, sampleCount: rows.length }
      } catch (error) {
        return {
          connected: true,
          canRead: false,
          sampleCount: 0,
          error: toSingleLineError(error),
        }
      }
    })(),
  ])

  const outlookReachable = outlookProbe.connected && outlookProbe.canRead
  const gmailReachable = gmailProbe.connected && gmailProbe.canRead

  return {
    connectedCount,
    reachable: {
      outlook: outlookReachable,
      gmail: gmailReachable,
      total: Number(outlookReachable) + Number(gmailReachable),
    },
    probes: {
      outlook: outlookProbe,
      gmail: gmailProbe,
    },
  }
}

function parseComprehensiveMailboxAuditQuery(input: string): {
  sinceDate: string
  displayTop: number
  maxFetchPerProvider: number
  exhaustive: boolean
} | null {
  const lower = normalizeInput(input)
  const asksDeepAudit =
    (containsAny(lower, ['analyze', 'analyse', 'analysis', 'review']) &&
      containsAny(lower, ['all emails', 'all mail', 'everything', 'connected'])) ||
    containsAny(lower, [
      'analyse all everything',
      'analyze all everything',
      'analyse all emails',
      'analyze all emails',
      'analyse all emailes',
      'analyze all emailes',
      'analyse all email',
      'analyze all email',
      'gather all info',
      'remember all',
      'all everything',
      'all importance',
      'all importeons',
      'all the way 2024',
      'all the way from 2024',
      'from 2024 onward',
    ])
  const asksDeepSearch = containsAny(lower, [
    'search all email',
    'search all emails',
    'search all emailes',
    'scan all email',
    'scan all emails',
    'check all email',
    'check all emails',
    'all mailbox',
    'all inbox',
  ])

  if (!asksDeepAudit && !asksDeepSearch) return null

  const yearMatch = lower.match(/\b(20\d{2})\b/)
  const year = yearMatch ? Number(yearMatch[1]) : 2024
  const safeYear = Number.isFinite(year) ? Math.min(Math.max(year, 2018), new Date().getUTCFullYear()) : 2024
  const displayTopMatch = lower.match(/\b(?:show|top|last)\s+(\d+)\b/)
  const displayTop = displayTopMatch ? Math.min(Math.max(Number(displayTopMatch[1]), 10), 200) : 120
  const fetchMatch = lower.match(/\b(?:scan|fetch|read)\s+(\d+)\b/)
  const envCap = Math.max(Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 1000)
  const maxFetchPerProvider = fetchMatch
    ? Math.min(Math.max(Number(fetchMatch[1]), 500), envCap)
    : envCap

  return {
    sinceDate: `${safeYear}-01-01T00:00:00.000Z`,
    displayTop,
    maxFetchPerProvider,
    exhaustive: true,
  }
}

function classifyOperationalCategory(message: InboxSnapshotMessage) {
  const text = `${message.subject || ''} ${message.bodyPreview || ''} ${message.fromName || ''} ${message.fromAddress || ''}`.toLowerCase()
  const supplierDomains = ['booker', 'parfetts', 'bestway', 'batleys', 'handcocks', 'damecha', 'khanjra']
  if (containsAny(text, ['solicitor', 'conveyancing', 'land registry', 'title', 'deed', 'leasehold', 'steamer street'])) return 'solicitor'
  if (containsAny(text, ['hmrc', 'tax', 'vat', 'payroll', 'invoice', 'accountant', 'accounts'])) return 'accountant'
  if (containsAny(text, ['supplier', 'order', 'delivery', 'stock', ...supplierDomains])) return 'supplier'
  if (containsAny(text, ['bank', 'mortgage', 'loan', 'statement', 'capitalise'])) return 'banking'
  if (containsAny(text, ['property', 'rent', 'council tax', 'bin collection', 'utility', 'electricity', 'gas', 'broadband', 'mobile', 'insurance'])) return 'property-ops'
  if (containsAny(text, ['newsletter', 'promotion', 'promo', 'discount', 'offer', 'digest', 'unsubscribe', 'tip.ai', 'token dispatch'])) return 'junk-likely'
  return 'general'
}

function isUrgentOrImportant(input: string) {
  const lower = normalizeInput(input)
  return containsAny(lower, [
    'urgent',
    'important',
    'importent',
    'importens',
    'critical',
    'high priority',
    'priority',
    'asap',
    'emergency',
  ])
}

function getEmergencyCloudProvider(preferred: ChatProvider): ChatProvider | null {
  const order: ChatProvider[] = [
    preferred,
    'openai',
    'gemini',
    'deepseek',
    'mistral',
    'qwen',
    'grok',
    'glm',
    'openrouter',
    'minimax',
    'huggingface',
  ]
  for (const provider of order) {
    if (provider === 'ollama') continue
    if (providerReady(provider)) return provider
  }
  return null
}

type InboxSnapshotMessage = {
  id: string
  provider: 'outlook' | 'gmail'
  subject: string
  receivedDateTime: string
  bodyPreview?: string
  fromName?: string
  fromAddress?: string
}

function parseStateObject(value?: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function getStateNextActions(state: Record<string, unknown>, max = 3): string[] {
  const snake = state.next_actions
  if (Array.isArray(snake)) {
    return snake.map((item) => String(item)).filter(Boolean).slice(0, max)
  }
  const camel = state.nextActions
  if (Array.isArray(camel)) {
    return camel.map((item) => String(item)).filter(Boolean).slice(0, max)
  }
  return []
}

function getStateStatus(state: Record<string, unknown>, fallback: string): string {
  const status = state.status
  if (typeof status === 'string' && status.trim()) return status.trim()
  return fallback
}

function getStateWaitingOn(state: Record<string, unknown>): string {
  const snake = state.waiting_on
  if (typeof snake === 'string' && snake.trim()) return snake.trim()
  const camel = state.waitingOn
  if (typeof camel === 'string' && camel.trim()) return camel.trim()
  return 'none'
}

function getStateLastEmailDate(state: Record<string, unknown>): string | null {
  const snake = state.last_email_date
  if (typeof snake === 'string' && snake.trim()) return snake
  const camel = state.lastEmailDate
  if (typeof camel === 'string' && camel.trim()) return camel
  return null
}

function isStrictSolicitorEntity(entity: {
  agentType: string
  entityKey: string
  state?: { stateJson?: string | null } | null
}): boolean {
  if (entity.agentType !== 'solicitor') return false
  const key = normalizeInput(entity.entityKey || '')
  const keyLooksLegal = containsAny(key, [
    'land registry',
    'title',
    'deed',
    'conveyancing',
    'solicitor',
    'lease',
    'leasehold',
    'freehold',
    'tenant',
    'landlord',
    'claim',
    'refund',
    'bpaution',
    'steamer street',
    'barrow-in-furness',
  ])

  const keyLooksListingNoise =
    /\b\d+\s*pw\b/i.test(entity.entityKey || '') ||
    containsAny(key, ['willow lane', 'grove street', 'damside street', 'chapel lane', 'nelson street', 'bowerham road'])

  const state = parseStateObject(entity.state?.stateJson)
  const facts = (state.facts || {}) as Record<string, unknown>
  const latestFrom = String(facts.latestFrom || '').toLowerCase()
  const senderLooksLegal = containsAny(latestFrom, ['@rc.legal', 'solicitor', 'conveyancing', 'legal'])
  const senderLooksListing = containsAny(latestFrom, ['rentaroof', 'rightmove', 'zoopla'])

  if (senderLooksLegal) return true
  if (keyLooksListingNoise || senderLooksListing) return false
  return keyLooksLegal
}

function normalizeEntitySearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findBestEntityMatch<T extends { entityKey: string; title: string; lastUpdateAt: Date }>(
  rows: T[],
  query: string
): T | null {
  const target = normalizeEntitySearchText(query)
  if (!target) return null
  const tokens = target.split(' ').filter((token) => token.length > 1)
  let best: { score: number; row: T } | null = null

  for (const row of rows) {
    const haystack = normalizeEntitySearchText(`${row.entityKey} ${row.title}`)
    if (!haystack) continue

    let score = 0
    if (haystack === target) score = Math.max(score, 120)
    if (haystack.includes(target)) score = Math.max(score, 90)
    if (target.includes(haystack) && haystack.length >= 4) score = Math.max(score, 70)
    for (const token of tokens) {
      if (haystack.includes(token)) score += 8
    }
    if (tokens.length === 1 && haystack.startsWith(tokens[0])) score += 10
    if (score <= 0) continue

    const ageHours = Math.max(0, (Date.now() - row.lastUpdateAt.getTime()) / 3_600_000)
    const recencyBoost = Math.max(0, 6 - Math.floor(ageHours / 24))
    score += recencyBoost

    if (!best || score > best.score || (score === best.score && row.lastUpdateAt > best.row.lastUpdateAt)) {
      best = { score, row }
    }
  }

  if (!best || best.score < 10) return null
  return best.row
}

const DOSSIER_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'about',
  'regarding',
  'issue',
  'status',
  'update',
  'property',
  'case',
  'matter',
  'email',
  'emails',
  'message',
  'messages',
  'all',
  'latest',
  'new',
  'of',
  'to',
  'in',
  'on',
  'a',
  'an',
])

type DossierMailboxMessage = {
  subject?: string
  bodyPreview?: string
  fromName?: string
  fromAddress?: string
}

function normalizeDossierText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDossierKeywords(topic: string): string[] {
  return uniqueStrings(
    normalizeDossierText(topic)
      .split(' ')
      .map((part) => part.trim())
      .filter((part) => part.length > 2 && !DOSSIER_STOPWORDS.has(part))
  )
}

function scoreTopicAgainstMessage(topic: string, message: DossierMailboxMessage): number {
  const topicText = normalizeDossierText(topic)
  const keywords = extractDossierKeywords(topic)
  const haystack = normalizeDossierText(
    `${message.subject || ''} ${message.bodyPreview || ''} ${message.fromName || ''} ${message.fromAddress || ''}`
  )
  if (!haystack) return 0

  let score = 0
  if (topicText && haystack.includes(topicText)) score += 4
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) score += 1
  }
  return score
}

function inferCaseStatus(messages: DossierMailboxMessage[]): 'action-required' | 'waiting' | 'in-progress' | 'resolved' | 'open' {
  if (messages.length === 0) return 'open'
  const latest = messages[0]
  const latestText = normalizeDossierText(`${latest.subject || ''} ${latest.bodyPreview || ''}`)
  const denialSignals = [
    'no refund is due',
    'refund not due',
    'never completed',
    'claim denied',
    'denied',
    'declined',
    'rejected',
    'refused',
    'formal letter of claim',
    'compensation claim',
    'legal action',
    'without prejudice',
  ]
  if (
    containsAny(latestText, [
      'undeliverable',
      'failed to deliver',
      'delivery has failed',
      'domain does not exist',
      'non existent',
      'mailbox unavailable',
      'rejected',
      'bounce',
    ])
  ) {
    return 'action-required'
  }
  if (containsAny(latestText, denialSignals)) return 'action-required'
  if (
    containsAny(latestText, ['resolved', 'closed', 'registered', 'done']) ||
    (latestText.includes('completed') && !containsAny(latestText, ['never completed', 'not completed', 'not yet completed']))
  ) {
    return 'resolved'
  }
  if (containsAny(latestText, ['awaiting', 'waiting', 'requisition', 'pending', 'chasing', 'landlord'])) return 'waiting'
  if (containsAny(latestText, ['expedite', 'expedited', 'in process', 'processing', 'submitted'])) return 'in-progress'
  return 'open'
}

function statusLabel(status: ReturnType<typeof inferCaseStatus>): string {
  switch (status) {
    case 'action-required':
      return 'Action required'
    case 'waiting':
      return 'Waiting on third party'
    case 'in-progress':
      return 'In progress'
    case 'resolved':
      return 'Resolved'
    case 'open':
    default:
      return 'Open'
  }
}

function recommendationForStatus(status: ReturnType<typeof inferCaseStatus>, issue: string): string {
  switch (status) {
    case 'action-required':
      return `For ${issue}: use an alternative contact route (phone/web/formal letter) and resend with proof of delivery.`
    case 'waiting':
      return `For ${issue}: chase the blocking party and request a dated completion confirmation.`
    case 'in-progress':
      return `For ${issue}: request an ETA and the next milestone date in writing.`
    case 'resolved':
      return `For ${issue}: archive supporting emails and keep proof in the case timeline.`
    case 'open':
    default:
      return `For ${issue}: request a concrete progress update and next action owner.`
  }
}

function extractPhoneCandidate(text: string): string | null {
  const match = text.match(/(?:\+44\s?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}|0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/)
  return match?.[0]?.replace(/\s+/g, ' ').trim() || null
}

async function runTaskEngine(message: string): Promise<{
  handled: boolean
  response?: string
  steps?: string[]
  followUps?: string[]
  agents?: { type: string; name: string; contribution: string }[]
  error?: string
}> {
  const lower = normalizeInput(message)
  if (parseReadCoverageQuery(message)) {
    const steps = [
      'Router: classified as read/coverage confirmation request',
      'Research Agent: loading latest mailbox audit memory',
      'Email Agent: checking current mailbox readiness',
    ]
    try {
      const [audit, readiness] = await Promise.all([getLatestMailboxAuditMemory(), getMailboxReadiness()])
      const latest = audit?.latest
      if (!latest) {
        return {
          handled: true,
          response: [
            'Not yet fully confirmed.',
            'I do not have a saved comprehensive audit snapshot in memory yet.',
            'Run: Analyze all connected Gmail and Outlook emails from 2024 onward.',
          ].join('\n'),
          steps,
          followUps: [
            'Analyze all connected Gmail and Outlook emails from 2024 onward',
            'Run worker sync now',
            'Show latest inbox updates',
          ],
          agents: [
            { type: 'research', name: 'Research Agent', contribution: 'I checked audit memory and found no saved full-audit snapshot yet.' },
          ],
        }
      }

      const providerTotal = (latest.providerSplit?.outlook || 0) + (latest.providerSplit?.gmail || 0)
      const coverage = `Scanned ${latest.scanned} emails from ${latest.sinceDate.slice(0, 10)} onward (Outlook ${latest.providerSplit?.outlook || 0}, Gmail ${latest.providerSplit?.gmail || 0}).`
      const understanding = 'I classify and summarize all scanned emails, but I do not claim perfect semantic understanding of every message body; I provide high-signal categorization plus follow-up actions.'
      const readinessLine =
        `Mailbox readiness now: Outlook ${readiness.reachable.outlook ? 'reachable' : 'not reachable'}, ` +
        `Gmail ${readiness.reachable.gmail ? 'reachable' : 'not reachable'}.`

      return {
        handled: true,
        response: [
          'Yes, I read the full audit scope that was scanned.',
          coverage,
          `Flagged/pinned: ${latest.flagged}. Important: ${latest.important}. Unread: ${latest.unread}.`,
          `Category totals: solicitor ${latest.categoryCounts?.solicitor || 0}, accountant ${latest.categoryCounts?.accountant || 0}, supplier ${latest.categoryCounts?.supplier || 0}, banking ${latest.categoryCounts?.banking || 0}, property ${latest.categoryCounts?.propertyOps || 0}.`,
          readinessLine,
          understanding,
          providerTotal === latest.scanned
            ? 'Coverage note: provider totals match scanned count.'
            : 'Coverage note: totals are audit-snapshot based; rerun audit if you need a fresh full-pass right now.',
        ].join('\n'),
        steps,
        followUps: [
          'Show solicitor-only high-priority updates',
          'Show Alicea + 6F Steamer Street timeline',
          'Run comprehensive audit again now',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I confirmed scan coverage and mailbox reachability using saved audit data.' },
          { type: 'research', name: 'Research Agent', contribution: 'I explained scan coverage versus understanding limits clearly.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to confirm audit coverage right now.',
        steps,
        error: error instanceof Error ? error.message : 'Coverage confirmation failed',
      }
    }
  }

  if (parseCasualGreetingQuery(message)) {
    return {
      handled: true,
      response: 'Hello Silva. I am online and ready. Ask me for updates, watch tasks, or draft emails.',
      steps: [
        'Router: classified as casual greeting',
      ],
      followUps: [
        'What is new today',
        'Show updates from Alicea',
        'Draft land registry chase email',
      ],
      agents: [
        { type: 'research', name: 'Research Agent', contribution: 'I recognized this as a greeting and kept the response concise.' },
      ],
    }
  }

  const draftLandRegistry = parseDraftLandRegistryEmailQuery(message)
  if (draftLandRegistry) {
    const steps = [
      'Router: classified as draft solicitor email request',
      'Legal Agent: preparing concise Land Registry chase draft',
      'Email Agent: returning send-ready message',
    ]
    const to = draftLandRegistry.toHint.toLowerCase().includes('@')
      ? draftLandRegistry.toHint
      : 'aliceamclellan@rc.legal'
    const draft = [
      `To: ${to}`,
      'Subject: Request for latest Land Registry update - 6F Steamer Street',
      '',
      'Hi Alicea,',
      '',
      'I hope you are well.',
      '',
      'Please can you share the latest status on the Land Registry application for 6F Steamer Street, Barrow-in-Furness.',
      'If possible, please confirm:',
      '1) current application status,',
      '2) any outstanding actions/documents needed from me,',
      '3) expected timeline for next update/completion.',
      '',
      'Thank you.',
      '',
      'Kind regards,',
      'Silva Kandasamy',
    ].join('\n')

    return {
      handled: true,
      response: draft,
      steps,
      followUps: [
        'Send this email now',
        'Set automatic chase reminder every 7 days',
        'Show latest Alicea timeline for 6F Steamer Street',
      ],
      agents: [
        { type: 'legal', name: 'Legal Agent', contribution: 'I drafted a focused Land Registry chase email with key status questions.' },
        { type: 'email', name: 'Email Agent', contribution: 'I formatted it as a send-ready email.' },
      ],
    }
  }

  const beemaGreeting = parseBeemaGreetingQuery(message)
  if (beemaGreeting) {
    const steps = [
      'Router: classified as BEEMA greeting request',
      'LIAM: filtered high-signal updates and removed likely noise',
      'SWAY: built short prioritized pulse with next actions',
    ]
    try {
      await runAgentAutomationCycle()
    } catch {
      // Keep response resilient even if worker refresh fails.
    }

    try {
      const pulse = await buildSwayPulse(beemaGreeting.top)
      const [legalOpen, legalWaiting, legalBlocked, financialOpen, financialWaiting, financialBlocked, supplierOpen, supplierWaiting, supplierBlocked] =
        await Promise.all([
          db.agentEntity.count({ where: { agentType: 'solicitor', status: 'open' } }),
          db.agentEntity.count({ where: { agentType: 'solicitor', status: 'waiting' } }),
          db.agentEntity.count({ where: { agentType: 'solicitor', status: 'blocked' } }),
          db.agentEntity.count({ where: { agentType: 'accountant', status: 'open' } }),
          db.agentEntity.count({ where: { agentType: 'accountant', status: 'waiting' } }),
          db.agentEntity.count({ where: { agentType: 'accountant', status: 'blocked' } }),
          db.agentEntity.count({ where: { agentType: 'supplier', status: 'open' } }),
          db.agentEntity.count({ where: { agentType: 'supplier', status: 'waiting' } }),
          db.agentEntity.count({ where: { agentType: 'supplier', status: 'blocked' } }),
        ])

      const healthLine =
        `Health: Solicitor O/W/B ${legalOpen}/${legalWaiting}/${legalBlocked} | ` +
        `Accountant O/W/B ${financialOpen}/${financialWaiting}/${financialBlocked} | ` +
        `Supplier O/W/B ${supplierOpen}/${supplierWaiting}/${supplierBlocked}`

      const rows = pulse.items.map((item, idx) => {
        const when = item.sourceDate
          ? new Date(item.sourceDate).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          : '-'
        return `${idx + 1}. [${item.priority.toUpperCase()}] ${item.area}: ${item.title}. Next: ${item.nextAction}. Date: ${when}.`
      })

      return {
        handled: true,
        response: [
          'Hello Silva.',
          '',
          healthLine,
          '',
          pulse.headline,
          '',
          ...(rows.length > 0 ? rows : ['1. [LOW] ops: No urgent changes detected. Next: Continue normal monitoring. Date: -.']),
        ].join('\n'),
        steps,
        followUps: [
          'Show solicitor/accountant/supplier status',
          'Show only high-priority legal/financial items',
          'Send urgent alerts to WhatsApp now',
        ],
        agents: [
          { type: 'email', name: 'LIAM Worker', contribution: 'I filtered low-signal email noise and kept only high-signal updates.' },
          { type: 'research', name: 'SWAY Planner', contribution: 'I prioritized the important updates and generated immediate next actions.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'I could not build your BEEMA pulse right now.',
        steps,
        error: error instanceof Error ? error.message : 'BEEMA greeting flow failed',
      }
    }
  }

  const opportunityQuery = parseOpportunityFeedQuery(message)
  if (opportunityQuery) {
    const steps = [
      'Router: classified as opportunity finder request',
      'Core Brain: scanning high-signal opportunity candidates',
      'Business Agent: ranking investigate/keep/switch/negotiate recommendations',
    ]
    try {
      const feed = await buildOpportunityFeed(opportunityQuery.max)
      const rows = feed.items.map((item, idx) => {
        const when = item.sourceDate
          ? new Date(item.sourceDate).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          : '-'
        return `| ${idx + 1} | ${item.priority.toUpperCase()} | ${item.category} | ${item.title} | ${item.recommendation.toUpperCase()} | ${item.nextAction} | ${when} |`
      })
      return {
        handled: true,
        response: [
          'Top opportunities and recommendations from your latest signals.',
          '',
          '| # | Priority | Category | Opportunity | Recommendation | Next Action | Date |',
          '|---|---|---|---|---|---|---|',
          ...(rows.length > 0 ? rows : ['| 1 | LOW | general | No strong opportunities detected right now | KEEP | Continue monitoring inbox and market signals | - |']),
        ].join('\n'),
        steps,
        followUps: [
          'Show property-only opportunities',
          'Show funding opportunities only',
          'Draft negotiation email for top opportunity',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I compiled and ranked opportunity signals from your latest updates.' },
          { type: 'supplier', name: 'Supplier Agent', contribution: 'I tagged actions as keep/switch/negotiate/investigate for faster decisions.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to generate opportunities feed right now.',
        steps,
        error: error instanceof Error ? error.message : 'Opportunity feed failed',
      }
    }
  }

  const whatsNewQuery = parseWhatsNewBriefingQuery(message)
  if (whatsNewQuery) {
    const steps = [
      'Router: classified as unified what-is-new briefing request',
      'Core Brain: loading persisted profile, leases, and issue memory',
      'Planner Agent: ranking latest priorities and next actions',
    ]
    try {
      const briefing = await buildWhatsNewBriefing(whatsNewQuery.max)
      const rows = briefing.items.map((item, idx) => {
        const when = item.sourceDate
          ? new Date(item.sourceDate).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          : '-'
        return `${idx + 1}. [${item.priority.toUpperCase()}] ${item.area}: ${item.title}. Next: ${item.nextAction}. Date: ${when}.`
      })
      return {
        handled: true,
        response: [
          `${briefing.headline}`,
          '',
          ...(rows.length > 0
            ? rows
            : ['1. [LOW] ops: No high-priority updates found. Next: Review inbox and entity timeline. Date: -.']),
        ].join('\n'),
        steps,
        followUps: [
          'Show solicitor-only status',
          'Show accountant and tax priorities',
          'Draft next follow-up emails',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I prepared your unified priority briefing from core memory.' },
          { type: 'email', name: 'Email Agent', contribution: 'I included latest high-signal updates from connected inboxes.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to generate briefing right now.',
        steps,
        error: error instanceof Error ? error.message : 'Briefing failed',
      }
    }
  }

  const importantSendersCommand = parseImportantSendersCommand(message)
  if (importantSendersCommand) {
    const savedPatterns: string[] = []
    const failedPatterns: string[] = []
    for (const senderPattern of importantSendersCommand.senderPatterns) {
      try {
        await upsertMailboxSenderRule({ senderPattern, action: 'important' })
        savedPatterns.push(senderPattern)
      } catch {
        failedPatterns.push(senderPattern)
      }
    }

    const profileMemory = await upsertMasterProfileMemory({
      importantSenders: savedPatterns,
      notes: [
        `Important sender rules updated (${savedPatterns.length} items) on ${new Date().toISOString()}.`,
      ],
    })

    let workerStats: { ingested: number; processedEvents: number; updatedEntities: number } | null = null
    try {
      workerStats = await runAgentAutomationCycle()
    } catch {
      // Keep response useful even when sync fails.
    }

    const readiness = await getMailboxReadiness()
    const diagnostics = mailboxReadinessDiagnostics(readiness)
    let latest: Awaited<ReturnType<typeof getUnifiedInbox>> = []
    if (readiness.reachable.total > 0) {
      try {
        latest = await getUnifiedInbox(12)
      } catch {
        latest = []
      }
    }
    const latestRows = latest.slice(0, 8).map((m) => {
      const sender = m.fromName || m.fromAddress || 'Unknown sender'
      const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
      return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject || '(No Subject)'} |`
    })

    return {
      handled: true,
      response: [
        'Important sender memory updated and persisted.',
        '',
        `- Important sender patterns saved: **${savedPatterns.length}**`,
        `- Failed to save: **${failedPatterns.length}**`,
        `- Total remembered important senders: **${profileMemory.importantSenders.length}**`,
        workerStats
          ? `- Worker sync: ingested **${workerStats.ingested}**, processed **${workerStats.processedEvents}**, updated entities **${workerStats.updatedEntities}**`
          : '- Worker sync: unavailable in this cycle.',
        readiness.reachable.total > 0
          ? `- Mailbox connectivity: Outlook ${readiness.reachable.outlook ? 'OK' : 'down'}, Gmail ${readiness.reachable.gmail ? 'OK' : 'down'}`
          : `- Mailbox connectivity: unavailable. ${diagnostics || 'Reconnect mailbox providers.'}`,
        '',
        '| Date | Provider | From | Subject |',
        '|---|---|---|---|',
        ...(latestRows.length > 0 ? latestRows : ['| n/a | n/a | n/a | No readable latest inbox messages |']),
      ].join('\n'),
      steps: [
        'Router: classified as important sender memory command',
        'Email Agent: persisted sender patterns as important mailbox rules',
        'Automation Worker: attempted mailbox ingest refresh',
        'Research Agent: updated long-term master profile memory',
      ],
      followUps: [
        'Analyze all connected Gmail and Outlook emails from 2024 onward',
        'Show latest Gmail + Outlook updates',
        'Show solicitor/accountant/supplier status',
      ],
      agents: [
        { type: 'email', name: 'Email Agent', contribution: `I saved ${savedPatterns.length} important sender rules and refreshed mailbox sync.` },
        { type: 'research', name: 'Research Agent', contribution: 'I persisted this sender list in long-term profile memory for future routing.' },
      ],
      error: failedPatterns.length > 0 ? `Failed sender patterns: ${failedPatterns.join(', ')}` : undefined,
    }
  }

  const profilePatch = parseMasterProfileUpdate(message)
  let profileMemory: MasterProfileState | null = null
  if (profilePatch) {
    profileMemory = await upsertMasterProfileMemory(profilePatch)
    const analysisRequested = containsAny(lower, ['analyze', 'analyse', 'analysis', 'review', 'updates', 'status'])
    if (!analysisRequested) {
      return {
        handled: true,
        response: [
          'Profile memory updated and stored locally in your secure workspace database.',
          '',
          `- Known aliases: ${profileMemory.aliases.length}`,
          `- Businesses tracked: ${profileMemory.businesses.length}`,
          `- Core suppliers tracked: ${profileMemory.coreSuppliers.length}`,
          `- Key addresses tracked: ${profileMemory.addresses.length}`,
          `- Bank relationships tracked: ${profileMemory.bankRelationships.length}`,
          `- Personal accounts tracked: ${profileMemory.personalAccounts.length}`,
          `- Business accounts tracked: ${profileMemory.businessAccounts.length}`,
          `- Business leases tracked: ${profileMemory.leaseBusiness.length}`,
          `- Apartment leases tracked: ${profileMemory.leaseResidential.length}`,
          `- Refund cases tracked: ${profileMemory.refundCases.length}`,
          `- Insurance policies tracked: ${profileMemory.insurancePolicies.length}`,
          `- Telecom contracts tracked: ${profileMemory.telecomContracts.length}`,
        ].join('\n'),
        steps: [
          'Router: classified as profile memory update',
          'Research Agent: persisted aliases/business profile into local entity memory',
        ],
        followUps: [
          'Analyze all connected emails from 2024',
          'Show solicitor/accountant/supplier updates',
          'Show junk/spam cleanup recommendations',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I stored your profile and aliases in persistent local memory for future routing.' },
        ],
      }
    }
  }

  const workerSyncQuery = parseWorkerSyncQuery(message)
  if (workerSyncQuery) {
    const steps = [
      'Router: classified as worker sync command',
      'Automation Worker: running mailbox ingest cycle now',
      'Planner Agent: returning ingest and processing stats',
    ]
    try {
      const stats = await runAgentAutomationCycle()
      return {
        handled: true,
        response: [
          'Worker sync completed.',
          '',
          `- Emails ingested: **${stats.ingested}**`,
          `- Pending events processed: **${stats.processedEvents}**`,
          `- Entities updated: **${stats.updatedEntities}**`,
        ].join('\n'),
        steps,
        followUps: [
          'Show latest Gmail + Outlook updates',
          'Analyze all connected Gmail and Outlook emails from 2024 onward',
          'Show solicitor/accountant/supplier status',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I ran the mailbox worker sync and refreshed inbox ingestion.' },
          { type: 'research', name: 'Research Agent', contribution: 'I summarized worker output and processing stats.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Worker sync failed before completion.',
        steps,
        error: error instanceof Error ? error.message : 'Worker sync failed',
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'The worker sync command failed; check mailbox OAuth/config and retry.' },
        ],
      }
    }
  }

  const senderPropertyWatch = parseSenderPropertyWatchQuery(message)
  if (senderPropertyWatch) {
    return handleSenderPropertyWatch({
      query: senderPropertyWatch,
      getMailboxReadiness,
      mailboxReadinessDiagnostics,
      searchUnifiedInbox,
      upsertMasterProfileMemory: async (patch) => {
        await upsertMasterProfileMemory({
          importantSenders: patch.importantSenders,
          notes: patch.notes,
        })
      },
      uniqueStrings,
      containsAny,
    })
  }

  const propertyMailboxQuery = parsePropertyMailboxQuery(message)
  if (propertyMailboxQuery) {
    const steps = [
      'Router: classified as property mailbox search request',
      `Email Agent: searching connected Gmail + Outlook from ${propertyMailboxQuery.sinceDate.slice(0, 10)}`,
      'Legal Agent: extracting land-registry / lease-related evidence',
    ]
    try {
      const profileMemory = await getMasterProfileMemory()
      const profileNames = [
        ...(profileMemory?.aliases || []),
        ...(profileMemory?.addresses || []),
      ]
      const fromContains = uniqueStrings([
        ...propertyMailboxQuery.nameHints,
        ...profileNames,
      ]).slice(0, 12)

      const textTerms = uniqueStrings(
        propertyMailboxQuery.textQuery
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length > 2)
      )
      const sinceDate = new Date(propertyMailboxQuery.sinceDate)
      const localMatches = await db.emailMessage.findMany({
        where: {
          date: { gte: sinceDate },
          AND: [
            {
              OR: textTerms.map((term) => ({
                OR: [
                  { subject: { contains: term } },
                  { body: { contains: term } },
                ],
              })),
            },
            ...(fromContains.length > 0
              ? [
                {
                  OR: fromContains.map((hint) => ({
                    fromAddress: { contains: hint },
                  })),
                },
              ]
              : []),
          ],
        },
        orderBy: { date: 'desc' },
        take: 120,
        select: {
          provider: true,
          providerMessageId: true,
          subject: true,
          date: true,
          body: true,
          fromAddress: true,
        },
      })

      let hits = localMatches.map((row) => ({
        id: row.providerMessageId,
        provider: (row.provider === 'gmail' ? 'gmail' : 'outlook') as 'gmail' | 'outlook',
        subject: row.subject || '(No Subject)',
        receivedDateTime: row.date.toISOString(),
        bodyPreview: (row.body || '').slice(0, 220),
        fromName: undefined,
        fromAddress: row.fromAddress || undefined,
      }))

      if (hits.length === 0) {
        hits = await searchUnifiedInbox({
          text: propertyMailboxQuery.textQuery,
          fromContains: fromContains.length > 0 ? fromContains : undefined,
          sinceDate: propertyMailboxQuery.sinceDate,
          maxFetchPerProvider: Math.min(propertyMailboxQuery.maxFetchPerProvider, 40),
          exhaustive: false,
        })
      }

      if (hits.length === 0) {
        const readiness = await getMailboxReadiness()
        const diagnostics = mailboxReadinessDiagnostics(readiness)
        const noMailboxConnection = readiness.connectedCount.total === 0
        const mailboxUnreachable = readiness.connectedCount.total > 0 && readiness.reachable.total === 0

        return {
          handled: true,
          response: noMailboxConnection
            ? 'No connected Gmail/Outlook mailbox accounts found. Reconnect mailboxes in the Email panel, then retry property search.'
            : mailboxUnreachable
              ? `Mailbox accounts are saved but currently unreachable (token expired or OAuth needs reconnect). Reconnect and retry.${diagnostics ? ` Diagnostics: ${diagnostics}` : ''}`
              : `No property/lease/land-registry emails were found from ${propertyMailboxQuery.sinceDate.slice(0, 10)} onward.`,
          steps,
          followUps: [
            'Run worker sync now',
            'Analyze all connected Gmail and Outlook emails from 2023 onward',
            'Show solicitor-only timeline from 2023',
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'I ran an inbox-wide property search but found no matching communications.' },
            { type: 'legal', name: 'Legal Agent', contribution: 'No lease/land-registry evidence matched the current search scope.' },
          ],
        }
      }

      const sorted = [...hits].sort(
        (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )
      const propertyHits = sorted.filter((msg) =>
        ['solicitor', 'property-ops'].includes(classifyOperationalCategory(msg as InboxSnapshotMessage))
      )
      const leaseHits = sorted.filter((msg) => {
        const text = `${msg.subject || ''} ${msg.bodyPreview || ''}`.toLowerCase()
        return containsAny(text, ['lease', 'leasehold', 'land registry', 'title', 'deed', 'conveyancing'])
      })

      const rows = sorted.slice(0, 20).map((m) => {
        const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
        const sender = m.fromName || m.fromAddress || 'Unknown sender'
        return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject || '(No Subject)'} | ${(m.bodyPreview || '').slice(0, 120)} |`
      })

      return {
        handled: true,
        response: [
          `Property mailbox search complete from **${propertyMailboxQuery.sinceDate.slice(0, 10)}** onward.`,
          '',
          `- Total matches: **${sorted.length}**`,
          `- Legal/property-core matches: **${propertyHits.length}**`,
          `- Lease/land-registry direct matches: **${leaseHits.length}**`,
          '',
          '| Date | Provider | Sender | Subject | Snippet |',
          '|---|---|---|---|---|',
          ...rows,
        ].join('\n'),
        steps,
        followUps: [
          'Show solicitor-only timeline from 2023',
          'Show thread status for land registry matters',
          'Draft follow-up email for lease updates',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I searched connected Gmail + Outlook history for property/lease communications.' },
          { type: 'legal', name: 'Legal Agent', contribution: 'I highlighted lease and land-registry related evidence for legal follow-up.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Property mailbox search failed before completion.',
        steps,
        error: error instanceof Error ? error.message : 'Property mailbox query failed',
      }
    }
  }

  const focusItem = parseFocusItemQuery(message)
  if (focusItem) {
    const steps = [
      'Router: classified as focused-case action request',
      'Research Agent: finding best matching tracked entity',
      'Legal/Planner Agent: returning single-case actions only',
    ]
    try {
      const rows = await db.agentEntity.findMany({
        where: {
          status: { not: 'closed' },
          ...(focusItem.agentType ? { agentType: focusItem.agentType } : {}),
        },
        include: { state: true },
        orderBy: { lastUpdateAt: 'desc' },
        take: 250,
      })
      const matched = findBestEntityMatch(rows, focusItem.entityQuery)
      if (!matched) {
        return {
          handled: true,
          response: `I could not find a tracked case matching "${focusItem.entityQuery}".`,
          steps,
          followUps: [
            'Show solicitor status',
            'Show thread status for 6F Steamer Street',
            'Run worker sync now',
          ],
          agents: [
            { type: 'research', name: 'Research Agent', contribution: 'I tried focused matching but no case matched your target.' },
          ],
        }
      }

      const state = parseStateObject(matched.state?.stateJson)
      const status = getStateStatus(state, matched.status)
      const waitingOn = getStateWaitingOn(state)
      const nextActions = getStateNextActions(state, 3)
      const lastEmailDate = getStateLastEmailDate(state)

      return {
        handled: true,
        response: [
          `Focused case: ${matched.entityKey} (${matched.agentType}).`,
          `Status: ${status}.`,
          `Waiting on: ${waitingOn || 'none'}.`,
          `Last update: ${lastEmailDate ? new Date(lastEmailDate).toLocaleString('en-GB') : new Date(matched.lastUpdateAt).toLocaleString('en-GB')}.`,
          `Next 1: ${nextActions[0] || 'Review latest timeline and confirm required action.'}`,
          `Next 2: ${nextActions[1] || 'Chase solicitor/accountant contact for explicit date and reference.'}`,
          `Next 3: ${nextActions[2] || 'Prepare follow-up email draft now.'}`,
        ].join('\n'),
        steps,
        followUps: [
          `Draft follow-up email for ${matched.entityKey}`,
          `Show timeline for ${matched.entityKey}`,
          'Create weekly chase reminder',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: `I narrowed to a single tracked case: ${matched.entityKey}.` },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to focus this case right now.',
        steps,
        error: error instanceof Error ? error.message : 'Focus case query failed',
      }
    }
  }

  const threadStatusQuery = parseThreadStatusQuery(message)
  if (threadStatusQuery) {
    const steps = [
      'Router: classified as per-thread status query',
      'Research Agent: matching request to a tracked entity thread',
      'Research Agent: loading thread state, timeline, and next actions',
    ]
    try {
      const rows = await db.agentEntity.findMany({
        where: {
          ...(threadStatusQuery.agentType ? { agentType: threadStatusQuery.agentType } : {}),
        },
        include: { state: true },
        orderBy: { lastUpdateAt: 'desc' },
        take: 250,
      })

      const matched = findBestEntityMatch(rows, threadStatusQuery.entityQuery)
      if (!matched) {
        return {
          handled: true,
          response: `No tracked thread found for "${threadStatusQuery.entityQuery}" yet.`,
          steps,
          followUps: [
            'Show central timeline from day 1',
            'Show solicitor/accountant/supplier/business status',
            'Run worker sync now',
          ],
          agents: [
            { type: 'research', name: 'Research Agent', contribution: 'I checked tracked entities but found no matching thread yet.' },
          ],
        }
      }

      const events = await db.agentEntityEvent.findMany({
        where: { agentEntityId: matched.id },
        orderBy: { createdAt: 'desc' },
        take: threadStatusQuery.limit,
      })

      const emailSourceRefs = events
        .filter((event) => event.source === 'email' && event.sourceRef)
        .map((event) => event.sourceRef)
      const emailRows = emailSourceRefs.length
        ? await db.emailMessage.findMany({
          where: { id: { in: emailSourceRefs } },
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            date: true,
            provider: true,
          },
        })
        : []
      const emailMap = new Map(emailRows.map((row) => [row.id, row]))

      const state = parseStateObject(matched.state?.stateJson)
      const status = getStateStatus(state, matched.status)
      const waitingOn = getStateWaitingOn(state)
      const nextActions = getStateNextActions(state, 3)
      const lastEmailDate = getStateLastEmailDate(state)

      const timelineRows = events.map((event) => {
        const email = emailMap.get(event.sourceRef)
        const when = email?.date || event.createdAt
        const provider = email?.provider ? email.provider.toUpperCase() : '-'
        const subject = email?.subject || '-'
        const from = email?.fromAddress || '-'
        return `| ${new Date(when).toLocaleString('en-US')} | ${provider} | ${from} | ${subject} | ${event.summary} |`
      })

      return {
        handled: true,
        response: [
          `Thread status for **${matched.entityKey}** (${matched.agentType}).`,
          '',
          `- Current state: **${status}**`,
          `- Waiting on: **${waitingOn || 'none'}**`,
          `- Last email date: **${lastEmailDate ? new Date(lastEmailDate).toLocaleString('en-US') : new Date(matched.lastUpdateAt).toLocaleString('en-US')}**`,
          `- Next actions: **${nextActions.length > 0 ? nextActions.join(' | ') : 'Review timeline and draft follow-up.'}**`,
          '',
          '| Date/Time | Provider | From | Subject | Summary |',
          '|---|---|---|---|---|',
          ...(timelineRows.length > 0 ? timelineRows : ['| n/a | n/a | n/a | n/a | No timeline events yet |']),
        ].join('\n'),
        steps,
        followUps: [
          'Show central timeline from day 1',
          `Draft follow-up email for ${matched.entityKey}`,
          'Mark one entity as resolved',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: `I loaded current state and timeline for ${matched.entityKey}.` },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to load thread status right now.',
        steps,
        error: error instanceof Error ? error.message : 'Thread status query failed',
      }
    }
  }

  const centralTimeline = parseCentralTimelineQuery(message)
  if (centralTimeline) {
    const steps = [
      'Router: classified as central timeline query',
      'Automation Worker: refreshing mailbox ingest in background',
      'Research Agent: loading unified event timeline from persistent storage',
    ]
    try {
      void runAgentAutomationCycle()

      const eventWhere = centralTimeline.agentType
        ? { agentEntity: { agentType: centralTimeline.agentType } }
        : {}

      const [totalEvents, eventsDesc] = await Promise.all([
        db.agentEntityEvent.count({ where: eventWhere }),
        db.agentEntityEvent.findMany({
          where: eventWhere,
          include: {
            agentEntity: {
              select: {
                id: true,
                agentType: true,
                entityKey: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: centralTimeline.limit,
        }),
      ])

      const events = [...eventsDesc].reverse()
      const emailSourceRefs = events
        .filter((event) => event.source === 'email' && event.sourceRef)
        .map((event) => event.sourceRef)
      const emailRows = emailSourceRefs.length
        ? await db.emailMessage.findMany({
          where: { id: { in: emailSourceRefs } },
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            date: true,
            provider: true,
          },
        })
        : []
      const emailMap = new Map(emailRows.map((row) => [row.id, row]))
      const entityCount = new Set(events.map((event) => event.agentEntity.id)).size

      const rows = events.map((event) => {
        const email = emailMap.get(event.sourceRef)
        const when = email?.date || event.createdAt
        const provider = email?.provider ? email.provider.toUpperCase() : '-'
        const from = email?.fromAddress || '-'
        const subject = email?.subject || '-'
        return `| ${new Date(when).toLocaleString('en-US')} | ${event.agentEntity.agentType} | ${event.agentEntity.entityKey} | ${event.agentEntity.status} | ${provider} | ${from} | ${subject} |`
      })

      return {
        handled: true,
        response: [
          `Central timeline ${centralTimeline.agentType ? `for **${centralTimeline.agentType}** threads ` : ''}(day 1 to now, showing latest ${events.length}).`,
          '',
          `- Total events recorded: **${totalEvents}**`,
          `- Threads represented: **${entityCount}**`,
          `- View order: **chronological**`,
          '',
          '| Date/Time | Type | Thread | Status | Provider | From | Subject |',
          '|---|---|---|---|---|---|---|',
          ...(rows.length > 0 ? rows : ['| n/a | n/a | n/a | n/a | n/a | n/a | No events yet |']),
        ].join('\n'),
        steps,
        followUps: [
          'Show status for HMRC',
          'Show status for British Gas',
          'Show solicitor/accountant/supplier/business status',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I assembled one unified event timeline across all tracked threads.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to load central timeline right now.',
        steps,
        error: error instanceof Error ? error.message : 'Central timeline query failed',
      }
    }
  }

  const topEntityTimeline = parseTopEntityTimelineQuery(message)
  if (topEntityTimeline) {
    const steps = [
      'Router: classified as top-entity timeline request',
      'Research Agent: selecting most recent active entity',
      'Research Agent: loading entity timeline events from persistent storage',
    ]
    try {
      const entity = await db.agentEntity.findFirst({
        where: {
          status: { not: 'closed' },
          ...(topEntityTimeline.agentType ? { agentType: topEntityTimeline.agentType } : {}),
        },
        include: { state: true },
        orderBy: { lastUpdateAt: 'desc' },
      })

      if (!entity) {
        return {
          handled: true,
          response: `No active ${topEntityTimeline.agentType ? `${topEntityTimeline.agentType} ` : ''}entities found for timeline view.`,
          steps,
          followUps: [
            'Show solicitor/accountant/supplier status',
            'Show latest live updates',
            'Analyze urgent inbox items',
          ],
          agents: [
            { type: 'research', name: 'Research Agent', contribution: 'No active entity exists yet to build a timeline from.' },
          ],
        }
      }

      const events = await db.agentEntityEvent.findMany({
        where: { agentEntityId: entity.id },
        orderBy: { createdAt: 'desc' },
        take: topEntityTimeline.limit,
      })

      const emailSourceRefs = events
        .filter((event) => event.source === 'email' && event.sourceRef)
        .map((event) => event.sourceRef)

      const emailRows = emailSourceRefs.length
        ? await db.emailMessage.findMany({
          where: { id: { in: emailSourceRefs } },
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            date: true,
            provider: true,
          },
        })
        : []

      const emailMap = new Map(emailRows.map((row) => [row.id, row]))
      const state = parseStateObject(entity.state?.stateJson)
      const nextActions = getStateNextActions(state, 2)

      const rows = events.map((event) => {
        const email = emailMap.get(event.sourceRef)
        const when = new Date(event.createdAt).toLocaleString('en-US')
        const provider = email?.provider ? email.provider.toUpperCase() : '-'
        const subject = email?.subject || '-'
        const from = email?.fromAddress || '-'
        return `| ${when} | ${event.source} | ${provider} | ${subject} | ${from} | ${event.summary} |`
      })

      const response = [
        `Top active entity timeline: **${entity.entityKey}** (${entity.agentType}).`,
        '',
        `- Status: **${entity.status}**`,
        `- Last updated: **${new Date(entity.lastUpdateAt).toLocaleString('en-US')}**`,
        `- Next actions: **${nextActions.length > 0 ? nextActions.join(' | ') : 'Review timeline'}**`,
        `- Timeline events found: **${events.length}**`,
        '',
        '| Date/Time | Source | Provider | Subject | From | Summary |',
        '|---|---|---|---|---|---|',
        ...(rows.length > 0 ? rows : ['| n/a | n/a | n/a | n/a | n/a | No recorded timeline events yet |']),
      ].join('\n')

      return {
        handled: true,
        response,
        steps,
        followUps: [
          'Show solicitor/accountant/supplier status',
          'Show latest live updates',
          'Draft follow-up email for waiting items',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: `I loaded real timeline events for ${entity.entityKey} from local persistent storage.` },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to load top entity timeline right now.',
        steps,
        error: error instanceof Error ? error.message : 'Top entity timeline query failed',
      }
    }
  }

  const combinedSolicitorAlicea = parseSolicitorAndAliceaCombinedQuery(message)
  if (combinedSolicitorAlicea) {
    const steps = [
      'Router: classified as combined solicitor-status + Alicea analysis request',
      'Research Agent: loading strict solicitor entities',
      'Email Agent: running sender-focused Alicea mailbox search',
      'Legal Agent: deciding if chase email is needed now',
    ]
    try {
      const sinceDate = new Date('2023-01-01T00:00:00.000Z')
      const providerWhere =
        combinedSolicitorAlicea.providerHint === 'all'
          ? {}
          : { provider: combinedSolicitorAlicea.providerHint }

      const [entities, hits, localRows] = await Promise.all([
        db.agentEntity.findMany({
          where: { status: { not: 'closed' }, agentType: 'solicitor' },
          include: { state: true },
          orderBy: { lastUpdateAt: 'desc' },
          take: 25,
        }),
        searchUnifiedInbox({
          fromContains: ['aliceamclellan@rc.legal', 'aliceamclellan', 'rc.legal', 'alicea'],
          text: '6f steamer street land registry lease title deed',
          sinceDate: '2023-01-01T00:00:00.000Z',
          maxFetchPerProvider: 5000,
          exhaustive: true,
        }),
        db.emailMessage.findMany({
          where: {
            date: { gte: sinceDate },
            ...providerWhere,
            OR: [
              { fromAddress: { contains: 'aliceamclellan@rc.legal' } },
              { fromAddress: { contains: 'aliceamclellan' } },
              { fromAddress: { contains: 'rc.legal' } },
              {
                AND: [
                  { subject: { contains: 'steamer street' } },
                  { body: { contains: 'land registry' } },
                ],
              },
            ],
          },
          orderBy: { date: 'desc' },
          take: 400,
          select: {
            provider: true,
            providerMessageId: true,
            subject: true,
            date: true,
            body: true,
            fromAddress: true,
          },
        }),
      ])

      const strictSolicitor = entities.filter((e) => isStrictSolicitorEntity(e)).slice(0, 6)
      const solicitorRows =
        strictSolicitor.length > 0
          ? strictSolicitor.map((row) => {
              const state = parseStateObject(row.state?.stateJson)
              const nextActions = getStateNextActions(state, 2).join(' | ') || 'Review timeline'
              return `- **${row.entityKey}** | status: \`${row.status}\` | last: ${new Date(row.lastUpdateAt).toLocaleString('en-GB')} | next: ${nextActions}`
            })
          : ['- No strict solicitor/legal entities found.']

      const localHits = localRows.map((row) => ({
        id: row.providerMessageId,
        provider: row.provider as 'outlook' | 'gmail',
        subject: row.subject || '(No Subject)',
        receivedDateTime: row.date.toISOString(),
        bodyPreview: (row.body || '').slice(0, 800),
        fromName: '',
        fromAddress: row.fromAddress || '',
      }))

      const mergedHitsMap = new Map<string, (typeof localHits)[number]>()
      for (const row of [...hits, ...localHits]) {
        const key = `${row.provider}:${row.id || row.receivedDateTime}:${row.subject || ''}`
        if (!mergedHitsMap.has(key)) mergedHitsMap.set(key, row)
      }

      const sortedHits = [...mergedHitsMap.values()].sort(
        (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )
      const aliceaHits = sortedHits.filter((m) => {
        const from = `${m.fromAddress || ''} ${m.fromName || ''}`.toLowerCase()
        return from.includes('aliceamclellan@rc.legal') || from.includes('@rc.legal') || from.includes('aliceamclellan')
      })
      const scopedHits = aliceaHits.length > 0 ? aliceaHits : sortedHits

      const providerScopedHits =
        combinedSolicitorAlicea.providerHint === 'all'
          ? scopedHits
          : scopedHits.filter((m) => m.provider === combinedSolicitorAlicea.providerHint)
      const finalHits = providerScopedHits.length > 0 ? providerScopedHits : scopedHits

      let aliceaSection: string[] = ['No Alicea/RC Legal matches were found in current accessible mailbox data.']
      if (finalHits.length > 0) {
        const latest = finalHits[0]
        const latestAt = new Date(latest.receivedDateTime)
        const daysSince = Math.floor((Date.now() - latestAt.getTime()) / (24 * 60 * 60 * 1000))
        const shouldChase = daysSince >= 7
        const sampleRows = finalHits.slice(0, 6).map((m) => {
          const date = new Date(m.receivedDateTime).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          const sender = m.fromName || m.fromAddress || 'Unknown sender'
          return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject || '(No Subject)'} |`
        })
        aliceaSection = [
          `- Total matches: **${finalHits.length}**`,
          `- Source coverage: **live provider + local synced history**`,
          `- Latest update: **${latestAt.toLocaleDateString('en-GB')}** | **${latest.subject || '(No Subject)'}**`,
          `- Need chase email now: **${shouldChase ? 'YES' : 'NO'}**`,
          `- Reason: ${shouldChase ? `Latest update is ${daysSince} day(s) old.` : 'Recent update exists.'}`,
          '',
          '| Date | Provider | From | Subject |',
          '|---|---|---|---|',
          ...sampleRows,
        ]
      }

      return {
        handled: true,
        response: [
          'Here is your combined solicitor status and Alicea update analysis:',
          '',
          '### Solicitor',
          ...solicitorRows,
          '',
          '### Alicea (rc.legal) Analysis',
          ...aliceaSection,
        ].join('\n'),
        steps,
        followUps: [
          'Draft chase email to Alicea now',
          'Show only Land Registry timeline for 6F Steamer Street',
          'Set daily Alicea follow-up check',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I returned strict solicitor-only entity status.' },
          { type: 'email', name: 'Email Agent', contribution: 'I ran an exhaustive sender-focused Alicea search across Gmail and Outlook.' },
          { type: 'legal', name: 'Legal Agent', contribution: 'I assessed if a chase email is needed now based on recency.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Combined solicitor/Alicea analysis failed before completion.',
        steps,
        error: error instanceof Error ? error.message : 'Combined analysis failed',
      }
    }
  }

  const dashboardQuery = parseEntityDashboardQuery(message)
  if (dashboardQuery) {
    const steps = [
      'Router: classified as persistent entity dashboard query',
      'Automation Worker: syncing latest mailbox events',
      'Planner Agent: summarizing case entities and next actions',
    ]
    try {
      // Trigger a background refresh but do not block the cockpit response.
      void runAgentAutomationCycle()

      const entities = await db.agentEntity.findMany({
        where: {
          status: { not: 'closed' },
          ...(dashboardQuery.agentType ? { agentType: dashboardQuery.agentType } : {}),
        },
        include: { state: true },
        orderBy: { lastUpdateAt: 'desc' },
        take: 25,
      })

      const filteredEntities =
        dashboardQuery.agentType === 'solicitor'
          ? entities.filter((entity) => isStrictSolicitorEntity(entity))
          : entities

      if (filteredEntities.length === 0) {
        return {
          handled: true,
          response:
            dashboardQuery.agentType === 'solicitor'
              ? 'No strict solicitor/legal entities found yet after filtering listing/newsletter noise.'
              : 'No active entities found yet. Connect inboxes and allow worker to ingest emails.',
          steps,
          followUps: [
            'Check Outlook updates',
            'Check Gmail updates',
            'Analyze inbox now',
          ],
          agents: [
            { type: 'research', name: 'Research Agent', contribution: 'No active tracked entities are available yet.' },
          ],
        }
      }

      const grouped = new Map<string, typeof filteredEntities>()
      for (const entity of filteredEntities) {
        if (!grouped.has(entity.agentType)) grouped.set(entity.agentType, [])
        grouped.get(entity.agentType)?.push(entity)
      }

      const sections: string[] = []
      for (const [agentType, rows] of grouped.entries()) {
        sections.push(`### ${agentType.charAt(0).toUpperCase()}${agentType.slice(1)}`)
        for (const row of rows.slice(0, 6)) {
          const state = parseStateObject(row.state?.stateJson)
          const nextActions = getStateNextActions(state, 2).join(' | ') || 'Review timeline'
          sections.push(
            `- **${row.entityKey}** | status: \`${row.status}\` | last: ${new Date(row.lastUpdateAt).toLocaleString('en-US')} | next: ${nextActions}`
          )
        }
        sections.push('')
      }

      return {
        handled: true,
        response: [
          'Here is your live case cockpit update across active entities:',
          '',
          ...sections,
        ].join('\n'),
        steps,
        followUps: [
          'Show timeline for top entity',
          'Draft follow-up email for waiting items',
          'Mark one entity as resolved',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I aggregated active entity memory and status across agents.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to build the case cockpit summary right now.',
        steps,
        error: error instanceof Error ? error.message : 'Dashboard query failed',
      }
    }
  }

  const generalUpdates = parseGeneralUpdatesQuery(message)
  if (generalUpdates) {
    const steps = [
      'Router: classified as general live updates query',
      'Automation Worker: syncing latest mailbox events',
      'Email Agent: collecting latest inbox updates',
      'Planner Agent: summarizing entity progress',
    ]
    try {
      await runAgentAutomationCycle()
    } catch {
      // Continue even if worker refresh fails; we can still read available state.
    }

    try {
      const [entityResult, inboxResult] = await Promise.allSettled([
        db.agentEntity.findMany({
          where: { status: { not: 'closed' } },
          include: { state: true },
          orderBy: { lastUpdateAt: 'desc' },
          take: 6,
        }),
        getUnifiedInbox(generalUpdates.top),
      ])

      const entities = entityResult.status === 'fulfilled' ? entityResult.value : []
      const inbox = inboxResult.status === 'fulfilled' ? inboxResult.value : []

      if (entities.length === 0 && inbox.length === 0) {
        return {
          handled: true,
          response: 'No live updates available yet. Connect Gmail/Outlook and allow the automation worker to ingest events.',
          steps,
          followUps: [
            'Check Gmail updates',
            'Check Outlook updates',
            'Show solicitor status updates',
          ],
          agents: [
            { type: 'research', name: 'Research Agent', contribution: 'No active entities or inbox updates were available yet.' },
          ],
        }
      }

      const providerSplit = inbox.reduce(
        (acc, msg) => {
          acc[msg.provider] += 1
          return acc
        },
        { outlook: 0, gmail: 0 }
      )

      const inboxRows = inbox
        .slice(0, generalUpdates.top)
        .map((m) => {
          const sender = m.fromName || m.fromAddress || 'Unknown sender'
          const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject || '(No Subject)'} |`
        })

      const entityRows = entities.map((entity) => {
        let nextAction = 'Review timeline'
        const state = parseStateObject(entity.state?.stateJson)
        const actions = getStateNextActions(state, 1)
        if (actions.length > 0) {
          nextAction = actions[0]
        }
        return `- **${entity.entityKey}** (${entity.agentType}) | status: \`${entity.status}\` | last: ${new Date(entity.lastUpdateAt).toLocaleString('en-US')} | next: ${nextAction}`
      })

      const responseLines: string[] = [
        'Here are your latest live operations updates:',
        '',
        `- Active entities: **${entities.length}**`,
        `- Inbox items checked: **${inbox.length}** (Outlook ${providerSplit.outlook}, Gmail ${providerSplit.gmail})`,
        '',
      ]

      if (entityRows.length > 0) {
        responseLines.push('### Entity Status')
        responseLines.push(...entityRows)
        responseLines.push('')
      }

      if (inboxRows.length > 0) {
        responseLines.push('### Latest Inbox Updates')
        responseLines.push('| Date | Provider | From | Subject |')
        responseLines.push('|---|---|---|---|')
        responseLines.push(...inboxRows)
      }

      return {
        handled: true,
        response: responseLines.join('\n'),
        steps,
        followUps: [
          'Show solicitor-only updates',
          'Show accountant-only updates',
          'Analyze and route urgent emails',
        ],
        agents: [
          { type: 'research', name: 'Research Agent', contribution: 'I assembled the latest entity and case progression snapshot.' },
          { type: 'email', name: 'Email Agent', contribution: 'I fetched live mailbox updates and included the newest messages.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Unable to build the general live updates view right now.',
        steps,
        error: error instanceof Error ? error.message : 'General updates query failed',
      }
    }
  }

  const comprehensiveAudit = parseComprehensiveMailboxAuditQuery(message)
  if (comprehensiveAudit) {
    const steps = [
      'Router: classified as comprehensive mailbox audit request',
      `Email Agent: exhaustively fetching Gmail + Outlook emails since ${comprehensiveAudit.sinceDate.slice(0, 10)}`,
      'Research Agent: ranking legal/finance/supplier/property relevance',
      'Research Agent: generating junk/spam cleanup recommendations',
    ]
    try {
      const hits = await searchUnifiedInbox({
        sinceDate: comprehensiveAudit.sinceDate,
        maxFetchPerProvider: comprehensiveAudit.maxFetchPerProvider,
        exhaustive: comprehensiveAudit.exhaustive,
      })

      if (hits.length === 0) {
        const readiness = await getMailboxReadiness()
        const noMailboxConnection = readiness.connectedCount.total === 0
        const mailboxUnreachable = readiness.connectedCount.total > 0 && readiness.reachable.total === 0
        const diagnostics = mailboxReadinessDiagnostics(readiness)
        return {
          handled: true,
          response: noMailboxConnection
            ? 'No connected Gmail/Outlook mailbox accounts found. Reconnect mailboxes in the Email panel, then rerun the full audit.'
            : mailboxUnreachable
              ? `Mailbox accounts are saved but currently unreachable (token expired or OAuth needs reconnect). Reconnect Gmail/Outlook in the Email panel, then rerun the full audit.${diagnostics ? ` Diagnostics: ${diagnostics}` : ''}`
              : `Mailbox connections are live, but search returned 0 emails from ${comprehensiveAudit.sinceDate.slice(0, 10)} onward.`,
          steps,
          followUps: [
            'Reconnect Gmail/Outlook and retry full audit',
            'Show latest inbox updates',
            'Run worker sync now',
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'No historical messages were returned from connected providers.' },
          ],
        }
      }

      const providerSplit = hits.reduce(
        (acc, m) => {
          acc[m.provider] += 1
          return acc
        },
        { outlook: 0, gmail: 0 }
      )
      const providerCapHit =
        providerSplit.outlook >= comprehensiveAudit.maxFetchPerProvider ||
        providerSplit.gmail >= comprehensiveAudit.maxFetchPerProvider

      const senderRules = await getMailboxSenderRules()
      const senderImportantRules = senderRules.filter((rule) => rule.action === 'important')
      const senderJunkRules = senderRules.filter((rule) => rule.action === 'junk')
      const flagged = hits.filter((m) => m.isFlagged || (m.labels || []).some((l) => /pinned|starred|flagged/i.test(l)))
      const importantById = new Set(
        hits
          .filter((m) => m.isImportant || containsAny(`${m.subject} ${m.bodyPreview || ''}`.toLowerCase(), ['urgent', 'deadline', 'action required', 'payment due']))
          .map((m) => m.id)
      )
      const unread = hits.filter((m) => m.isUnread)

      const buckets = new Map<string, InboxSnapshotMessage[]>()
      const junkCandidateById = new Map<string, InboxSnapshotMessage>()
      let senderRuleImportantMatches = 0
      let senderRuleJunkMatches = 0
      for (const msg of hits) {
        const item: InboxSnapshotMessage = {
          id: msg.id,
          provider: msg.provider,
          subject: msg.subject,
          receivedDateTime: msg.receivedDateTime,
          bodyPreview: msg.bodyPreview || '',
          fromName: msg.fromName,
          fromAddress: msg.fromAddress,
        }
        const bucket = classifyOperationalCategory(item)
        if (!buckets.has(bucket)) buckets.set(bucket, [])
        buckets.get(bucket)?.push(item)
        const matchedImportantRule = senderImportantRules.find((rule) =>
          messageMatchesSenderPattern(item, rule.senderPattern)
        )
        const matchedJunkRule = senderJunkRules.find((rule) =>
          messageMatchesSenderPattern(item, rule.senderPattern)
        )
        if (matchedImportantRule) {
          importantById.add(msg.id)
          senderRuleImportantMatches += 1
        }
        if (matchedJunkRule) {
          junkCandidateById.set(item.id, item)
          importantById.delete(msg.id)
          senderRuleJunkMatches += 1
        }
        if (bucket === 'junk-likely' && !item.subject.toLowerCase().includes('invoice') && !item.subject.toLowerCase().includes('statement')) {
          junkCandidateById.set(item.id, item)
        }
      }
      const important = hits.filter((m) => importantById.has(m.id))
      const junkCandidates = [...junkCandidateById.values()]

      const relevant = ['solicitor', 'accountant', 'supplier', 'banking', 'property-ops']
      const keyRows: string[] = []
      for (const bucket of relevant) {
        const rows = (buckets.get(bucket) || [])
          .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
          .slice(0, 2)
        for (const m of rows) {
          const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          const sender = m.fromName || m.fromAddress || 'Unknown sender'
          keyRows.push(`| ${bucket} | ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject} |`)
        }
      }

      const junkSenderCounts = new Map<string, number>()
      for (const m of junkCandidates) {
        const sender = (m.fromAddress || m.fromName || 'Unknown').toLowerCase()
        junkSenderCounts.set(sender, (junkSenderCounts.get(sender) || 0) + 1)
      }
      const junkTop = [...junkSenderCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([sender, count]) => `${sender} (${count})`)

      const importantSenderCounts = new Map<string, number>()
      for (const m of important) {
        const sender = (m.fromAddress || m.fromName || 'Unknown').toLowerCase()
        importantSenderCounts.set(sender, (importantSenderCounts.get(sender) || 0) + 1)
      }
      const importantTop = [...importantSenderCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([sender, count]) => `${sender} (${count})`)
      const importantForMemory = uniqueStrings(
        importantTop.map((entry) => entry.replace(/\s*\(\d+\)\s*$/g, '').trim()).filter(Boolean)
      )

      const earliestDate = hits
        .map((m) => new Date(m.receivedDateTime).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b)[0]

      const profileNote = profileMemory
        ? `\n- Profile memory refreshed: aliases ${profileMemory.aliases.length}, suppliers ${profileMemory.coreSuppliers.length}, businesses ${profileMemory.businesses.length}`
        : ''

      await upsertMailboxAuditMemory({
        sinceDate: comprehensiveAudit.sinceDate,
        scanned: hits.length,
        providerSplit,
        flagged: flagged.length,
        important: important.length,
        unread: unread.length,
        categoryCounts: {
          solicitor: (buckets.get('solicitor') || []).length,
          accountant: (buckets.get('accountant') || []).length,
          supplier: (buckets.get('supplier') || []).length,
          banking: (buckets.get('banking') || []).length,
          propertyOps: (buckets.get('property-ops') || []).length,
          junkLikely: (buckets.get('junk-likely') || []).length,
        },
        topJunkSenders: junkTop,
        topImportantSenders: importantTop,
        senderRules: {
          total: senderRules.length,
          importantRules: senderImportantRules.length,
          junkRules: senderJunkRules.length,
          importantMatches: senderRuleImportantMatches,
          junkMatches: senderRuleJunkMatches,
        },
      })
      const memoryAfterAudit = await upsertMasterProfileMemory({
        importantSenders: importantForMemory,
        notes: [
          `Exhaustive mailbox audit from ${comprehensiveAudit.sinceDate.slice(0, 10)} scanned ${hits.length} emails (Outlook ${providerSplit.outlook}, Gmail ${providerSplit.gmail}).`,
        ],
      })

      const response = [
        `Comprehensive mailbox audit complete (from ${comprehensiveAudit.sinceDate.slice(0, 10)}).`,
        '',
        `- Emails analyzed: **${hits.length}**`,
        `- Coverage window: **${earliestDate ? new Date(earliestDate).toLocaleDateString('en-US') : comprehensiveAudit.sinceDate.slice(0, 10)} to ${new Date().toLocaleDateString('en-US')}**`,
        `- Provider split: Outlook **${providerSplit.outlook}**, Gmail **${providerSplit.gmail}**`,
        `- Scan mode: **exhaustive historical pagination** (cap per provider ${comprehensiveAudit.maxFetchPerProvider}${providerCapHit ? ', cap reached on at least one provider' : ''})`,
        ...(providerCapHit
          ? ['- To scan deeper, increase `MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER` and rerun this audit.']
          : []),
        `- Flagged/pinned candidates: **${flagged.length}**`,
        `- Important candidates: **${important.length}**`,
        `- Sender rules loaded: **${senderRules.length}** (important **${senderImportantRules.length}**, junk **${senderJunkRules.length}**)`,
        `- Rule-matched emails: important **${senderRuleImportantMatches}**, junk **${senderRuleJunkMatches}**`,
        `- Unread candidates: **${unread.length}**${profileNote}`,
        `- Memory updated: remembered important senders **${memoryAfterAudit.importantSenders.length}**`,
        '',
        `- Solicitor-related emails: **${(buckets.get('solicitor') || []).length}**`,
        `- Accountant/tax emails: **${(buckets.get('accountant') || []).length}**`,
        `- Supplier/wholesale emails: **${(buckets.get('supplier') || []).length}**`,
        `- Banking/finance emails: **${(buckets.get('banking') || []).length}**`,
        `- Property/utility/council emails: **${(buckets.get('property-ops') || []).length}**`,
        `- Top important senders: **${importantTop.length > 0 ? importantTop.join(', ') : 'n/a'}**`,
        '',
        '| Category | Date | Provider | From | Subject |',
        '|---|---|---|---|---|',
        ...(keyRows.length > 0 ? keyRows : ['| n/a | n/a | n/a | n/a | No categorized messages found |']),
        '',
        ...(comprehensiveAudit.displayTop > 0
          ? [
            '| Latest Date | Provider | From | Subject |',
            '|---|---|---|---|',
            ...hits
              .slice(0, comprehensiveAudit.displayTop)
              .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
              .slice(0, Math.min(comprehensiveAudit.displayTop, 20))
              .map((m) => {
                const sender = m.fromName || m.fromAddress || 'Unknown sender'
                const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
                return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject || '(No Subject)'} |`
              }),
            '',
          ]
          : []),
        `Cleanup recommendations (junk/spam/unwanted): ${junkTop.length > 0 ? junkTop.join(', ') : 'No clear junk clusters detected.'}`,
        `- Active junk sender rules: ${senderJunkRules.length > 0 ? senderJunkRules.map((r) => r.senderPattern).slice(0, 6).join(', ') : 'none configured yet.'}`,
        '- Create rules: move newsletters/promotions to a low-priority folder.',
        '- Keep flagged/pinned and high-importance senders in focus inbox.',
        '- Run weekly cleanup for junk-likely senders and unsubscribe where safe.',
      ].join('\n')

      return {
        handled: true,
        response,
        steps,
        followUps: [
          'Show only flagged/pinned important emails',
          'Show solicitor-only timeline from 2024',
          'Show supplier cleanup and payment priorities',
          'Update sender rules for junk and important',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I completed a historical connected-mailbox audit with flagged/pinned and cleanup insights.' },
          { type: 'research', name: 'Research Agent', contribution: 'I categorized results for solicitor, accountant, suppliers, banking, and property/ops priorities.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Comprehensive mailbox audit failed before completion.',
        steps,
        error: error instanceof Error ? error.message : 'Comprehensive audit failed',
      }
    }
  }

  const mailboxAnalysis = parseMailboxAnalysisQuery(message)
  const senderFocusedAnalysis = parseSenderFocusedAnalysisQuery(message)
  if (senderFocusedAnalysis) {
    const steps = [
      'Router: classified as sender-focused mailbox analysis',
      `Email Agent: searching ${senderFocusedAnalysis.senderHints.join(', ')} from ${senderFocusedAnalysis.sinceDate.slice(0, 10)} across Gmail + Outlook`,
      'Legal Agent: extracting latest updates and follow-up urgency',
    ]
    try {
      const hits = await searchUnifiedInbox({
        fromContains: senderFocusedAnalysis.senderHints,
        text: senderFocusedAnalysis.topicHints.join(' ') || undefined,
        sinceDate: senderFocusedAnalysis.sinceDate,
        maxFetchPerProvider: 5000,
        exhaustive: true,
      })

      const sorted = [...hits].sort(
        (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )
      const strict = sorted.filter((m) => {
        const from = `${m.fromAddress || ''} ${m.fromName || ''}`.toLowerCase()
        return (
          from.includes('aliceamclellan@rc.legal') ||
          from.includes('@rc.legal') ||
          from.includes('aliceamclellan')
        )
      })
      const scoped = strict.length > 0 ? strict : sorted

      if (scoped.length === 0) {
        return {
          handled: true,
          response: [
            'No matching sender updates were found in accessible mailbox data.',
            '',
            `- Sender hints: ${senderFocusedAnalysis.senderHints.join(', ')}`,
            `- Since: ${senderFocusedAnalysis.sinceDate.slice(0, 10)}`,
            '- Action: reconnect mailbox and rerun full sender search if needed.',
          ].join('\n'),
          steps,
          followUps: [
            'Reconnect Gmail and Outlook',
            'Run comprehensive mailbox audit from 2023',
            'Draft chase email to Alicea',
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'I ran exhaustive sender-focused search and found no matches in current mailbox access.' },
          ],
        }
      }

      const latest = scoped[0]
      const latestAt = new Date(latest.receivedDateTime)
      const daysSince = Math.floor((Date.now() - latestAt.getTime()) / (24 * 60 * 60 * 1000))
      const needsFollowUp = senderFocusedAnalysis.askNeedReply || daysSince >= 7
      const reason = daysSince >= 7 ? `Latest update is ${daysSince} day(s) old.` : 'Recent update exists.'

      const rows = scoped.slice(0, 12).map((m) => {
        const date = new Date(m.receivedDateTime).toLocaleDateString('en-GB', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
        const sender = m.fromName || m.fromAddress || 'Unknown sender'
        return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject || '(No Subject)'} |`
      })

      return {
        handled: true,
        response: [
          `Sender analysis complete for **${senderFocusedAnalysis.senderHints[0]}**.`,
          '',
          `- Total matches: **${scoped.length}**`,
          `- Latest update: **${latestAt.toLocaleDateString('en-GB')}** | **${latest.subject || '(No Subject)'}**`,
          `- Need another email now: **${needsFollowUp ? 'YES' : 'NO'}**`,
          `- Reason: ${reason}`,
          needsFollowUp
            ? '- Recommended next action: send a follow-up chase email today.'
            : '- Recommended next action: monitor for 48 hours, then chase if no reply.',
          '',
          '| Date | Provider | From | Subject |',
          '|---|---|---|---|',
          ...rows,
        ].join('\n'),
        steps,
        followUps: [
          'Draft chase email to Alicea now',
          'Show only Land Registry items from Alicea',
          'Activate daily watch for Alicea + 6F Steamer Street',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I ran an exhaustive sender-focused search instead of generic inbox analysis.' },
          { type: 'legal', name: 'Legal Agent', contribution: 'I assessed whether follow-up chasing is needed now.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Sender-focused analysis failed before completion.',
        steps,
        error: error instanceof Error ? error.message : 'Sender-focused analysis failed',
      }
    }
  }

  if (mailboxAnalysis) {
    const steps = [
      'Router: classified as inbox analysis query',
      `Email Agent: collecting recent ${mailboxAnalysis.provider === 'all' ? 'Gmail + Outlook' : mailboxAnalysis.provider} emails`,
      'Research Agent: generating analysis summary and priorities',
    ]
    try {
      let hits: InboxSnapshotMessage[] = []
      if (mailboxAnalysis.provider === 'outlook') {
        const outlook = await getRecentMessages(mailboxAnalysis.top)
        hits = outlook.map((m) => ({
          id: m.id,
          provider: 'outlook',
          subject: m.subject || '(No Subject)',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: m.bodyPreview || '',
          fromName: m.from?.emailAddress?.name,
          fromAddress: m.from?.emailAddress?.address,
        }))
      } else if (mailboxAnalysis.provider === 'gmail') {
        const gmail = await getRecentGmailMessages(mailboxAnalysis.top)
        hits = gmail.map((m) => ({
          id: m.id,
          provider: 'gmail',
          subject: m.subject || '(No Subject)',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: m.bodyPreview || '',
          fromName: m.fromName,
          fromAddress: m.fromAddress,
        }))
      } else {
        const unified = await getUnifiedInbox(mailboxAnalysis.top)
        hits = unified.map((m) => ({
          id: m.id,
          provider: m.provider,
          subject: m.subject || '(No Subject)',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: m.bodyPreview || '',
          fromName: m.fromName,
          fromAddress: m.fromAddress,
        }))
      }

      if (hits.length === 0) {
        const readiness = await getMailboxReadiness()
        const noMailboxConnection = readiness.connectedCount.total === 0
        const mailboxUnreachable = readiness.connectedCount.total > 0 && readiness.reachable.total === 0
        const diagnostics = mailboxReadinessDiagnostics(readiness)
        return {
          handled: true,
          response: noMailboxConnection
            ? 'No connected Gmail/Outlook mailbox accounts found. Reconnect mailboxes in the Email panel, then run inbox analysis again.'
            : mailboxUnreachable
              ? `Mailbox accounts are saved but currently unreachable (token expired or OAuth needs reconnect). Reconnect Gmail/Outlook in the Email panel, then run inbox analysis again.${diagnostics ? ` Diagnostics: ${diagnostics}` : ''}`
              : `No recent ${mailboxAnalysis.provider === 'all' ? '' : `${mailboxAnalysis.provider} `}emails found to analyze.`,
          steps,
          followUps: [
            'Reconnect mailbox account',
            'Show latest inbox updates',
            'Analyze last 30 emails',
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'I checked and there are no recent emails available for analysis.' },
          ],
        }
      }

      const byProvider = hits.reduce(
        (acc, m) => {
          acc[m.provider] += 1
          return acc
        },
        { outlook: 0, gmail: 0 }
      )

      const urgentWords = ['urgent', 'asap', 'deadline', 'overdue', 'payment due', 'action required']
      const urgent = hits.filter((m) => {
        const hay = `${m.subject} ${m.bodyPreview || ''}`.toLowerCase()
        return urgentWords.some((w) => hay.includes(w))
      })

      const senderCount = new Map<string, number>()
      for (const m of hits) {
        const sender = m.fromName || m.fromAddress || 'Unknown sender'
        senderCount.set(sender, (senderCount.get(sender) || 0) + 1)
      }
      const topSenders = [...senderCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => `${name} (${count})`)

      const keyRows = hits
        .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
        .slice(0, 6)
        .map((m) => {
          const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          const sender = m.fromName || m.fromAddress || 'Unknown'
          return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject} |`
        })

      const response = [
        `Inbox analysis complete for **${mailboxAnalysis.provider === 'all' ? 'Gmail + Outlook' : mailboxAnalysis.provider.toUpperCase()}** (${hits.length} emails).`,
        '',
        `- Urgent candidates: **${urgent.length}**`,
        `- Top senders: **${topSenders.length > 0 ? topSenders.join(', ') : 'n/a'}**`,
        `- Provider split: Outlook **${byProvider.outlook}**, Gmail **${byProvider.gmail}**`,
        '',
        '| Date | Provider | From | Subject |',
        '|---|---|---|---|',
        ...keyRows,
      ].join('\n')

      return {
        handled: true,
        response,
        steps,
        followUps: [
          'Draft replies for urgent items',
          'Show only payment/deadline emails',
          'Analyze and route top 5 emails to agents',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I analyzed recent mailbox activity and extracted priorities.' },
          { type: 'research', name: 'Research Agent', contribution: 'I summarized trends, urgency, and sender concentration.' },
        ],
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Mailbox analysis failed'
      const providerName = mailboxAnalysis.provider === 'all' ? 'Gmail/Outlook' : mailboxAnalysis.provider
      const hint =
        msg.includes('401') || msg.toLowerCase().includes('token') || msg.includes('No connected')
          ? `Your ${providerName} connection is missing or expired. Reconnect it from Email panel.`
          : `Unable to analyze ${providerName} inbox right now.`
      return {
        handled: true,
        response: hint,
        steps,
        error: msg,
        agents: [
          { type: 'email', name: 'Email Agent', contribution: hint },
        ],
      }
    }
  }

  const mailboxQuery = parseMailboxUpdatesQuery(message)
  if (mailboxQuery) {
    const steps = [
      'Router: classified as inbox updates query',
      `Email Agent: reading ${mailboxQuery.provider === 'all' ? 'Gmail + Outlook' : mailboxQuery.provider} inbox`,
      'Planner Agent: summarizing latest messages',
    ]
    try {
      let hits: InboxSnapshotMessage[] = []
      if (mailboxQuery.provider === 'outlook') {
        const outlook = await getRecentMessages(mailboxQuery.top)
        hits = outlook.map((m) => ({
          id: m.id,
          provider: 'outlook' as const,
          subject: m.subject || '(No Subject)',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: m.bodyPreview || '',
          fromName: m.from?.emailAddress?.name,
          fromAddress: m.from?.emailAddress?.address,
        }))
      } else if (mailboxQuery.provider === 'gmail') {
        const gmail = await getRecentGmailMessages(mailboxQuery.top)
        hits = gmail.map((m) => ({
          id: m.id,
          provider: 'gmail' as const,
          subject: m.subject || '(No Subject)',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: m.bodyPreview || '',
          fromName: m.fromName,
          fromAddress: m.fromAddress,
        }))
      } else {
        const unified = await getUnifiedInbox(mailboxQuery.top)
        hits = unified.map((m) => ({
          id: m.id,
          provider: m.provider,
          subject: m.subject || '(No Subject)',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: m.bodyPreview || '',
          fromName: m.fromName,
          fromAddress: m.fromAddress,
        }))
      }

      if (hits.length === 0) {
        const readiness = await getMailboxReadiness()
        const noMailboxConnection = readiness.connectedCount.total === 0
        const mailboxUnreachable = readiness.connectedCount.total > 0 && readiness.reachable.total === 0
        const diagnostics = mailboxReadinessDiagnostics(readiness)
        return {
          handled: true,
          response: noMailboxConnection
            ? 'No connected Gmail/Outlook mailbox accounts found. Reconnect mailboxes in the Email panel, then request latest updates again.'
            : mailboxUnreachable
              ? `Mailbox accounts are saved but currently unreachable (token expired or OAuth needs reconnect). Reconnect Gmail/Outlook in the Email panel, then request latest updates again.${diagnostics ? ` Diagnostics: ${diagnostics}` : ''}`
              : `No recent ${mailboxQuery.provider === 'all' ? '' : `${mailboxQuery.provider} `}emails found.`,
          steps,
          followUps: [
            'Reconnect mailbox account',
            'Show last 20 emails',
            'Filter by sender',
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'I checked the mailbox and found no recent messages.' },
          ],
        }
      }

      const sorted = [...hits].sort(
        (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )
      const rows = sorted.slice(0, mailboxQuery.top).map((m) => {
        const sender = m.fromName || m.fromAddress || 'Unknown sender'
        const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
        return `| ${date} | ${m.provider.toUpperCase()} | ${sender} | ${m.subject} |`
      })

      return {
        handled: true,
        response: [
          `Here are your latest **${mailboxQuery.provider === 'all' ? 'Gmail + Outlook' : mailboxQuery.provider.toUpperCase()}** updates:`,
          '',
          '| Date | Provider | From | Subject |',
          '|---|---|---|---|',
          ...rows,
        ].join('\n'),
        steps,
        followUps: [
          'Summarize these updates',
          'Draft replies to the top 3 emails',
          'Analyze and route important ones to agents',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I fetched and organized your latest inbox updates.' },
        ],
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Mailbox query failed'
      const providerName = mailboxQuery.provider === 'all' ? 'Gmail/Outlook' : mailboxQuery.provider
      const hint =
        msg.includes('401') || msg.toLowerCase().includes('token')
          ? `Your ${providerName} connection expired. Reconnect it from Email panel.`
          : `Unable to read ${providerName} inbox right now.`
      return {
        handled: true,
        response: hint,
        steps,
        error: msg,
        agents: [
          { type: 'email', name: 'Email Agent', contribution: hint },
        ],
      }
    }
  }

  const caseDossierQuery = parseCaseDossierQuery(message)
  if (caseDossierQuery) {
    const steps = [
      'Router: classified as case communications dossier request',
      `Email Agent: exhaustive search from ${caseDossierQuery.sinceDate.slice(0, 10)} across connected Gmail + Outlook`,
      'Research Agent: building issue-by-issue status summary and actions',
    ]
    try {
      const hits = await searchUnifiedInbox({
        fromContains: caseDossierQuery.senders,
        sinceDate: caseDossierQuery.sinceDate,
        maxFetchPerProvider: caseDossierQuery.maxFetchPerProvider,
        exhaustive: true,
      })

      if (hits.length === 0) {
        return {
          handled: true,
          response: `I found no messages from the requested senders since ${caseDossierQuery.sinceDate.slice(0, 10)}.`,
          steps,
          followUps: [
            'Reconnect mailbox account',
            'Show latest Gmail + Outlook updates',
            'Run worker sync now',
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'I searched connected inboxes but no matching communications were found.' },
          ],
        }
      }

      const sorted = [...hits].sort(
        (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )

      const senderCoverage = caseDossierQuery.senders.map((sender) => {
        const key = normalizeDossierText(sender)
        const senderHits = sorted.filter((msg) =>
          normalizeDossierText(`${msg.fromName || ''} ${msg.fromAddress || ''}`).includes(key)
        )
        return {
          sender,
          count: senderHits.length,
          latest: senderHits[0] || null,
        }
      })
      const missingSenders = senderCoverage.filter((entry) => entry.count === 0).map((entry) => entry.sender)

      const topics = caseDossierQuery.topics.length > 0 ? caseDossierQuery.topics : ['Overall case update']
      const topicFindings = topics.map((topic) => {
        const matches = sorted.filter((msg) => {
          const score = scoreTopicAgainstMessage(topic, msg)
          const keywords = extractDossierKeywords(topic)
          const required = Math.min(2, Math.max(1, keywords.length))
          return score >= required
        })
        const latest = matches[0] || null
        const status = inferCaseStatus(matches)
        const latestText = latest
          ? (latest.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 180)
          : 'No direct matching email text found for this issue yet.'
        const phone = latest ? extractPhoneCandidate(`${latest.subject || ''} ${latest.bodyPreview || ''}`) : null
        return {
          topic,
          matches,
          latest,
          status,
          latestText,
          phone,
        }
      })

      const earliest = sorted[sorted.length - 1]
      const memory = await upsertMasterProfileMemory({
        importantSenders: uniqueStrings(caseDossierQuery.senders),
        notes: [
          `Case dossier query: ${caseDossierQuery.senders.join(', ')} | since ${caseDossierQuery.sinceDate.slice(0, 10)} | matches ${sorted.length}`,
        ],
      })

      const summaryRows = topicFindings.map((finding) => {
        const latestDate = finding.latest
          ? new Date(finding.latest.receivedDateTime).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          : 'n/a'
        const latestSubject = finding.latest?.subject || 'No direct match yet'
        return `| ${finding.topic} | ${statusLabel(finding.status)} | ${latestDate} | ${latestSubject} |`
      })

      const detailedSections: string[] = []
      topicFindings.forEach((finding, idx) => {
        detailedSections.push(`${idx + 1}. ${finding.topic}`)
        detailedSections.push(`- Status: ${statusLabel(finding.status)}.`)
        detailedSections.push(`- Latest update: ${finding.latestText}`)
        if (finding.phone) {
          detailedSections.push(`- Contact found in recent thread: ${finding.phone}`)
        }
        const recentRows = finding.matches.slice(0, 3).map((msg) => {
          const sender = msg.fromName || msg.fromAddress || 'Unknown sender'
          const date = new Date(msg.receivedDateTime).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          return `- ${date} | ${msg.provider.toUpperCase()} | ${sender} | ${msg.subject || '(No Subject)'}`
        })
        if (recentRows.length > 0) {
          detailedSections.push(...recentRows)
        } else {
          detailedSections.push('- No directly matched emails for this issue in current results.')
        }
        detailedSections.push('')
      })

      const nextSteps = topicFindings.map((finding) => recommendationForStatus(finding.status, finding.topic))

      return {
        handled: true,
        response: [
          `I searched connected Gmail + Outlook inboxes from **${caseDossierQuery.sinceDate.slice(0, 10)}** onward for communications from **${caseDossierQuery.senders.join(', ')}**.`,
          '',
          `- Messages scanned: **${sorted.length}**`,
          `- Coverage window: **${new Date(earliest.receivedDateTime).toLocaleDateString('en-US')} to ${new Date(sorted[0].receivedDateTime).toLocaleDateString('en-US')}**`,
          `- Sender memory updated: **${memory.importantSenders.length}** important senders remembered`,
          ...(missingSenders.length > 0 ? [`- No direct emails found from: **${missingSenders.join(', ')}**`] : []),
          '',
          '### Summary of Email Findings',
          '| Issue | Status | Latest Date | Latest Update |',
          '|---|---|---|---|',
          ...summaryRows,
          '',
          '### Detailed Findings',
          ...detailedSections,
          '### Next Steps Recommendation',
          ...nextSteps.map((step) => `- ${step}`),
        ].join('\n'),
        steps,
        followUps: [
          'Draft follow-up email for action-required issues',
          'Show central timeline from day 1',
          'Save missing-sender follow-up task list',
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I searched real connected mailbox data for all requested contacts and issues.' },
          { type: 'research', name: 'Research Agent', contribution: 'I summarized issue status, latest updates, and concrete next actions.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Case communications search failed before completion.',
        steps,
        error: error instanceof Error ? error.message : 'Case dossier query failed',
      }
    }
  }

  const updates = parseUpdatesQuery(message) || parsePersonProgressQuery(message)
  if (updates) {
    const steps = [
      'Router: classified as timeline lookup',
      'Email Agent: searching connected Gmail + Outlook inboxes',
      'Planner Agent: building timeline and suggested follow-ups',
    ]
    try {
      const topic = updates.topic?.trim()
      const hits = await searchUnifiedInbox({
        fromContains: [updates.person],
        ...(topic ? { text: topic } : {}),
        sinceHours: 24 * 365 * 3,
        top: 100,
      })

      if (hits.length === 0) {
        return {
          handled: true,
          response: topic
            ? `No recent emails found from ${updates.person} about "${topic}".`
            : `No recent emails found from ${updates.person}.`,
          steps,
          followUps: [
            `Show all emails from ${updates.person} in the last 6 months`,
            topic
              ? `Draft a follow-up email to ${updates.person} asking for update on ${topic}`
              : `Draft a follow-up email to ${updates.person} asking for latest updates`,
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'I searched your connected Gmail/Outlook inboxes and found no matching messages.' },
          ],
        }
      }

      const sorted = [...hits].sort(
        (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )
      const latest = sorted[0]
      const topRows = sorted.slice(0, 5).map((m) => {
        const date = new Date(m.receivedDateTime).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
        return `${date} | ${m.provider.toUpperCase()} | ${m.subject || '(No Subject)'} | ${(m.bodyPreview || '').slice(0, 110)}`
      })

      const response = [
        topic
          ? `Most recent update from ${updates.person} about ${topic} was on ${new Date(latest.receivedDateTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`
          : `Latest update from ${updates.person} was on ${new Date(latest.receivedDateTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
        '',
        ...topRows.map((r, i) => `${i + 1}. ${r}`),
      ].join('\n')

      return {
        handled: true,
        response,
        steps,
        followUps: [
          topic
            ? `Summarize all communications with ${updates.person} regarding ${topic}`
            : `Summarize all communications with ${updates.person}`,
          topic
            ? `Draft an email to ${updates.person} asking for latest progress on ${topic}`
            : `Draft an email to ${updates.person} asking what has been completed so far`,
          `Show me all emails from ${updates.person} in the last 6 months`,
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: 'I searched Gmail + Outlook messages and extracted the latest matching timeline.' },
          { type: 'research', name: 'Planner Agent', contribution: 'I generated follow-up actions based on the message timeline.' },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Inbox search failed. Please connect Gmail and/or Outlook first and verify OAuth settings.',
        steps,
        error: error instanceof Error ? error.message : 'Task engine failed',
      }
    }
  }

  const forward = parseForwardQuery(message)
  if (forward) {
    const steps = [
      'Router: classified as auto-forward task',
      'Email Agent: searching Gmail + Outlook messages by sender + timeframe',
      'Email Agent: forwarding matched messages to target recipient',
    ]
    try {
      const hits = await searchUnifiedInbox({
        fromContains: forward.senders,
        sinceHours: forward.hours,
        top: 100,
      })
      if (hits.length === 0) {
        return {
          handled: true,
          response: `No emails found in last ${forward.hours}h from: ${forward.senders.join(', ')}.`,
          steps,
          followUps: [
            `Try the same forward task for last 72h`,
            `Show matching emails without forwarding`,
          ],
          agents: [
            { type: 'email', name: 'Email Agent', contribution: 'No matching messages were found for this forward rule.' },
          ],
        }
      }

      const outlookIds = hits.filter((h) => h.provider === 'outlook').map((h) => h.id)
      const gmailIds = hits.filter((h) => h.provider === 'gmail').map((h) => h.id)
      let forwarded = 0
      if (outlookIds.length > 0) {
        forwarded += await forwardMessages({
          messageIds: outlookIds,
          to: forward.to,
          comment: `Auto-forwarded (${forward.hours}h window) for senders: ${forward.senders.join(', ')}`,
        })
      }
      if (gmailIds.length > 0) {
        forwarded += await forwardGmailMessages({
          messageIds: gmailIds,
          to: forward.to,
          comment: `Auto-forwarded (${forward.hours}h window) for senders: ${forward.senders.join(', ')}`,
        })
      }

      return {
        handled: true,
        response: `Forwarded **${forwarded}** emails from **${forward.senders.join(', ')}** to **${forward.to}** (last ${forward.hours}h).`,
        steps,
        followUps: [
          `Show me the forwarded email subjects`,
          `Set up this as a recurring daily forwarding rule`,
        ],
        agents: [
          { type: 'email', name: 'Email Agent', contribution: `I completed auto-forwarding of ${forwarded} emails.` },
        ],
      }
    } catch (error) {
      return {
        handled: true,
        response: 'Auto-forward failed. Connect Gmail/Outlook and verify token scopes (read/write/send).',
        steps,
        error: error instanceof Error ? error.message : 'Task engine failed',
      }
    }
  }

  return { handled: false }
}

export async function POST(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const { message, model, conversationHistory } = await req.json()

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Keep automation state fresh continuously while users chat.
    void runAgentAutomationCycle().catch((error) => {
      console.error('Automation worker refresh failed:', error)
    })

    const requestedProvider = detectProvider(model)
    const debug: string[] = []
    let followUps: string[] = []

    // ─── Task engine handles structured commands (mailbox search, forward, etc.) ───
    const task = await runTaskEngine(message)
    if (task.handled) {
      return NextResponse.json({
        response: task.response,
        agents: task.agents || [],
        steps: task.steps || [],
        followUps: task.followUps || [],
        error: task.error,
      })
    }

    // ─── REAL SPECIALIST BRAIN ACTIVATION ───
    // Detect which brain domain handles this message
    const brainDomain = detectBrainDomain(message)
    debug.push(`Brain domain detected: ${brainDomain}`)

    // Activate the specialist brain — loads real email memory + entity states
    let brain: Awaited<ReturnType<typeof activateBrain>> | null = null
    try {
      brain = await activateBrain(message, brainDomain)
      debug.push(`${brain.agentLabel} activated: loaded real email context and entity states`)
    } catch (brainErr: any) {
      debug.push(`Brain activation error: ${brainErr?.message || brainErr}`)
    }

    // Build messages with REAL brain context injected
    const messages = [
      // Use specialist brain system prompt if available, otherwise fallback
      ...(brain ? brain.contextMessages : [{ role: 'system' as const, content: systemPrompt }]),
      // Include conversation history
      ...(conversationHistory || []).map((msg: { role: string; content: string }) => ({
        role: msg.role === 'agent' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      // User's current message
      { role: 'user', content: message },
    ]

    const allowEmergencyCloud =
      CHAT_PROVIDER_POLICY.allowCloudFallbackOnUrgent && isUrgentOrImportant(message)
    let effectiveProvider: ChatProvider = 'ollama'

    if (requestedProvider !== 'ollama') {
      debug.push(`Chat policy lock active: requested ${requestedProvider}, forcing ollama`)
    }
    if (allowEmergencyCloud) {
      debug.push('Urgent/important request detected: emergency cloud fallback is allowed only if ollama fails')
    }

    const tryCall = async (prov: ChatProvider) => {
      switch (prov) {
        case 'openai':
          return callOpenAI(messages)
        case 'gemini':
          return callGemini(messages)
        case 'qwen':
          return callQwen(messages)
        case 'grok':
          return callGrok(messages)
        case 'glm':
          return callGLM(messages)
        case 'deepseek':
          return callDeepSeek(messages)
        case 'mistral':
          return callMistral(messages)
        case 'minimax':
          return callMinimax(messages)
        case 'openrouter':
          return callOpenRouter(messages)
        case 'huggingface':
          return callHuggingFace(messages)
        case 'ollama':
        default:
          return callOllama(messages)
      }
    }

    let response = ''
    let errorMsg = ''
    try {
      response = await tryCall(effectiveProvider)
    } catch (err: any) {
      errorMsg = err?.message || String(err)
      debug.push(`Ollama error: ${errorMsg}`)

      if (allowEmergencyCloud) {
        const emergencyProvider = getEmergencyCloudProvider(requestedProvider)
        if (emergencyProvider) {
          try {
            effectiveProvider = emergencyProvider
            response = await tryCall(emergencyProvider)
            debug.push(`Emergency fallback executed with ${emergencyProvider}`)
            errorMsg = ''
          } catch (fallbackErr: any) {
            debug.push(`Emergency fallback error (${emergencyProvider}): ${fallbackErr?.message || fallbackErr}`)
            errorMsg = fallbackErr?.message || String(fallbackErr)
          }
        } else {
          debug.push('No emergency cloud provider configured/ready; staying local-only')
        }
      } else {
        debug.push('Cloud fallback disabled for non-urgent requests (ollama-only policy)')
      }
    }

    if (errorMsg && !response && allowEmergencyCloud && effectiveProvider !== 'ollama') {
      try {
        effectiveProvider = 'ollama'
        response = await tryCall('ollama')
        debug.push('Recovered by retrying ollama')
        errorMsg = ''
      } catch (fallbackErr: any) {
        debug.push(`Ollama retry error: ${fallbackErr?.message || fallbackErr}`)
        errorMsg = fallbackErr?.message || String(fallbackErr)
      }
    }

    if (errorMsg && !response && CHAT_PROVIDER_POLICY.ollamaPrimary && !allowEmergencyCloud) {
      debug.push('Final state: no response generated under ollama-only policy')
    }

    // ─── REAL agent metadata from specialist brain ───
    const agents: { type: string; name: string; contribution: string }[] = []
    if (brain) {
      agents.push({
        type: brainDomain === 'accountant' ? 'financial' : brainDomain,
        name: brain.agentLabel,
        contribution: brain.agentContribution,
      })
    } else {
      // Fallback if brain activation failed
      const domain = detectIntentDomain(message)
      if (domain === 'legal') {
        agents.push({ type: 'legal', name: 'Legal Agent', contribution: 'Recognized as legal request.' })
      } else if (domain === 'financial') {
        agents.push({ type: 'financial', name: 'Financial Agent', contribution: 'Recognized as financial request.' })
      } else if (domain === 'supplier') {
        agents.push({ type: 'supplier', name: 'Supplier Agent', contribution: 'Recognized as supplier request.' })
      } else if (domain === 'email') {
        agents.push({ type: 'email', name: 'Email Agent', contribution: 'Recognized as email request.' })
      } else {
        agents.push({ type: 'research', name: 'Research Agent', contribution: 'Coordinating across all domains.' })
      }
    }

    const steps = [
      `Provider policy: ollama-primary (${CHAT_PROVIDER_POLICY.allowCloudFallbackOnUrgent ? 'urgent cloud fallback enabled' : 'no cloud fallback'})`,
      `Brain: ${brain ? brain.agentLabel + ' (REAL context loaded)' : 'fallback mode'}`,
      `Provider selected by UI: ${requestedProvider} (using ${effectiveProvider})`,
      ...debug,
    ]

    // Never throw to avoid 500 on the client; surface errors inline
    if (errorMsg && !response) {
      response = `Sorry, the chat backend failed: ${errorMsg}. Steps: ${steps.join(' | ')}`
    }

    // Domain-specific follow-up suggestions
    if (followUps.length === 0) {
      if (brainDomain === 'solicitor') {
        followUps = [
          'What is the status of 6F Steamer Street?',
          'Show all legal cases and their next actions',
          'Any urgent legal deadlines?',
        ]
      } else if (brainDomain === 'accountant') {
        followUps = [
          'What HMRC deadlines are coming up?',
          'Show all tax and accounting issues',
          'Any outstanding invoices or payments?',
        ]
      } else if (brainDomain === 'supplier') {
        followUps = [
          'Show all supplier issues and orders',
          'Any delivery problems or disputes?',
          'Compare latest supplier deals',
        ]
      } else if (brainDomain === 'business') {
        followUps = [
          'Show banking and insurance updates',
          'Any utility bills or payments due?',
          'Business operations status',
        ]
      } else {
        followUps = [
          'Give me a full status update across all domains',
          'What should I focus on today?',
          'Any urgent issues needing attention?',
        ]
      }
    }

    return NextResponse.json({ response, agents, steps, followUps, error: errorMsg || undefined })
  } catch (error) {
    console.error('Chat API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process message' },
      { status: 500 }
    )
  }
}
