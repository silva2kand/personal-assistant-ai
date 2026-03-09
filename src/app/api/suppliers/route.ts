import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const suppliers = await db.supplier.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ suppliers })
  } catch (error) {
    console.error('Failed to fetch suppliers:', error)
    return NextResponse.json({ suppliers: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const supplier = await db.supplier.create({
      data: {
        name: data.name,
        category: data.category || null,
        email: data.email || null,
        phone: data.phone || null,
        website: data.website || null,
        status: 'active',
      },
    })
    return NextResponse.json({ supplier })
  } catch (error) {
    console.error('Failed to create supplier:', error)
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 })
  }
}
