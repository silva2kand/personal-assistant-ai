'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Activity, Clock, Mail, RefreshCw, CheckCircle2, FileText, Sparkles } from 'lucide-react'

type EntityRow = {
  id: string
  agentType: string
  entityKey: string
  title: string
  status: string
  lastUpdateAt: string
  eventsCount: number
  queueCount: number
  pendingCount: number
  state: Record<string, unknown>
}

type WorkerStatus = {
  worker: 'idle' | 'running'
  running: boolean
  lastCycleAt: string | null
  lastCycleDurationMs: number | null
  lastCycle: {
    ingested: number
    processedEvents: number
    updatedEntities: number
  }
  lastLogLine: string | null
  pendingEvents: number
  entities: number
  emails: number
  entitiesUpdatedLast5Minutes: number
}

type EntityDetailState = {
  entity: {
    id: string
    agentType: string
    entityKey: string
    title: string
    status: string
    lastUpdateAt: string
  }
  state: {
    status?: string
    last_email_date?: string
    waiting_on?: string
    facts?: Record<string, unknown>
    next_actions?: string[]
  }
}

type TimelineItem = {
  id: string
  source: string
  sourceRef: string
  rawRef: string | null
  summary: string
  createdAt: string
  subject?: string
  fromAddress?: string
  emailDate?: string | null
  provider?: string | null
}

function statusBadge(status: string) {
  const value = status.toLowerCase()
  if (value === 'closed') return 'bg-green-600'
  if (value === 'blocked') return 'bg-red-600'
  if (value === 'waiting') return 'bg-yellow-600'
  return 'bg-blue-600'
}

export default function CasesEntitiesPanel() {
  const { setActivePanel, addMessage, currentConversation, createNewConversation, setEmailEntityFilter } = useApp()
  const [entities, setEntities] = useState<EntityRow[]>([])
  const [worker, setWorker] = useState<WorkerStatus | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string>('')
  const [detail, setDetail] = useState<EntityDetailState | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedEntityId) || null,
    [entities, selectedEntityId]
  )

  const loadWorker = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/worker')
      const data = await res.json()
      if (res.ok) {
        setWorker(data as WorkerStatus)
      }
    } catch {
      // no-op
    }
  }, [])

  const loadEntities = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/entities?limit=120')
      const data = await res.json()
      if (res.ok && Array.isArray(data.entities)) {
        setEntities(data.entities)
        if (!selectedEntityId && data.entities.length > 0) {
          setSelectedEntityId(data.entities[0].id)
        }
      }
    } catch {
      setEntities([])
    }
  }, [selectedEntityId])

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      const [stateRes, timelineRes] = await Promise.all([
        fetch(`/api/agents/entity/${id}/state`),
        fetch(`/api/agents/entity/${id}/timeline?limit=120`),
      ])
      const stateData = await stateRes.json()
      const timelineData = await timelineRes.json()
      if (stateRes.ok) setDetail(stateData)
      if (timelineRes.ok && Array.isArray(timelineData.events)) setTimeline(timelineData.events)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async (syncNow = false) => {
    setRefreshing(true)
    try {
      if (syncNow) {
        await fetch('/api/agents/worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runs: 1 }),
        })
      }
      await Promise.all([loadWorker(), loadEntities()])
      if (selectedEntityId) await loadDetail(selectedEntityId)
    } finally {
      setRefreshing(false)
    }
  }, [loadEntities, loadWorker, loadDetail, selectedEntityId])

  useEffect(() => {
    void refreshAll(false)
  }, [refreshAll])

  useEffect(() => {
    if (!selectedEntityId) return
    void loadDetail(selectedEntityId)
  }, [selectedEntityId, loadDetail])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadWorker()
      void loadEntities()
    }, 12_000)
    return () => clearInterval(timer)
  }, [loadWorker, loadEntities])

  const onDraftFollowUp = () => {
    if (!detail) return
    if (!currentConversation) createNewConversation()
    setActivePanel('chat')
    setTimeout(() => {
      addMessage({
        role: 'user',
        content: [
          'Draft a follow-up email for this entity based on current state.',
          `Entity: ${detail.entity.title}`,
          `Status: ${detail.state.status || detail.entity.status}`,
          `Waiting on: ${detail.state.waiting_on || 'unknown'}`,
          `Last email date: ${detail.state.last_email_date || 'unknown'}`,
          `Facts: ${JSON.stringify(detail.state.facts || {})}`,
          `Next actions: ${JSON.stringify(detail.state.next_actions || [])}`,
        ].join('\n'),
      })
    }, 120)
  }

  const onMarkResolved = async () => {
    if (!selectedEntityId) return
    await fetch(`/api/agents/entity/${selectedEntityId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    })
    await refreshAll(false)
  }

  const onOpenAllEmails = () => {
    if (!detail) return
    setEmailEntityFilter(detail.entity.entityKey)
    setActivePanel('email')
  }

  const nextActions = Array.isArray(detail?.state?.next_actions)
    ? detail?.state?.next_actions
    : []

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-b border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-blue-500" />
            <div>
              <h2 className="text-lg font-semibold text-white">Cases & Entities</h2>
              <p className="text-xs text-zinc-500">Live memory, status and next actions across solicitor/accountant/supplier/business/research</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refreshAll(false)} disabled={refreshing}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => refreshAll(true)} disabled={refreshing}>
              <Sparkles className="mr-1 h-3 w-3" />
              Sync Now
            </Button>
          </div>
        </div>
      </div>

      <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-[360px_1fr]">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-white">Mini Computer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Worker</span>
              <Badge className={worker?.running ? 'bg-yellow-600' : 'bg-green-600'}>
                {worker?.worker || 'idle'}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Last cycle</span>
              <span>{worker?.lastCycleAt ? new Date(worker.lastCycleAt).toLocaleTimeString() : 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Entities updated (5m)</span>
              <span>{worker?.entitiesUpdatedLast5Minutes || 0}</span>
            </div>
            <div className="rounded bg-zinc-950 p-2 text-zinc-300">
              {worker?.lastLogLine || 'No recent updates yet.'}
            </div>
            <Separator className="bg-zinc-800" />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded bg-zinc-950 p-2">
                <div className="text-[10px] text-zinc-500">Ingested</div>
                <div className="text-sm text-white">{worker?.lastCycle?.ingested || 0}</div>
              </div>
              <div className="rounded bg-zinc-950 p-2">
                <div className="text-[10px] text-zinc-500">Processed</div>
                <div className="text-sm text-white">{worker?.lastCycle?.processedEvents || 0}</div>
              </div>
              <div className="rounded bg-zinc-950 p-2">
                <div className="text-[10px] text-zinc-500">Pending</div>
                <div className="text-sm text-white">{worker?.pendingEvents || 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 overflow-hidden rounded border border-zinc-800 bg-zinc-900">
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[320px_1fr]">
            <div className="min-h-0 border-b border-zinc-800 lg:border-b-0 lg:border-r">
              <div className="p-3 text-sm font-medium text-white">Cases List</div>
              <ScrollArea className="h-[calc(100%-44px)]">
                <div className="space-y-2 p-2">
                  {entities.map((row) => (
                    <button
                      key={row.id}
                      onClick={() => setSelectedEntityId(row.id)}
                      className={`w-full rounded border p-2 text-left text-xs transition-colors ${
                        selectedEntityId === row.id
                          ? 'border-blue-600 bg-zinc-800'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Badge className="bg-zinc-700">{row.agentType}</Badge>
                        <Badge className={statusBadge(row.status)}>{row.status}</Badge>
                      </div>
                      <div className="truncate text-zinc-100">{row.title}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{new Date(row.lastUpdateAt).toLocaleString()}</div>
                    </button>
                  ))}
                  {entities.length === 0 && (
                    <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
                      No entities yet. Run sync and check inbox connections.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="min-h-0">
              <div className="border-b border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{detail?.entity?.title || selected?.title || 'Select an entity'}</div>
                    <div className="text-xs text-zinc-500">{detail?.entity?.entityKey || selected?.entityKey || ''}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={onDraftFollowUp} disabled={!detail}>
                      <FileText className="mr-1 h-3 w-3" />
                      Draft follow-up
                    </Button>
                    <Button size="sm" variant="outline" onClick={onOpenAllEmails} disabled={!detail}>
                      <Mail className="mr-1 h-3 w-3" />
                      Open all emails
                    </Button>
                    <Button size="sm" onClick={onMarkResolved} disabled={!detail}>
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Mark resolved
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid h-[calc(100%-61px)] min-h-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[360px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white">Current State</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Status</span>
                      <Badge className={statusBadge(detail?.state?.status || detail?.entity?.status || 'open')}>
                        {detail?.state?.status || detail?.entity?.status || 'open'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Waiting on</span>
                      <span className="truncate pl-3">{detail?.state?.waiting_on || 'n/a'}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Last email date</span>
                      <span>{detail?.state?.last_email_date ? new Date(detail.state.last_email_date).toLocaleString() : 'n/a'}</span>
                    </div>
                    <Separator className="bg-zinc-800" />
                    <div>
                      <div className="mb-1 text-zinc-400">Next actions</div>
                      {nextActions.length === 0 ? (
                        <div className="text-zinc-500">No actions yet.</div>
                      ) : (
                        <div className="space-y-1">
                          {nextActions.map((action, idx) => (
                            <div key={`${action}-${idx}`} className="rounded bg-zinc-900 p-2 text-zinc-200">
                              {action}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="min-h-0 border-zinc-800 bg-zinc-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white">Timeline</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[calc(100%-56px)] min-h-0 p-0">
                    <ScrollArea className="h-full px-3 pb-3">
                      <div className="space-y-2">
                        {timeline.map((event) => {
                          const when = event.emailDate || event.createdAt
                          return (
                            <div key={event.id} className="rounded border border-zinc-800 bg-zinc-900 p-2 text-xs">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="truncate font-medium text-zinc-100">{event.subject || '(No Subject)'}</span>
                                <span className="shrink-0 text-zinc-500">
                                  <Clock className="mr-1 inline h-3 w-3" />
                                  {new Date(when).toLocaleString()}
                                </span>
                              </div>
                              <div className="mb-1 text-zinc-500">{event.fromAddress || event.source}</div>
                              <div className="text-zinc-300">{event.summary}</div>
                            </div>
                          )
                        })}
                        {!loading && timeline.length === 0 && (
                          <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-500">
                            No timeline events for this entity yet.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
