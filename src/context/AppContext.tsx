'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'

// Types
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'agent'
  content: string
  agentType?: string
  agentName?: string
  timestamp: Date
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  createdAt: Date
}

export interface Solicitor {
  id: string
  name: string
  firm: string | null
  email: string | null
  phone: string | null
  specialty: string | null
  status: string
}

export interface Accountant {
  id: string
  name: string
  firm: string | null
  email: string | null
  phone: string | null
  specialty: string | null
  status: string
}

export interface Supplier {
  id: string
  name: string
  category: string | null
  email: string | null
  phone: string | null
  status: string
}

export interface EmailAccount {
  id: string
  provider: string
  email: string
  displayName: string | null
  status: string
}

export interface Agent {
  id: string
  type: 'legal' | 'financial' | 'supplier' | 'email' | 'research'
  name: string
  status: 'idle' | 'active' | 'processing' | 'error'
  description: string
}

export interface Model {
  id: string
  name: string
  provider: string
  type: 'api' | 'local'
  status: 'available' | 'unavailable' | 'checking'
}

export type TtsVoice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse'

// Context Type
interface AppContextType {
  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

  // Model Selection
  selectedModel: string
  setSelectedModel: (model: string) => void
  models: Model[]

  // Chat
  conversations: Conversation[]
  currentConversation: Conversation | null
  setCurrentConversation: (conv: Conversation | null) => void
  createNewConversation: () => void
  deleteConversation: (id: string) => void
  deleteAllConversations: () => void
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void

  // Voice
  voiceEnabled: boolean
  setVoiceEnabled: (enabled: boolean) => void
  isRecording: boolean
  setIsRecording: (recording: boolean) => void
  ttsVoice: TtsVoice
  setTtsVoice: (voice: TtsVoice) => void
  ttsSpeed: number
  setTtsSpeed: (speed: number) => void

  // Professional Services
  solicitors: Solicitor[]
  setSolicitors: (solicitors: Solicitor[]) => void
  accountants: Accountant[]
  setAccountants: (accountants: Accountant[]) => void
  suppliers: Supplier[]
  setSuppliers: (suppliers: Supplier[]) => void

  // Email
  emailAccounts: EmailAccount[]
  setEmailAccounts: (accounts: EmailAccount[]) => void
  emailEntityFilter: string
  setEmailEntityFilter: (entityKey: string) => void

  // Agents
  agents: Agent[]
  setAgents: (agents: Agent[]) => void
  activePanel: 'chat' | 'solicitor' | 'accountant' | 'supplier' | 'email' | 'agents' | 'entities' | 'documents'
  setActivePanel: (panel: 'chat' | 'solicitor' | 'accountant' | 'supplier' | 'email' | 'agents' | 'entities' | 'documents') => void
}

const defaultModels: Model[] = [
  // API Models
  { id: 'gemini', name: 'Gemini', provider: 'Google', type: 'api', status: 'available' },
  { id: 'openai', name: 'OpenAI (GPT)', provider: 'OpenAI', type: 'api', status: 'available' },
  { id: 'qwen', name: 'Qwen', provider: 'Alibaba', type: 'api', status: 'available' },
  { id: 'grok', name: 'Grok', provider: 'xAI', type: 'api', status: 'available' },
  { id: 'glm', name: 'GLM (Zhipu)', provider: 'ZhipuAI', type: 'api', status: 'available' },
  { id: 'deepseek', name: 'DeepSeek', provider: 'DeepSeek', type: 'api', status: 'available' },
  { id: 'mistral', name: 'Mistral', provider: 'Mistral AI', type: 'api', status: 'available' },
  { id: 'minimax', name: 'MiniMax', provider: 'MiniMax', type: 'api', status: 'available' },
  { id: 'openrouter', name: 'OpenRouter', provider: 'OpenRouter', type: 'api', status: 'available' },
  { id: 'huggingface', name: 'Hugging Face', provider: 'HF Inference', type: 'api', status: 'available' },
  // Local Models
  { id: 'ollama', name: 'Ollama (local)', provider: 'Local', type: 'local', status: 'checking' },
  { id: 'lmstudio', name: 'LM Studio', provider: 'Local', type: 'local', status: 'checking' },
]

const defaultAgents: Agent[] = [
  { id: 'legal', type: 'legal', name: 'Legal Agent', status: 'idle', description: 'UK Solicitor assistance' },
  { id: 'financial', type: 'financial', name: 'Financial Agent', status: 'idle', description: 'UK Accountant assistance' },
  { id: 'supplier', type: 'supplier', name: 'Supplier Agent', status: 'idle', description: 'Supplier tracking & management' },
  { id: 'email', type: 'email', name: 'Email Agent', status: 'idle', description: 'Email management & monitoring' },
  { id: 'research', type: 'research', name: 'Research Agent', status: 'idle', description: 'Information gathering & analysis' },
]

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const CHAT_MODEL_LOCK = 'ollama'
  const LAST_CONVERSATION_KEY = 'chat:lastConversationId'
  const idCounterRef = useRef(0)

  const makeId = useCallback((prefix: 'conv' | 'msg') => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }

    idCounterRef.current += 1
    return `${prefix}-${Date.now()}-${idCounterRef.current}`
  }, [])

  // Sidebar State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Model Selection
  const [selectedModel, setSelectedModelState] = useState(CHAT_MODEL_LOCK)
  const setSelectedModel = useCallback((_model: string) => {
    // Chat model is intentionally locked to local Ollama.
    setSelectedModelState(CHAT_MODEL_LOCK)
  }, [])
  const [models, setModels] = useState<Model[]>(defaultModels)

  // Chat State
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversationState] = useState<Conversation | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Voice State
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [ttsVoice, setTtsVoice] = useState<TtsVoice>('sage')
  const [ttsSpeed, setTtsSpeed] = useState(1)

  // Professional Services
  const [solicitors, setSolicitors] = useState<Solicitor[]>([])
  const [accountants, setAccountants] = useState<Accountant[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Email
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([])
  const [emailEntityFilter, setEmailEntityFilter] = useState('')

  // Agents
  const [agents, setAgents] = useState<Agent[]>(defaultAgents)
  const [activePanel, setActivePanel] = useState<'chat' | 'solicitor' | 'accountant' | 'supplier' | 'email' | 'agents' | 'entities' | 'documents'>('chat')

  const normalizeConversation = useCallback((raw: any): Conversation => {
    const messages: Message[] = Array.isArray(raw?.messages)
      ? raw.messages.map((message: any) => ({
          id: String(message.id),
          role: message.role,
          content: message.content,
          agentType: message.agentType ?? undefined,
          agentName: message.agentName ?? undefined,
          timestamp: new Date(message.createdAt ?? message.timestamp ?? Date.now()),
        }))
      : []

    return {
      id: String(raw.id),
      title: raw.title || 'New Chat',
      messages,
      model: raw.model || CHAT_MODEL_LOCK,
      createdAt: new Date(raw.createdAt ?? Date.now()),
    }
  }, [])

  const persistLastConversationId = useCallback((id: string | null) => {
    if (typeof window === 'undefined') return
    if (!id) {
      window.localStorage.removeItem(LAST_CONVERSATION_KEY)
      return
    }
    window.localStorage.setItem(LAST_CONVERSATION_KEY, id)
  }, [])

  const setCurrentConversation = useCallback((conv: Conversation | null) => {
    setCurrentConversationState(conv)
    persistLastConversationId(conv?.id ?? null)
  }, [persistLastConversationId])

  const persistMessage = useCallback(async (conversationId: string, message: Message, title?: string) => {
    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: message.role,
          content: message.content,
          agentType: message.agentType,
          agentName: message.agentName,
          timestamp: message.timestamp.toISOString(),
          title,
        }),
      })
    } catch (error) {
      console.error('Failed to persist message:', error)
    }
  }, [])

  // Load persistent conversations on startup.
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await fetch('/api/conversations', { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        const loaded: Conversation[] = Array.isArray(data?.conversations)
          ? data.conversations.map((item: any) => normalizeConversation(item))
          : []

        setConversations(loaded)
        if (loaded.length === 0) {
          setCurrentConversationState(null)
          persistLastConversationId(null)
          return
        }

        const savedId = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_CONVERSATION_KEY) : null
        const preferred = (savedId && loaded.find((conv) => conv.id === savedId)) || loaded[0]
        setCurrentConversationState(preferred)
        persistLastConversationId(preferred.id)
      } catch (error) {
        console.error('Failed to load conversations:', error)
      }
    }

    void loadConversations()
  }, [normalizeConversation, persistLastConversationId])

  // Toggle Sidebar
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, [])

  // Create New Conversation
  const createNewConversation = useCallback(() => {
    const create = async () => {
      try {
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Chat', model: selectedModel }),
        })
        if (!response.ok) throw new Error('Create conversation failed')
        const data = await response.json()
        const created = normalizeConversation(data.conversation)
        setConversations(prev => [created, ...prev])
        setCurrentConversation(created)
        return
      } catch (error) {
        console.error('Failed to create persistent conversation, falling back to local:', error)
      }

      const fallback: Conversation = {
        id: makeId('conv'),
        title: 'New Chat',
        messages: [],
        model: selectedModel,
        createdAt: new Date(),
      }
      setConversations(prev => [fallback, ...prev])
      setCurrentConversation(fallback)
    }

    void create()
  }, [makeId, normalizeConversation, selectedModel, setCurrentConversation])

  const deleteConversation = useCallback((id: string) => {
    const remove = async () => {
      try {
        await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      } catch (error) {
        console.error('Failed to delete conversation:', error)
      }
    }

    void remove()

    setConversations(prev => {
      const updated = prev.filter(conv => conv.id !== id)
      if (currentConversation?.id === id) {
        setCurrentConversation(updated[0] ?? null)
      }
      return updated
    })
  }, [currentConversation?.id, setCurrentConversation])

  const deleteAllConversations = useCallback(() => {
    const removeAll = async () => {
      try {
        await fetch('/api/conversations', { method: 'DELETE' })
      } catch (error) {
        console.error('Failed to delete all conversations:', error)
      }
    }

    void removeAll()
    setConversations([])
    setCurrentConversation(null)
  }, [setCurrentConversation])

  // Add Message
  const addMessage = useCallback((message: Omit<Message, 'id' | 'timestamp'>) => {
    const newMessage: Message = {
      ...message,
      id: makeId('msg'),
      timestamp: new Date(),
    }

    setCurrentConversationState(prev => {
      if (!prev) return null
      const nextTitle =
        prev.messages.length === 0 && message.role === 'user'
          ? `${message.content.slice(0, 30)}...`
          : prev.title
      const updatedConv = {
        ...prev,
        messages: [...prev.messages, newMessage],
        title: nextTitle,
      }
      setConversations(convs =>
        [updatedConv, ...convs.filter(c => c.id !== prev.id)]
      )
      void persistMessage(prev.id, newMessage, nextTitle !== prev.title ? nextTitle : undefined)
      return updatedConv
    })
  }, [makeId, persistMessage])

  // Check Local Models on Mount
  useEffect(() => {
    const checkLocalModels = async () => {
      try {
        const response = await fetch('/api/models/local')
        const data = await response.json()

        setModels(prev => prev.map(model => {
          if (model.id === 'ollama') {
            return { ...model, status: data.ollama ? 'available' : 'unavailable' }
          }
          if (model.id === 'lmstudio') {
            return { ...model, status: data.lmstudio ? 'available' : 'unavailable' }
          }
          return model
        }))
      } catch (error) {
        console.error('Failed to check local models:', error)
        setModels(prev => prev.map(model =>
          model.type === 'local' ? { ...model, status: 'unavailable' } : model
        ))
      }
    }

    checkLocalModels()
  }, [])

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'b':
            e.preventDefault()
            toggleSidebar()
            break
          case 'n':
            e.preventDefault()
            createNewConversation()
            break
          case 'm':
            e.preventDefault()
            setVoiceEnabled(prev => !prev)
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar, createNewConversation])

  return (
    <AppContext.Provider value={{
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
      selectedModel,
      setSelectedModel,
      models,
      conversations,
      currentConversation,
      setCurrentConversation,
      createNewConversation,
      deleteConversation,
      deleteAllConversations,
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
      solicitors,
      setSolicitors,
      accountants,
      setAccountants,
      suppliers,
      setSuppliers,
      emailAccounts,
      setEmailAccounts,
      emailEntityFilter,
      setEmailEntityFilter,
      agents,
      setAgents,
      activePanel,
      setActivePanel,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
