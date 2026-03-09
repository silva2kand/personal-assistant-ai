import { db } from '@/lib/db'

export type MailboxRuleAction = 'important' | 'junk'

export type MailboxSenderRule = {
  id: string
  senderPattern: string
  action: MailboxRuleAction
  createdAt: string
  updatedAt: string
}

type MailboxRulesState = {
  rules: MailboxSenderRule[]
  updatedAt?: string
}

const MAILBOX_RULES_AGENT_TYPE = 'research'
const MAILBOX_RULES_ENTITY_KEY = 'mailbox-user-rules'
const FALLBACK_STATE: MailboxRulesState = { rules: [] }

function safeJsonParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

function normalizePattern(input: string) {
  return input.trim().toLowerCase()
}

function makeRuleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rule-${crypto.randomUUID()}`
  }
  return `rule-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function sanitizeRules(rules: MailboxSenderRule[]): MailboxSenderRule[] {
  return rules
    .map((rule) => ({
      id: String(rule.id || makeRuleId()),
      senderPattern: normalizePattern(rule.senderPattern || ''),
      action: rule.action === 'junk' ? 'junk' : 'important',
      createdAt: String(rule.createdAt || new Date().toISOString()),
      updatedAt: String(rule.updatedAt || new Date().toISOString()),
    }))
    .filter((rule) => rule.senderPattern.length > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

async function ensureMailboxRulesEntity() {
  return db.agentEntity.upsert({
    where: {
      agentType_entityKey: {
        agentType: MAILBOX_RULES_AGENT_TYPE,
        entityKey: MAILBOX_RULES_ENTITY_KEY,
      },
    },
    update: {
      title: 'Research - Mailbox Sender Rules',
      status: 'open',
      lastUpdateAt: new Date(),
    },
    create: {
      agentType: MAILBOX_RULES_AGENT_TYPE,
      entityKey: MAILBOX_RULES_ENTITY_KEY,
      title: 'Research - Mailbox Sender Rules',
      status: 'open',
      lastUpdateAt: new Date(),
    },
  })
}

async function readMailboxRulesState() {
  const entity = await ensureMailboxRulesEntity()
  const existing = await db.agentEntityState.findUnique({ where: { agentEntityId: entity.id } })
  const parsed = safeJsonParse<MailboxRulesState>(existing?.stateJson, FALLBACK_STATE)
  return {
    entityId: entity.id,
    state: {
      rules: sanitizeRules(Array.isArray(parsed.rules) ? parsed.rules : []),
      updatedAt: parsed.updatedAt,
    } satisfies MailboxRulesState,
  }
}

async function writeMailboxRulesState(entityId: string, state: MailboxRulesState) {
  const payload: MailboxRulesState = {
    rules: sanitizeRules(state.rules),
    updatedAt: new Date().toISOString(),
  }
  await db.agentEntityState.upsert({
    where: { agentEntityId: entityId },
    update: {
      stateJson: JSON.stringify(payload),
      updatedAt: new Date(),
    },
    create: {
      agentEntityId: entityId,
      stateJson: JSON.stringify(payload),
    },
  })
  return payload.rules
}

export async function getMailboxSenderRules() {
  const { state } = await readMailboxRulesState()
  return state.rules
}

export async function upsertMailboxSenderRule(input: {
  senderPattern: string
  action: MailboxRuleAction
}) {
  const normalizedPattern = normalizePattern(input.senderPattern || '')
  if (!normalizedPattern) {
    throw new Error('senderPattern is required')
  }
  if (input.action !== 'important' && input.action !== 'junk') {
    throw new Error('action must be important or junk')
  }

  const now = new Date().toISOString()
  const { entityId, state } = await readMailboxRulesState()
  const existingIndex = state.rules.findIndex((rule) => rule.senderPattern === normalizedPattern)
  const rules = [...state.rules]

  if (existingIndex >= 0) {
    const current = rules[existingIndex]
    rules[existingIndex] = {
      ...current,
      action: input.action,
      updatedAt: now,
    }
  } else {
    rules.push({
      id: makeRuleId(),
      senderPattern: normalizedPattern,
      action: input.action,
      createdAt: now,
      updatedAt: now,
    })
  }

  return writeMailboxRulesState(entityId, { rules })
}

export async function deleteMailboxSenderRuleById(ruleId: string) {
  const trimmed = String(ruleId || '').trim()
  if (!trimmed) return false

  const { entityId, state } = await readMailboxRulesState()
  const nextRules = state.rules.filter((rule) => rule.id !== trimmed)
  if (nextRules.length === state.rules.length) return false
  await writeMailboxRulesState(entityId, { rules: nextRules })
  return true
}

export function messageMatchesSenderPattern(
  message: { fromAddress?: string; fromName?: string },
  senderPattern: string
) {
  const pattern = normalizePattern(senderPattern)
  if (!pattern) return false
  const senderAddress = normalizePattern(message.fromAddress || '')
  const senderName = normalizePattern(message.fromName || '')
  if (!senderAddress && !senderName) return false
  return senderAddress.includes(pattern) || senderName.includes(pattern)
}
