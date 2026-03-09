import { NextRequest, NextResponse } from 'next/server'
import {
  deleteMailboxSenderRuleById,
  getMailboxSenderRules,
  upsertMailboxSenderRule,
} from '@/lib/mailbox-rules'
import type { MailboxRuleAction } from '@/lib/mailbox-rules'

export const runtime = 'nodejs'

function parseAction(value: unknown): MailboxRuleAction | null {
  const action = String(value || '').trim().toLowerCase()
  if (action === 'important' || action === 'junk') return action
  return null
}

export async function GET() {
  try {
    const rules = await getMailboxSenderRules()
    return NextResponse.json({ rules })
  } catch (error) {
    console.error('Failed to load mailbox sender rules:', error)
    return NextResponse.json({ rules: [], error: 'Failed to load rules' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const senderPattern = String(body?.senderPattern || '').trim()
    const action = parseAction(body?.action)

    if (!senderPattern) {
      return NextResponse.json({ error: 'senderPattern is required' }, { status: 400 })
    }
    if (!action) {
      return NextResponse.json({ error: 'action must be important or junk' }, { status: 400 })
    }

    const rules = await upsertMailboxSenderRule({ senderPattern, action })
    return NextResponse.json({ rules })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save rule'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const queryId = req.nextUrl.searchParams.get('id')
    const body = await req.json().catch(() => ({}))
    const id = String(queryId || body?.id || '').trim()
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const deleted = await deleteMailboxSenderRuleById(id)
    if (!deleted) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const rules = await getMailboxSenderRules()
    return NextResponse.json({ ok: true, rules })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete rule'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
