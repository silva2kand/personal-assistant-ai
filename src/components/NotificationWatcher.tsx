'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/hooks/use-toast'

type QueueNotification = {
  id: string
  title: string
  body: string
  priority: 'high' | 'medium' | 'low'
  channel: 'desktop' | 'whatsapp' | 'chat'
  source: string
  createdAt: string
}

async function fetchDesktopQueue(max = 5): Promise<QueueNotification[]> {
  const res = await fetch(`/api/notifications/queue?channel=desktop&max=${max}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({}))
  return Array.isArray(data?.items) ? (data.items as QueueNotification[]) : []
}

async function acknowledge(id: string): Promise<void> {
  await fetch(`/api/notifications/queue/${encodeURIComponent(id)}/ack`, {
    method: 'POST',
    cache: 'no-store',
  }).catch(() => {
    // Best-effort ack.
  })
}

export default function NotificationWatcher() {
  const { toast } = useToast()
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let alive = true

    const run = async () => {
      if (!alive) return
      const items = await fetchDesktopQueue(5)
      if (!alive || items.length === 0) return
      for (const item of items) {
        if (seenRef.current.has(item.id)) continue
        seenRef.current.add(item.id)
        toast({
          title: item.title,
          description: item.body,
          variant: item.priority === 'high' ? 'destructive' : 'default',
        })
        void acknowledge(item.id)
      }
    }

    void run()
    const id = window.setInterval(() => {
      void run()
    }, 15_000)

    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [toast])

  return null
}
