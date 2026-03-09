import { GmailAccount, getGmailAccount, upsertGmailAccount } from '@/lib/gmail-store'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1'
const DEEP_FETCH_CAP = Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000)

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

interface GmailApiMessage {
  id: string
  threadId?: string
  snippet?: string
  internalDate?: string
  labelIds?: string[]
  payload?: {
    mimeType?: string
    filename?: string
    body?: {
      size?: number
      data?: string
      attachmentId?: string
    }
    parts?: Array<{
      partId?: string
      mimeType?: string
      filename?: string
      body?: {
        size?: number
        data?: string
        attachmentId?: string
      }
      parts?: Array<unknown>
    }>
    headers?: Array<{ name: string; value: string }>
  }
}

export interface GmailMessage {
  id: string
  threadId?: string
  subject: string
  receivedDateTime: string
  bodyPreview?: string
  fromName?: string
  fromAddress?: string
  labelIds?: string[]
  isFlagged?: boolean
  isImportant?: boolean
  isUnread?: boolean
}

export interface GmailMessageAttachment {
  fileName: string
  mimeType: string
  sizeBytes: number
  bytes: Buffer
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function getHeader(msg: GmailApiMessage, name: string): string {
  return (
    msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
  )
}

function parseFrom(value: string): { name?: string; address?: string } {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const angle = trimmed.match(/^(.*)<([^>]+)>$/)
  if (angle) {
    return {
      name: angle[1].trim().replace(/^"|"$/g, '') || undefined,
      address: angle[2].trim(),
    }
  }
  if (trimmed.includes('@')) return { address: trimmed }
  return { name: trimmed }
}

function toUnifiedMessage(msg: GmailApiMessage): GmailMessage {
  const subject = getHeader(msg, 'Subject') || '(No Subject)'
  const from = parseFrom(getHeader(msg, 'From'))
  const receivedDateTime = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date().toISOString()
  const labels = msg.labelIds || []
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    receivedDateTime,
    bodyPreview: msg.snippet || '',
    fromName: from.name,
    fromAddress: from.address,
    labelIds: labels,
    isFlagged: labels.includes('STARRED'),
    isImportant: labels.includes('IMPORTANT'),
    isUnread: labels.includes('UNREAD'),
  }
}

async function refreshGmailToken(account: GmailAccount): Promise<GmailAccount> {
  const clientId = requireEnv('GMAIL_CLIENT_ID')
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET')
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail/callback'

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    redirect_uri: redirectUri,
  })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    throw new Error(`Gmail refresh failed: ${tokenRes.status} ${text}`)
  }

  const tokenData = await tokenRes.json()
  const updated: GmailAccount = {
    ...account,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || account.refreshToken,
    expiresAt: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
    scope: tokenData.scope || account.scope,
  }
  await upsertGmailAccount(updated)
  return updated
}

export async function getValidGmailAccount(email?: string): Promise<GmailAccount> {
  const account = await getGmailAccount(email)
  if (!account) throw new Error('No connected Gmail account')

  if (account.expiresAt <= Date.now() + 60_000) {
    return refreshGmailToken(account)
  }
  return account
}

async function gmailRequest<T>(
  account: GmailAccount,
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API ${endpoint} failed: ${res.status} ${text}`)
  }
  return (await res.json()) as T
}

async function listMessageIds(params: {
  maxResults?: number
  q?: string
  email?: string
  exhaustive?: boolean
}): Promise<string[]> {
  const account = await getValidGmailAccount(params.email)
  const q = params.q ? `&q=${encodeURIComponent(params.q)}` : ''
  const requested = Number(params.maxResults || 0)
  const target = Math.min(
    Math.max(requested > 0 ? requested : DEEP_FETCH_CAP, 1),
    Math.max(DEEP_FETCH_CAP, 1)
  )
  const exhaustive = params.exhaustive === true
  const ids: string[] = []
  let pageToken: string | undefined

  while (ids.length < target) {
    const remaining = target - ids.length
    const pageSize = Math.min(100, remaining)
    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
    const data = await gmailRequest<{
      messages?: Array<{ id: string }>
      nextPageToken?: string
    }>(
      account,
      `/users/me/messages?maxResults=${pageSize}${q}${page}`
    )

    const chunk = (data.messages || []).map((m) => m.id).filter(Boolean)
    if (chunk.length === 0) break
    ids.push(...chunk)
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
    if (!exhaustive && ids.length >= target) break
  }

  return [...new Set(ids)].slice(0, target)
}

export async function getGmailMessageById(messageId: string, email?: string): Promise<GmailMessage> {
  const account = await getValidGmailAccount(email)
  const msg = await gmailRequest<GmailApiMessage>(
    account,
    `/users/me/messages/${encodeURIComponent(
      messageId
    )}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=Date`
  )
  return toUnifiedMessage(msg)
}

async function getRawMessage(messageId: string, email?: string): Promise<GmailApiMessage> {
  const account = await getValidGmailAccount(email)
  return gmailRequest<GmailApiMessage>(
    account,
    `/users/me/messages/${encodeURIComponent(
      messageId
    )}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=Date`
  )
}

type GmailPayloadPart = {
  mimeType?: string
  filename?: string
  body?: {
    size?: number
    data?: string
    attachmentId?: string
  }
  parts?: GmailPayloadPart[]
}

function decodeBase64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${pad}`, 'base64')
}

function flattenParts(parts: GmailPayloadPart[] | undefined, out: GmailPayloadPart[] = []): GmailPayloadPart[] {
  for (const part of parts || []) {
    out.push(part)
    if (Array.isArray(part.parts) && part.parts.length > 0) {
      flattenParts(part.parts, out)
    }
  }
  return out
}

export async function getGmailMessageAttachments(
  messageId: string,
  email?: string
): Promise<GmailMessageAttachment[]> {
  const account = await getValidGmailAccount(email)
  const message = await gmailRequest<GmailApiMessage>(
    account,
    `/users/me/messages/${encodeURIComponent(messageId)}?format=full`
  )

  const parts = flattenParts(message.payload?.parts as GmailPayloadPart[] | undefined)
  const files = parts.filter((p) => {
    const name = String(p.filename || '').trim()
    const body = p.body || {}
    return !!name && (!!body.attachmentId || !!body.data)
  })

  const output: GmailMessageAttachment[] = []
  for (const part of files) {
    const body = part.body || {}
    let bytes: Buffer | null = null

    if (body.data) {
      bytes = decodeBase64UrlToBuffer(body.data)
    } else if (body.attachmentId) {
      const attachmentData = await gmailRequest<{ data?: string; size?: number }>(
        account,
        `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(body.attachmentId)}`
      )
      if (attachmentData.data) {
        bytes = decodeBase64UrlToBuffer(attachmentData.data)
      }
    }

    if (!bytes || bytes.length === 0) continue
    output.push({
      fileName: part.filename || 'attachment.bin',
      mimeType: part.mimeType || 'application/octet-stream',
      sizeBytes: bytes.length || Number(body.size || 0),
      bytes,
    })
  }

  return output
}

async function getRawMessagesInBatches(
  ids: string[],
  email?: string,
  batchSize = 20
): Promise<GmailApiMessage[]> {
  const safeBatchSize = Math.min(Math.max(batchSize, 1), 50)
  const rows: GmailApiMessage[] = []

  for (let i = 0; i < ids.length; i += safeBatchSize) {
    const chunk = ids.slice(i, i + safeBatchSize)
    const settled = await Promise.allSettled(chunk.map((id) => getRawMessage(id, email)))
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        rows.push(result.value)
      }
    }
  }

  return rows
}

export async function getRecentGmailMessages(top = 25, email?: string): Promise<GmailMessage[]> {
  const ids = await listMessageIds({
    maxResults: Math.min(Math.max(top, 1), 500),
    email,
  })
  const rows = await getRawMessagesInBatches(ids, email, 20)
  return rows.map(toUnifiedMessage)
}

export async function searchGmailMessages(params: {
  text?: string
  fromContains?: string[]
  sinceHours?: number
  sinceDate?: string
  top?: number
  maxFetch?: number
  exhaustive?: boolean
  email?: string
}): Promise<GmailMessage[]> {
  const terms: string[] = []
  if (params.text?.trim()) terms.push(params.text.trim())
  const senders = (params.fromContains || []).map((s) => s.trim()).filter(Boolean)
  if (senders.length === 1) {
    terms.push(`from:${senders[0]}`)
  } else if (senders.length > 1) {
    terms.push(`(${senders.map((s) => `from:${s}`).join(' OR ')})`)
  }
  let afterUnix = 0
  if (params.sinceHours && params.sinceHours > 0) {
    afterUnix = Math.max(afterUnix, Math.floor(Date.now() / 1000 - params.sinceHours * 3600))
  }
  if (params.sinceDate) {
    const parsed = new Date(params.sinceDate)
    if (!Number.isNaN(parsed.getTime())) {
      afterUnix = Math.max(afterUnix, Math.floor(parsed.getTime() / 1000))
    }
  }
  if (afterUnix > 0) {
    terms.push(`after:${afterUnix}`)
  }
  const q = terms.join(' ').trim()

  const fetchTarget = Math.min(
    Math.max(Number(params.maxFetch || params.top || (params.exhaustive ? DEEP_FETCH_CAP : 50)), 1),
    Math.max(DEEP_FETCH_CAP, 1)
  )
  const ids = await listMessageIds({
    maxResults: fetchTarget,
    exhaustive: params.exhaustive,
    q: q || undefined,
    email: params.email,
  })

  const rows = await getRawMessagesInBatches(ids, params.email, 20)
  return rows.map(toUnifiedMessage)
}

export async function sendGmailMessage(params: {
  to: string
  subject: string
  body: string
  cc?: string[]
  bcc?: string[]
  email?: string
}): Promise<void> {
  const account = await getValidGmailAccount(params.email)
  const lines = [
    `To: ${params.to}`,
    params.cc && params.cc.length > 0 ? `Cc: ${params.cc.join(', ')}` : '',
    params.bcc && params.bcc.length > 0 ? `Bcc: ${params.bcc.join(', ')}` : '',
    `Subject: ${params.subject || '(No Subject)'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body || '',
  ].filter(Boolean)

  await gmailRequest(
    account,
    '/users/me/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({
        raw: base64UrlEncode(lines.join('\r\n')),
      }),
    }
  )
}

export async function replyToGmailMessage(params: {
  messageId: string
  body: string
  email?: string
}): Promise<void> {
  const account = await getValidGmailAccount(params.email)
  const original = await getRawMessage(params.messageId, params.email)
  const replyTo = getHeader(original, 'Reply-To') || getHeader(original, 'From')
  const subjectRaw = getHeader(original, 'Subject') || '(No Subject)'
  const subject = subjectRaw.toLowerCase().startsWith('re:') ? subjectRaw : `Re: ${subjectRaw}`
  const messageIdHeader = getHeader(original, 'Message-ID')

  const lines = [
    `To: ${replyTo}`,
    `Subject: ${subject}`,
    messageIdHeader ? `In-Reply-To: ${messageIdHeader}` : '',
    messageIdHeader ? `References: ${messageIdHeader}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body || '',
  ].filter(Boolean)

  await gmailRequest(
    account,
    '/users/me/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({
        raw: base64UrlEncode(lines.join('\r\n')),
        threadId: original.threadId,
      }),
    }
  )
}

export async function forwardGmailMessages(params: {
  messageIds: string[]
  to: string
  comment?: string
  email?: string
}): Promise<number> {
  let forwarded = 0
  for (const id of params.messageIds) {
    const msg = await getRawMessage(id, params.email)
    const from = getHeader(msg, 'From') || 'Unknown sender'
    const subject = getHeader(msg, 'Subject') || '(No Subject)'
    const date = getHeader(msg, 'Date') || msg.internalDate || ''
    const bodyLines = [
      params.comment || 'Forwarded by workflow assistant.',
      '',
      '----- Forwarded message -----',
      `From: ${from}`,
      `Date: ${date}`,
      `Subject: ${subject}`,
      '',
      msg.snippet || '',
    ]

    await sendGmailMessage({
      to: params.to,
      subject: `Fwd: ${subject}`,
      body: bodyLines.join('\n'),
      email: params.email,
    })
    forwarded += 1
  }
  return forwarded
}

export async function getGmailProfile(email?: string): Promise<{ emailAddress?: string; messagesTotal?: number }> {
  const account = await getValidGmailAccount(email)
  return gmailRequest(account, '/users/me/profile')
}
