import { getOutlookAccount, OutlookAccount, upsertOutlookAccount } from '@/lib/outlook-store'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const DEEP_FETCH_CAP = Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000)

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export interface OutlookMessage {
  id: string
  subject: string
  receivedDateTime: string
  bodyPreview?: string
  from?: { emailAddress?: { name?: string; address?: string } }
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>
  conversationId?: string
  flag?: { flagStatus?: string }
  importance?: 'low' | 'normal' | 'high'
  isRead?: boolean
  categories?: string[]
}

export interface OutlookMessageAttachment {
  fileName: string
  mimeType: string
  sizeBytes: number
  bytes: Buffer
}

async function refreshOutlookToken(account: OutlookAccount): Promise<OutlookAccount> {
  const clientId = requireEnv('OUTLOOK_CLIENT_ID')
  const clientSecret = requireEnv('OUTLOOK_CLIENT_SECRET')
  const tenant = process.env.OUTLOOK_TENANT || 'common'
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  const redirectUri =
    process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3000/api/auth/outlook/callback'

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    redirect_uri: redirectUri,
  })

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    throw new Error(`Outlook refresh failed: ${tokenRes.status} ${text}`)
  }

  const tokenData = await tokenRes.json()
  const updated: OutlookAccount = {
    ...account,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || account.refreshToken,
    expiresAt: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
    scope: tokenData.scope || account.scope,
  }
  await upsertOutlookAccount(updated)
  return updated
}

export async function getValidOutlookAccount(email?: string): Promise<OutlookAccount> {
  const account = await getOutlookAccount(email)
  if (!account) throw new Error('No connected Outlook account')

  // Refresh one minute before expiry.
  if (account.expiresAt <= Date.now() + 60_000) {
    return refreshOutlookToken(account)
  }
  return account
}

async function graphRequest<T>(
  account: OutlookAccount,
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}${endpoint}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph API ${endpoint} failed: ${res.status} ${text}`)
  }
  return (await res.json()) as T
}

export async function getOutlookMe(email?: string): Promise<{ displayName?: string; mail?: string; userPrincipalName?: string }> {
  const account = await getValidOutlookAccount(email)
  return graphRequest(account, '/me')
}

export async function getRecentMessages(top = 25, email?: string): Promise<OutlookMessage[]> {
  return listOutlookMessages({ top, email })
}

async function listOutlookMessages(params: {
  top: number
  sinceDate?: string
  email?: string
}): Promise<OutlookMessage[]> {
  const account = await getValidOutlookAccount(params.email)
  const target = Math.min(Math.max(params.top, 1), Math.max(DEEP_FETCH_CAP, 1))
  const pageSize = Math.min(100, target)
  const select = 'id,subject,receivedDateTime,bodyPreview,from,toRecipients,conversationId,flag,importance,isRead,categories'
  const parsedSince = params.sinceDate ? new Date(params.sinceDate) : null
  const validSince = parsedSince && !Number.isNaN(parsedSince.getTime()) ? parsedSince.toISOString() : null
  const filter = validSince
    ? `&$filter=${encodeURIComponent(`receivedDateTime ge ${validSince}`)}`
    : ''

  let endpoint = `/me/messages?$top=${pageSize}&$orderby=receivedDateTime desc&$select=${select}${filter}`
  const rows: OutlookMessage[] = []

  while (endpoint && rows.length < target) {
    const data = await graphRequest<{ value: OutlookMessage[]; '@odata.nextLink'?: string }>(
      account,
      endpoint
    )
    rows.push(...(data.value || []))
    endpoint = data['@odata.nextLink'] || ''
  }

  return rows.slice(0, target)
}

export async function getOutlookMessageById(messageId: string, email?: string): Promise<OutlookMessage> {
  const account = await getValidOutlookAccount(email)
  return graphRequest(
    account,
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,receivedDateTime,bodyPreview,from,toRecipients,conversationId,flag,importance,isRead,categories`
  )
}

export async function getOutlookMessageAttachments(
  messageId: string,
  email?: string
): Promise<OutlookMessageAttachment[]> {
  const account = await getValidOutlookAccount(email)
  const data = await graphRequest<{
    value?: Array<{
      id?: string
      name?: string
      contentType?: string
      size?: number
      isInline?: boolean
      contentBytes?: string
      '@odata.type'?: string
    }>
  }>(
    account,
    `/me/messages/${encodeURIComponent(messageId)}/attachments?$top=50`
  )

  const items = data.value || []
  const output: OutlookMessageAttachment[] = []
  for (const item of items) {
    const isInline = item.isInline === true
    const contentBytes = item.contentBytes
    if (isInline || !contentBytes) continue
    const fileName = (item.name || '').trim() || 'attachment.bin'
    const bytes = Buffer.from(contentBytes, 'base64')
    if (bytes.length === 0) continue
    output.push({
      fileName,
      mimeType: item.contentType || 'application/octet-stream',
      sizeBytes: bytes.length || Number(item.size || 0),
      bytes,
    })
  }
  return output
}

export async function searchMessages(params: {
  text?: string
  fromContains?: string[]
  sinceHours?: number
  sinceDate?: string
  top?: number
  maxFetch?: number
  exhaustive?: boolean
  email?: string
}): Promise<OutlookMessage[]> {
  const fetchSize = Math.min(
    Math.max(params.maxFetch || params.top || (params.exhaustive ? DEEP_FETCH_CAP : 100), 1),
    Math.max(DEEP_FETCH_CAP, 1)
  )
  const recent = await listOutlookMessages({
    top: fetchSize,
    sinceDate: params.sinceDate,
    email: params.email,
  })
  const sinceFromHours = params.sinceHours ? Date.now() - params.sinceHours * 3600 * 1000 : 0
  const sinceFromDate = params.sinceDate ? new Date(params.sinceDate).getTime() : 0
  const sinceMs = Math.max(sinceFromHours, Number.isNaN(sinceFromDate) ? 0 : sinceFromDate)
  const fromFilters = (params.fromContains || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  const text = (params.text || '').toLowerCase()

  return recent.filter((m) => {
    const received = new Date(m.receivedDateTime).getTime()
    if (sinceMs && received < sinceMs) return false

    const sender =
      `${m.from?.emailAddress?.name || ''} ${m.from?.emailAddress?.address || ''}`.toLowerCase()
    if (fromFilters.length > 0 && !fromFilters.some((f) => sender.includes(f))) return false

    if (text) {
      const hay = `${m.subject || ''} ${m.bodyPreview || ''}`.toLowerCase()
      if (!hay.includes(text)) return false
    }
    return true
  })
}

export async function forwardMessages(params: {
  messageIds: string[]
  to: string
  comment?: string
  email?: string
}): Promise<number> {
  const account = await getValidOutlookAccount(params.email)
  let forwarded = 0

  for (const id of params.messageIds) {
    await graphRequest(
      account,
      `/me/messages/${id}/forward`,
      {
        method: 'POST',
        body: JSON.stringify({
          comment: params.comment || 'Auto-forwarded by workflow assistant.',
          toRecipients: [
            {
              emailAddress: {
                address: params.to,
              },
            },
          ],
        }),
      }
    )
    forwarded += 1
  }
  return forwarded
}

export async function sendOutlookMail(params: {
  to: string
  subject: string
  body: string
  cc?: string[]
  email?: string
}): Promise<void> {
  const account = await getValidOutlookAccount(params.email)
  await graphRequest(
    account,
    '/me/sendMail',
    {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: params.subject || '(No Subject)',
          body: {
            contentType: 'Text',
            content: params.body || '',
          },
          toRecipients: [
            {
              emailAddress: {
                address: params.to,
              },
            },
          ],
          ccRecipients: (params.cc || []).map((cc) => ({
            emailAddress: { address: cc },
          })),
        },
        saveToSentItems: true,
      }),
    }
  )
}

export async function replyToOutlookMessage(params: {
  messageId: string
  body: string
  email?: string
}): Promise<void> {
  const account = await getValidOutlookAccount(params.email)
  await graphRequest(
    account,
    `/me/messages/${encodeURIComponent(params.messageId)}/reply`,
    {
      method: 'POST',
      body: JSON.stringify({
        comment: params.body || '',
      }),
    }
  )
}
