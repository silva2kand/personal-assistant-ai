import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 100), 1), 500)

    const entity = await db.agentEntity.findUnique({
      where: { id },
      select: {
        id: true,
        agentType: true,
        entityKey: true,
        title: true,
        status: true,
        lastUpdateAt: true,
      },
    })
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    const events = await db.agentEntityEvent.findMany({
      where: { agentEntityId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const emailSourceRefs = events
      .filter((e) => e.source === 'email' && e.sourceRef)
      .map((e) => e.sourceRef)

    const emailRows = emailSourceRefs.length
      ? await db.emailMessage.findMany({
          where: { id: { in: emailSourceRefs } },
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            date: true,
            provider: true,
          },
        })
      : []

    const emailMap = new Map(emailRows.map((row) => [row.id, row]))

    return NextResponse.json({
      entity,
      events: events.map((event) => {
        const email = emailMap.get(event.sourceRef)
        return {
          id: event.id,
          source: event.source,
          sourceRef: event.sourceRef,
          rawRef: event.rawRef,
          summary: event.summary,
          createdAt: event.createdAt,
          subject: email?.subject || '',
          fromAddress: email?.fromAddress || '',
          emailDate: email?.date || null,
          provider: email?.provider || null,
        }
      }),
    })
  } catch (error) {
    console.error('Failed to fetch agent entity timeline:', error)
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 })
  }
}
