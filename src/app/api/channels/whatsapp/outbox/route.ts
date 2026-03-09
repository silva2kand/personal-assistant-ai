import { NextRequest, NextResponse } from 'next/server'
import { listNotifications } from '@/lib/notification-center'
import { dispatchWhatsAppMessage } from '@/lib/whatsapp-bridge'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const max = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('max') || 100), 300))
    const includeRead = req.nextUrl.searchParams.get('includeRead') === '1'
    const items = await listNotifications({
      max,
      includeRead,
      channel: 'whatsapp',
    })
    return NextResponse.json({ ok: true, provider: process.env.WHATSAPP_PROVIDER || 'mock', items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load WhatsApp outbox' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const to = String(body?.to || '').trim()
    const message = String(body?.message || body?.text || '').trim()
    if (!to || !message) {
      return NextResponse.json({ error: 'to and message are required' }, { status: 400 })
    }

    const result = await dispatchWhatsAppMessage({
      to,
      message,
      source: String(body?.source || 'api-whatsapp-outbox'),
      priority: body?.priority === 'high' || body?.priority === 'low' ? body.priority : 'medium',
    })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue WhatsApp message' },
      { status: 500 }
    )
  }
}
