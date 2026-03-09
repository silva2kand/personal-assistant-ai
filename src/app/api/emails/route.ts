import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const accounts = await db.emailAccount.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ accounts })
  } catch (error) {
    console.error('Failed to fetch email accounts:', error)
    return NextResponse.json({ accounts: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const account = await db.emailAccount.create({
      data: {
        provider: data.provider,
        email: data.email,
        displayName: data.displayName || null,
        status: 'connected',
        lastSync: new Date(),
      },
    })
    return NextResponse.json({ account })
  } catch (error) {
    console.error('Failed to create email account:', error)
    return NextResponse.json({ error: 'Failed to create email account' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    await db.emailAccount.delete({
      where: { id },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete email account:', error)
    return NextResponse.json({ error: 'Failed to delete email account' }, { status: 500 })
  }
}
