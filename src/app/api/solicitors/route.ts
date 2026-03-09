import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const solicitors = await db.solicitor.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ solicitors })
  } catch (error) {
    console.error('Failed to fetch solicitors:', error)
    return NextResponse.json({ solicitors: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const solicitor = await db.solicitor.create({
      data: {
        name: data.name,
        firm: data.firm || null,
        email: data.email || null,
        phone: data.phone || null,
        specialty: data.specialty || null,
        status: 'active',
      },
    })
    return NextResponse.json({ solicitor })
  } catch (error) {
    console.error('Failed to create solicitor:', error)
    return NextResponse.json({ error: 'Failed to create solicitor' }, { status: 500 })
  }
}
