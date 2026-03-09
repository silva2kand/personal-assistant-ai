import { db } from '@/lib/db'
import type { UnifiedEmailMessage } from '@/lib/email-hub'

type MailboxReadiness = {
  connectedCount: { total: number }
  reachable: { total: number }
}

type WatchQuery = {
  sinceDate: string
  senderHints: string[]
  propertyHints: string[]
  includeLandRegistry: boolean
}

type TaskEngineResult = {
  handled: boolean
  response?: string
  steps?: string[]
  followUps?: string[]
  agents?: { type: string; name: string; contribution: string }[]
  error?: string
}

type HandlerDeps = {
  query: WatchQuery
  getMailboxReadiness: () => Promise<MailboxReadiness>
  mailboxReadinessDiagnostics: (readiness: MailboxReadiness) => string
  searchUnifiedInbox: (params: {
    fromContains?: string[]
    text?: string
    sinceDate?: string
    maxFetchPerProvider?: number
    exhaustive?: boolean
  }) => Promise<UnifiedEmailMessage[]>
  upsertMasterProfileMemory: (patch: {
    importantSenders?: string[]
    notes?: string[]
  }) => Promise<void>
  uniqueStrings: (values: string[]) => string[]
  containsAny: (text: string, values: string[]) => boolean
}

function isHighTrustSolicitorSender(from: string): boolean {
  const lower = from.toLowerCase()
  return (
    lower.includes('aliceamclellan@rc.legal') ||
    lower.includes('@rc.legal') ||
    lower.includes('alicea mclellan')
  )
}

export async function handleSenderPropertyWatch(deps: HandlerDeps): Promise<TaskEngineResult> {
  const { query } = deps
  const steps = [
    'Router: classified as sender+property watch request',
    `Email Agent: exhaustive sender search from ${query.sinceDate.slice(0, 10)} across Gmail + Outlook`,
    'Legal Agent: filtered 6F Steamer Street / Land Registry evidence',
    'Research Agent: saved watch state and chase actions in memory',
  ]

  try {
    const readiness = await deps.getMailboxReadiness()
    const diagnostics = deps.mailboxReadinessDiagnostics(readiness)
    const noMailboxConnection = readiness.connectedCount.total === 0
    const mailboxUnreachable = readiness.connectedCount.total > 0 && readiness.reachable.total === 0

    if (noMailboxConnection || mailboxUnreachable) {
      return {
        handled: true,
        response: noMailboxConnection
          ? 'No connected Gmail/Outlook mailbox accounts found. Connect your mailboxes, then retry this watch.'
          : `Mailbox accounts are connected but unreachable (token expired/OAuth reconnect needed).${diagnostics ? ` Diagnostics: ${diagnostics}` : ''}`,
        steps,
        followUps: ['Reconnect Gmail and Outlook', 'Run worker sync now', 'Retry Alicea 6F Steamer watch'],
        agents: [{ type: 'email', name: 'Email Agent', contribution: 'I checked mailbox connectivity before running watch mode.' }],
      }
    }

    const maxFetchPerProvider = Math.min(
      Math.max(Number(process.env.MAILBOX_DEEP_FETCH_MAX_PER_PROVIDER || 20000), 1000),
      5000
    )
    const hits = await deps.searchUnifiedInbox({
      fromContains: query.senderHints,
      // Use sender-first deep search; property filtering is done in-memory to avoid brittle provider text matching.
      text: undefined,
      sinceDate: query.sinceDate,
      maxFetchPerProvider,
      exhaustive: true,
    })

    const sinceDate = new Date(query.sinceDate)
    const localRows = await db.emailMessage.findMany({
      where: {
        date: { gte: sinceDate },
        OR: query.senderHints.map((hint) => ({ fromAddress: { contains: hint } })),
      },
      orderBy: { date: 'desc' },
      take: 800,
      select: {
        provider: true,
        providerMessageId: true,
        subject: true,
        date: true,
        body: true,
        fromAddress: true,
      },
    })

    const localHits: UnifiedEmailMessage[] = localRows.map((row) => ({
      id: row.providerMessageId,
      provider: row.provider as 'gmail' | 'outlook',
      subject: row.subject || '(No Subject)',
      receivedDateTime: row.date.toISOString(),
      bodyPreview: (row.body || '').slice(0, 800),
      fromName: '',
      fromAddress: row.fromAddress || '',
    }))

    const mergedMap = new Map<string, UnifiedEmailMessage>()
    for (const item of [...hits, ...localHits]) {
      const key = `${item.provider}:${item.id}:${item.receivedDateTime}:${item.subject || ''}`
      if (!mergedMap.has(key)) mergedMap.set(key, item)
    }
    const mergedHits = [...mergedMap.values()]

    const sorted = [...mergedHits].sort(
      (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
    )

    const legalCore = sorted.filter((msg) => {
      const text = `${msg.subject || ''} ${msg.bodyPreview || ''}`.toLowerCase()
      const from = `${msg.fromAddress || ''} ${msg.fromName || ''}`.toLowerCase()
      const senderMatch = query.senderHints.some((hint) => from.includes(hint.toLowerCase()))
      const propertyMatch = deps.containsAny(text, ['steamer', 'streamer', '6f', 'barrow', 'land registry', 'lease', 'title', 'deed'])
      return senderMatch && propertyMatch
    })

    const prioritizedCore = [
      ...legalCore.filter((m) => isHighTrustSolicitorSender(`${m.fromAddress || ''} ${m.fromName || ''}`)),
      ...legalCore.filter((m) => !isHighTrustSolicitorSender(`${m.fromAddress || ''} ${m.fromName || ''}`)),
    ]

    const landRegistryHits = prioritizedCore.filter((msg) =>
      deps.containsAny(`${msg.subject || ''} ${msg.bodyPreview || ''}`.toLowerCase(), ['land registry', 'title', 'deed', 'application'])
    )

    const managementCandidates = deps.uniqueStrings(
      prioritizedCore
        .filter((msg) =>
          deps.containsAny(
            `${msg.subject || ''} ${msg.bodyPreview || ''} ${msg.fromAddress || ''}`.toLowerCase(),
            ['property management', 'managing agent', 'estate', 'lettings', 'management', 'block management']
          )
        )
        .map((msg) => msg.fromAddress || msg.fromName || '')
        .filter(Boolean)
    ).slice(0, 8)

    const latest = prioritizedCore[0]
    const latestDate = latest ? new Date(latest.receivedDateTime).toISOString() : new Date().toISOString()
    const latestSubject = latest?.subject || '(No Subject)'
    const watchEntityKey = '6f steamer street land registry'
    const watchEntity = await db.agentEntity.upsert({
      where: { agentType_entityKey: { agentType: 'solicitor', entityKey: watchEntityKey } },
      update: {
        title: 'Solicitor - 6F Steamer Street Land Registry',
        status: landRegistryHits.length > 0 ? 'waiting' : 'open',
        lastUpdateAt: new Date(),
      },
      create: {
        agentType: 'solicitor',
        entityKey: watchEntityKey,
        title: 'Solicitor - 6F Steamer Street Land Registry',
        status: landRegistryHits.length > 0 ? 'waiting' : 'open',
        lastUpdateAt: new Date(),
      },
    })

    const stateJson = JSON.stringify({
      status: prioritizedCore.length > 0 && landRegistryHits.length > 0 ? 'waiting' : 'open',
      last_email_date: latestDate,
      waiting_on: prioritizedCore.length > 0 && landRegistryHits.length > 0 ? 'Land Registry / Solicitor response' : 'none',
      facts: {
        watchSenderHints: query.senderHints,
        watchPropertyHints: query.propertyHints,
        scannedCandidates: mergedHits.length,
        totalMatches: prioritizedCore.length,
        landRegistryMatches: landRegistryHits.length,
        latestSubject,
        latestFrom: latest?.fromAddress || latest?.fromName || 'unknown',
        managementCandidates,
      },
      next_actions: [
        'Chase solicitor for Land Registry status update.',
        'Confirm application reference and expected update date.',
        'Request managing-agent/property-management contact details for 6F Steamer Street.',
      ],
    })

    await db.agentEntityState.upsert({
      where: { agentEntityId: watchEntity.id },
      update: { stateJson, updatedAt: new Date() },
      create: { agentEntityId: watchEntity.id, stateJson },
    })

    await deps.upsertMasterProfileMemory({
      importantSenders: query.senderHints,
      notes: [
        `Watch active: Alicea/RC Legal + 6F Steamer Street from ${query.sinceDate.slice(0, 10)}. Matches: ${prioritizedCore.length}; Land Registry matches: ${landRegistryHits.length}.`,
      ],
    })

    const tableRows = prioritizedCore.slice(0, 20).map((msg) => {
      const date = new Date(msg.receivedDateTime).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
      const sender = msg.fromName || msg.fromAddress || 'Unknown sender'
      return `| ${date} | ${msg.provider.toUpperCase()} | ${sender} | ${msg.subject || '(No Subject)'} |`
    })

    const strictSenderCount = prioritizedCore.filter((m) =>
      isHighTrustSolicitorSender(`${m.fromAddress || ''} ${m.fromName || ''}`)
    ).length

    return {
      handled: true,
      response: [
        'Alicea + 6F Steamer Street watch is active and saved in secure local memory.',
        '',
        `- Search coverage: **live provider + local synced history**`,
        `- Scanned candidates: **${mergedHits.length}**`,
        `- Total legal-core matches: **${prioritizedCore.length}**`,
        `- Direct Alicea/RC Legal matches: **${strictSenderCount}**`,
        `- Land Registry direct matches: **${landRegistryHits.length}**`,
        prioritizedCore.length > 0
          ? `- Latest update: **${new Date(latest.receivedDateTime).toLocaleDateString('en-GB')}** | **${latestSubject}**`
          : '- Latest update: **none found yet in current dataset**',
        `- Watch status: **${prioritizedCore.length > 0 && landRegistryHits.length > 0 ? 'waiting (chase required)' : 'open'}**`,
        managementCandidates.length > 0
          ? `- Property management candidates found: **${managementCandidates.join(', ')}**`
          : '- Property management contact not yet explicit in matched emails.',
        '',
        '| Date | Provider | Sender | Subject |',
        '|---|---|---|---|',
        ...(tableRows.length > 0 ? tableRows : ['| - | - | - | No matching legal-core emails yet |']),
      ].join('\n'),
      steps,
      followUps: [
        'Draft chase email to Alicea for Land Registry status',
        'Show full 6F Steamer Street legal timeline',
        'Show property-management candidates only',
      ],
      agents: [
        { type: 'email', name: 'Email Agent', contribution: 'I ran sender+property exhaustive search and returned only matching records.' },
        { type: 'legal', name: 'Legal Agent', contribution: 'I saved a legal watch state and queued Land Registry chase actions.' },
        { type: 'research', name: 'Research Agent', contribution: 'I persisted sender/property watch memory for continuous updates.' },
      ],
    }
  } catch (error) {
    return {
      handled: true,
      response: 'Sender/property watch setup failed before completion.',
      steps,
      error: error instanceof Error ? error.message : 'Sender/property watch failed',
    }
  }
}
