import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

function safeJsonParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    const entity = await db.agentEntity.findUnique({
      where: { id },
      include: { state: true },
    })
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    return NextResponse.json({
      entity: {
        id: entity.id,
        agentType: entity.agentType,
        entityKey: entity.entityKey,
        title: entity.title,
        status: entity.status,
        lastUpdateAt: entity.lastUpdateAt,
      },
      state: safeJsonParse(entity.state?.stateJson, {}),
    })
  } catch (error) {
    console.error('Failed to fetch agent entity state:', error)
    return NextResponse.json({ error: 'Failed to fetch state' }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))

    const incomingStatus = String(body?.status || '').trim().toLowerCase()
    const allowed = new Set(['open', 'waiting', 'blocked', 'closed'])
    if (!allowed.has(incomingStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const entity = await db.agentEntity.update({
      where: { id },
      data: {
        status: incomingStatus,
        lastUpdateAt: new Date(),
      },
      include: { state: true },
    })

    const state = safeJsonParse<Record<string, unknown>>(entity.state?.stateJson, {})
    const nextState = {
      ...state,
      status: incomingStatus,
      next_actions:
        incomingStatus === 'closed'
          ? []
          : Array.isArray(state.next_actions)
          ? state.next_actions
          : [],
    }

    await db.agentEntityState.upsert({
      where: { agentEntityId: id },
      update: {
        stateJson: JSON.stringify(nextState),
        updatedAt: new Date(),
      },
      create: {
        agentEntityId: id,
        stateJson: JSON.stringify(nextState),
      },
    })

    return NextResponse.json({
      ok: true,
      entity: {
        id: entity.id,
        status: entity.status,
        lastUpdateAt: entity.lastUpdateAt,
      },
      state: nextState,
    })
  } catch (error) {
    console.error('Failed to patch agent entity state:', error)
    return NextResponse.json({ error: 'Failed to update state' }, { status: 500 })
  }
}
