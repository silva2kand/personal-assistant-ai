'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Message, useApp } from '@/context/AppContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Bot, User, Scale, Calculator, Truck, Mail, Search, Volume2, Square, Loader2 } from 'lucide-react'

interface Props {
  message: Message
}

export default function MessageBubble({ message }: Props) {
  const { ttsVoice, ttsSpeed } = useApp()
  const isUser = message.role === 'user'
  const isAgent = message.role === 'agent'
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isLoadingAudio, setIsLoadingAudio] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  const getAgentIcon = (type?: string) => {
    switch (type) {
      case 'legal': return Scale
      case 'financial': return Calculator
      case 'supplier': return Truck
      case 'email': return Mail
      case 'research': return Search
      default: return Bot
    }
  }

  const getAgentColor = (type?: string) => {
    switch (type) {
      case 'legal': return 'bg-purple-600'
      case 'financial': return 'bg-green-600'
      case 'supplier': return 'bg-orange-600'
      case 'email': return 'bg-blue-600'
      case 'research': return 'bg-cyan-600'
      default: return 'bg-blue-600'
    }
  }

  const getAgentBadgeColor = (type?: string) => {
    switch (type) {
      case 'legal': return 'border-purple-500 text-purple-400'
      case 'financial': return 'border-green-500 text-green-400'
      case 'supplier': return 'border-orange-500 text-orange-400'
      case 'email': return 'border-blue-500 text-blue-400'
      case 'research': return 'border-cyan-500 text-cyan-400'
      default: return 'border-blue-500 text-blue-400'
    }
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const cleanupAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    if (typeof window !== 'undefined' && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
    }
    cleanupAudioUrl()
    setIsSpeaking(false)
    setIsLoadingAudio(false)
  }

  useEffect(() => {
    return () => {
      stopAudio()
    }
  }, [])

  const plainTextForSpeech = (content: string) => {
    let text = content
    text = text.replace(/```[\s\S]*?```/g, (match) => match.replace(/```[\w]*\n?/g, '').replace(/```/g, ''))
    text = text.replace(/`([^`]+)`/g, '$1')
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
    text = text.replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/\n+/g, '. ')
    return text.trim()
  }

  const speakMessage = async () => {
    if (isSpeaking || isLoadingAudio) {
      stopAudio()
      return
    }

    const text = plainTextForSpeech(message.content)
    if (!text) return

    setIsLoadingAudio(true)
    try {
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: ttsVoice, speed: ttsSpeed }),
      })

      if (response.ok) {
        const audioBlob = await response.blob()
        cleanupAudioUrl()
        const audioUrl = URL.createObjectURL(audioBlob)
        audioUrlRef.current = audioUrl

        const audio = new Audio(audioUrl)
        audioRef.current = audio
        audio.onplay = () => {
          setIsLoadingAudio(false)
          setIsSpeaking(true)
        }
        audio.onended = () => {
          setIsSpeaking(false)
          audioRef.current = null
          cleanupAudioUrl()
        }
        audio.onerror = () => {
          setIsSpeaking(false)
          setIsLoadingAudio(false)
          audioRef.current = null
          cleanupAudioUrl()
        }
        await audio.play()
        return
      }
    } catch {
      // Fall through to browser TTS fallback.
    }

    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.onstart = () => {
          setIsLoadingAudio(false)
          setIsSpeaking(true)
        }
        utterance.onend = () => setIsSpeaking(false)
        utterance.onerror = () => {
          setIsSpeaking(false)
          setIsLoadingAudio(false)
        }
        window.speechSynthesis.speak(utterance)
      } else {
        setIsLoadingAudio(false)
      }
    } catch {
      setIsLoadingAudio(false)
    }
  }

  // Simple markdown-like rendering
  const renderContent = (content: string) => {
    // Code blocks
    content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-zinc-800 p-3 rounded-lg overflow-x-auto my-2"><code>$2</code></pre>')
    // Inline code
    content = content.replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 rounded">$1</code>')
    // Bold
    content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Links
    content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">$1</a>')
    // Line breaks
    content = content.replace(/\n/g, '<br />')
    
    return <div dangerouslySetInnerHTML={{ __html: content }} />
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <Avatar className="w-8 h-8 shrink-0 mt-1">
          <AvatarFallback className={isAgent ? getAgentColor(message.agentType) : 'bg-blue-600'}>
            {isAgent ? (
              React.createElement(getAgentIcon(message.agentType), { className: 'w-4 h-4' })
            ) : (
              <Bot className="w-4 h-4" />
            )}
          </AvatarFallback>
        </Avatar>
      )}

      <div className={`max-w-[80%] ${isUser ? 'order-first' : ''}`}>
        {isAgent && message.agentName && (
          <Badge variant="outline" className={`text-[10px] mb-1 ${getAgentBadgeColor(message.agentType)}`}>
            {message.agentName}
          </Badge>
        )}
        <div
          className={`
            px-4 py-3 rounded-2xl
            ${isUser 
              ? 'bg-blue-600 text-white rounded-br-md' 
              : isAgent
              ? 'bg-zinc-800 text-zinc-200 rounded-bl-md border-l-2 border-l-blue-500'
              : 'bg-zinc-800 text-zinc-200 rounded-bl-md'
            }
          `}
        >
          <div className="text-sm leading-relaxed">
            {renderContent(message.content)}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 px-1">
          {!isUser && (
            <button
              type="button"
              onClick={speakMessage}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title={isSpeaking || isLoadingAudio ? 'Stop audio' : 'Play audio'}
              aria-label={isSpeaking || isLoadingAudio ? 'Stop audio' : 'Play audio'}
            >
              {isLoadingAudio ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isSpeaking ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <p className="text-[10px] text-zinc-600">
            {formatTime(message.timestamp)}
          </p>
        </div>
      </div>

      {isUser && (
        <Avatar className="w-8 h-8 shrink-0 mt-1">
          <AvatarFallback className="bg-zinc-600">
            <User className="w-4 h-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}
