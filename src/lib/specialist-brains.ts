/**
 * Specialist Brains — Real separate AI agents for Legal, Financial, and Supplier domains.
 *
 * Each brain has:
 * 1. Its own UK-specific system prompt with professional knowledge
 * 2. Access to ALL classified emails in its domain
 * 3. Access to ALL entity states (cases, issues, threads) in its domain
 * 4. Memory of the master profile (user identity, properties, businesses)
 * 5. Real context injection so the AI model actually KNOWS what happened
 */

import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrainDomain = 'solicitor' | 'accountant' | 'supplier' | 'business' | 'research' | 'general'

export interface BrainMemorySnapshot {
    domain: BrainDomain
    totalEmails: number
    totalEntities: number
    entitySummaries: EntitySummary[]
    recentEmails: EmailDigest[]
    relevantEmails: EmailDigest[]
    masterProfile: MasterProfileDigest | null
    generatedAt: string
}

export interface EntitySummary {
    entityKey: string
    agentType: string
    status: string
    title: string
    lastUpdateAt: string
    state: {
        status?: string
        waiting_on?: string
        last_email_date?: string
        facts?: Record<string, unknown>
        next_actions?: string[]
    } | null
    eventCount: number
    latestEmailFrom?: string
    latestEmailSubject?: string
    latestEmailDate?: string
}

export interface EmailDigest {
    id: string
    provider: string
    fromAddress: string
    toAddress: string
    subject: string
    body: string
    date: string
    classifiedAs: string | null
    entityKey: string | null
}

export interface MasterProfileDigest {
    aliases: string[]
    businesses: string[]
    addresses: string[]
    propertyAssets: string[]
    coreSuppliers: string[]
    focusAreas: string[]
    importantSenders: string[]
    notes: string[]
}

export interface BrainResponse {
    systemPrompt: string
    contextMessages: { role: string; content: string }[]
    agentLabel: string
    agentContribution: string
    domain: BrainDomain
}

// ---------------------------------------------------------------------------
// System Prompts — Real UK Professional Knowledge
// ---------------------------------------------------------------------------

const LEGAL_BRAIN_SYSTEM_PROMPT = `You are Silva's UK Legal Advisor AI — a specialist solicitor-brain embedded in his personal operating system.

YOUR IDENTITY:
- You are one of three specialist AI brains serving Silva Kandasamy
- Your domain: UK legal matters, conveyancing, land registry, leasehold/freehold, contracts, compliance, council
- You have FULL access to all legal-classified emails, entity states, and document vault

YOUR CLIENT:
- Silva Kandasamy (also known as Shiva Kandasamy, Siyanthank Kandasamy)
- Businesses: Silva Retail Ltd (active), Newton Newsagent (trading name)
- Properties: 6F Steamer Street, Barrow-in-Furness, LA14 5SG (flat purchased 05 Sep 2024)
- Home: 3 Langdale Place, Lancaster, LA1 3NS
- Key solicitor: Alice McClellan at RC Legal (aliceamclellan@rc.legal)

YOUR UK LEGAL KNOWLEDGE:
- Land Registry (HMLR) processes, title registers, title deeds
- Leasehold vs freehold, lease extensions under Leasehold Reform Act
- Conveyancing timeline and completion process
- Section 20 notices, service charge disputes
- Building regulations and planning permission
- Council tax bands, council disputes
- Landlord/tenant law (Housing Act 1988, Protection from Eviction Act 1977)
- Companies House filings and compliance
- Consumer rights and trading standards
- GDPR and data protection obligations

BEHAVIOUR RULES:
- ALWAYS reference real emails and facts from your memory context below
- NEVER say "I don't have access" — you DO have access, check the context
- When asked about any legal matter, search through the email memory provided
- Summarize the CURRENT STATUS of legal matters based on real email evidence
- Flag deadlines, risks, and required actions
- If something requires a human solicitor, say so clearly
- Use UK legal terminology and references
- Protect Silva's interests — flag any risk immediately
- NEVER delete or discard any legal document without explicit confirmation`

const FINANCIAL_BRAIN_SYSTEM_PROMPT = `You are Silva's UK Financial Advisor AI — a specialist accountant-brain embedded in his personal operating system.

YOUR IDENTITY:
- You are one of three specialist AI brains serving Silva Kandasamy
- Your domain: UK tax, VAT, HMRC, self-assessment, corporation tax, payroll, invoicing, banking, insurance
- You have FULL access to all financial-classified emails, entity states, and document vault

YOUR CLIENT:
- Silva Kandasamy (also known as Shiva Kandasamy)
- Businesses: Silva Retail Ltd (active), Newton Newsagent (trading name)
- Previously: YourShop1 Ltd (closed), Newton Store Ltd (closed)
- Properties: 6F Steamer Street, Barrow-in-Furness (flat, purchased 05 Sep 2024)

YOUR UK FINANCIAL KNOWLEDGE:
- HMRC Self Assessment deadlines (31 Jan / 31 Jul)
- Corporation Tax (19-25% from Apr 2023), CT600 filing
- VAT registration threshold (£90,000), MTD requirements
- Income Tax bands: 0% to £12,570, 20% to £50,270, 40% to £125,140, 45% above
- National Insurance contributions (Class 2, Class 4)
- Capital Gains Tax on property (18%/28% residential)
- Annual Investment Allowance, capital allowances
- Stamp Duty Land Tax rates and reliefs
- Business rates and reliefs (small business rate relief)
- Dividend tax rates and allowances
- Making Tax Digital for Income Tax (starting Apr 2026)
- PAYE and payroll obligations
- ISA allowances and pension contributions

BEHAVIOUR RULES:
- ALWAYS reference real emails and facts from your memory context below
- Track ALL financial deadlines, amounts, and obligations
- Flag overdue or upcoming HMRC deadlines immediately
- Summarize tax positions, outstanding liabilities, and payment history
- When asked about finances, search through the email memory provided
- Cross-reference invoices, payments, and bank statements
- If something needs a human accountant, say so clearly
- Use UK tax terminology and HMRC references
- NEVER delete financial records without explicit confirmation
- Flag any potential tax savings or deductions`

const SUPPLIER_BRAIN_SYSTEM_PROMPT = `You are Silva's UK Supplier & Operations Manager AI — a specialist supply-chain brain embedded in his personal operating system.

YOUR IDENTITY:
- You are one of three specialist AI brains serving Silva Kandasamy
- Your domain: wholesale suppliers, orders, deliveries, stock management, pricing, supplier relationships
- You have FULL access to all supplier-classified emails, entity states, and document vault

YOUR CLIENT:
- Silva Kandasamy
- Business: Newton Newsagent / Silva Retail Ltd (convenience store/newsagent)
- Key suppliers: Booker, Parfetts, Bestway/Batleys, Hancocks, Damecha, Khanjra

YOUR SUPPLIER KNOWLEDGE:
- UK wholesale and cash & carry operations
- Supplier credit terms and payment cycles
- Stock ordering and reorder points
- Delivery scheduling and logistics
- Price comparison across suppliers
- Promotional deals and trade offers
- PayPoint operations and settlement
- WorldPay/card terminal management
- Tobacco and alcohol licensing requirements
- Food safety and HACCP compliance
- National Lottery operations
- Trading standards compliance

BEHAVIOUR RULES:
- ALWAYS reference real emails and facts from your memory context below
- Track ALL orders, deliveries, invoices, and payment deadlines
- Compare prices across suppliers when relevant
- Flag any delivery issues, stock shortages, or payment disputes
- When asked about suppliers, search through the email memory provided
- Identify cost-saving opportunities and better deals
- Track promotional offers and limited-time deals
- Monitor supplier communication patterns
- NEVER confirm an order or payment without explicit user approval
- Flag any unusual charges or discrepancies`

const BUSINESS_BRAIN_SYSTEM_PROMPT = `You are Silva's UK Business Operations AI — managing general business operations, banking, insurance, utilities, and property management.

YOUR IDENTITY:
- You are one of three specialist AI brains, handling all business operations not covered by Legal, Financial, or Supplier brains
- Your domain: banking, insurance, utilities, broadband, mobile, council tax, business rates, property operations

YOUR CLIENT:
- Silva Kandasamy
- Businesses: Silva Retail Ltd, Newton Newsagent
- Properties: 6F Steamer Street, Barrow-in-Furness; 3 Langdale Place, Lancaster
- Banking: Halifax, Tide (business accounts)

BEHAVIOUR RULES:
- ALWAYS reference real emails and facts from your memory context
- Track all business operations, payments, and service contracts
- Monitor utility bills, insurance renewals, and banking communications
- Flag any cost-saving opportunities
- When asked about business operations, search through the email memory provided
- NEVER approve any payment or contract change without explicit user confirmation`

const RESEARCH_BRAIN_SYSTEM_PROMPT = `You are Silva's Research & Intelligence AI — coordinating across all specialist brains and handling general queries.

YOUR IDENTITY:
- You are the coordinator brain that can access information from Legal, Financial, and Supplier domains
- Your domain: cross-cutting queries, general research, status overviews, opportunity identification

BEHAVIOUR RULES:
- Provide comprehensive answers by pulling from all available domain data
- ALWAYS reference real emails and facts from your memory context
- When asked for general updates, summarise across all domains
- Identify cross-domain connections and opportunities`

// ---------------------------------------------------------------------------
// Memory Retrieval — Load Real Email Data For Each Brain
// ---------------------------------------------------------------------------

function safeJsonParse<T>(value?: string | null, fallback?: T): T {
    if (!value) return fallback as T
    try { return JSON.parse(value) as T } catch { return fallback as T }
}

const DOMAIN_MAP: Record<BrainDomain, string[]> = {
    solicitor: ['solicitor'],
    accountant: ['accountant'],
    supplier: ['supplier'],
    business: ['business'],
    research: ['research', 'general'],
    general: ['general'],
}

/**
 * Load ALL emails classified under a given domain, most recent first.
 * For context injection, we cap at a reasonable size but still load the full picture.
 */
export async function loadDomainEmails(
    domain: BrainDomain,
    options?: { limit?: number; search?: string }
): Promise<EmailDigest[]> {
    const classifiedValues = DOMAIN_MAP[domain] || [domain]
    const limit = Math.max(1, Math.min(Number(options?.limit || 200), 1000))

    const where: any = {
        classifiedAs: { in: classifiedValues },
    }

    if (options?.search) {
        const search = options.search.trim()
        where.OR = [
            { subject: { contains: search } },
            { body: { contains: search } },
            { fromAddress: { contains: search } },
            { entityKey: { contains: search } },
        ]
    }

    const rows = await db.emailMessage.findMany({
        where,
        orderBy: { date: 'desc' },
        take: limit,
        select: {
            id: true,
            provider: true,
            fromAddress: true,
            toAddress: true,
            subject: true,
            body: true,
            date: true,
            classifiedAs: true,
            entityKey: true,
        },
    })

    return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        fromAddress: r.fromAddress,
        toAddress: r.toAddress,
        subject: r.subject,
        body: (r.body || '').slice(0, 500),
        date: r.date.toISOString(),
        classifiedAs: r.classifiedAs,
        entityKey: r.entityKey,
    }))
}

/**
 * Load ALL entity summaries (cases/issues/threads) for a domain, with their states.
 */
export async function loadDomainEntities(domain: BrainDomain): Promise<EntitySummary[]> {
    const agentTypes = DOMAIN_MAP[domain] || [domain]

    const entities = await db.agentEntity.findMany({
        where: { agentType: { in: agentTypes } },
        orderBy: { lastUpdateAt: 'desc' },
        take: 100,
        include: {
            state: true,
            events: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { summary: true, createdAt: true },
            },
            _count: {
                select: { events: true },
            },
        },
    })

    return entities.map((e) => {
        const stateData = e.state ? safeJsonParse<any>(e.state.stateJson, null) : null
        const latestEvent = e.events[0]
        const latestSummary = latestEvent?.summary || ''
        const fromMatch = latestSummary.match(/^([^\s]+@[^\s]+|[^-]+)\s*-/)

        return {
            entityKey: e.entityKey,
            agentType: e.agentType,
            status: e.status,
            title: e.title || e.entityKey,
            lastUpdateAt: e.lastUpdateAt.toISOString(),
            state: stateData
                ? {
                    status: stateData.status,
                    waiting_on: stateData.waiting_on,
                    last_email_date: stateData.last_email_date,
                    facts: stateData.facts,
                    next_actions: stateData.next_actions,
                }
                : null,
            eventCount: e._count.events,
            latestEmailFrom: fromMatch?.[1]?.trim(),
            latestEmailSubject: latestSummary.split(' - ')[1]?.trim(),
            latestEmailDate: latestEvent?.createdAt?.toISOString(),
        }
    })
}

/**
 * Load master profile memory.
 */
export async function loadMasterProfile(): Promise<MasterProfileDigest | null> {
    const entity = await db.agentEntity.findUnique({
        where: {
            agentType_entityKey: {
                agentType: 'research',
                entityKey: 'silva-master-profile',
            },
        },
        select: { id: true },
    })
    if (!entity) return null

    const state = await db.agentEntityState.findUnique({
        where: { agentEntityId: entity.id },
        select: { stateJson: true },
    })
    if (!state?.stateJson) return null

    return safeJsonParse<MasterProfileDigest>(state.stateJson, null)
}

/**
 * Build complete memory snapshot for a brain domain.
 */
export async function buildBrainMemory(
    domain: BrainDomain,
    searchQuery?: string
): Promise<BrainMemorySnapshot> {
    const [emails, entities, profile, totalEmails, totalEntities] = await Promise.all([
        loadDomainEmails(domain, { limit: 200 }),
        loadDomainEntities(domain),
        loadMasterProfile(),
        db.emailMessage.count({ where: { classifiedAs: { in: DOMAIN_MAP[domain] || [domain] } } }),
        db.agentEntity.count({ where: { agentType: { in: DOMAIN_MAP[domain] || [domain] } } }),
    ])

    // If there's a search query, also load specifically relevant emails
    let relevantEmails: EmailDigest[] = []
    if (searchQuery) {
        relevantEmails = await loadDomainEmails(domain, { limit: 50, search: searchQuery })
    }

    return {
        domain,
        totalEmails,
        totalEntities,
        entitySummaries: entities,
        recentEmails: emails.slice(0, 50),
        relevantEmails,
        masterProfile: profile,
        generatedAt: new Date().toISOString(),
    }
}

// ---------------------------------------------------------------------------
// Cross-Domain Memory — For research/general queries that need all domains
// ---------------------------------------------------------------------------

export async function buildCrossDomainMemory(searchQuery?: string): Promise<{
    legal: BrainMemorySnapshot
    financial: BrainMemorySnapshot
    supplier: BrainMemorySnapshot
    business: BrainMemorySnapshot
    totalEmailsAllDomains: number
}> {
    const [legal, financial, supplier, business, totalEmailsAllDomains] = await Promise.all([
        buildBrainMemory('solicitor', searchQuery),
        buildBrainMemory('accountant', searchQuery),
        buildBrainMemory('supplier', searchQuery),
        buildBrainMemory('business', searchQuery),
        db.emailMessage.count(),
    ])

    return { legal, financial, supplier, business, totalEmailsAllDomains }
}

// ---------------------------------------------------------------------------
// Context Builder — Format memory into AI-consumable context
// ---------------------------------------------------------------------------

function formatEntityContext(entities: EntitySummary[]): string {
    if (entities.length === 0) return 'No tracked cases/issues in this domain yet.'

    return entities
        .map((e) => {
            const lines = [
                `📂 ${e.title}`,
                `   Status: ${e.state?.status || e.status} | Entity: ${e.entityKey}`,
                `   Last update: ${e.lastUpdateAt.slice(0, 10)}`,
            ]
            if (e.state?.waiting_on && e.state.waiting_on !== 'none') {
                lines.push(`   ⏳ Waiting on: ${e.state.waiting_on}`)
            }
            if (e.state?.facts && Object.keys(e.state.facts).length > 0) {
                const factStr = Object.entries(e.state.facts)
                    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                    .join('; ')
                lines.push(`   Facts: ${factStr}`)
            }
            if (e.state?.next_actions?.length) {
                lines.push(`   Next actions: ${e.state.next_actions.join(' | ')}`)
            }
            if (e.latestEmailFrom) {
                lines.push(`   Latest from: ${e.latestEmailFrom} — ${e.latestEmailSubject || '(No Subject)'}`)
            }
            return lines.join('\n')
        })
        .join('\n\n')
}

function formatEmailContext(emails: EmailDigest[], label: string): string {
    if (emails.length === 0) return `No ${label} emails found.`

    return emails
        .slice(0, 40)
        .map((e) => {
            const date = e.date.slice(0, 10)
            const body = (e.body || '').replace(/\s+/g, ' ').trim().slice(0, 200)
            return `[${date}] ${e.provider.toUpperCase()} | From: ${e.fromAddress} | Subject: ${e.subject}${body ? ` | ${body}` : ''}`
        })
        .join('\n')
}

function formatProfileContext(profile: MasterProfileDigest | null): string {
    if (!profile) return 'Master profile not yet loaded.'

    const lines: string[] = []
    if (profile.aliases?.length) lines.push(`Client names: ${profile.aliases.join(', ')}`)
    if (profile.businesses?.length) lines.push(`Businesses: ${profile.businesses.join(', ')}`)
    if (profile.addresses?.length) lines.push(`Addresses: ${profile.addresses.join(', ')}`)
    if (profile.propertyAssets?.length) lines.push(`Property assets: ${profile.propertyAssets.join(', ')}`)
    if (profile.coreSuppliers?.length) lines.push(`Core suppliers: ${profile.coreSuppliers.join(', ')}`)
    if (profile.importantSenders?.length) lines.push(`Important senders: ${profile.importantSenders.slice(0, 20).join(', ')}`)
    if (profile.focusAreas?.length) lines.push(`Focus areas: ${profile.focusAreas.join(', ')}`)
    if (profile.notes?.length) lines.push(`Notes: ${profile.notes.join('; ')}`)
    return lines.join('\n')
}

/**
 * Build the full context injection for a specialist brain.
 * This is what makes the agent REAL — it injects actual email data and entity states.
 */
function buildContextMessage(memory: BrainMemorySnapshot): string {
    const sections: string[] = [
        `=== ${memory.domain.toUpperCase()} BRAIN MEMORY (as of ${memory.generatedAt.slice(0, 19)}) ===`,
        '',
        `📊 Domain Statistics: ${memory.totalEmails} emails classified | ${memory.totalEntities} tracked cases/issues`,
        '',
        '--- CLIENT PROFILE ---',
        formatProfileContext(memory.masterProfile),
        '',
        '--- ACTIVE CASES & ISSUES ---',
        formatEntityContext(memory.entitySummaries),
        '',
        '--- RECENT EMAILS (most recent first) ---',
        formatEmailContext(memory.recentEmails, 'recent'),
    ]

    if (memory.relevantEmails.length > 0) {
        sections.push(
            '',
            '--- SEARCH-MATCHED EMAILS ---',
            formatEmailContext(memory.relevantEmails, 'search-matched')
        )
    }

    sections.push(
        '',
        '=== END OF MEMORY CONTEXT ==='
    )

    return sections.join('\n')
}

// ---------------------------------------------------------------------------
// Main Entry — Build Brain Response for Chat
// ---------------------------------------------------------------------------

function getSystemPrompt(domain: BrainDomain): string {
    switch (domain) {
        case 'solicitor': return LEGAL_BRAIN_SYSTEM_PROMPT
        case 'accountant': return FINANCIAL_BRAIN_SYSTEM_PROMPT
        case 'supplier': return SUPPLIER_BRAIN_SYSTEM_PROMPT
        case 'business': return BUSINESS_BRAIN_SYSTEM_PROMPT
        case 'research':
        case 'general':
        default: return RESEARCH_BRAIN_SYSTEM_PROMPT
    }
}

function getAgentLabel(domain: BrainDomain): string {
    switch (domain) {
        case 'solicitor': return 'Legal Agent'
        case 'accountant': return 'Financial Agent'
        case 'supplier': return 'Supplier Agent'
        case 'business': return 'Business Agent'
        case 'research':
        case 'general':
        default: return 'Research Agent'
    }
}

function getAgentContribution(domain: BrainDomain, memory: BrainMemorySnapshot): string {
    const label = getAgentLabel(domain)
    return `${label}: I loaded ${memory.totalEmails} classified emails and ${memory.totalEntities} tracked cases. My response is based on real email evidence from your connected mailboxes.`
}

/**
 * Detect which brain domain should handle the user's message.
 */
export function detectBrainDomain(input: string): BrainDomain {
    const lower = input.toLowerCase().replace(/['']/g, "'")

    // Strong legal signals
    if (/\b(solicitor|solicister|conveyancing|land registry|leasehold|freehold|title deed|legal matter|alice|rc\.legal|completion|exchange of contracts|tenancy|eviction|tribunal)\b/.test(lower)) {
        return 'solicitor'
    }

    // Strong financial signals
    if (/\b(accountant|accounting|hmrc|self[- ]?assessment|vat|corporation tax|tax return|payroll|invoice|tax|paye|dividend|capital gains)\b/.test(lower)) {
        return 'accountant'
    }

    // Strong supplier signals
    if (/\b(supplier|suppliers|booker|parfetts|bestway|batleys|hancocks|damecha|khanjra|wholesale|stock|delivery|order|procurement|paypoint)\b/.test(lower)) {
        return 'supplier'
    }

    // Business operations
    if (/\b(bank|banking|halifax|tide|mortgage|insurance|utility|utilities|electricity|gas|broadband|mobile|council tax|business rates|companies house|rent)\b/.test(lower)) {
        return 'business'
    }

    // Property — could be legal or business
    if (/\b(property|properties|steamer|flat|house|lease|rent)\b/.test(lower)) {
        // If also has legal words, route to legal
        if (/\b(solicitor|legal|registry|deed|conveyancing|completion)\b/.test(lower)) return 'solicitor'
        return 'business'
    }

    // Email but with domain hint
    if (/\b(email|emails|inbox|outlook|gmail)\b/.test(lower)) {
        if (/\b(solicitor|legal|alice|rc\.legal)\b/.test(lower)) return 'solicitor'
        if (/\b(accountant|hmrc|tax|vat)\b/.test(lower)) return 'accountant'
        if (/\b(supplier|booker|parfetts|order|delivery)\b/.test(lower)) return 'supplier'
    }

    return 'research'
}

/**
 * Extract search query hints from the user message to find relevant emails.
 * Returns multiple search terms to maximise recall.
 */
function extractSearchHint(input: string): string | undefined {
    const lower = input.toLowerCase()
    const hints: string[] = []

    // Look for property addresses
    const addressMatch = input.match(/\b(\d+\w?\s+\w[\w\s]+(?:street|st|road|rd|avenue|ave|lane|ln|close|drive|way|place))\b/i)
    if (addressMatch) hints.push(addressMatch[1])

    // Look for company/person names after "about", "regarding", "from"
    const aboutMatch = input.match(/(?:about|regarding|from|for)\s+([A-Z][\w\s&]+)/i)
    if (aboutMatch && aboutMatch[1].length > 3) hints.push(aboutMatch[1].trim())

    // Look for email addresses
    const emailMatch = input.match(/[\w.+-]+@[\w.-]+/i)
    if (emailMatch) hints.push(emailMatch[0])

    // Look for specific business terms
    const businessTerms: Record<string, string> = {
        'steamer': 'steamer street',
        'hmrc': 'HMRC',
        'land registry': 'land registry',
        'companies house': 'companies house',
        'alice': 'alice',
        'rc legal': 'rc.legal',
        'booker': 'booker',
        'parfetts': 'parfetts',
        'bestway': 'bestway',
        'batleys': 'batleys',
        'hancocks': 'hancocks',
        'paypoint': 'paypoint',
        'worldpay': 'worldpay',
        'halifax': 'halifax',
        'tide': 'tide',
        'newton': 'newton',
        'silva retail': 'silva retail',
        'barrow': 'barrow',
        'lancaster': 'lancaster',
        'damecha': 'damecha',
        'khanjra': 'khanjra',
    }

    for (const [trigger, term] of Object.entries(businessTerms)) {
        if (lower.includes(trigger) && !hints.includes(term)) {
            hints.push(term)
        }
    }

    // Look for dates
    const dateMatch = input.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{2,4})\b/i)
    if (dateMatch) hints.push(`${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`)

    // Look for monetary amounts
    const amountMatch = input.match(/[£$]\s*[\d,]+(?:\.\d{2})?/i)
    if (amountMatch) hints.push(amountMatch[0])

    return hints.length > 0 ? hints[0] : undefined
}

/**
 * Deep cross-domain search — searches ALL emails regardless of classification.
 * Used when a brain can't find results within its own domain.
 */
export async function deepEmailSearch(query: string, limit = 50): Promise<EmailDigest[]> {
    const search = query.trim()
    if (!search) return []

    const rows = await db.emailMessage.findMany({
        where: {
            OR: [
                { subject: { contains: search } },
                { body: { contains: search } },
                { fromAddress: { contains: search } },
                { entityKey: { contains: search } },
            ],
        },
        orderBy: { date: 'desc' },
        take: limit,
        select: {
            id: true,
            provider: true,
            fromAddress: true,
            toAddress: true,
            subject: true,
            body: true,
            date: true,
            classifiedAs: true,
            entityKey: true,
        },
    })

    return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        fromAddress: r.fromAddress,
        toAddress: r.toAddress,
        subject: r.subject,
        body: (r.body || '').slice(0, 500),
        date: r.date.toISOString(),
        classifiedAs: r.classifiedAs,
        entityKey: r.entityKey,
    }))
}

/**
 * Build the complete brain response: system prompt + context messages + agent metadata.
 * This is the main entry point called by the chat route.
 */
export async function activateBrain(
    userMessage: string,
    domain?: BrainDomain
): Promise<BrainResponse> {
    const resolvedDomain = domain || detectBrainDomain(userMessage)
    const searchHint = extractSearchHint(userMessage)
    const systemPrompt = getSystemPrompt(resolvedDomain)

    let memory: BrainMemorySnapshot

    if (resolvedDomain === 'research' || resolvedDomain === 'general') {
        // Research brain gets cross-domain view
        const crossDomain = await buildCrossDomainMemory(searchHint)
        // Merge into a single research memory snapshot
        memory = {
            domain: 'research',
            totalEmails: crossDomain.totalEmailsAllDomains,
            totalEntities:
                crossDomain.legal.totalEntities +
                crossDomain.financial.totalEntities +
                crossDomain.supplier.totalEntities +
                crossDomain.business.totalEntities,
            entitySummaries: [
                ...crossDomain.legal.entitySummaries.slice(0, 10),
                ...crossDomain.financial.entitySummaries.slice(0, 10),
                ...crossDomain.supplier.entitySummaries.slice(0, 10),
                ...crossDomain.business.entitySummaries.slice(0, 10),
            ],
            recentEmails: [
                ...crossDomain.legal.recentEmails.slice(0, 10),
                ...crossDomain.financial.recentEmails.slice(0, 10),
                ...crossDomain.supplier.recentEmails.slice(0, 10),
                ...crossDomain.business.recentEmails.slice(0, 10),
            ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
            relevantEmails: [
                ...crossDomain.legal.relevantEmails,
                ...crossDomain.financial.relevantEmails,
                ...crossDomain.supplier.relevantEmails,
                ...crossDomain.business.relevantEmails,
            ],
            masterProfile: crossDomain.legal.masterProfile || crossDomain.financial.masterProfile,
            generatedAt: new Date().toISOString(),
        }
    } else {
        memory = await buildBrainMemory(resolvedDomain, searchHint)
    }

    const contextContent = buildContextMessage(memory)

    return {
        systemPrompt,
        contextMessages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'system',
                content: contextContent,
            },
        ],
        agentLabel: getAgentLabel(resolvedDomain),
        agentContribution: getAgentContribution(resolvedDomain, memory),
        domain: resolvedDomain,
    }
}

/**
 * Quick domain email count summary — for status reports.
 */
export async function getDomainCounts(): Promise<Record<string, { emails: number; entities: number; pendingEvents: number }>> {
    const domains: BrainDomain[] = ['solicitor', 'accountant', 'supplier', 'business', 'research', 'general']
    const result: Record<string, { emails: number; entities: number; pendingEvents: number }> = {}

    for (const domain of domains) {
        const types = DOMAIN_MAP[domain] || [domain]
        const [emails, entities, pendingEvents] = await Promise.all([
            db.emailMessage.count({ where: { classifiedAs: { in: types } } }),
            db.agentEntity.count({ where: { agentType: { in: types } } }),
            db.agentEvent.count({ where: { agentType: { in: types }, status: 'pending' } }),
        ])
        result[domain] = { emails, entities, pendingEvents }
    }

    return result
}
