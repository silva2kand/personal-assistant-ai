import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface Params {
  params: { id: string }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const conversation = await db.conversation.findUnique({
      where: { id: params.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error('Failed to fetch conversation:', error)
    return NextResponse.json({ error: 'Failed to fetch conversation' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json().catch(() => ({}))
    const data: { title?: string; model?: string } = {}

    if (typeof body?.title === 'string') {
      data.title = body.title.trim() || 'New Chat'
    }
    if (typeof body?.model === 'string' && body.model.trim()) {
      data.model = body.model.trim()
    }

    if (!data.title && !data.model) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const conversation = await db.conversation.update({
      where: { id: params.id },
      data,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error('Failed to update conversation:', error)
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await db.conversation.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to delete conversation:', error)
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }
}
