import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const accountants = await db.accountant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ accountants })
  } catch (error) {
    console.error('Failed to fetch accountants:', error)
    return NextResponse.json({ accountants: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const accountant = await db.accountant.create({
      data: {
        name: data.name,
        firm: data.firm || null,
        email: data.email || null,
        phone: data.phone || null,
        specialty: data.specialty || null,
        status: 'active',
      },
    })
    return NextResponse.json({ accountant })
  } catch (error) {
    console.error('Failed to create accountant:', error)
    return NextResponse.json({ error: 'Failed to create accountant' }, { status: 500 })
  }
}
