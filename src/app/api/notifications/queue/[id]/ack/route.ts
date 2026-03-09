import { NextRequest, NextResponse } from 'next/server'
import { acknowledgeNotification } from '@/lib/notification-center'

export const runtime = 'nodejs'

export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const item = await acknowledgeNotification(id)
    if (!item) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, item })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to acknowledge notification' },
      { status: 500 }
    )
  }
}
