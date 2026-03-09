import { NextRequest, NextResponse } from 'next/server'
import { analyzeAndRouteEmail } from '@/lib/email-routing'
import { EmailProvider, getUnifiedMessageById } from '@/lib/email-hub'

export const runtime = 'nodejs'

function isProvider(value: string): value is EmailProvider {
  return value === 'gmail' || value === 'outlook'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const provider = String(body?.provider || '').toLowerCase()
    const messageId = String(body?.messageId || '')

    if (!isProvider(provider) || !messageId) {
      return NextResponse.json(
        { error: 'provider (gmail|outlook) and messageId are required' },
        { status: 400 }
      )
    }

    const message = await getUnifiedMessageById(provider, messageId)
    const analysis = await analyzeAndRouteEmail(message)
    return NextResponse.json({ message, analysis })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze email' },
      { status: 500 }
    )
  }
}
