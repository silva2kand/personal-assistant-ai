'use client'

import React, { useEffect, useState } from 'react'
import { AppProvider, useApp } from '@/context/AppContext'
import Sidebar from '@/components/Sidebar'
import ChatInterface from '@/components/ChatInterface'
import SolicitorPanel from '@/components/SolicitorPanel'
import AccountantPanel from '@/components/AccountantPanel'
import SupplierPanel from '@/components/SupplierPanel'
import EmailPanel from '@/components/EmailPanel'
import AgentStatusPanel from '@/components/AgentStatusPanel'
import CasesEntitiesPanel from '@/components/CasesEntitiesPanel'
import DocumentVaultPanel from '@/components/DocumentVaultPanel'
import { Toaster } from '@/components/ui/toaster'
import NotificationWatcher from '@/components/NotificationWatcher'

function MainContent() {
  const { sidebarCollapsed, activePanel } = useApp()
  
  useEffect(() => {
    void fetch('/api/agents/worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runs: 1 }),
    }).catch(() => {
      // Startup worker kick is best-effort.
    })
  }, [])

  useEffect(() => {
    const cooldownMs = 6 * 60 * 60 * 1000
    const storageKey = 'historicalBackfill:lastTriggeredAt'
    const now = Date.now()
    const previousRaw = window.localStorage.getItem(storageKey)
    const previous = previousRaw ? Number(previousRaw) : 0
    if (Number.isFinite(previous) && previous > 0 && now - previous < cooldownMs) {
      return
    }

    window.localStorage.setItem(storageKey, String(now))
    void fetch('/api/agents/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sinceYear: 2023,
      }),
    }).catch(() => {
      // Startup bootstrap is best-effort.
    })
  }, [])

  const renderActivePanel = () => {
    switch (activePanel) {
      case 'solicitor':
        return <SolicitorPanel />
      case 'accountant':
        return <AccountantPanel />
      case 'supplier':
        return <SupplierPanel />
      case 'email':
        return <EmailPanel />
      case 'agents':
        return <AgentStatusPanel />
      case 'entities':
        return <CasesEntitiesPanel />
      case 'documents':
        return <DocumentVaultPanel />
      default:
        return <ChatInterface />
    }
  }

  return (
    <div
      className="flex h-dvh min-h-0 min-w-0 bg-zinc-950 text-white overflow-hidden"
    >
      <Sidebar />
      <main className={`flex min-h-0 min-w-0 flex-1 flex-col transition-all duration-300 ${sidebarCollapsed ? 'ml-0' : ''}`}>
        {renderActivePanel()}
      </main>
    </div>
  )
}

export default function Home() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-dvh bg-zinc-950" />
  }

  return (
    <AppProvider>
      <MainContent />
      <NotificationWatcher />
      <Toaster />
    </AppProvider>
  )
}
