'use client'

import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { User, Bot, Scale, Calculator, Truck, Mail, Search, Copy, Check } from 'lucide-react'
import type { Message } from '@/context/AppContext'

interface MessageBubbleProps {
  message: Message
}

const agentIcons: Record<string, React.ReactNode> = {
  legal: <Scale className="h-4 w-4" />,
  financial: <Calculator className="h-4 w-4" />,
  supplier: <Truck className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  research: <Search className="h-4 w-4" />,
}

const agentColors: Record<string, string> = {
  legal: 'from-blue-500 to-cyan-500',
  financial: 'from-emerald-500 to-teal-500',
  supplier: 'from-orange-500 to-amber-500',
  email: 'from-pink-500 to-rose-500',
  research: 'from-purple-500 to-violet-500',
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = React.useState(false)
  const isUser = message.role === 'user'
  const isAgent = message.role === 'agent'

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const getAgentIcon = () => {
    if (!isAgent || !message.agentType) return <Bot className="h-4 w-4" />
    return agentIcons[message.agentType] || <Bot className="h-4 w-4" />
  }

  const getAgentGradient = () => {
    if (!isAgent || !message.agentType) return 'from-violet-500 to-fuchsia-500'
    return agentColors[message.agentType] || 'from-violet-500 to-fuchsia-500'
  }

  return (
    <div
      className={cn(
        "flex gap-3 p-4 group",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar className={cn(
        "h-8 w-8 shrink-0",
        isUser ? "bg-zinc-700" : `bg-gradient-to-br ${getAgentGradient()}`
      )}>
        <AvatarFallback className={cn(
          "bg-transparent",
          isUser ? "text-zinc-300" : "text-white"
        )}>
          {isUser ? <User className="h-4 w-4" /> : getAgentIcon()}
        </AvatarFallback>
      </Avatar>
      
      <div className={cn(
        "flex flex-col max-w-[80%]",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={cn(
          "rounded-2xl px-4 py-2.5",
          isUser 
            ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-tr-md" 
            : "bg-zinc-800 text-zinc-100 rounded-tl-md"
        )}>
          {isAgent && message.agentName && (
            <div className="text-xs font-medium text-zinc-400 mb-1 flex items-center gap-1">
              {getAgentIcon()}
              {message.agentName}
            </div>
          )}
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
                code: ({ className, children, ...props }) => {
                  const isInline = !className
                  return isInline ? (
                    <code className="bg-zinc-700/50 px-1.5 py-0.5 rounded text-sm" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className={cn("block bg-zinc-900 p-3 rounded-lg text-sm overflow-x-auto", className)} {...props}>
                      {children}
                    </code>
                  )
                },
                pre: ({ children }) => <>{children}</>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 underline">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
        
        <div className={cn(
          "flex items-center gap-2 mt-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
          <span className="text-xs text-zinc-500">
            {formatTime(message.createdAt)}
          </span>
          {!isUser && (
            <button
              onClick={handleCopy}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
