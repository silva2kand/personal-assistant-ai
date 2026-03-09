'use client'

import React, { useState, useEffect } from 'react'
import { useApp, Accountant } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
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
  Calculator,
  Phone,
  Mail,
  Building,
  FileText,
  MessageSquare,
  Calendar,
  AlertCircle,
} from 'lucide-react'

export default function AccountantPanel() {
  const { accountants, setAccountants, setActivePanel, addMessage, currentConversation, createNewConversation } = useApp()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newAccountant, setNewAccountant] = useState({
    name: '',
    firm: '',
    email: '',
    phone: '',
    specialty: '',
  })

  // Sample tax deadlines
  const upcomingDeadlines = [
    { id: 1, title: 'Self Assessment', date: '2025-01-31', status: 'upcoming' },
    { id: 2, title: 'Corporation Tax', date: '2025-03-15', status: 'upcoming' },
    { id: 3, title: 'VAT Return', date: '2025-02-28', status: 'upcoming' },
  ]

  const fetchAccountants = async () => {
    try {
      const response = await fetch('/api/accountants')
      const data = await response.json()
      setAccountants(data.accountants || [])
    } catch (error) {
      console.error('Failed to fetch accountants:', error)
    }
  }

  useEffect(() => {
    fetchAccountants()
  }, [])

  const addAccountant = async () => {
    try {
      const response = await fetch('/api/accountants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccountant),
      })
      const data = await response.json()
      if (data.accountant) {
        setAccountants([...accountants, data.accountant])
        setNewAccountant({ name: '', firm: '', email: '', phone: '', specialty: '' })
        setIsAddDialogOpen(false)
      }
    } catch (error) {
      console.error('Failed to add accountant:', error)
    }
  }

  const chatWithAccountant = (accountant: Accountant) => {
    if (!currentConversation) {
      createNewConversation()
    }
    setActivePanel('chat')
    setTimeout(() => {
      addMessage({
        role: 'user',
        content: `I need help with ${accountant.name} (${accountant.firm || 'Accountant'}). They specialize in ${accountant.specialty || 'accounting'}. Can you help me manage my financial matters with them?`,
      })
    }, 100)
  }

  const filteredAccountants = accountants.filter(a => 
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.firm?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.specialty?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calculator className="w-6 h-6 text-green-500" />
            <div>
              <h2 className="text-lg font-semibold text-white">UK Accountant Tracking</h2>
              <p className="text-xs text-zinc-500">Manage your financial professionals</p>
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-green-600 hover:bg-green-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Accountant
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
              <DialogHeader>
                <DialogTitle>Add New Accountant</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <Input
                  placeholder="Name"
                  value={newAccountant.name}
                  onChange={(e) => setNewAccountant({ ...newAccountant, name: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Firm"
                  value={newAccountant.firm}
                  onChange={(e) => setNewAccountant({ ...newAccountant, firm: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={newAccountant.email}
                  onChange={(e) => setNewAccountant({ ...newAccountant, email: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Phone"
                  value={newAccountant.phone}
                  onChange={(e) => setNewAccountant({ ...newAccountant, phone: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Specialty (e.g., Tax, Audit, Advisory)"
                  value={newAccountant.specialty}
                  onChange={(e) => setNewAccountant({ ...newAccountant, specialty: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Button onClick={addAccountant} className="w-full bg-green-600 hover:bg-green-700">
                  Add Accountant
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search accountants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-zinc-900 border-zinc-700"
          />
        </div>
      </div>

      {/* Tax Deadlines Alert */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-yellow-500" />
          <span className="text-sm font-medium text-white">Upcoming Tax Deadlines</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {upcomingDeadlines.map((deadline) => (
            <Badge key={deadline.id} variant="outline" className="shrink-0 border-yellow-500 text-yellow-400">
              <Calendar className="w-3 h-3 mr-1" />
              {deadline.title}: {new Date(deadline.date).toLocaleDateString('en-GB')}
            </Badge>
          ))}
        </div>
      </div>

      {/* Accountant List */}
      <ScrollArea className="flex-1 p-4">
        {filteredAccountants.length === 0 ? (
          <div className="text-center py-8">
            <Calculator className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">No accountants found</p>
            <p className="text-xs text-zinc-600 mt-1">Add your first accountant to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAccountants.map((accountant) => (
              <Card key={accountant.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center shrink-0">
                        <Calculator className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-white">{accountant.name}</h3>
                        {accountant.firm && (
                          <p className="text-sm text-zinc-400 flex items-center gap-1">
                            <Building className="w-3 h-3" />
                            {accountant.firm}
                          </p>
                        )}
                        {accountant.specialty && (
                          <Badge variant="outline" className="mt-1 text-xs border-green-500 text-green-400">
                            {accountant.specialty}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge 
                      variant={accountant.status === 'active' ? 'default' : 'secondary'}
                      className={accountant.status === 'active' ? 'bg-green-600' : ''}
                    >
                      {accountant.status}
                    </Badge>
                  </div>

                  <Separator className="my-3 bg-zinc-800" />

                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    {accountant.email && (
                      <div className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{accountant.email}</span>
                      </div>
                    )}
                    {accountant.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <span>{accountant.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => chatWithAccountant(accountant)}
                    >
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Chat
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <FileText className="w-3 h-3 mr-1" />
                      Documents
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Calendar className="w-3 h-3 mr-1" />
                      Deadlines
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
