import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted, runAgentAutomationCycle } from '@/lib/agent-automation'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()

    const sync = req.nextUrl.searchParams.get('sync')
    if (sync === '1') {
      try {
        await runAgentAutomationCycle()
      } catch {
        // Keep endpoint readable even if sync fails.
      }
    }

    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 200), 1), 1000)
    const order = req.nextUrl.searchParams.get('order') === 'desc' ? 'desc' : 'asc'
    const agentType = (req.nextUrl.searchParams.get('agentType') || '').trim()
    const entityKey = (req.nextUrl.searchParams.get('entityKey') || '').trim()

    const agentEntityWhere: Record<string, unknown> = {}
    if (agentType) {
      agentEntityWhere.agentType = agentType
    }
    if (entityKey) {
      agentEntityWhere.entityKey = { contains: entityKey }
    }
    const eventWhere = Object.keys(agentEntityWhere).length > 0 ? { agentEntity: agentEntityWhere } : {}

    const [total, events] = await Promise.all([
      db.agentEntityEvent.count({ where: eventWhere }),
      db.agentEntityEvent.findMany({
        where: eventWhere,
        include: {
          agentEntity: {
            select: {
              id: true,
              agentType: true,
              entityKey: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: order },
        take: limit,
      }),
    ])

    const emailSourceRefs = events
      .filter((event) => event.source === 'email' && event.sourceRef)
      .map((event) => event.sourceRef)

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
      total,
      returned: events.length,
      filters: {
        agentType: agentType || null,
        entityKey: entityKey || null,
        order,
      },
      events: events.map((event) => {
        const email = emailMap.get(event.sourceRef)
        return {
          id: event.id,
          createdAt: event.createdAt,
          source: event.source,
          summary: event.summary,
          sourceRef: event.sourceRef,
          rawRef: event.rawRef,
          entity: {
            id: event.agentEntity.id,
            agentType: event.agentEntity.agentType,
            entityKey: event.agentEntity.entityKey,
            title: event.agentEntity.title,
            status: event.agentEntity.status,
          },
          email: email
            ? {
                provider: email.provider,
                date: email.date,
                fromAddress: email.fromAddress,
                subject: email.subject,
              }
            : null,
        }
      }),
    })
  } catch (error) {
    console.error('Failed to fetch central timeline:', error)
    return NextResponse.json({ error: 'Failed to fetch central timeline' }, { status: 500 })
  }
}
