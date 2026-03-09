import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted, runAgentAutomationCycle } from '@/lib/agent-automation'
import { db } from '@/lib/db'
import { getUnifiedInbox } from '@/lib/email-hub'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    if (req.nextUrl.searchParams.get('sync') === '1') {
      await runAgentAutomationCycle()
    }

    const top = Math.min(Math.max(Number(req.nextUrl.searchParams.get('top') || 40), 1), 100)
    const entityKey = (req.nextUrl.searchParams.get('entityKey') || '').trim()
    const agentType = (req.nextUrl.searchParams.get('agentType') || '').trim()

    if (entityKey) {
      const rows = await db.emailMessage.findMany({
        where: {
          entityKey,
          ...(agentType ? { classifiedAs: agentType } : {}),
        },
        orderBy: { date: 'desc' },
        take: top,
      })

      const messages = rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        subject: row.subject,
        receivedDateTime: row.date.toISOString(),
        bodyPreview: row.body,
        fromName: row.fromAddress,
        fromAddress: row.fromAddress,
      }))

      return NextResponse.json({ messages })
    }

    const messages = await getUnifiedInbox(top)
    return NextResponse.json({ messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch unified inbox' },
      { status: 500 }
    )
  }
}
