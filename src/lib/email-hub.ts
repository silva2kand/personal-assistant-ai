import {
  getGmailMessageById,
  getRecentGmailMessages,
  searchGmailMessages,
  GmailMessage,
} from '@/lib/gmail-api'
import {
  getOutlookMessageById,
  getRecentMessages,
  searchMessages,
  OutlookMessage,
} from '@/lib/outlook-graph'

export type EmailProvider = 'gmail' | 'outlook'

export interface UnifiedEmailMessage {
  id: string
  provider: EmailProvider
  subject: string
  receivedDateTime: string
  bodyPreview?: string
  fromName?: string
  fromAddress?: string
  threadId?: string
  labels?: string[]
  isFlagged?: boolean
  isImportant?: boolean
  isUnread?: boolean
}

function mapOutlook(m: OutlookMessage): UnifiedEmailMessage {
  return {
    id: m.id,
    provider: 'outlook',
    subject: m.subject || '(No Subject)',
    receivedDateTime: m.receivedDateTime,
    bodyPreview: m.bodyPreview || '',
    fromName: m.from?.emailAddress?.name,
    fromAddress: m.from?.emailAddress?.address,
    threadId: m.conversationId,
    labels: [
      ...(m.categories || []),
      m.flag?.flagStatus === 'flagged' ? 'FLAGGED' : '',
      m.importance === 'high' ? 'IMPORTANT' : '',
      m.isRead === false ? 'UNREAD' : '',
    ].filter(Boolean),
    isFlagged: m.flag?.flagStatus === 'flagged',
    isImportant: m.importance === 'high' || (m.categories || []).some((c) => c.toLowerCase().includes('important')),
    isUnread: m.isRead === false,
  }
}

function mapGmail(m: GmailMessage): UnifiedEmailMessage {
  return {
    id: m.id,
    provider: 'gmail',
    subject: m.subject || '(No Subject)',
    receivedDateTime: m.receivedDateTime,
    bodyPreview: m.bodyPreview || '',
    fromName: m.fromName,
    fromAddress: m.fromAddress,
    threadId: m.threadId,
    labels: m.labelIds || [],
    isFlagged: m.isFlagged,
    isImportant: m.isImportant,
    isUnread: m.isUnread,
  }
}

export async function getUnifiedInbox(top = 30): Promise<UnifiedEmailMessage[]> {
  const perProvider = Math.max(5, Math.min(50, Math.ceil(top)))
  const [outlookRes, gmailRes] = await Promise.allSettled([
    getRecentMessages(perProvider),
    getRecentGmailMessages(perProvider),
  ])

  const merged: UnifiedEmailMessage[] = []
  if (outlookRes.status === 'fulfilled') merged.push(...outlookRes.value.map(mapOutlook))
  if (gmailRes.status === 'fulfilled') merged.push(...gmailRes.value.map(mapGmail))

  return merged
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
    .slice(0, top)
}

export async function searchUnifiedInbox(params: {
  text?: string
  fromContains?: string[]
  sinceHours?: number
  sinceDate?: string
  top?: number
  maxFetchPerProvider?: number
  exhaustive?: boolean
}): Promise<UnifiedEmailMessage[]> {
  const deepCap = Math.max(Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 1)
  const requested = Number(params.maxFetchPerProvider || params.top || (params.exhaustive ? deepCap : 50))
  const perProvider = Math.max(5, Math.min(deepCap, requested))
  const [outlookRes, gmailRes] = await Promise.allSettled([
    searchMessages({
      text: params.text,
      fromContains: params.fromContains,
      sinceHours: params.sinceHours,
      sinceDate: params.sinceDate,
      top: perProvider,
      maxFetch: perProvider,
      exhaustive: params.exhaustive,
    }),
    searchGmailMessages({
      text: params.text,
      fromContains: params.fromContains,
      sinceHours: params.sinceHours,
      sinceDate: params.sinceDate,
      top: perProvider,
      maxFetch: perProvider,
      exhaustive: params.exhaustive,
    }),
  ])

  const merged: UnifiedEmailMessage[] = []
  if (outlookRes.status === 'fulfilled') merged.push(...outlookRes.value.map(mapOutlook))
  if (gmailRes.status === 'fulfilled') merged.push(...gmailRes.value.map(mapGmail))

  const sorted = merged.sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
  if (typeof params.top === 'number' && params.top > 0) {
    return sorted.slice(0, params.top)
  }
  return sorted
}

export async function getUnifiedMessageById(
  provider: EmailProvider,
  messageId: string
): Promise<UnifiedEmailMessage> {
  if (provider === 'gmail') {
    const msg = await getGmailMessageById(messageId)
    return mapGmail(msg)
  }
  const msg = await getOutlookMessageById(messageId)
  return mapOutlook(msg)
}
