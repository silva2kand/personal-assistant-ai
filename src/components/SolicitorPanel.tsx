'use client'

import React, { useState, useEffect } from 'react'
import { useApp, Solicitor } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Plus,
  Search,
  Scale,
  Phone,
  Mail,
  Building,
  MoreVertical,
  Edit,
  Trash2,
  FileText,
  MessageSquare,
  Briefcase,
} from 'lucide-react'

export default function SolicitorPanel() {
  const { solicitors, setSolicitors, setActivePanel, addMessage, currentConversation, createNewConversation } = useApp()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newSolicitor, setNewSolicitor] = useState({
    name: '',
    firm: '',
    email: '',
    phone: '',
    specialty: '',
  })

  const fetchSolicitors = async () => {
    try {
      const response = await fetch('/api/solicitors')
      const data = await response.json()
      setSolicitors(data.solicitors || [])
    } catch (error) {
      console.error('Failed to fetch solicitors:', error)
    }
  }

  // Fetch solicitors on mount
  useEffect(() => {
    fetchSolicitors()
  }, [])

  const addSolicitor = async () => {
    try {
      const response = await fetch('/api/solicitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSolicitor),
      })
      const data = await response.json()
      if (data.solicitor) {
        setSolicitors([...solicitors, data.solicitor])
        setNewSolicitor({ name: '', firm: '', email: '', phone: '', specialty: '' })
        setIsAddDialogOpen(false)
      }
    } catch (error) {
      console.error('Failed to add solicitor:', error)
    }
  }

  const chatWithSolicitor = (solicitor: Solicitor) => {
    if (!currentConversation) {
      createNewConversation()
    }
    setActivePanel('chat')
    setTimeout(() => {
      addMessage({
        role: 'user',
        content: `I need help with ${solicitor.name} (${solicitor.firm || 'Solicitor'}). They specialize in ${solicitor.specialty || 'legal matters'}. Can you help me manage my relationship with them?`,
      })
    }, 100)
  }

  const filteredSolicitors = solicitors.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.firm?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.specialty?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Scale className="w-6 h-6 text-purple-500" />
            <div>
              <h2 className="text-lg font-semibold text-white">UK Solicitor Tracking</h2>
              <p className="text-xs text-zinc-500">Manage your legal professionals</p>
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Solicitor
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
              <DialogHeader>
                <DialogTitle>Add New Solicitor</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <Input
                  placeholder="Name"
                  value={newSolicitor.name}
                  onChange={(e) => setNewSolicitor({ ...newSolicitor, name: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Firm"
                  value={newSolicitor.firm}
                  onChange={(e) => setNewSolicitor({ ...newSolicitor, firm: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={newSolicitor.email}
                  onChange={(e) => setNewSolicitor({ ...newSolicitor, email: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Phone"
                  value={newSolicitor.phone}
                  onChange={(e) => setNewSolicitor({ ...newSolicitor, phone: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Specialty (e.g., Corporate Law, Property Law)"
                  value={newSolicitor.specialty}
                  onChange={(e) => setNewSolicitor({ ...newSolicitor, specialty: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Button onClick={addSolicitor} className="w-full bg-purple-600 hover:bg-purple-700">
                  Add Solicitor
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search solicitors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-zinc-900 border-zinc-700"
          />
        </div>
      </div>

      {/* Solicitor List */}
      <ScrollArea className="flex-1 p-4">
        {filteredSolicitors.length === 0 ? (
          <div className="text-center py-8">
            <Scale className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">No solicitors found</p>
            <p className="text-xs text-zinc-600 mt-1">Add your first solicitor to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSolicitors.map((solicitor) => (
              <Card key={solicitor.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
                        <Scale className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-white">{solicitor.name}</h3>
                        {solicitor.firm && (
                          <p className="text-sm text-zinc-400 flex items-center gap-1">
                            <Building className="w-3 h-3" />
                            {solicitor.firm}
                          </p>
                        )}
                        {solicitor.specialty && (
                          <Badge variant="outline" className="mt-1 text-xs border-purple-500 text-purple-400">
                            {solicitor.specialty}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge 
                      variant={solicitor.status === 'active' ? 'default' : 'secondary'}
                      className={solicitor.status === 'active' ? 'bg-green-600' : ''}
                    >
                      {solicitor.status}
                    </Badge>
                  </div>

                  <Separator className="my-3 bg-zinc-800" />

                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    {solicitor.email && (
                      <div className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{solicitor.email}</span>
                      </div>
                    )}
                    {solicitor.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <span>{solicitor.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => chatWithSolicitor(solicitor)}
                    >
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Chat
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <FileText className="w-3 h-3 mr-1" />
                      Documents
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Briefcase className="w-3 h-3 mr-1" />
                      Cases
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
