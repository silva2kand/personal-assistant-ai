import { NextRequest, NextResponse } from 'next/server'
import { sendOutlookMail } from '@/lib/outlook-graph'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.to || !body?.subject || !body?.body) {
      return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 })
    }

    await sendOutlookMail({
      to: body.to,
      subject: body.subject,
      body: body.body,
      cc: Array.isArray(body.cc) ? body.cc : undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send Outlook message' },
      { status: 500 }
    )
  }
}
