import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface Params {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json()
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    const role = typeof body?.role === 'string' ? body.role : ''

    if (!content || !role) {
      return NextResponse.json({ error: 'role and content are required' }, { status: 400 })
    }

    const timestampCandidate =
      typeof body?.timestamp === 'string' || typeof body?.timestamp === 'number'
        ? new Date(body.timestamp)
        : null
    const createdAt = timestampCandidate && !Number.isNaN(timestampCandidate.getTime()) ? timestampCandidate : new Date()
    const title = typeof body?.title === 'string' ? body.title.trim() : ''

    const result = await db.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: params.id,
          role,
          content,
          agentType: typeof body?.agentType === 'string' ? body.agentType : null,
          agentName: typeof body?.agentName === 'string' ? body.agentName : null,
          createdAt,
        },
      })

      const conversation = await tx.conversation.update({
        where: { id: params.id },
        data: {
          ...(title ? { title } : {}),
        },
      })

      return { message, conversation }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to append conversation message:', error)
    return NextResponse.json({ error: 'Failed to append conversation message' }, { status: 500 })
  }
}
