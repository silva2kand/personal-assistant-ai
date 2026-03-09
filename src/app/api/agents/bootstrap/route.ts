import { NextRequest, NextResponse } from 'next/server'
import {
  ensureAgentAutomationWorkerStarted,
  getHistoricalBackfillSnapshot,
  runHistoricalBackfill,
} from '@/lib/agent-automation'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

function toSinceDate(inputYear?: number): string {
  const nowYear = new Date().getUTCFullYear()
  const safeYear = Math.min(Math.max(Number(inputYear || 2023), 2018), nowYear)
  return `${safeYear}-01-01T00:00:00.000Z`
}

export async function GET() {
  try {
    ensureAgentAutomationWorkerStarted()
    const snapshot = getHistoricalBackfillSnapshot()
    const connectedAccounts = await db.emailAccount.count({
      where: { status: 'connected' },
    })

    return NextResponse.json({
      ok: true,
      connectedAccounts,
      ...snapshot,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch bootstrap status' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const body = await req.json().catch(() => ({}))
    const sinceDate = toSinceDate(Number(body?.sinceYear || 2023))
    const force = body?.force === true

    const connectedAccounts = await db.emailAccount.count({
      where: { status: 'connected' },
    })
    if (connectedAccounts === 0) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'no_connected_accounts',
        connectedAccounts,
        ...getHistoricalBackfillSnapshot(),
      })
    }

    const maxFetchPerProvider = Math.max(
      500,
      Math.min(Number(body?.maxFetchPerProvider || process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 20000)
    )

    const alreadyRunning = getHistoricalBackfillSnapshot().running
    if (!alreadyRunning) {
      void runHistoricalBackfill({
        sinceDate,
        maxFetchPerProvider,
        force,
      }).catch(() => {
        // Error is surfaced through snapshot fields.
      })
    }

    return NextResponse.json({
      ok: true,
      triggered: !alreadyRunning,
      sinceDate,
      connectedAccounts,
      ...getHistoricalBackfillSnapshot(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger bootstrap backfill' },
      { status: 500 }
    )
  }
}
