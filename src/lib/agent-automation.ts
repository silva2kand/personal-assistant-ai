import { db } from '@/lib/db'
import { getRecentGmailMessages } from '@/lib/gmail-api'
import { searchGmailMessages } from '@/lib/gmail-api'
import { getRecentMessages } from '@/lib/outlook-graph'
import { searchMessages } from '@/lib/outlook-graph'
import { refreshCoreBrainMemory } from '@/lib/core-brain'
import { enqueueNotification } from '@/lib/notification-center'
import { dispatchWhatsAppMessage } from '@/lib/whatsapp-bridge'
import { ingestImportantEmailsToVault } from '@/lib/email-vault-ingest'
import { runOcrForPendingVaultDocuments } from '@/lib/document-ocr'

type Provider = 'gmail' | 'outlook'
type Domain = 'solicitor' | 'accountant' | 'supplier' | 'business' | 'research' | 'general'
type SessionAgent = 'legal' | 'financial' | 'supplier' | 'email' | 'research'

type NormalizedMessage = {
  provider: Provider
  providerMessageId: string
  threadKey?: string
  fromAddress: string
  toAddress: string
  subject: string
  body: string
  date: Date
  labels: string[]
}

type ClassificationResult = {
  domain: Domain
  entity_key: string
}

type ReducerState = {
  status: string
  last_email_date: string
  waiting_on: string
  facts: Record<string, unknown>
  next_actions: string[]
}

type QueueEvent = {
  summary: string
  date: string
  from: string
  subject: string
}

const LOOP_MS = Math.max(Number(process.env.AGENT_LOOP_MS || 2 * 60 * 1000), 15_000)
const STARTUP_DELAY_MS = 10 * 1000
const INGEST_TOP = Math.min(Math.max(Number(process.env.AGENT_INGEST_TOP || 120), 25), 500)
const CLASSIFY_BATCH_PER_CYCLE = Math.min(Math.max(Number(process.env.AGENT_CLASSIFY_BATCH || 120), 20), 300)
const PROVIDER_FETCH_TIMEOUT_MS = 12_000
const HISTORICAL_BACKFILL_DEFAULT_SINCE_DATE = process.env.HISTORICAL_BACKFILL_SINCE_DATE || '2023-01-01T00:00:00.000Z'
const HISTORICAL_BACKFILL_MAX_PER_PROVIDER = Math.max(Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 1000)
const CONTINUOUS_DEEP_FEED_INTERVAL_MS = Math.max(
  Number(process.env.CONTINUOUS_DEEP_FEED_INTERVAL_MS || 30 * 60 * 1000),
  5 * 60 * 1000
)
const CONTINUOUS_DEEP_FEED_MAX_FETCH_PER_PROVIDER = Math.min(
  Math.max(Number(process.env.CONTINUOUS_DEEP_FEED_MAX_FETCH_PER_PROVIDER || 1200), 200),
  HISTORICAL_BACKFILL_MAX_PER_PROVIDER
)

const globalWorker = globalThis as unknown as {
  agentWorkerStarted?: boolean
  agentWorkerRunning?: boolean
  agentWorkerTimer?: NodeJS.Timeout
  agentWorkerLastCycleAt?: string
  agentWorkerLastCycleDurationMs?: number
  agentWorkerLastCycleStats?: {
    ingested: number
    processedEvents: number
    updatedEntities: number
  }
  agentWorkerLastLogLine?: string
  deepFeedTimer?: NodeJS.Timeout
  deepFeedLastStartedAt?: string
  deepFeedLastCompletedAt?: string
  deepFeedLastError?: string
  deepFeedLastLogLine?: string
  historicalBackfillRunning?: boolean
  historicalBackfillLastStartedAt?: string
  historicalBackfillLastCompletedAt?: string
  historicalBackfillLastSinceDate?: string
  historicalBackfillLastError?: string
  historicalBackfillStats?: {
    scanned: number
    ingested: number
    processedEvents: number
    updatedEntities: number
  }
  historicalBackfillLastLogLine?: string
  notificationDedupe?: Record<string, number>
}

function safeJsonParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function mapDomainToSessionAgent(domain: Domain): SessionAgent {
  switch (domain) {
    case 'solicitor':
      return 'legal'
    case 'accountant':
      return 'financial'
    case 'supplier':
      return 'supplier'
    case 'business':
      return 'research'
    case 'research':
      return 'research'
    case 'general':
    default:
      return 'email'
  }
}

function sanitizeDomain(value: string): Domain {
  const normalized = (value || '').toLowerCase().trim()
  if (normalized === 'solicitor') return 'solicitor'
  if (normalized === 'accountant') return 'accountant'
  if (normalized === 'supplier') return 'supplier'
  if (normalized === 'business') return 'business'
  if (normalized === 'research') return 'research'
  return 'general'
}

function shouldEmitNotification(key: string, cooldownMs: number): boolean {
  const now = Date.now()
  if (!globalWorker.notificationDedupe) globalWorker.notificationDedupe = {}
  const previous = globalWorker.notificationDedupe[key] || 0
  if (previous > 0 && now - previous < cooldownMs) return false
  globalWorker.notificationDedupe[key] = now
  return true
}

function domainLabel(domain: Domain): string {
  if (domain === 'solicitor') return 'Legal'
  if (domain === 'accountant') return 'Financial'
  if (domain === 'supplier') return 'Supplier'
  if (domain === 'business') return 'Business'
  if (domain === 'research') return 'Research'
  return 'Email'
}

function notificationPriorityFor(domain: Domain, status: string): 'high' | 'medium' | 'low' {
  if (status === 'blocked') return 'high'
  if (status === 'waiting') return domain === 'solicitor' || domain === 'accountant' ? 'high' : 'medium'
  return domain === 'solicitor' || domain === 'accountant' ? 'medium' : 'low'
}

async function emitEntityNotification(input: {
  domain: Domain
  status: string
  entityKey: string
  latestFrom: string
  latestSubject: string
  nextAction: string
}) {
  const dedupeKey = `entity:${input.domain}:${input.entityKey}:${input.status}`
  if (!shouldEmitNotification(dedupeKey, 30 * 60 * 1000)) return

  const priority = notificationPriorityFor(input.domain, input.status)
  const title = `${domainLabel(input.domain)} update: ${input.entityKey}`
  const statusLine =
    input.status === 'blocked'
      ? 'Blocked issue detected.'
      : input.status === 'waiting'
      ? 'Waiting on external response.'
      : 'New update processed.'
  const body = `${statusLine} Latest: ${input.latestSubject || '(No Subject)'} from ${input.latestFrom}. Next: ${input.nextAction}`

  await enqueueNotification({
    title,
    body,
    priority,
    channel: 'desktop',
    source: 'agent-worker',
    meta: {
      domain: input.domain,
      status: input.status,
      entityKey: input.entityKey,
    },
  })

  const alertTo = (process.env.WHATSAPP_ALERT_TO || '').trim()
  if (alertTo && priority === 'high') {
    await dispatchWhatsAppMessage({
      to: alertTo,
      message: `${title}\n${body}`,
      source: 'agent-worker',
      priority: 'high',
    }).catch(() => {
      // Keep worker resilient if WhatsApp delivery fails.
    })
  }
}

async function emitLeaseReminderNotifications(reminders: Array<{ title: string; detail: string; dueDate?: string; priority: 'high' | 'medium' | 'low' }>) {
  for (const reminder of reminders.slice(0, 3)) {
    const dueKey = reminder.dueDate ? new Date(reminder.dueDate).toISOString().slice(0, 10) : 'none'
    const key = `lease:${reminder.title}:${dueKey}`
    if (!shouldEmitNotification(key, 12 * 60 * 60 * 1000)) continue
    await enqueueNotification({
      title: reminder.title,
      body: reminder.detail,
      priority: reminder.priority,
      channel: 'desktop',
      source: 'core-brain',
      meta: {
        dueDate: reminder.dueDate || null,
        type: 'lease-reminder',
      },
    })
    const alertTo = (process.env.WHATSAPP_ALERT_TO || '').trim()
    if (alertTo && reminder.priority === 'high') {
      await dispatchWhatsAppMessage({
        to: alertTo,
        message: `${reminder.title}\n${reminder.detail}`,
        source: 'core-brain',
        priority: 'high',
      }).catch(() => {
        // Keep worker resilient if WhatsApp delivery fails.
      })
    }
  }
}

async function emitVaultExpiryNotifications(): Promise<void> {
  const docs = await db.vaultDocument.findMany({
    where: {
      status: 'active',
      expiresAt: { not: null },
    },
    select: {
      id: true,
      title: true,
      category: true,
      expiresAt: true,
    },
    take: 400,
    orderBy: { expiresAt: 'asc' },
  })

  const now = Date.now()
  for (const doc of docs) {
    if (!doc.expiresAt) continue
    const days = Math.floor((doc.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))
    if (days > 60) continue
    const priority: 'high' | 'medium' | 'low' = days <= 14 ? 'high' : days <= 30 ? 'medium' : 'low'
    const state = days < 0 ? `expired ${Math.abs(days)} day(s) ago` : `expires in ${days} day(s)`
    const dedupeKey = `vault-expiry:${doc.id}:${doc.expiresAt.toISOString().slice(0, 10)}`
    if (!shouldEmitNotification(dedupeKey, 12 * 60 * 60 * 1000)) continue

    const title = `Document expiry alert: ${doc.title}`
    const body = `${state}. Category: ${doc.category}.`
    await enqueueNotification({
      title,
      body,
      priority,
      channel: 'desktop',
      source: 'document-vault',
      meta: {
        documentId: doc.id,
        expiresAt: doc.expiresAt.toISOString(),
      },
    })

    const alertTo = (process.env.WHATSAPP_ALERT_TO || '').trim()
    if (alertTo && priority === 'high') {
      await dispatchWhatsAppMessage({
        to: alertTo,
        message: `${title}\n${body}`,
        source: 'document-vault',
        priority: 'high',
      }).catch(() => {
        // Keep worker resilient if WhatsApp delivery fails.
      })
    }
  }
}

async function runVaultOcrBackground(): Promise<void> {
  const out = await runOcrForPendingVaultDocuments(6)
  if (out.scanned === 0) return

  if (out.extracted > 0) {
    await enqueueNotification({
      title: 'Document OCR complete',
      body: `Extracted text from ${out.extracted} document(s) via ${out.provider}.`,
      priority: 'low',
      channel: 'desktop',
      source: 'document-ocr',
      meta: out as unknown as Record<string, unknown>,
    })
  }

  if (out.failed > 0) {
    await enqueueNotification({
      title: 'Document OCR issues',
      body: `${out.failed} document(s) failed OCR via ${out.provider}.`,
      priority: 'medium',
      channel: 'desktop',
      source: 'document-ocr',
      meta: out as unknown as Record<string, unknown>,
    })
  }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function normalizeCompareText(input: string): string {
  return input
    .toLowerCase()
    .replace(/\bflat\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toTitleWords(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function normalizePropertyAddress(input: string): string {
  return normalizeCompareText(input)
}

function extractPropertyAddress(text: string): string | null {
  const match = text.match(
    /\b(\d+[A-Za-z]?(?:\/\d+)?\s+[A-Za-z][A-Za-z0-9\s,-]{2,80}\s(?:street|st|road|rd|avenue|ave|lane|ln|close|drive|way))\b/i
  )
  return match?.[1]?.trim() || null
}

function taxYearForDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  if (m >= 4) return `${y}-${y + 1}`
  return `${y - 1}-${y}`
}

function extractSenderDomain(fromAddress: string): string {
  const raw = (fromAddress || '').split('@')[1]?.toLowerCase().trim() || ''
  if (!raw) return ''
  const host = raw.split('>')[0].split(' ')[0]
  const labels = host.split('.').filter(Boolean)
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  const secondLast = labels[labels.length - 2]
  const last = labels[labels.length - 1]
  if (['co', 'com', 'org', 'net', 'gov', 'ac'].includes(secondLast) && labels.length >= 3) {
    return labels[labels.length - 3]
  }
  if (last.length <= 3) return secondLast
  return secondLast
}

function levenshtein(a: string, b: string): number {
  const x = a.length
  const y = b.length
  const dp = Array.from({ length: x + 1 }, () => new Array<number>(y + 1).fill(0))
  for (let i = 0; i <= x; i += 1) dp[i][0] = i
  for (let j = 0; j <= y; j += 1) dp[0][j] = j
  for (let i = 1; i <= x; i += 1) {
    for (let j = 1; j <= y; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[x][y]
}

function detectBusinessOverride(msg: NormalizedMessage): {
  suggestedDomain?: Domain
  suggestedEntityKey?: string
  marketingLikely: boolean
  strongBusinessSignal: boolean
} {
  const from = (msg.fromAddress || '').toLowerCase()
  const subject = (msg.subject || '').toLowerCase()
  const body = (msg.body || '').toLowerCase()
  const text = `${subject} ${body} ${from}`
  const senderBase = extractSenderDomain(msg.fromAddress)
  const knownSupplierSenders = new Set([
    'paypoint',
    'worldpay',
    'takepayments',
    'parfetts',
    'booker',
    'bestway',
    'dhl',
    'ups',
    'fedex',
    'amazon',
    'amazonbusiness',
  ])

  const marketingLikely =
    /\b(newsletter|digest|promo|promotion|offer|deals?|sale|discount|jackpot|coming soon|specials?|subscribe|webinar)\b/.test(
      text
    ) ||
    /\b(noreply|no-reply|mailer|mailchimp|beehiiv|substack)\b/.test(from)

  const securitySignals =
    /\b(account-security|account protection|new app\(s\) connected|security alert|sign-in alert|verify account|password reset)\b/.test(
      text
    ) || /\baccountprotection\.microsoft\b/.test(from)

  const accountingSignals =
    /\b(hmrc|self[ -]?assessment|vat|corporation tax|tax return|payroll|accounting|reconciliation|remittance|settlement notice|bank statement|statement of account|bookkeeping|balance sheet|paye|rti)\b/.test(
      text
    )
  const supplierSignals =
    /\b(purchase order|po\s?#?\d+|delivery|dispatch|shipment|supplier|procurement|stock|backorder|lead time|order number|invoice|wholesale)\b/.test(
      text
    )
  const legalSignals =
    /\b(solicitor|conveyancing|land registry|title register|title deed|deed|leasehold|freehold|completion|exchange of contracts|legal notice|tenancy|tenant|landlord|dispute|claim|pre-action|without prejudice)\b/.test(
      text
    )
  const refundSignals =
    /\b(refund|chargeback|dispute|compensation|claim|bpaution|bpaution\.co\.uk|money back)\b/.test(text)
  const telecomSignals =
    /\b(mobile|mobile phone|sim|broadband|landline|phone line|telecom|contract renewal|early termination)\b/.test(text)
  const insuranceSignals =
    /\b(insurance|car insurance|motor insurance|policy|premium|claim number|renewal notice)\b/.test(text)
  const leaseSignals =
    /\b(lease|lease renewal|rent review|service charge|ground rent|break clause|landlord consent)\b/.test(text)
  const legalSenderSignal =
    /\b(rc\.legal|solicitor|law|legal|conveyancing|landregistry|land-registry)\b/.test(from)
  const businessSignals =
    /\b(bank|banking|mortgage|loan|insurance|utility|utilities|electricity|gas|broadband|mobile|council tax|business rates|companies house|statement|rent|lease payment|landline|contract)\b/.test(
      text
    )

  const propertyAddress = extractPropertyAddress(`${msg.subject} ${msg.body}`)
  const supplierVendorSignal = senderBase ? knownSupplierSenders.has(senderBase) : false
  const strongBusinessSignal =
    accountingSignals ||
    supplierSignals ||
    legalSignals ||
    refundSignals ||
    telecomSignals ||
    insuranceSignals ||
    leaseSignals ||
    !!propertyAddress ||
    supplierVendorSignal

  if (securitySignals) {
    return {
      suggestedDomain: 'general',
      suggestedEntityKey: 'Microsoft Account',
      marketingLikely,
      strongBusinessSignal: false,
    }
  }

  if (accountingSignals) {
    if (/\b(hmrc|self[ -]?assessment|vat|corporation tax|tax return)\b/.test(text)) {
      return {
        suggestedDomain: 'accountant',
        suggestedEntityKey: `HMRC ${taxYearForDate(msg.date)}`,
        marketingLikely,
        strongBusinessSignal: true,
      }
    }
    return {
      suggestedDomain: 'accountant',
      suggestedEntityKey: senderBase ? toTitleWords(senderBase) : 'Accounting',
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  if (refundSignals) {
    return {
      suggestedDomain: legalSignals ? 'solicitor' : 'business',
      suggestedEntityKey: text.includes('bpaution') ? 'Bpaution Refund Case' : senderBase ? toTitleWords(senderBase) : 'Refund Dispute',
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  if (supplierSignals) {
    return {
      suggestedDomain: 'supplier',
      suggestedEntityKey: senderBase ? toTitleWords(senderBase) : 'Supplier',
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  if (supplierVendorSignal && senderBase) {
    return {
      suggestedDomain: 'supplier',
      suggestedEntityKey: toTitleWords(senderBase),
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  if (propertyAddress && !legalSignals && !leaseSignals && !legalSenderSignal) {
    return {
      suggestedDomain: 'business',
      suggestedEntityKey: propertyAddress,
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  if (legalSignals || leaseSignals || (propertyAddress && legalSenderSignal)) {
    return {
      suggestedDomain: 'solicitor',
      suggestedEntityKey: propertyAddress || (senderBase ? toTitleWords(senderBase) : 'Legal Matter'),
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  if (businessSignals) {
    return {
      suggestedDomain: 'business',
      suggestedEntityKey: senderBase ? toTitleWords(senderBase) : 'Business Operations',
      marketingLikely,
      strongBusinessSignal: true,
    }
  }

  return {
    marketingLikely,
    strongBusinessSignal,
  }
}

function normalizeEntityKey(domain: Domain, rawEntityKey: string, msg: NormalizedMessage): string {
  const raw = (rawEntityKey || '').trim()
  const text = `${msg.subject} ${msg.body} ${msg.fromAddress}`

  if (/\b(hmrc|self[\s-]?assessment|vat|corporation tax|tax return)\b/i.test(text) || domain === 'accountant') {
    if (/\b(hmrc|self[\s-]?assessment|vat|corporation tax|tax return)\b/i.test(text)) {
      return `HMRC ${taxYearForDate(msg.date)}`
    }
  }

  if (domain === 'supplier') {
    const senderBase = extractSenderDomain(msg.fromAddress)
    if (senderBase) return toTitleWords(senderBase)
  }

  const propertyHint = /\b(street|st|road|rd|avenue|ave|lane|ln|close|drive|way|barrow-in-furness|property|leasehold|land registry)\b/i.test(
    `${raw} ${text}`
  )
  if (domain === 'business') {
    const senderBase = extractSenderDomain(msg.fromAddress)
    if (propertyHint) {
      const normalized = normalizePropertyAddress(raw || `${msg.subject} ${msg.body}`)
      if (normalized) return normalized
    }
    if (senderBase) return toTitleWords(senderBase)
  }

  if (domain === 'solicitor' && propertyHint) {
    const normalized = normalizePropertyAddress(raw || `${msg.subject} ${msg.body}`)
    if (normalized) return normalized
  }

  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (!cleaned) {
    const senderBase = extractSenderDomain(msg.fromAddress)
    return senderBase ? toTitleWords(senderBase) : 'Newton Store'
  }

  if (domain === 'general') {
    if (/^newton store$/i.test(cleaned)) {
      const senderBase = extractSenderDomain(msg.fromAddress)
      return senderBase ? toTitleWords(senderBase) : 'Newton Store'
    }
    return cleaned || 'Newton Store'
  }

  return cleaned
}

async function callLocalJson<T>(prompt: string, fallback: T): Promise<T> {
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const preferred = [
    process.env.OLLAMA_ROUTER_MODEL,
    process.env.OLLAMA_MODEL,
    'llama3.1',
    'llama3',
    'qwen2.5:latest',
  ].filter((v): v is string => !!v)

  const seen = new Set<string>()
  for (const model of preferred) {
    if (seen.has(model)) continue
    seen.add(model)

    try {
      const response = await withTimeout(
        fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            format: 'json',
            options: {
              temperature: 0,
            },
            messages: [
              {
                role: 'system',
                content: 'Return strict JSON only. No markdown, no commentary, no code fences.',
              },
              { role: 'user', content: prompt },
            ],
          }),
          cache: 'no-store',
        }),
        15_000,
        `Local model ${model}`
      )

      if (!response.ok) continue
      const data = await response.json()
      const raw = data?.message?.content || data?.response || ''
      const jsonChunk = extractJsonObject(String(raw))
      if (!jsonChunk) continue
      return JSON.parse(jsonChunk) as T
    } catch {
      // Continue to fallback model candidates.
    }
  }

  return fallback
}

async function classifyEmailWithModel(email: NormalizedMessage): Promise<ClassificationResult> {
  const fallback: ClassificationResult = {
    domain: 'general',
    entity_key: 'Newton Store',
  }

  const prompt = [
    'You are a strict router for a personal operations OS.',
    'You must pick only one domain:',
    '- solicitor: active legal/casework topics (solicitor, conveyancing, completion, title, deed, leasehold dispute, tribunal, court, legal letter).',
    '- accountant: HMRC/tax/VAT/payroll/accounts/invoice reconciliation/settlement statements.',
    '- supplier: operational supplier matters (orders, deliveries, stock, procurement, supplier invoice/payment operations).',
    '- business: business operations not covered above (banks, insurance, utility bills, council tax, telecom/broadband/mobile, companies house).',
    '- research: explicit research/analysis task requested by the user or internal research memo.',
    '- general: all newsletters, promotions, security alerts, social updates, reminders, events, marketing, and anything uncertain.',
    'Hard rules:',
    '- If email is promotional/newsletter/marketing (e.g. noreply/newsletter/weekly digest/deals), use general.',
    '- If email is account-security or app-connection alert, use general unless legal dispute is explicit.',
    '- Never use solicitor for marketing property deals or lottery/property ads.',
    '- Prefer business for banking/insurance/utility/property-ops operational emails that are not legal casework.',
    '- If uncertain, return general and Newton Store.',
    'Classify this email into:',
    '- domain: one of solicitor, accountant, supplier, business, research, general',
    '- entity_key: short stable key that groups related emails',
    'Entity key rules:',
    '- Keep short and stable; reuse same key for related threads.',
    '- Use concrete case/account/supplier names when present.',
    '- For tax emails use HMRC YYYY-YYYY if relevant.',
    '- For supplier operations use supplier/company name.',
    '- For general uncertain emails use Newton Store.',
    'Examples:',
    '- "New app(s) connected to your Microsoft account" => {"domain":"general","entity_key":"Microsoft Account"}',
    '- "Self Assessment payment reminder from HMRC" => {"domain":"accountant","entity_key":"HMRC 2025-2026"}',
    '- "PO 9912 delivery delayed by Toshiba" => {"domain":"supplier","entity_key":"Toshiba"}',
    '- "British Gas statement for account 88421" => {"domain":"business","entity_key":"Britishgas"}',
    '- "Land Registry title update for 6F Steamer Street" => {"domain":"solicitor","entity_key":"6F Steamer Street"}',
    'If you are not sure, use general and Newton Store.',
    'Return strict JSON: { "domain": "...", "entity_key": "..." }',
    '',
    `from: ${email.fromAddress}`,
    `to: ${email.toAddress}`,
    `subject: ${email.subject}`,
    `date: ${email.date.toISOString()}`,
    `body: ${(email.body || '').slice(0, 2500)}`,
  ].join('\n')

  const raw = await callLocalJson<Partial<ClassificationResult>>(prompt, fallback)
  const heuristic = detectBusinessOverride(email)
  let domain = sanitizeDomain(String(raw?.domain || 'general'))
  let candidateEntity = String(raw?.entity_key || '')

  if (domain === 'general' && heuristic.suggestedDomain) {
    domain = heuristic.suggestedDomain
    if (!candidateEntity.trim() || /^newton store$/i.test(candidateEntity.trim())) {
      candidateEntity = heuristic.suggestedEntityKey || candidateEntity
    }
  } else if (
    (domain === 'solicitor' || domain === 'supplier' || domain === 'accountant' || domain === 'business') &&
    heuristic.marketingLikely &&
    !heuristic.strongBusinessSignal
  ) {
    domain = 'general'
  }

  if (!candidateEntity.trim() && heuristic.suggestedEntityKey) {
    candidateEntity = heuristic.suggestedEntityKey
  }

  const entity_key = normalizeEntityKey(domain, candidateEntity, email)

  return {
    domain,
    entity_key: entity_key || 'Newton Store',
  }
}

function normalizeReducerStatus(value: unknown): 'open' | 'waiting' | 'blocked' | 'closed' {
  const text = String(value || '').toLowerCase()
  if (text.includes('closed') || text.includes('resolved')) return 'closed'
  if (text.includes('block')) return 'blocked'
  if (text.includes('wait')) return 'waiting'
  return 'open'
}

function buildReducerPrompt(agentType: Domain, currentState: Record<string, unknown>, events: QueueEvent[]): string {
  const label =
    agentType === 'solicitor'
      ? 'UK Solicitor case'
      : agentType === 'accountant'
      ? 'UK Accountant case'
      : agentType === 'supplier'
      ? 'Supplier operations case'
      : agentType === 'business'
      ? 'Business operations case'
      : agentType === 'research'
      ? 'Research task'
      : 'General operations case'

  return [
    `You maintain the long-term state for a ${label}.`,
    'Be conservative and evidence-based.',
    'Rules:',
    '- Use only facts from current_state and new_events.',
    '- Do not treat marketing/newsletter language as operational waiting/blocker signals.',
    '- Set status=waiting only when there is a clear dependency on another party.',
    '- Set status=blocked only when there is an explicit blocker/problem preventing progress.',
    '- If no clear dependency or blocker, set status=open.',
    '- waiting_on should be "none" unless a specific party/action is clearly pending.',
    '- next_actions must be max 3 practical actions.',
    '- Preserve useful facts from current_state.facts and merge new facts.',
    'Inputs:',
    '- current_state: JSON with known facts so far (may be {})',
    '- new_events: list of short summaries of new emails/events in time order',
    'Update:',
    '- last known status',
    '- last email date',
    '- who is waiting on whom',
    '- key amounts / deadlines',
    '- recommended next actions (max 3)',
    'Return strict JSON with:',
    '{ "status": "...", "last_email_date": "...", "waiting_on": "...", "facts": {...}, "next_actions": [...] }',
    '',
    `current_state: ${JSON.stringify(currentState || {})}`,
    `new_events: ${JSON.stringify(events)}`,
  ].join('\n')
}

async function reduceEntityStateWithModel(
  agentType: Domain,
  currentState: Record<string, unknown>,
  events: QueueEvent[]
): Promise<ReducerState> {
  const fallback: ReducerState = {
    status: 'open',
    last_email_date: events[events.length - 1]?.date || new Date().toISOString(),
    waiting_on: 'none',
    facts: currentState?.facts && typeof currentState.facts === 'object' ? (currentState.facts as Record<string, unknown>) : {},
    next_actions: ['Review timeline and draft follow-up for pending items.'],
  }

  const prompt = buildReducerPrompt(agentType, currentState, events)
  const raw = await callLocalJson<Partial<ReducerState>>(prompt, fallback)

  return {
    status: normalizeReducerStatus(raw?.status),
    last_email_date: String(raw?.last_email_date || fallback.last_email_date),
    waiting_on: String(raw?.waiting_on || fallback.waiting_on),
    facts:
      raw?.facts && typeof raw.facts === 'object'
        ? (raw.facts as Record<string, unknown>)
        : fallback.facts,
    next_actions: Array.isArray(raw?.next_actions)
      ? raw.next_actions.map((v) => String(v)).filter(Boolean).slice(0, 3)
      : fallback.next_actions,
  }
}

async function fetchProviderMessages(provider: Provider): Promise<NormalizedMessage[]> {
  try {
    if (provider === 'outlook') {
      const rows = await withTimeout(getRecentMessages(INGEST_TOP), PROVIDER_FETCH_TIMEOUT_MS, 'Outlook fetch')
      return rows.map((m) => ({
        provider,
        providerMessageId: m.id,
        threadKey: m.conversationId || undefined,
        fromAddress: m.from?.emailAddress?.address || m.from?.emailAddress?.name || 'unknown',
        toAddress: (m.toRecipients || [])
          .map((r) => r.emailAddress?.address || '')
          .filter(Boolean)
          .join(', '),
        subject: m.subject || '(No Subject)',
        body: m.bodyPreview || '',
        date: new Date(m.receivedDateTime),
        labels: [
          ...(m.categories || []),
          m.flag?.flagStatus === 'flagged' ? 'FLAGGED' : '',
          m.importance === 'high' ? 'IMPORTANT' : '',
          m.isRead === false ? 'UNREAD' : '',
        ].filter(Boolean),
      }))
    }

    const rows = await withTimeout(getRecentGmailMessages(INGEST_TOP), PROVIDER_FETCH_TIMEOUT_MS, 'Gmail fetch')
    return rows.map((m) => ({
      provider,
      providerMessageId: m.id,
      threadKey: m.threadId || undefined,
      fromAddress: m.fromAddress || m.fromName || 'unknown',
      toAddress: '',
      subject: m.subject || '(No Subject)',
      body: m.bodyPreview || '',
      date: new Date(m.receivedDateTime),
      labels: m.labelIds || [],
    }))
  } catch {
    return []
  }
}

function summarizeEmail(msg: NormalizedMessage): string {
  const sender = msg.fromAddress || 'Unknown sender'
  const subject = msg.subject || '(No Subject)'
  const body = (msg.body || '').replace(/\s+/g, ' ').trim()
  return `${sender} - ${subject}${body ? ` - ${body.slice(0, 200)}` : ''}`
}

async function upsertAgentSession(agentType: SessionAgent, status: 'idle' | 'active' | 'processing' | 'error', context: Record<string, unknown>) {
  const existing = await db.agentSession.findFirst({ where: { agentType } })
  if (existing) {
    await db.agentSession.update({
      where: { id: existing.id },
      data: {
        status,
        lastActive: new Date(),
        context: JSON.stringify(context),
      },
    })
  } else {
    await db.agentSession.create({
      data: {
        agentType,
        status,
        context: JSON.stringify(context),
      },
    })
  }
}

async function findSimilarEntity(agentType: Domain, entityKey: string): Promise<{ id: string; entityKey: string; title: string } | null> {
  const target = normalizeCompareText(entityKey)
  if (!target) return null

  const existing = await db.agentEntity.findMany({
    where: { agentType },
    select: { id: true, entityKey: true, title: true },
    take: 200,
  })

  for (const row of existing) {
    const candidate = normalizeCompareText(row.entityKey)
    if (!candidate) continue
    if (candidate === target) return row
    if (candidate.startsWith(target) || target.startsWith(candidate)) return row
    if (candidate.includes(target) || target.includes(candidate)) return row

    const distance = levenshtein(candidate, target)
    const maxLen = Math.max(candidate.length, target.length)
    if (distance <= Math.max(2, Math.floor(maxLen * 0.2))) return row
  }

  return null
}

async function classifyAndQueueEmail(emailId: string): Promise<void> {
  const email = await db.emailMessage.findUnique({ where: { id: emailId } })
  if (!email) return

  const normalized: NormalizedMessage = {
    provider: email.provider as Provider,
    providerMessageId: email.providerMessageId,
    threadKey: email.threadKey || undefined,
    fromAddress: email.fromAddress,
    toAddress: email.toAddress,
    subject: email.subject,
    body: email.body,
    date: email.date,
    labels: safeJsonParse<string[]>(email.labelsJson, []),
  }

  const classification = await classifyEmailWithModel(normalized)
  const similar = await findSimilarEntity(classification.domain, classification.entity_key)

  const chosenEntityKey = similar?.entityKey || classification.entity_key
  const entityTitle = `${classification.domain.charAt(0).toUpperCase()}${classification.domain.slice(1)} - ${chosenEntityKey}`

  const entity = similar
    ? await db.agentEntity.update({
        where: { id: similar.id },
        data: {
          lastUpdateAt: new Date(),
          title: similar.title || entityTitle,
        },
      })
    : await db.agentEntity.upsert({
        where: {
          agentType_entityKey: {
            agentType: classification.domain,
            entityKey: chosenEntityKey,
          },
        },
        update: {
          lastUpdateAt: new Date(),
          title: entityTitle,
        },
        create: {
          agentType: classification.domain,
          entityKey: chosenEntityKey,
          title: entityTitle,
          status: 'open',
          lastUpdateAt: new Date(),
        },
      })

  await db.emailMessage.update({
    where: { id: email.id },
    data: {
      classifiedAs: classification.domain,
      entityKey: chosenEntityKey,
    },
  })

  await db.agentEntityEvent.create({
    data: {
      agentEntityId: entity.id,
      source: 'email',
      sourceRef: email.id,
      summary: summarizeEmail(normalized),
      rawRef: email.providerMessageId,
    },
  })

  await db.agentEvent.create({
    data: {
      agentType: classification.domain,
      emailMessageId: email.id,
      agentEntityId: entity.id,
      entityKey: chosenEntityKey,
      eventType: 'NEW_EMAIL',
      status: 'pending',
    },
  })

  await upsertAgentSession(mapDomainToSessionAgent(classification.domain), 'processing', {
    source: 'automation-ingest',
    entityKey: chosenEntityKey,
    emailId: email.id,
  })
}

async function createEmailIfMissing(msg: NormalizedMessage): Promise<string | null> {
  const existing = await db.emailMessage.findUnique({
    where: {
      provider_providerMessageId: {
        provider: msg.provider,
        providerMessageId: msg.providerMessageId,
      },
    },
    select: { id: true },
  })
  if (existing) return null

  const created = await db.emailMessage.create({
    data: {
      provider: msg.provider,
      providerMessageId: msg.providerMessageId,
      threadKey: msg.threadKey || null,
      fromAddress: msg.fromAddress,
      toAddress: msg.toAddress,
      subject: msg.subject,
      body: msg.body,
      date: msg.date,
      labelsJson: JSON.stringify(msg.labels || []),
    },
    select: { id: true },
  })

  return created.id
}

async function createEmailIfMissingAndQueue(msg: NormalizedMessage): Promise<boolean> {
  const createdId = await createEmailIfMissing(msg)
  if (!createdId) return false
  await classifyAndQueueEmail(createdId)
  return true
}

async function ingestProvider(provider: Provider): Promise<number> {
  const messages = await fetchProviderMessages(provider)
  if (messages.length === 0) {
    await db.workerCursor.upsert({
      where: { provider },
      update: { lastCheckedAt: new Date() },
      create: { provider, lastCheckedAt: new Date() },
    })
    return 0
  }

  const cursor = await db.workerCursor.upsert({
    where: { provider },
    update: {},
    create: { provider, lastCheckedAt: new Date(0) },
  })

  let createdCount = 0
  const lastCheckedAt = cursor.lastCheckedAt
  const newestDate = new Date(Math.max(...messages.map((m) => m.date.getTime()), Date.now()))

  const sorted = [...messages].sort((a, b) => a.date.getTime() - b.date.getTime())
  for (const msg of sorted) {
    if (msg.date.getTime() < lastCheckedAt.getTime() - 60_000) continue
    if (await createEmailIfMissingAndQueue(msg)) {
      createdCount += 1
    }
  }

  await db.workerCursor.update({
    where: { provider },
    data: { lastCheckedAt: newestDate },
  })

  await db.emailAccount.updateMany({
    where: { provider },
    data: { lastSync: new Date() },
  })

  return createdCount
}

async function processEntityQueue(agentEntityId: string, eventIds: string[]): Promise<{ processed: number; logLine?: string }> {
  const queueRows = await db.agentEvent.findMany({
    where: { id: { in: eventIds } },
    include: { emailMessage: true, agentEntity: true },
    orderBy: { createdAt: 'asc' },
  })
  if (queueRows.length === 0) return { processed: 0 }

  await db.agentEvent.updateMany({
    where: { id: { in: queueRows.map((q) => q.id) } },
    data: { status: 'processing' },
  })

  const entity = queueRows[0].agentEntity
  const domain = sanitizeDomain(entity.agentType)
  const stateRow = await db.agentEntityState.findUnique({ where: { agentEntityId } })
  const currentState = safeJsonParse<Record<string, unknown>>(stateRow?.stateJson, {})

  const events: QueueEvent[] = queueRows.map((q) => ({
    summary: `${q.emailMessage.fromAddress} - ${q.emailMessage.subject} - ${(q.emailMessage.body || '').slice(0, 180)}`,
    date: q.emailMessage.date.toISOString(),
    from: q.emailMessage.fromAddress,
    subject: q.emailMessage.subject,
  }))

  const reduced = await reduceEntityStateWithModel(domain, currentState, events)
  const status = normalizeReducerStatus(reduced.status)

  await db.agentEntity.update({
    where: { id: agentEntityId },
    data: {
      status,
      lastUpdateAt: new Date(),
    },
  })

  await db.agentEntityState.upsert({
    where: { agentEntityId },
    update: {
      stateJson: JSON.stringify(reduced),
      updatedAt: new Date(),
    },
    create: {
      agentEntityId,
      stateJson: JSON.stringify(reduced),
    },
  })

  await db.agentEvent.updateMany({
    where: { id: { in: queueRows.map((q) => q.id) } },
    data: {
      status: 'done',
      processedAt: new Date(),
    },
  })

  await upsertAgentSession(mapDomainToSessionAgent(domain), 'active', {
    source: 'automation-reducer',
    entityId: agentEntityId,
    processedEvents: queueRows.length,
    status,
    nextActions: reduced.next_actions,
  })

  const latest = queueRows[queueRows.length - 1]
  const firstAction = Array.isArray(reduced.next_actions) && reduced.next_actions.length > 0
    ? String(reduced.next_actions[0])
    : 'Review and confirm next step.'
  await emitEntityNotification({
    domain,
    status,
    entityKey: entity.entityKey,
    latestFrom: latest?.emailMessage?.fromAddress || 'unknown',
    latestSubject: latest?.emailMessage?.subject || '(No Subject)',
    nextAction: firstAction,
  }).catch(() => {
    // Keep entity processing resilient.
  })

  return {
    processed: queueRows.length,
    logLine: `${domain.charAt(0).toUpperCase()}${domain.slice(1)}: updated ${entity.entityKey} at ${new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}`,
  }
}

async function processPendingEvents(): Promise<{ processed: number; updatedEntities: number; lastLogLine?: string }> {
  const pending = await db.agentEvent.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, agentEntityId: true },
  })
  if (pending.length === 0) return { processed: 0, updatedEntities: 0 }

  const grouped = new Map<string, string[]>()
  for (const row of pending) {
    if (!grouped.has(row.agentEntityId)) grouped.set(row.agentEntityId, [])
    grouped.get(row.agentEntityId)?.push(row.id)
  }

  let processed = 0
  let updatedEntities = 0
  let lastLogLine: string | undefined

  for (const [entityId, ids] of grouped.entries()) {
    const out = await processEntityQueue(entityId, ids)
    if (out.processed > 0) {
      processed += out.processed
      updatedEntities += 1
      if (out.logLine) lastLogLine = out.logLine
    }
  }

  return { processed, updatedEntities, lastLogLine }
}

async function classifyUnprocessedEmails(limit = 40): Promise<number> {
  const rows = await db.emailMessage.findMany({
    where: { classifiedAs: null },
    select: { id: true },
    orderBy: { date: 'asc' },
    take: Math.max(1, Math.min(limit, 200)),
  })
  for (const row of rows) {
    await classifyAndQueueEmail(row.id)
  }
  return rows.length
}

async function countAgentEntityByType(agentType: Domain, status?: string): Promise<number> {
  return db.agentEntity.count({
    where: {
      agentType,
      ...(status ? { status } : {}),
    },
  })
}

async function refreshMiniAgentSessions(): Promise<void> {
  const [legalOpen, legalWaiting, legalPending] = await Promise.all([
    countAgentEntityByType('solicitor'),
    countAgentEntityByType('solicitor', 'waiting'),
    db.agentEvent.count({ where: { agentType: 'solicitor', status: 'pending' } }),
  ])
  const [financialOpen, financialWaiting, financialPending] = await Promise.all([
    countAgentEntityByType('accountant'),
    countAgentEntityByType('accountant', 'waiting'),
    db.agentEvent.count({ where: { agentType: 'accountant', status: 'pending' } }),
  ])
  const [supplierOpen, supplierWaiting, supplierPending] = await Promise.all([
    countAgentEntityByType('supplier'),
    countAgentEntityByType('supplier', 'waiting'),
    db.agentEvent.count({ where: { agentType: 'supplier', status: 'pending' } }),
  ])
  const [emailOpen, emailPending, researchOpen, researchPending] = await Promise.all([
    countAgentEntityByType('general'),
    db.agentEvent.count({ where: { agentType: 'general', status: 'pending' } }),
    db.agentEntity.count({ where: { agentType: { in: ['research', 'business'] } } }),
    db.agentEvent.count({ where: { agentType: { in: ['research', 'business'] }, status: 'pending' } }),
  ])

  await Promise.all([
    upsertAgentSession('legal', legalPending > 0 ? 'processing' : legalOpen > 0 ? 'active' : 'idle', {
      openEntities: legalOpen,
      waitingEntities: legalWaiting,
      pendingEvents: legalPending,
      updatedAt: new Date().toISOString(),
    }),
    upsertAgentSession('financial', financialPending > 0 ? 'processing' : financialOpen > 0 ? 'active' : 'idle', {
      openEntities: financialOpen,
      waitingEntities: financialWaiting,
      pendingEvents: financialPending,
      updatedAt: new Date().toISOString(),
    }),
    upsertAgentSession('supplier', supplierPending > 0 ? 'processing' : supplierOpen > 0 ? 'active' : 'idle', {
      openEntities: supplierOpen,
      waitingEntities: supplierWaiting,
      pendingEvents: supplierPending,
      updatedAt: new Date().toISOString(),
    }),
    upsertAgentSession('email', emailPending > 0 ? 'processing' : emailOpen > 0 ? 'active' : 'idle', {
      trackedEmailEntities: emailOpen,
      pendingEvents: emailPending,
      ingestTop: INGEST_TOP,
      updatedAt: new Date().toISOString(),
    }),
    upsertAgentSession('research', researchPending > 0 ? 'processing' : researchOpen > 0 ? 'active' : 'idle', {
      researchEntities: researchOpen,
      pendingEvents: researchPending,
      updatedAt: new Date().toISOString(),
    }),
  ])
}

async function triggerContinuousDeepFeed(): Promise<void> {
  if (globalWorker.historicalBackfillRunning || globalWorker.agentWorkerRunning) return
  globalWorker.deepFeedLastStartedAt = new Date().toISOString()
  globalWorker.deepFeedLastError = undefined
  globalWorker.deepFeedLastLogLine = `Continuous deep feed started (${HISTORICAL_BACKFILL_DEFAULT_SINCE_DATE.slice(0, 10)}+)`
  try {
    await runHistoricalBackfill({
      sinceDate: HISTORICAL_BACKFILL_DEFAULT_SINCE_DATE,
      maxFetchPerProvider: CONTINUOUS_DEEP_FEED_MAX_FETCH_PER_PROVIDER,
      force: true,
    })
    globalWorker.deepFeedLastCompletedAt = new Date().toISOString()
    globalWorker.deepFeedLastLogLine = 'Continuous deep feed completed'
  } catch (error) {
    globalWorker.deepFeedLastError = error instanceof Error ? error.message : String(error)
    globalWorker.deepFeedLastLogLine = `Continuous deep feed failed: ${globalWorker.deepFeedLastError}`
  }
}

export function getAgentAutomationWorkerSnapshot(): {
  running: boolean
  lastCycleAt: string | null
  lastCycleDurationMs: number | null
  stats: { ingested: number; processedEvents: number; updatedEntities: number }
  lastLogLine: string | null
} {
  return {
    running: !!globalWorker.agentWorkerRunning,
    lastCycleAt: globalWorker.agentWorkerLastCycleAt || null,
    lastCycleDurationMs:
      typeof globalWorker.agentWorkerLastCycleDurationMs === 'number'
        ? globalWorker.agentWorkerLastCycleDurationMs
        : null,
    stats: globalWorker.agentWorkerLastCycleStats || {
      ingested: 0,
      processedEvents: 0,
      updatedEntities: 0,
    },
    lastLogLine: globalWorker.agentWorkerLastLogLine || null,
  }
}

export async function runAgentAutomationCycle(): Promise<{
  ingested: number
  processedEvents: number
  updatedEntities: number
}> {
  if (globalWorker.agentWorkerRunning) {
    return {
      ...(globalWorker.agentWorkerLastCycleStats || {
        ingested: 0,
        processedEvents: 0,
        updatedEntities: 0,
      }),
    }
  }

  const startedAt = Date.now()
  globalWorker.agentWorkerRunning = true

  try {
    const [outlookCount, gmailCount] = await Promise.all([ingestProvider('outlook'), ingestProvider('gmail')])
    await classifyUnprocessedEmails(CLASSIFY_BATCH_PER_CYCLE)
    const pending = await processPendingEvents()
    await refreshMiniAgentSessions()
    await ingestImportantEmailsToVault(50).catch(() => {
      // Keep worker resilient if vault ingest fails.
    })
    const core = await refreshCoreBrainMemory().catch(() => {
      // Keep worker cycle resilient even if core-brain refresh fails.
      return null
    })
    if (core?.reminders?.length) {
      await emitLeaseReminderNotifications(core.reminders).catch(() => {
        // Keep worker resilient if reminder notifications fail.
      })
    }
    await emitVaultExpiryNotifications().catch(() => {
      // Keep worker resilient if vault expiry notifications fail.
    })
    await runVaultOcrBackground().catch(() => {
      // Keep worker resilient if OCR background fails.
    })

    const stats = {
      ingested: outlookCount + gmailCount,
      processedEvents: pending.processed,
      updatedEntities: pending.updatedEntities,
    }

    globalWorker.agentWorkerLastCycleAt = new Date().toISOString()
    globalWorker.agentWorkerLastCycleDurationMs = Date.now() - startedAt
    globalWorker.agentWorkerLastCycleStats = stats
    if (pending.lastLogLine) globalWorker.agentWorkerLastLogLine = pending.lastLogLine

    return stats
  } finally {
    globalWorker.agentWorkerRunning = false
  }
}

export async function reclassifyAllEmails(options?: {
  limit?: number
  resetAll?: boolean
}): Promise<{
  reclassified: number
  processedEvents: number
  updatedEntities: number
}> {
  if (globalWorker.agentWorkerRunning) {
    return { reclassified: 0, processedEvents: 0, updatedEntities: 0 }
  }

  const startedAt = Date.now()
  globalWorker.agentWorkerRunning = true

  try {
    const limit = Math.max(0, Number(options?.limit || 0))
    const resetAll = options?.resetAll !== false

    if (resetAll) {
      await db.agentEvent.deleteMany({})
      await db.agentEntityEvent.deleteMany({})
      await db.agentEntityState.deleteMany({})
      await db.agentEntity.deleteMany({})
      await db.emailMessage.updateMany({
        data: {
          classifiedAs: null,
          entityKey: null,
        },
      })
    }

    const emails = await db.emailMessage.findMany({
      select: { id: true },
      orderBy: { date: 'asc' },
      ...(limit > 0 ? { take: limit } : {}),
    })

    for (const email of emails) {
      await classifyAndQueueEmail(email.id)
    }

    const pending = await processPendingEvents()
    const stats = {
      reclassified: emails.length,
      processedEvents: pending.processed,
      updatedEntities: pending.updatedEntities,
    }

    globalWorker.agentWorkerLastCycleAt = new Date().toISOString()
    globalWorker.agentWorkerLastCycleDurationMs = Date.now() - startedAt
    globalWorker.agentWorkerLastCycleStats = {
      ingested: 0,
      processedEvents: stats.processedEvents,
      updatedEntities: stats.updatedEntities,
    }
    globalWorker.agentWorkerLastLogLine = `Backfill: reclassified ${stats.reclassified} emails`

    return stats
  } finally {
    globalWorker.agentWorkerRunning = false
  }
}

async function fetchHistoricalProviderMessages(
  provider: Provider,
  sinceDate: string,
  maxFetchPerProvider: number
): Promise<NormalizedMessage[]> {
  try {
    if (provider === 'outlook') {
      const rows = await withTimeout(
        searchMessages({
          sinceDate,
          maxFetch: maxFetchPerProvider,
          top: maxFetchPerProvider,
          exhaustive: true,
        }),
        Math.max(PROVIDER_FETCH_TIMEOUT_MS, 60_000),
        'Outlook historical fetch'
      )
      return rows.map((m) => ({
        provider: 'outlook',
        providerMessageId: m.id,
        threadKey: m.conversationId || undefined,
        fromAddress: m.from?.emailAddress?.address || m.from?.emailAddress?.name || 'unknown',
        toAddress: (m.toRecipients || [])
          .map((r) => r.emailAddress?.address || '')
          .filter(Boolean)
          .join(', '),
        subject: m.subject || '(No Subject)',
        body: m.bodyPreview || '',
        date: new Date(m.receivedDateTime),
        labels: [
          ...(m.categories || []),
          m.flag?.flagStatus === 'flagged' ? 'FLAGGED' : '',
          m.importance === 'high' ? 'IMPORTANT' : '',
          m.isRead === false ? 'UNREAD' : '',
        ].filter(Boolean),
      }))
    }

    const rows = await withTimeout(
      searchGmailMessages({
        sinceDate,
        maxFetch: maxFetchPerProvider,
        top: maxFetchPerProvider,
        exhaustive: true,
      }),
      Math.max(PROVIDER_FETCH_TIMEOUT_MS, 60_000),
      'Gmail historical fetch'
    )
    return rows.map((m) => ({
      provider: 'gmail',
      providerMessageId: m.id,
      threadKey: m.threadId || undefined,
      fromAddress: m.fromAddress || m.fromName || 'unknown',
      toAddress: '',
      subject: m.subject || '(No Subject)',
      body: m.bodyPreview || '',
      date: new Date(m.receivedDateTime),
      labels: m.labelIds || [],
    }))
  } catch {
    return []
  }
}

export function getHistoricalBackfillSnapshot(): {
  running: boolean
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastSinceDate: string | null
  stats: { scanned: number; ingested: number; processedEvents: number; updatedEntities: number }
  lastError: string | null
  lastLogLine: string | null
} {
  return {
    running: !!globalWorker.historicalBackfillRunning,
    lastStartedAt: globalWorker.historicalBackfillLastStartedAt || null,
    lastCompletedAt: globalWorker.historicalBackfillLastCompletedAt || null,
    lastSinceDate: globalWorker.historicalBackfillLastSinceDate || null,
    stats: globalWorker.historicalBackfillStats || {
      scanned: 0,
      ingested: 0,
      processedEvents: 0,
      updatedEntities: 0,
    },
    lastError: globalWorker.historicalBackfillLastError || null,
    lastLogLine: globalWorker.historicalBackfillLastLogLine || null,
  }
}

export async function runHistoricalBackfill(options?: {
  sinceDate?: string
  maxFetchPerProvider?: number
  force?: boolean
}): Promise<{
  scanned: number
  ingested: number
  processedEvents: number
  updatedEntities: number
}> {
  if (globalWorker.historicalBackfillRunning) {
    return (
      globalWorker.historicalBackfillStats || {
        scanned: 0,
        ingested: 0,
        processedEvents: 0,
        updatedEntities: 0,
      }
    )
  }

  const sinceDate = options?.sinceDate || HISTORICAL_BACKFILL_DEFAULT_SINCE_DATE
  const parsedSince = new Date(sinceDate)
  const normalizedSince = Number.isNaN(parsedSince.getTime())
    ? HISTORICAL_BACKFILL_DEFAULT_SINCE_DATE
    : parsedSince.toISOString()
  const force = options?.force === true
  const maxFetchPerProvider = Math.min(
    Math.max(Number(options?.maxFetchPerProvider || HISTORICAL_BACKFILL_MAX_PER_PROVIDER), 100),
    HISTORICAL_BACKFILL_MAX_PER_PROVIDER
  )

  if (
    !force &&
    globalWorker.historicalBackfillLastSinceDate === normalizedSince &&
    globalWorker.historicalBackfillLastCompletedAt
  ) {
    return (
      globalWorker.historicalBackfillStats || {
        scanned: 0,
        ingested: 0,
        processedEvents: 0,
        updatedEntities: 0,
      }
    )
  }

  globalWorker.historicalBackfillRunning = true
  globalWorker.historicalBackfillLastStartedAt = new Date().toISOString()
  globalWorker.historicalBackfillLastSinceDate = normalizedSince
  globalWorker.historicalBackfillLastError = undefined
  globalWorker.historicalBackfillLastLogLine = `Historical backfill started from ${normalizedSince.slice(0, 10)}`

  try {
    const [outlookRows, gmailRows] = await Promise.all([
      fetchHistoricalProviderMessages('outlook', normalizedSince, maxFetchPerProvider),
      fetchHistoricalProviderMessages('gmail', normalizedSince, maxFetchPerProvider),
    ])

    const merged = [...outlookRows, ...gmailRows]
      .filter((m) => !Number.isNaN(m.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    globalWorker.historicalBackfillStats = {
      scanned: merged.length,
      ingested: 0,
      processedEvents: 0,
      updatedEntities: 0,
    }
    globalWorker.historicalBackfillLastLogLine = `Historical backfill scanning ${merged.length} messages from ${normalizedSince.slice(0, 10)}`

    let ingested = 0
    for (let i = 0; i < merged.length; i += 1) {
      const msg = merged[i]
      if (msg.date.toISOString() < normalizedSince) continue
      const createdId = await createEmailIfMissing(msg)
      if (createdId) {
        ingested += 1
      }
      if ((i + 1) % 50 === 0 || i === merged.length - 1) {
        globalWorker.historicalBackfillStats = {
          scanned: merged.length,
          ingested,
          processedEvents: 0,
          updatedEntities: 0,
        }
        globalWorker.historicalBackfillLastLogLine = `Historical backfill progress: ${i + 1}/${merged.length}, ingested ${ingested}`
      }
    }

    const stats = {
      scanned: merged.length,
      ingested,
      processedEvents: 0,
      updatedEntities: 0,
    }

    globalWorker.historicalBackfillStats = stats
    globalWorker.historicalBackfillLastCompletedAt = new Date().toISOString()
    globalWorker.historicalBackfillLastLogLine = `Historical backfill complete: scanned ${stats.scanned}, ingested ${stats.ingested}`
    await refreshCoreBrainMemory().catch(() => {
      // Backfill should still finish even when memory refresh fails.
    })

    return stats
  } catch (error) {
    globalWorker.historicalBackfillLastError = error instanceof Error ? error.message : String(error)
    globalWorker.historicalBackfillLastLogLine = `Historical backfill failed: ${globalWorker.historicalBackfillLastError}`
    throw error
  } finally {
    globalWorker.historicalBackfillRunning = false
  }
}

export function ensureAgentAutomationWorkerStarted(): void {
  if (globalWorker.agentWorkerStarted) return
  globalWorker.agentWorkerStarted = true

  setTimeout(() => {
    void runAgentAutomationCycle()
  }, STARTUP_DELAY_MS)

  globalWorker.agentWorkerTimer = setInterval(() => {
    void runAgentAutomationCycle()
  }, LOOP_MS)

  setTimeout(() => {
    void triggerContinuousDeepFeed()
  }, STARTUP_DELAY_MS + 5_000)

  globalWorker.deepFeedTimer = setInterval(() => {
    void triggerContinuousDeepFeed()
  }, CONTINUOUS_DEEP_FEED_INTERVAL_MS)
}
