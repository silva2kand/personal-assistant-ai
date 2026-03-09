'use client'

import React from 'react'
import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  MessageSquare,
  Plus,
  Settings,
  Scale,
  Calculator,
  Truck,
  Mail,
  Bot,
  ChevronLeft,
  ChevronRight,
  Zap,
  Globe,
  Server,
  FolderLock,
  Trash2,
} from 'lucide-react'
import ModelSelector from './ModelSelector'

export default function Sidebar() {
  const {
    sidebarCollapsed,
    toggleSidebar,
    conversations,
    currentConversation,
    setCurrentConversation,
    createNewConversation,
    deleteConversation,
    deleteAllConversations,
    activePanel,
    setActivePanel,
    models,
    selectedModel,
  } = useApp()

  const currentModel = models.find(m => m.id === selectedModel)

  const menuItems = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'solicitor', label: 'UK Solicitor', icon: Scale },
    { id: 'accountant', label: 'UK Accountant', icon: Calculator },
    { id: 'supplier', label: 'UK Suppliers', icon: Truck },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'documents', label: 'Document Vault', icon: FolderLock },
    { id: 'agents', label: 'AI Agents', icon: Bot },
    { id: 'entities', label: 'Cases & Entities', icon: Server },
  ] as const

  return (
    <aside
      className={`
        flex flex-col h-full bg-zinc-900 border-r border-zinc-800
        transition-all duration-300 ease-in-out
        ${sidebarCollapsed ? 'w-16' : 'w-72'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" />
            <span className="font-semibold text-white">AI Assistant</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="text-zinc-400 hover:text-white hover:bg-zinc-800"
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      {/* New Chat Button */}
      {!sidebarCollapsed && (
        <div className="p-3">
          <Button
            onClick={createNewConversation}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </div>
      )}

      {/* Model Selector */}
      {!sidebarCollapsed && (
        <div className="px-3 pb-3">
          <ModelSelector />
          {currentModel && (
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
              {currentModel.type === 'local' ? (
                <Server className="w-3 h-3" />
              ) : (
                <Globe className="w-3 h-3" />
              )}
              <span>
                {currentModel.type === 'local' ? 'Local Model' : 'API Model'}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  currentModel.status === 'available'
                    ? 'border-green-500 text-green-500'
                    : currentModel.status === 'checking'
                    ? 'border-yellow-500 text-yellow-500'
                    : 'border-red-500 text-red-500'
                }`}
              >
                {currentModel.status}
              </Badge>
            </div>
          )}
        </div>
      )}

      <Separator className="bg-zinc-800" />

      {/* Menu Items */}
      <nav className="p-2">
        {menuItems.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            className={`
              w-full justify-start text-zinc-400 hover:text-white hover:bg-zinc-800
              ${activePanel === item.id ? 'bg-zinc-800 text-white' : ''}
              ${sidebarCollapsed ? 'px-3' : 'px-3'}
            `}
            onClick={() => setActivePanel(item.id)}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span className="ml-3">{item.label}</span>}
          </Button>
        ))}
      </nav>

      <Separator className="bg-zinc-800" />

      {/* Chat History */}
      {!sidebarCollapsed && (
        <ScrollArea className="flex-1 px-2">
          <div className="py-2">
            <div className="mb-2 flex items-center justify-between px-3">
              <p className="text-xs font-medium text-zinc-500">Recent Chats</p>
              {conversations.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                  onClick={deleteAllConversations}
                  title="Delete all chats"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {conversations.length === 0 ? (
              <p className="px-3 text-xs text-zinc-600">No conversations yet</p>
            ) : (
              conversations.slice(0, 10).map((conv) => (
                <div key={conv.id} className="group flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className={`
                      flex-1 justify-start text-left text-sm text-zinc-400 hover:text-white hover:bg-zinc-800
                      ${currentConversation?.id === conv.id ? 'bg-zinc-800 text-white' : ''}
                    `}
                    onClick={() => setCurrentConversation(conv)}
                  >
                    <MessageSquare className="w-3 h-3 mr-2 shrink-0" />
                    <span className="truncate">{conv.title}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                    onClick={() => deleteConversation(conv.id)}
                    title="Delete chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* Footer */}
      <div className="p-3 border-t border-zinc-800">
        {!sidebarCollapsed ? (
          <Button
            variant="ghost"
            className="w-full justify-start text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <Settings className="w-4 h-4 mr-3" />
            Settings
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="w-full text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <Settings className="w-4 h-4" />
          </Button>
        )}
      </div>
    </aside>
  )
}
