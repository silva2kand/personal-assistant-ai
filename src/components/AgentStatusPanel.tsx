'use client'

import React, { useState, useEffect } from 'react'
import { useApp, Agent } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Scale,
  Calculator,
  Truck,
  Mail,
  Search,
  Bot,
  Play,
  Pause,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  Clock,
  Activity,
  Zap,
} from 'lucide-react'

const agentDetails = {
  legal: {
    icon: Scale,
    name: 'Legal Agent',
    color: 'purple',
    description: 'Handles UK legal matters, solicitor communications, and document analysis',
    capabilities: ['Contract review', 'Legal research', 'Solicitor coordination', 'Document preparation'],
  },
  financial: {
    icon: Calculator,
    name: 'Financial Agent',
    color: 'green',
    description: 'Manages accounting, tax deadlines, and financial document tracking',
    capabilities: ['Tax reminders', 'Invoice processing', 'Financial analysis', 'Accountant coordination'],
  },
  supplier: {
    icon: Truck,
    name: 'Supplier Agent',
    color: 'orange',
    description: 'Tracks suppliers, orders, and supply chain communications',
    capabilities: ['Order tracking', 'Invoice matching', 'Supplier communication', 'Inventory alerts'],
  },
  email: {
    icon: Mail,
    name: 'Email Agent',
    color: 'blue',
    description: 'Monitors and manages email communications across accounts',
    capabilities: ['Email monitoring', 'Auto-responses', 'Priority filtering', 'Calendar integration'],
  },
  research: {
    icon: Search,
    name: 'Research Agent',
    color: 'cyan',
    description: 'Gathers and analyzes information from various sources',
    capabilities: ['Web research', 'Data analysis', 'Report generation', 'Market intelligence'],
  },
}

export default function AgentStatusPanel() {
  const { agents, setAgents, setActivePanel, addMessage, currentConversation, createNewConversation } = useApp()
  const [agentLogs, setAgentLogs] = useState<Record<string, string[]>>({})

  const fetchRealAgentSessions = async () => {
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      const sessions = Array.isArray(data.sessions) ? data.sessions : []
      const byType = new Map<string, string>()
      sessions.forEach((s: { agentType?: string; status?: string }) => {
        if (!s?.agentType) return
        byType.set(String(s.agentType), String(s.status || 'idle'))
      })

      setAgents((prev) =>
        prev.map((agent) => {
          const status = byType.get(agent.id)
          if (status === 'active' || status === 'processing' || status === 'error' || status === 'idle') {
            return { ...agent, status }
          }
          return agent
        })
      )
    } catch {
      // Keep last-known UI state on fetch errors.
    }
  }

  const getAgentIcon = (type: string) => {
    return agentDetails[type as keyof typeof agentDetails]?.icon || Bot
  }

  const getAgentColor = (type: string) => {
    return agentDetails[type as keyof typeof agentDetails]?.color || 'zinc'
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500'
      case 'processing': return 'bg-yellow-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-zinc-500'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-600'
      case 'processing': return 'bg-yellow-600'
      case 'error': return 'bg-red-600'
      default: return 'bg-zinc-600'
    }
  }

  const toggleAgent = (agentId: string) => {
    setAgents(agents.map(agent => {
      if (agent.id === agentId) {
        return {
          ...agent,
          status: agent.status === 'idle' ? 'active' : 'idle'
        }
      }
      return agent
    }))
  }

  const chatWithAgent = (agent: Agent) => {
    if (!currentConversation) {
      createNewConversation()
    }
    setActivePanel('chat')
    setTimeout(() => {
      addMessage({
        role: 'user',
        content: `I need help from the ${agent.name}. ${agentDetails[agent.type as keyof typeof agentDetails]?.description}. Can you assist me?`,
      })
    }, 100)
  }

  useEffect(() => {
    void fetchRealAgentSessions()
    const interval = setInterval(() => {
      void fetchRealAgentSessions()
    }, 15000)
    return () => clearInterval(interval)
  }, [setAgents])

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-6 h-6 text-blue-500" />
            <div>
              <h2 className="text-lg font-semibold text-white">AI Agents Hub</h2>
              <p className="text-xs text-zinc-500">Collaborative AI assistant management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-blue-500 text-blue-400">
              <Activity className="w-3 h-3 mr-1" />
              {agents.filter(a => a.status === 'active' || a.status === 'processing').length} Active
            </Badge>
            <Button variant="outline" size="sm">
              <RefreshCw className="w-3 h-3 mr-1" />
              Sync
            </Button>
          </div>
        </div>
      </div>

      {/* Agent Grid */}
      <ScrollArea className="flex-1 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => {
            const details = agentDetails[agent.type as keyof typeof agentDetails]
            const Icon = details?.icon || Bot
            const color = details?.color || 'zinc'

            return (
              <Card key={agent.id} className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full bg-${color}-600 flex items-center justify-center`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-sm text-white">{agent.name}</CardTitle>
                        <Badge variant="outline" className={`text-[10px] mt-1 border-${color}-500 text-${color}-400`}>
                          {agent.status}
                        </Badge>
                      </div>
                    </div>
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400 mb-3">{details?.description}</p>

                  {/* Capabilities */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {details?.capabilities.map((cap, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {cap}
                      </Badge>
                    ))}
                  </div>

                  {/* Status indicator */}
                  {agent.status === 'processing' && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
                        <span>Processing...</span>
                        <span>67%</span>
                      </div>
                      <Progress value={67} className="h-1" />
                    </div>
                  )}

                  <Separator className="my-2 bg-zinc-800" />

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => toggleAgent(agent.id)}
                    >
                      {agent.status === 'idle' ? (
                        <>
                          <Play className="w-3 h-3 mr-1" />
                          Activate
                        </>
                      ) : (
                        <>
                          <Pause className="w-3 h-3 mr-1" />
                          Pause
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => chatWithAgent(agent)}
                    >
                      <Zap className="w-3 h-3 mr-1" />
                      Interact
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Collaboration Section */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            Agent Collaboration
          </h3>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <p className="text-xs text-zinc-400 mb-3">
                When you ask complex questions, multiple agents collaborate to provide comprehensive answers.
                The system automatically routes tasks to the most appropriate agents.
              </p>
              <div className="flex items-center gap-2 text-xs">
                <Badge className="bg-purple-600">Legal</Badge>
                <span className="text-zinc-600">+</span>
                <Badge className="bg-green-600">Financial</Badge>
                <span className="text-zinc-600">+</span>
                <Badge className="bg-orange-600">Supplier</Badge>
                <span className="text-zinc-600">+</span>
                <Badge className="bg-blue-600">Email</Badge>
                <span className="text-zinc-600">+</span>
                <Badge className="bg-cyan-600">Research</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Activity Log */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            Recent Activity
          </h3>
          <div className="space-y-2">
            {[
              { agent: 'Legal Agent', action: 'Analyzed contract document', time: '2 min ago' },
              { agent: 'Email Agent', action: 'Processed 3 new emails', time: '5 min ago' },
              { agent: 'Financial Agent', action: 'Tax deadline reminder sent', time: '10 min ago' },
              { agent: 'Supplier Agent', action: 'Order status updated', time: '15 min ago' },
            ].map((log, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-zinc-900 p-2 rounded">
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-green-500" />
                  <span className="text-zinc-400">{log.agent}:</span>
                  <span className="text-white">{log.action}</span>
                </div>
                <span className="text-zinc-600">{log.time}</span>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
