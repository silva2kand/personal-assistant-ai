import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureAgentAutomationWorkerStarted } from '@/lib/agent-automation'

// GET - List all agent sessions
export async function GET() {
  try {
    ensureAgentAutomationWorkerStarted()
    const sessions = await db.agentSession.findMany({
      orderBy: { lastActive: 'desc' },
    })
    
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('Error fetching agent sessions:', error)
    return NextResponse.json({ sessions: [] })
  }
}

// POST - Create or update agent session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { agentType, status, context } = body

    // Find or create agent session
    const existing = await db.agentSession.findFirst({
      where: { agentType },
    })

    let session
    if (existing) {
      session = await db.agentSession.update({
        where: { id: existing.id },
        data: {
          status,
          context: context ? JSON.stringify(context) : existing.context,
          lastActive: new Date(),
        },
      })
    } else {
      session = await db.agentSession.create({
        data: {
          agentType,
          status: status || 'idle',
          context: context ? JSON.stringify(context) : null,
        },
      })
    }

    return NextResponse.json({ session })
  } catch (error) {
    console.error('Error updating agent session:', error)
    return NextResponse.json(
      { error: 'Failed to update agent session' },
      { status: 500 }
    )
  }
}
