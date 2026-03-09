'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Send,
  Mic,
  Volume2,
  VolumeX,
  Bot,
  Scale,
  Calculator,
  Truck,
  Mail,
  Search,
  Loader2,
  StopCircle,
  MonitorCog,
  Ear,
  CheckCircle2,
  Circle,
} from 'lucide-react'
import MessageBubble from './MessageBubble'
import AgentVisualization from './AgentVisualization'
import { toSpeechSafeText } from '@/lib/speech-safe'

const liveProcessingSteps = [
  'Classifying request',
  'Gathering relevant context',
  'Running mailbox/entity tasks',
  'Composing response',
  'Finalizing result',
]

const CHAT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

export default function ChatInterface() {
  const {
    currentConversation,
    createNewConversation,
    addMessage,
    isLoading,
    setIsLoading,
    voiceEnabled,
    setVoiceEnabled,
    isRecording,
    setIsRecording,
    ttsVoice,
    setTtsVoice,
    ttsSpeed,
    setTtsSpeed,
    selectedModel,
    agents,
    activePanel,
  } = useApp()

  const [input, setInput] = useState('')
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [listenAfterReply, setListenAfterReply] = useState(false)
  const [workflowSteps, setWorkflowSteps] = useState<string[]>([])
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([])
  const [showWorkflow, setShowWorkflow] = useState(true)
  const [liveStepIndex, setLiveStepIndex] = useState(0)
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const speechApiAvailable =
    typeof window !== 'undefined' &&
    (('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window))

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const viewport = scrollRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
  }, [])

  // Auto-scroll to bottom after render updates.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollToBottom('auto')
    })

    return () => cancelAnimationFrame(frame)
  }, [
    scrollToBottom,
    currentConversation?.messages.length,
    isLoading,
    liveStepIndex,
    workflowSteps.length,
    suggestedFollowUps.length,
  ])

  // Live processing progress while waiting for API response.
  useEffect(() => {
    if (!isLoading) {
      setLiveStepIndex(0)
      setLiveElapsedSeconds(0)
      return
    }

    const startedAt = Date.now()
    const stepInterval = window.setInterval(() => {
      setLiveStepIndex((prev) => Math.min(prev + 1, liveProcessingSteps.length - 1))
    }, 1300)
    const timerInterval = window.setInterval(() => {
      setLiveElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => {
      clearInterval(stepInterval)
      clearInterval(timerInterval)
    }
  }, [isLoading])

  // Send message
  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')

    // Create conversation if needed
    if (!currentConversation) {
      createNewConversation()
      // Wait for state update
      setTimeout(() => sendMessage(userMessage), 100)
      return
    }

    await sendMessage(userMessage)
  }

  const sendMessage = async (content: string) => {
    addMessage({ role: 'user', content })
    setIsLoading(true)

    let timeout: ReturnType<typeof window.setTimeout> | undefined
    try {
      const controller = new AbortController()
      timeout = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS)

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          model: selectedModel,
          conversationHistory: currentConversation?.messages.slice(-10) || [],
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Chat API failed with status ${response.status}`)
      }

      const data = await response.json()

      if (data.response) {
        addMessage({ role: 'assistant', content: data.response })

        // TTS if enabled
        if (voiceEnabled && data.response) {
          await speakText(data.response)
          if (listenAfterReply) {
            await startRecording()
          }
        }
      }

      if (Array.isArray(data.steps)) {
        setWorkflowSteps(data.steps)
      }
      if (Array.isArray(data.followUps)) {
        setSuggestedFollowUps(data.followUps)
      }

      // Check if agents were involved
      if (data.agents && data.agents.length > 0) {
        data.agents.forEach((agent: { type: string; name: string; contribution: string }) => {
          addMessage({
            role: 'agent',
            content: agent.contribution,
            agentType: agent.type,
            agentName: agent.name,
          })
        })
      }
    } catch (error) {
      console.error('Chat error:', error)
      if (error instanceof Error && error.name === 'AbortError') {
        addMessage({
          role: 'assistant',
          content: `This request timed out after ${Math.round(CHAT_REQUEST_TIMEOUT_MS / 1000)} seconds. Please retry or narrow the scope if the mailbox is very large.`,
        })
      } else {
        addMessage({ role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' })
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      setIsLoading(false)
    }
  }

  // Voice Recording
  const startBrowserSTT = () => {
    try {
      const SpeechRec: typeof SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const rec: SpeechRecognition = new SpeechRec()
      rec.lang = 'en-GB'
      rec.continuous = false
      rec.interimResults = false
      rec.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript
        if (transcript) setInput(transcript)
      }
      rec.onend = () => {
        setIsRecording(false)
        recognitionRef.current = null
      }
      rec.onerror = () => {
        setIsRecording(false)
        recognitionRef.current = null
      }
      recognitionRef.current = rec
      rec.start()
      setIsRecording(true)
    } catch (error) {
      console.error('Browser STT error:', error)
      setIsRecording(false)
    }
  }

  const startRecording = async () => {
    try {
      if (speechApiAvailable) {
        startBrowserSTT()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
        await transcribeAudio(audioBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error('Error accessing microphone:', error)
    }
  }

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setIsRecording(false)
      return
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob)

      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (data.text) {
        setInput(data.text)
      } else if (speechApiAvailable) {
        startBrowserSTT()
      }
    } catch (error) {
      console.error('Transcription error:', error)
      if (speechApiAvailable) {
        startBrowserSTT()
      }
    }
  }

  // Text-to-Speech
  const speakText = async (text: string) => {
    try {
      const speechText = toSpeechSafeText(text, 1024)
      setAudioPlaying(true)
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speechText, voice: ttsVoice, speed: ttsSpeed }),
      })

      if (response.ok) {
        const audioBlob = await response.blob()
        const audio = new Audio(URL.createObjectURL(audioBlob))
        audio.onended = () => setAudioPlaying(false)
        await audio.play()
      } else {
        // Browser TTS fallback when server voice API is unavailable
        const utterance = new SpeechSynthesisUtterance(speechText)
        utterance.onend = () => setAudioPlaying(false)
        window.speechSynthesis.speak(utterance)
      }
    } catch (error) {
      console.error('TTS error:', error)
      try {
        const utterance = new SpeechSynthesisUtterance(toSpeechSafeText(text, 1024))
        utterance.onend = () => setAudioPlaying(false)
        window.speechSynthesis.speak(utterance)
      } catch {
        setAudioPlaying(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends, Shift+Enter makes a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const runFollowUp = async (text: string) => {
    setInput(text)
    await sendMessage(text)
  }

  const getAgentIcon = (type: string) => {
    switch (type) {
      case 'legal': return Scale
      case 'financial': return Calculator
      case 'supplier': return Truck
      case 'email': return Mail
      case 'research': return Search
      default: return Bot
    }
  }

  // Get active agents
  const activeAgents = agents.filter(a => a.status === 'active' || a.status === 'processing')

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-blue-500" />
          <div>
            <h2 className="text-lg font-semibold text-white">
              {activePanel === 'chat' ? 'AI Assistant' : 
               activePanel === 'solicitor' ? 'UK Solicitor Tracking' :
               activePanel === 'accountant' ? 'UK Accountant Tracking' :
               activePanel === 'supplier' ? 'UK Supplier Tracking' :
               activePanel === 'email' ? 'Email Integration' : 'AI Agents'}
            </h2>
            <p className="text-xs text-zinc-500">
              Powered by {selectedModel.toUpperCase()}
            </p>
          </div>
        </div>
        {activeAgents.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Active Agents:</span>
            {activeAgents.map(agent => {
              const Icon = getAgentIcon(agent.type)
              return (
                <Badge key={agent.id} variant="outline" className="border-blue-500 text-blue-400">
                  <Icon className="w-3 h-3 mr-1" />
                  {agent.name}
                </Badge>
              )
            })}
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
        {!currentConversation || currentConversation.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="w-16 h-16 text-zinc-700 mb-4" />
            <h3 className="text-xl font-semibold text-zinc-400 mb-2">How can I help you today?</h3>
            <p className="text-zinc-600 max-w-md">
              I can assist with UK legal matters, accounting, supplier tracking, and email management. 
              Just ask or use voice input.
            </p>
            {/* Agent Visualization */}
            <div className="mt-8">
              <AgentVisualization />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {currentConversation.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex items-center gap-3 p-4">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-blue-600">
                    <Bot className="w-4 h-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  <span className="text-zinc-400">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggested Follow-ups */}
      {suggestedFollowUps.length > 0 && (
        <div className="px-4 pb-2">
          <p className="text-xs text-zinc-500 mb-2">Suggested follow-ups</p>
          <div className="flex flex-wrap gap-2">
            {suggestedFollowUps.map((item) => (
              <Button
                key={item}
                variant="outline"
                size="sm"
                className="text-xs border-zinc-700 text-zinc-300"
                disabled={isLoading}
                onClick={() => runFollowUp(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="mx-4 mb-2 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-zinc-200">
              <MonitorCog className="h-4 w-4 text-emerald-400" />
              <span>Live Processing</span>
            </div>
            <span className="text-xs text-zinc-400">{liveElapsedSeconds}s</span>
          </div>
          <div className="space-y-1">
            {liveProcessingSteps.map((step, idx) => (
              <div key={step} className="flex items-center gap-2 text-xs text-zinc-300">
                {idx < liveStepIndex ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : idx === liveStepIndex ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-zinc-600" />
                )}
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-zinc-800">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Voice</span>
          <Select value={ttsVoice} onValueChange={(value) => setTtsVoice(value as typeof ttsVoice)}>
            <SelectTrigger className="h-8 w-[170px] border-zinc-700 bg-zinc-900 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-200">
              <SelectItem value="sage">Sage (Professional)</SelectItem>
              <SelectItem value="alloy">Alloy (Neutral)</SelectItem>
              <SelectItem value="echo">Echo (Deep)</SelectItem>
              <SelectItem value="shimmer">Shimmer (Bright)</SelectItem>
              <SelectItem value="ash">Ash</SelectItem>
              <SelectItem value="ballad">Ballad</SelectItem>
              <SelectItem value="coral">Coral</SelectItem>
              <SelectItem value="verse">Verse</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(ttsSpeed)} onValueChange={(value) => setTtsSpeed(Number(value))}>
            <SelectTrigger className="h-8 w-[130px] border-zinc-700 bg-zinc-900 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-200">
              <SelectItem value="0.85">Slow</SelectItem>
              <SelectItem value="1">Normal</SelectItem>
              <SelectItem value="1.1">Clear</SelectItem>
              <SelectItem value="1.2">Fast</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {workflowSteps.length > 0 && showWorkflow && (
          <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-200">
                <MonitorCog className="h-4 w-4 text-emerald-400" />
                <span>Mini Computer</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowWorkflow(false)}>
                Hide
              </Button>
            </div>
            <div className="space-y-1">
              {workflowSteps.map((step, idx) => (
                <div key={`${step}-${idx}`} className="text-xs text-zinc-300">
                  {idx + 1}. {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {workflowSteps.length > 0 && !showWorkflow && (
          <div className="mb-3">
            <Button variant="outline" size="sm" onClick={() => setShowWorkflow(true)}>
              <MonitorCog className="mr-2 h-4 w-4" />
              Show Mini Computer
            </Button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Voice Input Button */}
          <Button
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            onClick={isRecording ? stopRecording : startRecording}
            className={`shrink-0 ${isRecording ? 'animate-pulse' : ''}`}
          >
            {isRecording ? <StopCircle className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>

          {/* Text Input */}
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
              className="min-h-[44px] max-h-32 resize-none bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 pr-24"
              rows={1}
            />
          </div>

          {/* Voice Output Toggle */}
          <Button
            variant={voiceEnabled ? "default" : "outline"}
            size="icon"
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`shrink-0 ${voiceEnabled ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
            title="Speak responses"
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>

          {/* Listen Mode Toggle */}
          <Button
            variant={listenAfterReply ? "default" : "outline"}
            size="icon"
            onClick={() => setListenAfterReply(!listenAfterReply)}
            className={`shrink-0 ${listenAfterReply ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
            title="Listen after each reply"
          >
            <Ear className="w-4 h-4" />
          </Button>

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="shrink-0 bg-blue-600 hover:bg-blue-700"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {/* Keyboard Shortcuts Hint */}
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-zinc-600">
          <span>Ctrl+B: Toggle sidebar</span>
          <span>Ctrl+N: New chat</span>
          <span>Ctrl+M: Toggle voice</span>
          <span>Enter: Send</span>
        </div>
      </div>
    </div>
  )
}
