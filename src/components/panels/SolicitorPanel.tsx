'use client'

import * as React from 'react'
import { 
  Scale, Plus, Phone, Mail, MapPin, FileText, MessageSquare, 
  MoreHorizontal, Pencil, Trash2, X, Check, Loader2, Briefcase,
  Calendar
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface Solicitor {
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

interface SolicitorCase {
  id: string
  title: string
  description: string | null
  status: string
  caseNumber: string | null
  startDate: string | null
  endDate: string | null
}

interface SolicitorDocument {
  id: string
  name: string
  type: string | null
  notes: string | null
}

interface SolicitorCommunication {
  id: string
  type: string
  subject: string | null
  content: string
  date: string
}

export function SolicitorPanel() {
  const [solicitors, setSolicitors] = React.useState<Solicitor[]>([])
  const [selectedSolicitor, setSelectedSolicitor] = React.useState<Solicitor | null>(null)
  const [cases, setCases] = React.useState<SolicitorCase[]>([])
  const [documents, setDocuments] = React.useState<SolicitorDocument[]>([])
  const [communications, setCommunications] = React.useState<SolicitorCommunication[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  
  // Form state
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
    fetchSolicitors()
  }, [])

  const fetchSolicitors = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/solicitors')
      const data = await response.json()
      setSolicitors(data.solicitors || [])
    } catch (error) {
      console.error('Error fetching solicitors:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchSolicitorDetails = async (id: string) => {
    try {
      const [casesRes, docsRes, commsRes] = await Promise.all([
        fetch(`/api/solicitors/${id}/cases`),
        fetch(`/api/solicitors/${id}/documents`),
        fetch(`/api/solicitors/${id}/communications`),
      ])
      
      const [casesData, docsData, commsData] = await Promise.all([
        casesRes.json(),
        docsRes.json(),
        commsRes.json(),
      ])
      
      setCases(casesData.cases || [])
      setDocuments(docsData.documents || [])
      setCommunications(commsData.communications || [])
    } catch (error) {
      console.error('Error fetching solicitor details:', error)
    }
  }

  const handleSelectSolicitor = (solicitor: Solicitor) => {
    setSelectedSolicitor(solicitor)
    fetchSolicitorDetails(solicitor.id)
  }

  const handleAddSolicitor = async () => {
    try {
      const response = await fetch('/api/solicitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      
      if (response.ok) {
        fetchSolicitors()
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
      console.error('Error adding solicitor:', error)
    }
  }

  const handleDeleteSolicitor = async (id: string) => {
    try {
      const response = await fetch(`/api/solicitors/${id}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        setSolicitors(solicitors.filter(s => s.id !== id))
        if (selectedSolicitor?.id === id) {
          setSelectedSolicitor(null)
        }
      }
    } catch (error) {
      console.error('Error deleting solicitor:', error)
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

  const getCaseStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-500/10 text-blue-400'
      case 'in_progress': return 'bg-amber-500/10 text-amber-400'
      case 'closed': return 'bg-emerald-500/10 text-emerald-400'
      default: return 'bg-zinc-500/10 text-zinc-400'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Solicitor List */}
      <div className="w-80 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-violet-400" />
            <h2 className="font-semibold text-zinc-100">UK Solicitors</h2>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">Add New Solicitor</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label className="text-zinc-300">Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Solicitor name"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Firm</Label>
                  <Input
                    value={formData.firm}
                    onChange={(e) => setFormData({ ...formData, firm: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Law firm name"
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
                    placeholder="e.g., Corporate Law"
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
                <Button onClick={handleAddSolicitor} className="w-full bg-violet-600 hover:bg-violet-700">
                  Add Solicitor
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {solicitors.length === 0 ? (
              <div className="text-center text-zinc-500 py-8">
                <Scale className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No solicitors added yet</p>
                <p className="text-sm">Click + to add your first solicitor</p>
              </div>
            ) : (
              solicitors.map((solicitor) => (
                <div
                  key={solicitor.id}
                  onClick={() => handleSelectSolicitor(solicitor)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-colors group",
                    selectedSolicitor?.id === solicitor.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "hover:bg-zinc-800/50 text-zinc-300"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{solicitor.name}</span>
                        <Badge className={cn("text-xs", getStatusColor(solicitor.status))}>
                          {solicitor.status}
                        </Badge>
                      </div>
                      {solicitor.firm && (
                        <p className="text-sm text-zinc-400 truncate">{solicitor.firm}</p>
                      )}
                      {solicitor.specialty && (
                        <p className="text-xs text-violet-400 truncate">{solicitor.specialty}</p>
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
                            // Edit functionality
                          }}
                          className="text-zinc-200 focus:bg-zinc-800"
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteSolicitor(solicitor.id)
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

      {/* Solicitor Details */}
      <div className="flex-1 flex flex-col">
        {selectedSolicitor ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-zinc-800">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100">{selectedSolicitor.name}</h2>
                  {selectedSolicitor.firm && (
                    <p className="text-zinc-400">{selectedSolicitor.firm}</p>
                  )}
                </div>
                <Badge className={getStatusColor(selectedSolicitor.status)}>
                  {selectedSolicitor.status}
                </Badge>
              </div>
              
              <div className="flex gap-4 mt-4 text-sm">
                {selectedSolicitor.email && (
                  <a href={`mailto:${selectedSolicitor.email}`} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Mail className="h-4 w-4" />
                    {selectedSolicitor.email}
                  </a>
                )}
                {selectedSolicitor.phone && (
                  <a href={`tel:${selectedSolicitor.phone}`} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Phone className="h-4 w-4" />
                    {selectedSolicitor.phone}
                  </a>
                )}
              </div>
              
              {selectedSolicitor.address && (
                <div className="flex items-center gap-1 mt-2 text-sm text-zinc-400">
                  <MapPin className="h-4 w-4" />
                  {selectedSolicitor.address}
                </div>
              )}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="cases" className="flex-1 flex flex-col">
              <TabsList className="mx-4 mt-4 bg-zinc-800/50">
                <TabsTrigger value="cases" className="data-[state=active]:bg-zinc-700">
                  <Briefcase className="h-4 w-4 mr-2" />
                  Cases
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

              <TabsContent value="cases" className="flex-1 m-0">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {cases.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8">
                        <Briefcase className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No cases yet</p>
                      </div>
                    ) : (
                      cases.map((c) => (
                        <Card key={c.id} className="bg-zinc-900 border-zinc-800">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <CardTitle className="text-base text-zinc-100">{c.title}</CardTitle>
                              <Badge className={getCaseStatusColor(c.status)}>
                                {c.status.replace('_', ' ')}
                              </Badge>
                            </div>
                            {c.caseNumber && (
                              <p className="text-xs text-zinc-500">Case #{c.caseNumber}</p>
                            )}
                          </CardHeader>
                          <CardContent>
                            {c.description && (
                              <p className="text-sm text-zinc-400">{c.description}</p>
                            )}
                            {c.startDate && (
                              <div className="flex items-center gap-1 mt-2 text-xs text-zinc-500">
                                <Calendar className="h-3 w-3" />
                                Started: {new Date(c.startDate).toLocaleDateString('en-GB')}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))
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
                              <FileText className="h-5 w-5 text-violet-400" />
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
            <Scale className="h-16 w-16 text-zinc-700 mb-4" />
            <h3 className="text-lg font-medium text-zinc-400 mb-2">Select a Solicitor</h3>
            <p className="text-zinc-500 max-w-sm">
              Choose a solicitor from the list to view their details, cases, documents, and communication history.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
