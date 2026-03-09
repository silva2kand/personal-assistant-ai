'use client'

import * as React from 'react'
import { 
  Calculator, Plus, Phone, Mail, MapPin, FileText, MessageSquare, 
  MoreHorizontal, Pencil, Trash2, Loader2, Calendar, AlertCircle,
  Clock
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'

interface Accountant {
  id: string
  name: string
  firm: string | null
  email: string | null
  phone: string | null
  address: string | null
  specialty: string | null
  status: string
  notes: string | null
  createdAt: string
}

interface TaxDeadline {
  id: string
  title: string
  description: string | null
  deadlineDate: string
  status: string
}

interface AccountantDocument {
  id: string
  name: string
  type: string | null
  notes: string | null
}

interface AccountantCommunication {
  id: string
  type: string
  subject: string | null
  content: string
  date: string
}

export function AccountantPanel() {
  const [accountants, setAccountants] = React.useState<Accountant[]>([])
  const [selectedAccountant, setSelectedAccountant] = React.useState<Accountant | null>(null)
  const [deadlines, setDeadlines] = React.useState<TaxDeadline[]>([])
  const [documents, setDocuments] = React.useState<AccountantDocument[]>([])
  const [communications, setCommunications] = React.useState<AccountantCommunication[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  
  const [formData, setFormData] = React.useState({
    name: '',
    firm: '',
    email: '',
    phone: '',
    address: '',
    specialty: '',
    notes: '',
  })

  React.useEffect(() => {
    fetchAccountants()
  }, [])

  const fetchAccountants = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/accountants')
      const data = await response.json()
      setAccountants(data.accountants || [])
    } catch (error) {
      console.error('Error fetching accountants:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchAccountantDetails = async (id: string) => {
    try {
      const [deadlinesRes, docsRes, commsRes] = await Promise.all([
        fetch(`/api/accountants/${id}/deadlines`),
        fetch(`/api/accountants/${id}/documents`),
        fetch(`/api/accountants/${id}/communications`),
      ])
      
      const [deadlinesData, docsData, commsData] = await Promise.all([
        deadlinesRes.json(),
        docsRes.json(),
        commsRes.json(),
      ])
      
      setDeadlines(deadlinesData.deadlines || [])
      setDocuments(docsData.documents || [])
      setCommunications(commsData.communications || [])
    } catch (error) {
      console.error('Error fetching accountant details:', error)
    }
  }

  const handleSelectAccountant = (accountant: Accountant) => {
    setSelectedAccountant(accountant)
    fetchAccountantDetails(accountant.id)
  }

  const handleAddAccountant = async () => {
    try {
      const response = await fetch('/api/accountants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      
      if (response.ok) {
        fetchAccountants()
        setIsAddDialogOpen(false)
        setFormData({
          name: '',
          firm: '',
          email: '',
          phone: '',
          address: '',
          specialty: '',
          notes: '',
        })
      }
    } catch (error) {
      console.error('Error adding accountant:', error)
    }
  }

  const handleDeleteAccountant = async (id: string) => {
    try {
      const response = await fetch(`/api/accountants/${id}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        setAccountants(accountants.filter(a => a.id !== id))
        if (selectedAccountant?.id === id) {
          setSelectedAccountant(null)
        }
      }
    } catch (error) {
      console.error('Error deleting accountant:', error)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/10 text-emerald-500'
      case 'inactive': return 'bg-zinc-500/10 text-zinc-400'
      case 'archived': return 'bg-amber-500/10 text-amber-500'
      default: return 'bg-zinc-500/10 text-zinc-400'
    }
  }

  const getDeadlineStatusColor = (status: string) => {
    switch (status) {
      case 'upcoming': return 'bg-blue-500/10 text-blue-400'
      case 'completed': return 'bg-emerald-500/10 text-emerald-400'
      case 'missed': return 'bg-red-500/10 text-red-400'
      default: return 'bg-zinc-500/10 text-zinc-400'
    }
  }

  const getDaysUntil = (dateStr: string) => {
    const deadline = new Date(dateStr)
    const now = new Date()
    const diff = deadline.getTime() - now.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Accountant List */}
      <div className="w-80 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-emerald-400" />
            <h2 className="font-semibold text-zinc-100">UK Accountants</h2>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">Add New Accountant</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label className="text-zinc-300">Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Accountant name"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Firm</Label>
                  <Input
                    value={formData.firm}
                    onChange={(e) => setFormData({ ...formData, firm: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Accounting firm name"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Phone</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="+44..."
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Specialty</Label>
                  <Input
                    value={formData.specialty}
                    onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="e.g., Tax, Audit, Advisory"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Address</Label>
                  <Textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Full address"
                    rows={2}
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Additional notes"
                    rows={2}
                  />
                </div>
                <Button onClick={handleAddAccountant} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  Add Accountant
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {accountants.length === 0 ? (
              <div className="text-center text-zinc-500 py-8">
                <Calculator className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No accountants added yet</p>
                <p className="text-sm">Click + to add your first accountant</p>
              </div>
            ) : (
              accountants.map((accountant) => (
                <div
                  key={accountant.id}
                  onClick={() => handleSelectAccountant(accountant)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-colors group",
                    selectedAccountant?.id === accountant.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "hover:bg-zinc-800/50 text-zinc-300"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{accountant.name}</span>
                        <Badge className={cn("text-xs", getStatusColor(accountant.status))}>
                          {accountant.status}
                        </Badge>
                      </div>
                      {accountant.firm && (
                        <p className="text-sm text-zinc-400 truncate">{accountant.firm}</p>
                      )}
                      {accountant.specialty && (
                        <p className="text-xs text-emerald-400 truncate">{accountant.specialty}</p>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-700">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          className="text-zinc-200 focus:bg-zinc-800"
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteAccountant(accountant.id)
                          }}
                          className="text-red-400 focus:text-red-400 focus:bg-zinc-800"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Accountant Details */}
      <div className="flex-1 flex flex-col">
        {selectedAccountant ? (
          <>
            <div className="p-4 border-b border-zinc-800">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100">{selectedAccountant.name}</h2>
                  {selectedAccountant.firm && (
                    <p className="text-zinc-400">{selectedAccountant.firm}</p>
                  )}
                </div>
                <Badge className={getStatusColor(selectedAccountant.status)}>
                  {selectedAccountant.status}
                </Badge>
              </div>
              
              <div className="flex gap-4 mt-4 text-sm">
                {selectedAccountant.email && (
                  <a href={`mailto:${selectedAccountant.email}`} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Mail className="h-4 w-4" />
                    {selectedAccountant.email}
                  </a>
                )}
                {selectedAccountant.phone && (
                  <a href={`tel:${selectedAccountant.phone}`} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Phone className="h-4 w-4" />
                    {selectedAccountant.phone}
                  </a>
                )}
              </div>
              
              {selectedAccountant.address && (
                <div className="flex items-center gap-1 mt-2 text-sm text-zinc-400">
                  <MapPin className="h-4 w-4" />
                  {selectedAccountant.address}
                </div>
              )}
            </div>

            <Tabs defaultValue="deadlines" className="flex-1 flex flex-col">
              <TabsList className="mx-4 mt-4 bg-zinc-800/50">
                <TabsTrigger value="deadlines" className="data-[state=active]:bg-zinc-700">
                  <Clock className="h-4 w-4 mr-2" />
                  Tax Deadlines
                </TabsTrigger>
                <TabsTrigger value="documents" className="data-[state=active]:bg-zinc-700">
                  <FileText className="h-4 w-4 mr-2" />
                  Documents
                </TabsTrigger>
                <TabsTrigger value="communications" className="data-[state=active]:bg-zinc-700">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Communications
                </TabsTrigger>
              </TabsList>

              <TabsContent value="deadlines" className="flex-1 m-0">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {deadlines.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8">
                        <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No tax deadlines yet</p>
                      </div>
                    ) : (
                      deadlines.map((deadline) => {
                        const daysUntil = getDaysUntil(deadline.deadlineDate)
                        const isUrgent = daysUntil <= 7 && daysUntil > 0
                        const isPast = daysUntil < 0
                        
                        return (
                          <Card key={deadline.id} className={cn(
                            "bg-zinc-900 border-zinc-800",
                            isUrgent && "border-amber-500/50",
                            isPast && deadline.status !== 'completed' && "border-red-500/50"
                          )}>
                            <CardContent className="py-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    {isUrgent && <AlertCircle className="h-4 w-4 text-amber-500" />}
                                    <span className="font-medium text-zinc-100">{deadline.title}</span>
                                  </div>
                                  {deadline.description && (
                                    <p className="text-sm text-zinc-400">{deadline.description}</p>
                                  )}
                                  <div className="flex items-center gap-4 mt-2 text-xs">
                                    <span className="text-zinc-500 flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      {new Date(deadline.deadlineDate).toLocaleDateString('en-GB')}
                                    </span>
                                    <span className={cn(
                                      "font-medium",
                                      isPast && deadline.status !== 'completed' ? "text-red-400" :
                                      isUrgent ? "text-amber-400" : "text-zinc-400"
                                    )}>
                                      {isPast ? `${Math.abs(daysUntil)} days overdue` : `${daysUntil} days left`}
                                    </span>
                                  </div>
                                </div>
                                <Badge className={getDeadlineStatusColor(deadline.status)}>
                                  {deadline.status}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="documents" className="flex-1 m-0">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {documents.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8">
                        <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No documents yet</p>
                      </div>
                    ) : (
                      documents.map((doc) => (
                        <Card key={doc.id} className="bg-zinc-900 border-zinc-800">
                          <CardContent className="py-3">
                            <div className="flex items-center gap-3">
                              <FileText className="h-5 w-5 text-emerald-400" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-zinc-100 truncate">{doc.name}</p>
                                {doc.type && (
                                  <p className="text-xs text-zinc-500">{doc.type}</p>
                                )}
                              </div>
                            </div>
                            {doc.notes && (
                              <p className="text-sm text-zinc-400 mt-2">{doc.notes}</p>
                            )}
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="communications" className="flex-1 m-0">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {communications.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8">
                        <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No communications yet</p>
                      </div>
                    ) : (
                      communications.map((comm) => (
                        <Card key={comm.id} className="bg-zinc-900 border-zinc-800">
                          <CardContent className="py-3">
                            <div className="flex items-start justify-between mb-2">
                              <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                                {comm.type}
                              </Badge>
                              <span className="text-xs text-zinc-500">
                                {new Date(comm.date).toLocaleDateString('en-GB')}
                              </span>
                            </div>
                            {comm.subject && (
                              <p className="font-medium text-zinc-100 mb-1">{comm.subject}</p>
                            )}
                            <p className="text-sm text-zinc-400">{comm.content}</p>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Calculator className="h-16 w-16 text-zinc-700 mb-4" />
            <h3 className="text-lg font-medium text-zinc-400 mb-2">Select an Accountant</h3>
            <p className="text-zinc-500 max-w-sm">
              Choose an accountant from the list to view their details, tax deadlines, documents, and communication history.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
