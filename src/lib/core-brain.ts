import { db } from '@/lib/db'

type BrainLease = {
  id: string
  propertyKey: string
  address: string
  landlord: string
  startDate: string
  renewalYears: number
  nextRenewalDate: string
  status: 'active' | 'renewal_due' | 'expired'
  notes: string[]
  source: 'inferred' | 'manual'
  updatedAt: string
}

type BrainReminder = {
  type: 'lease-renewal' | 'deadline' | 'risk'
  priority: 'high' | 'medium' | 'low'
  title: string
  detail: string
  dueDate?: string
}

export type CoreBrainState = {
  profile: {
    aliases: string[]
    addresses: string[]
    businesses: string[]
    focusAreas: string[]
    importantSenders: string[]
    bankRelationships: string[]
    personalAccounts: string[]
    businessAccounts: string[]
    leaseBusiness: string[]
    leaseResidential: string[]
    refundCases: string[]
    insurancePolicies: string[]
    telecomContracts: string[]
  }
  leases: BrainLease[]
  reminders: BrainReminder[]
  openIssueCounts: {
    solicitor: number
    accountant: number
    supplier: number
    business: number
  }
  latestImportantEmails: Array<{
    provider: string
    fromAddress: string
    subject: string
    classifiedAs: string
    date: string
  }>
  settings: {
    neverDeleteWithoutConfirmation: boolean
  }
  updatedAt: string
}

export type BrainBriefingItem = {
  priority: 'high' | 'medium' | 'low'
  area: 'legal' | 'financial' | 'supplier' | 'business' | 'ops'
  title: string
  detail: string
  nextAction: string
  sourceDate?: string
}

export type BrainBriefing = {
  generatedAt: string
  headline: string
  items: BrainBriefingItem[]
}

export type BrainOpportunity = {
  priority: 'high' | 'medium' | 'low'
  category: 'property' | 'funding' | 'supplier' | 'cost-saving' | 'general'
  title: string
  detail: string
  recommendation: 'keep' | 'switch' | 'negotiate' | 'investigate'
  nextAction: string
  sourceDate: string
}

const CORE_ENTITY_KEY = 'silva-core-brain'
const MASTER_PROFILE_KEY = 'silva-master-profile'

const LEGAL_SIGNAL_RE = /\b(land registry|lease|leasehold|freehold|title|deed|conveyancing|solicitor|council|completion|property)\b/i
const FINANCIAL_SIGNAL_RE = /\b(hmrc|vat|tax|payroll|invoice|account|payment|settlement|self assessment)\b/i
const SUPPLIER_SIGNAL_RE = /\b(supplier|order|stock|delivery|invoice|wholesale|parfetts|booker|bestway|paypoint)\b/i
const PROMO_NOISE_RE = /\b(newsletter|offer|deals?|sale|discount|promo|bonanza|new arrivals|join us|welcome|one day only|tips?)\b/i
const OPPORTUNITY_SIGNAL_RE = /\b(auction|lots? for sale|valuation|funding|loan|eligible|growth guarantee|opportunity|available|new properties|property auction)\b/i
const COST_SIGNAL_RE = /\b(insurance|energy|electricity|gas|broadband|mobile|loan|rate|price|tariff)\b/i

function safeParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function leaseIdFromAddress(address: string): string {
  return normalizeAddress(address).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseDateLike(text: string): Date | null {
  const d = new Date(text)
  if (!Number.isNaN(d.getTime())) return d
  const m = text.match(/\b(\d{1,2})\s+([a-z]{3,9})\s+(20\d{2})\b/i)
  if (!m) return null
  const parsed = new Date(`${m[1]} ${m[2]} ${m[3]} UTC`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function addYears(iso: string, years: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString()
}

function leaseStatus(nextRenewalDate: string): 'active' | 'renewal_due' | 'expired' {
  const now = Date.now()
  const due = new Date(nextRenewalDate).getTime()
  if (Number.isNaN(due)) return 'active'
  if (due < now) return 'expired'
  const days = Math.floor((due - now) / (24 * 60 * 60 * 1000))
  if (days <= 365) return 'renewal_due'
  return 'active'
}

async function getMasterProfileState() {
  const entity = await db.agentEntity.findUnique({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: MASTER_PROFILE_KEY,
      },
    },
    select: { id: true },
  })
  if (!entity) return null
  const state = await db.agentEntityState.findUnique({
    where: { agentEntityId: entity.id },
    select: { stateJson: true },
  })
  return safeParse<Record<string, unknown>>(state?.stateJson, {})
}

async function getCoreBrainEntity() {
  return db.agentEntity.upsert({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: CORE_ENTITY_KEY,
      },
    },
    update: {
      title: 'Research - Silva Core Brain',
      status: 'open',
      lastUpdateAt: new Date(),
    },
    create: {
      agentType: 'research',
      entityKey: CORE_ENTITY_KEY,
      title: 'Research - Silva Core Brain',
      status: 'open',
      lastUpdateAt: new Date(),
    },
  })
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v || '').trim()).filter(Boolean)
}

function inferStartDateFromProfile(propertyAssets: string[], address: string): string {
  const normalizedAddress = normalizeAddress(address)
  for (const asset of propertyAssets) {
    if (!normalizeAddress(asset).includes(normalizedAddress.split(',')[0])) continue
    const match = asset.match(/\b(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})\b/)
    if (!match) continue
    const parsed = parseDateLike(match[1])
    if (parsed) return parsed.toISOString()
  }
  if (normalizedAddress.includes('steamer street')) {
    return new Date('2024-09-05T00:00:00.000Z').toISOString()
  }
  return new Date().toISOString()
}

function buildLeaseReminders(leases: BrainLease[]): BrainReminder[] {
  const now = Date.now()
  const out: BrainReminder[] = []
  for (const lease of leases) {
    const due = new Date(lease.nextRenewalDate).getTime()
    if (Number.isNaN(due)) continue
    const days = Math.floor((due - now) / (24 * 60 * 60 * 1000))
    if (days <= 0) {
      out.push({
        type: 'lease-renewal',
        priority: 'high',
        title: `Lease renewal overdue: ${lease.address}`,
        detail: `Renewal date passed on ${new Date(lease.nextRenewalDate).toLocaleDateString('en-GB')}.`,
        dueDate: lease.nextRenewalDate,
      })
    } else if (days <= 180) {
      out.push({
        type: 'lease-renewal',
        priority: 'high',
        title: `Lease renewal due soon: ${lease.address}`,
        detail: `${days} days to renewal window/date.`,
        dueDate: lease.nextRenewalDate,
      })
    } else if (days <= 365) {
      out.push({
        type: 'lease-renewal',
        priority: 'medium',
        title: `Lease planning window: ${lease.address}`,
        detail: `${days} days to next renewal.`,
        dueDate: lease.nextRenewalDate,
      })
    }
  }
  return out
}

export async function refreshCoreBrainMemory(): Promise<CoreBrainState> {
  const [master, coreEntity] = await Promise.all([getMasterProfileState(), getCoreBrainEntity()])
  const existingStateRow = await db.agentEntityState.findUnique({
    where: { agentEntityId: coreEntity.id },
    select: { stateJson: true },
  })
  const existing = safeParse<CoreBrainState>(existingStateRow?.stateJson, {
    profile: {
      aliases: [],
      addresses: [],
      businesses: [],
      focusAreas: [],
      importantSenders: [],
      bankRelationships: [],
      personalAccounts: [],
      businessAccounts: [],
      leaseBusiness: [],
      leaseResidential: [],
      refundCases: [],
      insurancePolicies: [],
      telecomContracts: [],
    },
    leases: [],
    reminders: [],
    openIssueCounts: { solicitor: 0, accountant: 0, supplier: 0, business: 0 },
    latestImportantEmails: [],
    settings: { neverDeleteWithoutConfirmation: true },
    updatedAt: new Date().toISOString(),
  })

  const aliases = toStringArray(master?.aliases)
  const addressesFromProfile = toStringArray(master?.addresses)
  const businesses = toStringArray(master?.businesses)
  const focusAreas = toStringArray(master?.focusAreas)
  const importantSenders = toStringArray(master?.importantSenders)
  const propertyAssets = toStringArray(master?.propertyAssets)
  const bankRelationships = toStringArray(master?.bankRelationships)
  const personalAccounts = toStringArray(master?.personalAccounts)
  const businessAccounts = toStringArray(master?.businessAccounts)
  const leaseBusiness = toStringArray(master?.leaseBusiness)
  const leaseResidential = toStringArray(master?.leaseResidential)
  const refundCases = toStringArray(master?.refundCases)
  const insurancePolicies = toStringArray(master?.insurancePolicies)
  const telecomContracts = toStringArray(master?.telecomContracts)

  const [propertyEntities, openIssueCounts, latestImportantEmailsRaw] = await Promise.all([
    db.agentEntity.findMany({
      where: {
        agentType: { in: ['solicitor', 'business'] },
        OR: [
          { entityKey: { contains: 'street' } },
          { entityKey: { contains: 'road' } },
          { entityKey: { contains: 'property' } },
          { entityKey: { contains: 'lease' } },
        ],
      },
      select: { entityKey: true },
      take: 120,
    }),
    Promise.all([
      db.agentEntity.count({ where: { agentType: 'solicitor', status: { in: ['open', 'waiting', 'blocked'] } } }),
      db.agentEntity.count({ where: { agentType: 'accountant', status: { in: ['open', 'waiting', 'blocked'] } } }),
      db.agentEntity.count({ where: { agentType: 'supplier', status: { in: ['open', 'waiting', 'blocked'] } } }),
      db.agentEntity.count({ where: { agentType: 'business', status: { in: ['open', 'waiting', 'blocked'] } } }),
    ]),
    db.emailMessage.findMany({
      where: { classifiedAs: { in: ['solicitor', 'accountant', 'supplier', 'business'] } },
      orderBy: { date: 'desc' },
      take: 40,
      select: {
        provider: true,
        fromAddress: true,
        subject: true,
        classifiedAs: true,
        date: true,
      },
    }),
  ])

  const inferredAddresses = propertyEntities
    .map((e) => e.entityKey)
    .filter((v) => /street|road|avenue|lane|close|drive|way/i.test(v))
  const allAddresses = Array.from(new Set([...addressesFromProfile, ...inferredAddresses]))

  const existingLeasesById = new Map((existing.leases || []).map((l) => [l.id, l]))
  const leases: BrainLease[] = []
  for (const address of allAddresses) {
    const id = leaseIdFromAddress(address)
    const old = existingLeasesById.get(id)
    const startDate = old?.startDate || inferStartDateFromProfile(propertyAssets, address)
    const renewalYears = old?.renewalYears || 3
    const nextRenewalDate = addYears(startDate, renewalYears)
    const landlord = old?.landlord || (normalizeAddress(address).includes('lancaster') ? 'Lancaster City Council' : 'Unknown')
    leases.push({
      id,
      propertyKey: normalizeAddress(address).split(',')[0],
      address,
      landlord,
      startDate,
      renewalYears,
      nextRenewalDate,
      status: leaseStatus(nextRenewalDate),
      notes: old?.notes || [],
      source: old?.source || 'inferred',
      updatedAt: new Date().toISOString(),
    })
  }

  const reminders = buildLeaseReminders(leases)
  const importantSenderSet = new Set(importantSenders.map((s) => s.toLowerCase()))
  const latestImportantEmails = latestImportantEmailsRaw
    .filter((row) => {
      const from = (row.fromAddress || '').toLowerCase()
      const subject = (row.subject || '').toLowerCase()
      const cls = (row.classifiedAs || 'general').toLowerCase()
      const senderIsImportant = Array.from(importantSenderSet).some((s) => s && from.includes(s))
      if (senderIsImportant) return true
      if (cls === 'solicitor') return LEGAL_SIGNAL_RE.test(subject) || LEGAL_SIGNAL_RE.test(from)
      if (cls === 'accountant') return FINANCIAL_SIGNAL_RE.test(subject) || FINANCIAL_SIGNAL_RE.test(from)
      if (cls === 'supplier') return SUPPLIER_SIGNAL_RE.test(subject) || SUPPLIER_SIGNAL_RE.test(from)
      if (cls === 'business') return !PROMO_NOISE_RE.test(subject)
      return false
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 40)
  const state: CoreBrainState = {
    profile: {
      aliases,
      addresses: allAddresses,
      businesses,
      focusAreas,
      importantSenders,
      bankRelationships,
      personalAccounts,
      businessAccounts,
      leaseBusiness,
      leaseResidential,
      refundCases,
      insurancePolicies,
      telecomContracts,
    },
    leases,
    reminders,
    openIssueCounts: {
      solicitor: openIssueCounts[0],
      accountant: openIssueCounts[1],
      supplier: openIssueCounts[2],
      business: openIssueCounts[3],
    },
    latestImportantEmails: latestImportantEmails.map((row) => ({
      provider: row.provider,
      fromAddress: row.fromAddress,
      subject: row.subject,
      classifiedAs: row.classifiedAs || 'general',
      date: row.date.toISOString(),
    })),
    settings: {
      neverDeleteWithoutConfirmation: true,
    },
    updatedAt: new Date().toISOString(),
  }

  await db.agentEntityState.upsert({
    where: { agentEntityId: coreEntity.id },
    update: { stateJson: JSON.stringify(state), updatedAt: new Date() },
    create: { agentEntityId: coreEntity.id, stateJson: JSON.stringify(state) },
  })

  return state
}

export async function getCoreBrainMemory(): Promise<CoreBrainState | null> {
  const entity = await db.agentEntity.findUnique({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: CORE_ENTITY_KEY,
      },
    },
    select: { id: true },
  })
  if (!entity) return null
  const state = await db.agentEntityState.findUnique({
    where: { agentEntityId: entity.id },
    select: { stateJson: true },
  })
  return safeParse<CoreBrainState>(state?.stateJson, null as unknown as CoreBrainState)
}

export async function buildWhatsNewBriefing(maxItems = 7): Promise<BrainBriefing> {
  const core = await refreshCoreBrainMemory()

  const items: BrainBriefingItem[] = []
  core.reminders
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1))
    .slice(0, 3)
    .forEach((r) => {
      items.push({
        priority: r.priority,
        area: 'legal',
        title: r.title,
        detail: r.detail,
        nextAction: 'Review lease timeline and prepare renewal communication.',
        sourceDate: r.dueDate,
      })
    })

  const seenClass = new Set<string>()
  for (const row of core.latestImportantEmails) {
    const cls = row.classifiedAs
    if (seenClass.has(cls)) continue
    seenClass.add(cls)
    const area: BrainBriefingItem['area'] =
      cls === 'solicitor'
        ? 'legal'
        : cls === 'accountant'
        ? 'financial'
        : cls === 'supplier'
        ? 'supplier'
        : 'business'
    const subjectLower = (row.subject || '').toLowerCase()
    const recommendation =
      cls === 'accountant'
        ? 'Review now and confirm filing/payment action.'
        : cls === 'solicitor'
        ? 'Check legal impact and escalate if deadline-sensitive.'
        : cls === 'supplier'
        ? 'Compare margin and negotiate terms if needed.'
        : COST_SIGNAL_RE.test(subjectLower)
        ? 'Compare current contract and decide keep/switch/negotiate.'
        : 'Review relevance and archive if non-actionable.'

    items.push({
      priority: cls === 'solicitor' || cls === 'accountant' ? 'high' : 'medium',
      area,
      title: `Latest ${cls} update: ${row.subject || '(No Subject)'}`,
      detail: `From ${row.fromAddress} (${row.provider.toUpperCase()}).`,
      nextAction: recommendation,
      sourceDate: row.date,
    })
    if (items.length >= Math.max(3, maxItems)) break
  }

  const bounded = items.slice(0, Math.max(1, Math.min(maxItems, 12)))
  return {
    generatedAt: new Date().toISOString(),
    headline: 'Here is what is new and important right now.',
    items: bounded,
  }
}

function inferOpportunityCategory(subject: string): BrainOpportunity['category'] {
  const lower = subject.toLowerCase()
  if (/\b(auction|lot|valuation|property)\b/.test(lower)) return 'property'
  if (/\b(funding|loan|eligible|growth guarantee)\b/.test(lower)) return 'funding'
  if (/\b(supplier|wholesale|stock|order)\b/.test(lower)) return 'supplier'
  if (COST_SIGNAL_RE.test(lower)) return 'cost-saving'
  return 'general'
}

function inferOpportunityRecommendation(category: BrainOpportunity['category'], subject: string): BrainOpportunity['recommendation'] {
  const lower = subject.toLowerCase()
  if (category === 'cost-saving' && /\b(loan|insurance|energy|rate|tariff)\b/.test(lower)) return 'switch'
  if (category === 'supplier' && /\b(deal|offer|price|stock)\b/.test(lower)) return 'negotiate'
  if (category === 'property' || category === 'funding') return 'investigate'
  return 'keep'
}

function nextActionForOpportunity(category: BrainOpportunity['category'], recommendation: BrainOpportunity['recommendation']): string {
  if (category === 'property') return 'Review deal details and run quick risk check.'
  if (category === 'funding') return 'Check eligibility, cost, and repayment impact before applying.'
  if (category === 'supplier') return 'Compare margin impact and negotiate better terms if possible.'
  if (category === 'cost-saving') return recommendation === 'switch'
    ? 'Request a quote comparison and prepare switch decision.'
    : recommendation === 'negotiate'
    ? 'Renegotiate current contract with better terms.'
    : 'Review current contract and keep unless a clearly better option appears.'
  return 'Review and decide if this is actionable this week.'
}

export async function buildOpportunityFeed(maxItems = 12): Promise<{ generatedAt: string; items: BrainOpportunity[] }> {
  const core = await refreshCoreBrainMemory()
  const items: BrainOpportunity[] = []

  for (const row of core.latestImportantEmails) {
    const subject = row.subject || '(No Subject)'
    if (!OPPORTUNITY_SIGNAL_RE.test(subject) && !COST_SIGNAL_RE.test(subject)) continue
    const category = inferOpportunityCategory(subject)
    const priority: BrainOpportunity['priority'] =
      category === 'property' || category === 'funding' ? 'high' : category === 'cost-saving' ? 'medium' : 'low'
    const recommendation = inferOpportunityRecommendation(category, subject)
    items.push({
      priority,
      category,
      title: subject,
      detail: `From ${row.fromAddress} via ${row.provider.toUpperCase()}.`,
      recommendation,
      nextAction: nextActionForOpportunity(category, recommendation),
      sourceDate: row.date,
    })
    if (items.length >= Math.max(1, Math.min(maxItems, 30))) break
  }

  return {
    generatedAt: new Date().toISOString(),
    items,
  }
}
