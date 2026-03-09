'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'
import { 
  Scale, Calculator, Truck, Mail, Search, 
  Circle, CircleDot, Loader2, Zap
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const agentConfig = {
  legal: {
    icon: Scale,
    name: 'Legal Agent',
    description: 'Solicitor & legal assistance',
    gradient: 'from-blue-500 to-cyan-500',
    color: 'text-blue-400',
  },
  financial: {
    icon: Calculator,
    name: 'Financial Agent',
    description: 'Accounting & tax assistance',
    gradient: 'from-emerald-500 to-teal-500',
    color: 'text-emerald-400',
  },
  supplier: {
    icon: Truck,
    name: 'Supplier Agent',
    description: 'Supplier & order management',
    gradient: 'from-orange-500 to-amber-500',
    color: 'text-orange-400',
  },
  email: {
    icon: Mail,
    name: 'Email Agent',
    description: 'Email management & communication',
    gradient: 'from-pink-500 to-rose-500',
    color: 'text-pink-400',
  },
  research: {
    icon: Search,
    name: 'Research Agent',
    description: 'Information gathering & analysis',
    gradient: 'from-purple-500 to-violet-500',
    color: 'text-purple-400',
  },
}

export function AgentVisualization() {
  const { agents, activeAgents, activateAgent, deactivateAgent, updateAgentStatus } = useApp()

  const handleToggleAgent = (agentType: typeof agents[0]['type']) => {
    if (activeAgents.includes(agentType)) {
      deactivateAgent(agentType)
    } else {
      activateAgent(agentType)
    }
  }

  return (
    <div className="p-4 bg-zinc-900/50 border-t border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-medium text-zinc-300">AI Agents</span>
        </div>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          {activeAgents.length} active
        </Badge>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => {
          const config = agentConfig[agent.type]
          const Icon = config.icon
          const isActive = activeAgents.includes(agent.type)
          const isProcessing = agent.status === 'processing'
          
          return (
            <Button
              key={agent.id}
              variant="outline"
              size="sm"
              onClick={() => handleToggleAgent(agent.type)}
              className={cn(
                "relative border-zinc-700 transition-all",
                isActive 
                  ? `bg-gradient-to-r ${config.gradient} border-transparent text-white hover:opacity-90` 
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              )}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Icon className="h-4 w-4 mr-2" />
              )}
              <span className="text-xs">{config.name}</span>
              {isActive && !isProcessing && (
                <span className="ml-2 w-2 h-2 rounded-full bg-white animate-pulse" />
              )}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function AgentStatus() {
  const { agents, activeAgents } = useApp()
  
  if (activeAgents.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/50 border-b border-zinc-800">
      <span className="text-xs text-zinc-500">Active Agents:</span>
      <div className="flex items-center gap-2">
        {agents
          .filter(agent => activeAgents.includes(agent.type))
          .map(agent => {
            const config = agentConfig[agent.type]
            const Icon = config.icon
            
            return (
              <div
                key={agent.id}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800"
              >
                <Icon className={cn("h-3 w-3", config.color)} />
                <span className="text-xs text-zinc-300">{config.name}</span>
                <CircleDot className={cn("h-2 w-2", config.color, "animate-pulse")} />
              </div>
            )
          })}
      </div>
    </div>
  )
}
