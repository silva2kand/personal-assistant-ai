import { NextRequest, NextResponse } from 'next/server'
import { getDomainCounts, buildBrainMemory, type BrainDomain } from '@/lib/specialist-brains'

export const runtime = 'nodejs'

/**
 * GET /api/brain/domains
 * Returns real-time domain counts and brain status for all specialist agents.
 */
export async function GET() {
    try {
        const counts = await getDomainCounts()

        return NextResponse.json({
            ok: true,
            domains: counts,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error('Brain domains API error:', error)
        return NextResponse.json(
            { ok: false, error: error instanceof Error ? error.message : 'Failed to load domain counts' },
            { status: 500 }
        )
    }
}

/**
 * POST /api/brain/domains
 * Load full brain memory snapshot for a specific domain.
 * Body: { domain: 'solicitor' | 'accountant' | 'supplier' | 'business' | 'research', search?: string }
 */
export async function POST(req: NextRequest) {
    try {
        const { domain, search } = await req.json()
        const validDomains: BrainDomain[] = ['solicitor', 'accountant', 'supplier', 'business', 'research', 'general']

        if (!domain || !validDomains.includes(domain)) {
            return NextResponse.json(
                { ok: false, error: `Invalid domain. Must be one of: ${validDomains.join(', ')}` },
                { status: 400 }
            )
        }

        const memory = await buildBrainMemory(domain, search)

        return NextResponse.json({
            ok: true,
            memory: {
                domain: memory.domain,
                totalEmails: memory.totalEmails,
                totalEntities: memory.totalEntities,
                entitySummaries: memory.entitySummaries,
                recentEmailCount: memory.recentEmails.length,
                relevantEmailCount: memory.relevantEmails.length,
                hasProfile: !!memory.masterProfile,
                generatedAt: memory.generatedAt,
            },
            entities: memory.entitySummaries,
            recentEmails: memory.recentEmails.slice(0, 20),
            relevantEmails: memory.relevantEmails.slice(0, 20),
        })
    } catch (error) {
        console.error('Brain memory load error:', error)
        return NextResponse.json(
            { ok: false, error: error instanceof Error ? error.message : 'Failed to load brain memory' },
            { status: 500 }
        )
    }
}
