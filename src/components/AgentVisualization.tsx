'use client'

import React from 'react'
import { useApp } from '@/context/AppContext'
import { Card, CardContent } from '@/components/ui/card'
import { Scale, Calculator, Truck, Mail, Search, Loader2 } from 'lucide-react'

export default function AgentVisualization() {
  const { agents, setAgents, setActivePanel } = useApp()

  const panelForAgent = (type: string): 'chat' | 'solicitor' | 'accountant' | 'supplier' | 'email' | 'agents' => {
    switch (type) {
      case 'legal':
        return 'solicitor'
      case 'financial':
        return 'accountant'
      case 'supplier':
        return 'supplier'
      case 'email':
        return 'email'
      case 'research':
        return 'agents'
      default:
        return 'chat'
    }
  }

  const handleAgentClick = (agentId: string, agentType: string) => {
    setAgents(
      agents.map((agent) =>
        agent.id === agentId
          ? { ...agent, status: agent.status === 'idle' ? 'active' : 'idle' }
          : agent
      )
    )
    setActivePanel(panelForAgent(agentType))
  }

  const getAgentIcon = (type: string) => {
    switch (type) {
      case 'legal': return Scale
      case 'financial': return Calculator
      case 'supplier': return Truck
      case 'email': return Mail
      case 'research': return Search
      default: return Scale
    }
  }

  const getAgentColor = (type: string) => {
    switch (type) {
      case 'legal': return { bg: 'bg-purple-600', border: 'border-purple-500', text: 'text-purple-400' }
      case 'financial': return { bg: 'bg-green-600', border: 'border-green-500', text: 'text-green-400' }
      case 'supplier': return { bg: 'bg-orange-600', border: 'border-orange-500', text: 'text-orange-400' }
      case 'email': return { bg: 'bg-blue-600', border: 'border-blue-500', text: 'text-blue-400' }
      case 'research': return { bg: 'bg-cyan-600', border: 'border-cyan-500', text: 'text-cyan-400' }
      default: return { bg: 'bg-zinc-600', border: 'border-zinc-500', text: 'text-zinc-400' }
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500'
      case 'processing': return 'bg-yellow-500 animate-pulse'
      case 'error': return 'bg-red-500'
      default: return 'bg-zinc-500'
    }
  }

  return (
    <div className="grid grid-cols-5 gap-3 max-w-2xl">
      {agents.map((agent) => {
        const Icon = getAgentIcon(agent.type)
        const colors = getAgentColor(agent.type)
        const isActive = agent.status === 'active' || agent.status === 'processing'

        return (
          <Card
            key={agent.id}
            className={`
              bg-zinc-900 border-zinc-800 transition-all duration-300 cursor-pointer
              hover:border-zinc-600 ${isActive ? `border-l-2 ${colors.border}` : ''}
            `}
            onClick={() => handleAgentClick(agent.id, agent.type)}
          >
            <CardContent className="p-3 text-center">
              <div className="relative inline-block">
                <div className={`
                  w-10 h-10 rounded-full ${colors.bg} flex items-center justify-center mx-auto mb-2
                  ${isActive ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-blue-500' : ''}
                `}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className={`
                  absolute -top-1 -right-1 w-3 h-3 rounded-full ${getStatusColor(agent.status)}
                  border-2 border-zinc-900
                `} />
              </div>
              <p className={`text-xs font-medium ${isActive ? colors.text : 'text-zinc-400'}`}>
                {agent.name.replace(' Agent', '')}
              </p>
              <p className="text-[10px] text-zinc-600 mt-1">
                {agent.status === 'processing' ? (
                  <span className="flex items-center justify-center gap-1">
                    <Loader2 className="w-2 h-2 animate-spin" />
                    Working
                  </span>
                ) : agent.status}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
