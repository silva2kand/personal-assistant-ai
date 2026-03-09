import { enqueueNotification, markNotificationSent, NotificationItem } from '@/lib/notification-center'

export type WhatsAppSendResult = {
  id: string
  queued: boolean
  delivered: boolean
  provider: string
  error?: string
}

function providerName() {
  return (process.env.WHATSAPP_PROVIDER || 'mock').toLowerCase()
}

async function dispatchViaTwilio(input: { to: string; message: string; source?: string }): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM
  if (!accountSid || !authToken || !from) {
    throw new Error('Twilio config missing: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM')
  }

  const to = input.to.startsWith('whatsapp:') ? input.to : `whatsapp:${input.to}`
  const fromNumber = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const form = new URLSearchParams({
    To: to,
    From: fromNumber,
    Body: input.message,
  })

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio send failed: ${res.status} ${text}`)
  }
}

async function dispatchViaMeta(input: { to: string; message: string; source?: string }): Promise<void> {
  const token = process.env.WHATSAPP_META_TOKEN
  const phoneNumberId = process.env.WHATSAPP_META_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) {
    throw new Error('Meta config missing: WHATSAPP_META_TOKEN/WHATSAPP_META_PHONE_NUMBER_ID')
  }

  const digitsOnlyTo = input.to.replace(/[^\d]/g, '')
  const res = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: digitsOnlyTo,
      type: 'text',
      text: { body: input.message },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta WhatsApp send failed: ${res.status} ${text}`)
  }
}

export async function queueWhatsAppMessage(input: {
  to: string
  message: string
  source?: string
  priority?: 'high' | 'medium' | 'low'
}): Promise<NotificationItem> {
  return enqueueNotification({
    title: `WhatsApp to ${input.to}`,
    body: input.message,
    channel: 'whatsapp',
    source: input.source || 'beema-whatsapp',
    priority: input.priority || 'medium',
    meta: { to: input.to },
  })
}

export async function dispatchWhatsAppMessage(input: {
  to: string
  message: string
  source?: string
  priority?: 'high' | 'medium' | 'low'
}): Promise<WhatsAppSendResult> {
  const queued = await queueWhatsAppMessage(input)
  const provider = providerName()

  if (provider === 'mock') {
    return {
      id: queued.id,
      queued: true,
      delivered: false,
      provider,
    }
  }

  try {
    if (provider === 'twilio') {
      await dispatchViaTwilio(input)
    } else if (provider === 'meta' || provider === 'whatsapp-cloud') {
      await dispatchViaMeta(input)
    } else {
      const webhook = process.env.WHATSAPP_WEBHOOK_URL
      if (!webhook) {
        return {
          id: queued.id,
          queued: true,
          delivered: false,
          provider,
          error: 'WHATSAPP_WEBHOOK_URL is not set',
        }
      }
      const token = process.env.WHATSAPP_WEBHOOK_TOKEN
      const res = await fetch(webhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          channel: 'whatsapp',
          to: input.to,
          message: input.message,
          source: input.source || 'beema-whatsapp',
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        return {
          id: queued.id,
          queued: true,
          delivered: false,
          provider,
          error: `Webhook send failed: ${res.status} ${text}`,
        }
      }
    }

    await markNotificationSent(queued.id)
    return {
      id: queued.id,
      queued: true,
      delivered: true,
      provider,
    }
  } catch (error) {
    return {
      id: queued.id,
      queued: true,
      delivered: false,
      provider,
      error: error instanceof Error ? error.message : 'Unknown webhook error',
    }
  }
}
