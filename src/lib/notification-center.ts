import { db } from '@/lib/db'

export type NotificationChannel = 'desktop' | 'whatsapp' | 'chat'
export type NotificationPriority = 'high' | 'medium' | 'low'

export type NotificationItem = {
  id: string
  title: string
  body: string
  priority: NotificationPriority
  channel: NotificationChannel
  source: string
  createdAt: string
  readAt?: string
  status: 'pending' | 'sent' | 'read'
  meta?: Record<string, unknown>
}

type NotificationState = {
  queue: NotificationItem[]
  history: NotificationItem[]
  updatedAt: string
}

const ENTITY_KEY = 'system-notification-center'

function safeParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

function nowIso() {
  return new Date().toISOString()
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `notif-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

async function getCenterEntity() {
  return db.agentEntity.upsert({
    where: {
      agentType_entityKey: {
        agentType: 'research',
        entityKey: ENTITY_KEY,
      },
    },
    update: {
      title: 'Research - Notification Center',
      status: 'open',
      lastUpdateAt: new Date(),
    },
    create: {
      agentType: 'research',
      entityKey: ENTITY_KEY,
      title: 'Research - Notification Center',
      status: 'open',
      lastUpdateAt: new Date(),
    },
  })
}

async function loadState(): Promise<{ entityId: string; state: NotificationState }> {
  const entity = await getCenterEntity()
  const row = await db.agentEntityState.findUnique({
    where: { agentEntityId: entity.id },
    select: { stateJson: true },
  })
  const state = safeParse<NotificationState>(row?.stateJson, {
    queue: [],
    history: [],
    updatedAt: nowIso(),
  })
  return { entityId: entity.id, state }
}

async function saveState(entityId: string, state: NotificationState): Promise<void> {
  await db.agentEntityState.upsert({
    where: { agentEntityId: entityId },
    update: { stateJson: JSON.stringify(state), updatedAt: new Date() },
    create: { agentEntityId: entityId, stateJson: JSON.stringify(state) },
  })
}

export async function enqueueNotification(input: {
  title: string
  body: string
  priority?: NotificationPriority
  channel?: NotificationChannel
  source?: string
  meta?: Record<string, unknown>
}): Promise<NotificationItem> {
  const { entityId, state } = await loadState()
  const item: NotificationItem = {
    id: makeId(),
    title: input.title.trim(),
    body: input.body.trim(),
    priority: input.priority || 'medium',
    channel: input.channel || 'desktop',
    source: input.source || 'system',
    createdAt: nowIso(),
    status: 'pending',
    ...(input.meta ? { meta: input.meta } : {}),
  }
  const queue = [item, ...state.queue].slice(0, 300)
  const next: NotificationState = { ...state, queue, updatedAt: nowIso() }
  await saveState(entityId, next)
  return item
}

export async function listNotifications(options?: {
  includeRead?: boolean
  channel?: NotificationChannel
  max?: number
}): Promise<NotificationItem[]> {
  const { state } = await loadState()
  const max = Math.max(1, Math.min(Number(options?.max || 100), 300))
  let out = [...state.queue, ...(options?.includeRead ? state.history : [])]
  if (options?.channel) out = out.filter((n) => n.channel === options.channel)
  return out.slice(0, max)
}

export async function acknowledgeNotification(id: string): Promise<NotificationItem | null> {
  const { entityId, state } = await loadState()
  const idx = state.queue.findIndex((n) => n.id === id)
  if (idx < 0) return null
  const item = state.queue[idx]
  const read: NotificationItem = {
    ...item,
    status: 'read',
    readAt: nowIso(),
  }
  const queue = state.queue.filter((n) => n.id !== id)
  const history = [read, ...state.history].slice(0, 500)
  const next: NotificationState = { ...state, queue, history, updatedAt: nowIso() }
  await saveState(entityId, next)
  return read
}

export async function markNotificationSent(id: string): Promise<void> {
  const { entityId, state } = await loadState()
  const nextQueue = state.queue.map((n) => (n.id === id ? { ...n, status: 'sent' as const } : n))
  await saveState(entityId, { ...state, queue: nextQueue, updatedAt: nowIso() })
}

export async function clearNotifications(maxKeepHistory = 200): Promise<void> {
  const { entityId, state } = await loadState()
  await saveState(entityId, {
    queue: [],
    history: state.history.slice(0, Math.max(0, maxKeepHistory)),
    updatedAt: nowIso(),
  })
}
