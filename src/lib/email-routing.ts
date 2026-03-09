import { db } from '@/lib/db'
import { UnifiedEmailMessage } from '@/lib/email-hub'

type AgentType = 'legal' | 'financial' | 'supplier' | 'email' | 'research'

export interface RoutedAgent {
  type: AgentType
  name: string
  score: number
  reason: string
}

export interface EmailRoutingResult {
  summary: string
  urgency: 'low' | 'medium' | 'high'
  routedAgents: RoutedAgent[]
  matchedContacts: {
    solicitors: string[]
    accountants: string[]
    suppliers: string[]
  }
}

const AGENT_NAMES: Record<AgentType, string> = {
  legal: 'Legal Agent',
  financial: 'Financial Agent',
  supplier: 'Supplier Agent',
  email: 'Email Agent',
  research: 'Research Agent',
}

function scoreKeywords(text: string, keywords: string[]): number {
  return keywords.reduce((acc, keyword) => (text.includes(keyword) ? acc + 1 : acc), 0)
}

function normalize(value?: string): string {
  return (value || '').trim().toLowerCase()
}

function buildSummary(message: UnifiedEmailMessage): string {
  const sender = message.fromName || message.fromAddress || 'Unknown sender'
  const body = (message.bodyPreview || '').trim()
  if (!body) return `Email from ${sender}: ${message.subject || '(No Subject)'}`
  return `Email from ${sender}: ${message.subject || '(No Subject)'} - ${body.slice(0, 240)}`
}

function detectUrgency(text: string): 'low' | 'medium' | 'high' {
  const highHits = scoreKeywords(text, ['urgent', 'asap', 'immediately', 'deadline', 'overdue'])
  if (highHits > 0) return 'high'
  const mediumHits = scoreKeywords(text, ['soon', 'follow up', 'reminder', 'priority', 'important'])
  return mediumHits > 0 ? 'medium' : 'low'
}

export async function analyzeAndRouteEmail(message: UnifiedEmailMessage): Promise<EmailRoutingResult> {
  const haystack = normalize(`${message.subject} ${message.bodyPreview}`)
  const sender = normalize(message.fromAddress)

  const [solicitors, accountants, suppliers] = await Promise.all([
    db.solicitor.findMany({ where: { email: { not: null } }, select: { id: true, name: true, email: true } }),
    db.accountant.findMany({ where: { email: { not: null } }, select: { id: true, name: true, email: true } }),
    db.supplier.findMany({ where: { email: { not: null } }, select: { id: true, name: true, email: true } }),
  ])

  const matchedSolicitors = solicitors.filter((s) => normalize(s.email || '') === sender)
  const matchedAccountants = accountants.filter((a) => normalize(a.email || '') === sender)
  const matchedSuppliers = suppliers.filter((s) => normalize(s.email || '') === sender)

  const scores: Record<AgentType, number> = {
    email: 1,
    legal: 0,
    financial: 0,
    supplier: 0,
    research: 0,
  }

  scores.legal += scoreKeywords(haystack, [
    'legal',
    'solicitor',
    'contract',
    'agreement',
    'nda',
    'liability',
    'court',
    'compliance',
  ])
  scores.financial += scoreKeywords(haystack, [
    'invoice',
    'payment',
    'tax',
    'vat',
    'hmrc',
    'accounting',
    'audit',
    'expense',
    'receipt',
    'refund',
  ])
  scores.supplier += scoreKeywords(haystack, [
    'supplier',
    'order',
    'purchase',
    'shipment',
    'delivery',
    'procurement',
    'stock',
    'quote',
  ])
  scores.research += scoreKeywords(haystack, ['research', 'analysis', 'market', 'benchmark', 'investigate'])

  if (matchedSolicitors.length > 0) scores.legal += 4
  if (matchedAccountants.length > 0) scores.financial += 4
  if (matchedSuppliers.length > 0) scores.supplier += 4

  const routedAgents: RoutedAgent[] = (Object.keys(scores) as AgentType[])
    .filter((type) => type === 'email' || scores[type] >= 2)
    .sort((a, b) => scores[b] - scores[a])
    .map((type) => {
      let reason = 'General email handling and tracking.'
      if (type === 'legal') reason = 'Legal terms detected or sender matched a solicitor contact.'
      if (type === 'financial') reason = 'Finance/tax keywords detected or sender matched an accountant.'
      if (type === 'supplier') reason = 'Supplier/order keywords detected or sender matched a supplier.'
      if (type === 'research') reason = 'Research/analysis intent detected.'
      return {
        type,
        name: AGENT_NAMES[type],
        score: scores[type],
        reason,
      }
    })

  const context = {
    source: 'email-analysis',
    provider: message.provider,
    messageId: message.id,
    subject: message.subject,
    from: message.fromAddress || message.fromName || 'unknown',
    preview: (message.bodyPreview || '').slice(0, 400),
    routedAgents,
    at: new Date().toISOString(),
  }

  for (const agent of routedAgents) {
    const existing = await db.agentSession.findFirst({
      where: { agentType: agent.type },
    })
    if (existing) {
      await db.agentSession.update({
        where: { id: existing.id },
        data: {
          status: 'processing',
          lastActive: new Date(),
          context: JSON.stringify(context),
        },
      })
    } else {
      await db.agentSession.create({
        data: {
          agentType: agent.type,
          status: 'processing',
          context: JSON.stringify(context),
        },
      })
    }
  }

  if (matchedSolicitors.length > 0) {
    await Promise.all(
      matchedSolicitors.map((solicitor) =>
        db.solicitorCommunication.create({
          data: {
            solicitorId: solicitor.id,
            type: 'email',
            subject: message.subject,
            content: message.bodyPreview || '',
            date: new Date(message.receivedDateTime),
          },
        })
      )
    )
  }
  if (matchedAccountants.length > 0) {
    await Promise.all(
      matchedAccountants.map((accountant) =>
        db.accountantCommunication.create({
          data: {
            accountantId: accountant.id,
            type: 'email',
            subject: message.subject,
            content: message.bodyPreview || '',
            date: new Date(message.receivedDateTime),
          },
        })
      )
    )
  }
  if (matchedSuppliers.length > 0) {
    await Promise.all(
      matchedSuppliers.map((supplier) =>
        db.supplierCommunication.create({
          data: {
            supplierId: supplier.id,
            type: 'email',
            subject: message.subject,
            content: message.bodyPreview || '',
            date: new Date(message.receivedDateTime),
          },
        })
      )
    )
  }

  return {
    summary: buildSummary(message),
    urgency: detectUrgency(haystack),
    routedAgents,
    matchedContacts: {
      solicitors: matchedSolicitors.map((s) => s.name),
      accountants: matchedAccountants.map((a) => a.name),
      suppliers: matchedSuppliers.map((s) => s.name),
    },
  }
}
