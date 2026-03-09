import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const conversations = await db.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      take: 200,
    })

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('Failed to fetch conversations:', error)
    return NextResponse.json({ conversations: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : 'New Chat'
    const model = typeof body?.model === 'string' && body.model.trim().length > 0 ? body.model.trim() : 'ollama'

    const conversation = await db.conversation.create({
      data: {
        title,
        model,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error('Failed to create conversation:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await db.conversation.deleteMany({})
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to delete all conversations:', error)
    return NextResponse.json({ error: 'Failed to delete all conversations' }, { status: 500 })
  }
}
