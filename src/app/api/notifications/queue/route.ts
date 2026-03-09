import { NextRequest, NextResponse } from 'next/server'
import {
  acknowledgeNotification,
  clearNotifications,
  enqueueNotification,
  listNotifications,
  NotificationChannel,
  NotificationPriority,
} from '@/lib/notification-center'

export const runtime = 'nodejs'

function normalizePriority(input: unknown): NotificationPriority {
  const v = String(input || '').toLowerCase()
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'medium'
}

function normalizeChannel(input: unknown): NotificationChannel {
  const v = String(input || '').toLowerCase()
  if (v === 'desktop' || v === 'whatsapp' || v === 'chat') return v
  return 'desktop'
}

export async function GET(req: NextRequest) {
  try {
    const max = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('max') || 100), 300))
    const includeRead = req.nextUrl.searchParams.get('includeRead') === '1'
    const channelRaw = req.nextUrl.searchParams.get('channel')
    const channel = channelRaw ? normalizeChannel(channelRaw) : undefined
    const items = await listNotifications({ max, includeRead, channel })
    return NextResponse.json({ ok: true, items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list notifications' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const title = String(body?.title || '').trim()
    const text = String(body?.body || body?.text || '').trim()
    if (!title || !text) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 })
    }
    const item = await enqueueNotification({
      title,
      body: text,
      priority: normalizePriority(body?.priority),
      channel: normalizeChannel(body?.channel),
      source: String(body?.source || 'api'),
      meta: body?.meta && typeof body.meta === 'object' ? body.meta : undefined,
    })
    return NextResponse.json({ ok: true, item })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue notification' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const maxKeep = Math.max(0, Math.min(Number(req.nextUrl.searchParams.get('keepHistory') || 200), 1000))
    await clearNotifications(maxKeep)
    return NextResponse.json({ ok: true, cleared: true, keepHistory: maxKeep })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear notifications' },
      { status: 500 }
    )
  }
}
