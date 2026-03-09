'use client'

import * as React from 'react'
import { 
  Mail, Plus, ExternalLink, MoreHorizontal, Trash2, Loader2,
  CheckCircle, XCircle, RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

interface EmailAccount {
  id: string
  provider: string
  email: string
  displayName: string | null
  status: string
  lastSync: string | null
}

const emailProviders = [
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com', icon: '📧', color: 'from-red-500 to-orange-500' },
  { id: 'outlook', name: 'Outlook', url: 'https://outlook.live.com', icon: '📬', color: 'from-blue-500 to-cyan-500' },
  { id: 'hotmail', name: 'Hotmail', url: 'https://outlook.live.com', icon: '📬', color: 'from-blue-500 to-cyan-500' },
  { id: 'live', name: 'Live', url: 'https://outlook.live.com', icon: '📬', color: 'from-blue-500 to-cyan-500' },
  { id: 'microsoft', name: 'Microsoft 365', url: 'https://outlook.office.com', icon: '📋', color: 'from-blue-600 to-indigo-600' },
]

export function EmailPanel() {
  const [accounts, setAccounts] = React.useState<EmailAccount[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  const [selectedProvider, setSelectedProvider] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')

  React.useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/emails')
      const data = await response.json()
      setAccounts(data.accounts || [])
    } catch (error) {
      console.error('Error fetching email accounts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddAccount = async () => {
    if (!selectedProvider || !email) return
    
    try {
      const response = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          email,
          displayName: displayName || null,
        }),
      })
      
      if (response.ok) {
        fetchAccounts()
        setIsAddDialogOpen(false)
        setSelectedProvider('')
        setEmail('')
        setDisplayName('')
      }
    } catch (error) {
      console.error('Error adding email account:', error)
    }
  }

  const handleDeleteAccount = async (id: string) => {
    try {
      const response = await fetch(`/api/emails/${id}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        setAccounts(accounts.filter(a => a.id !== id))
      }
    } catch (error) {
      console.error('Error deleting email account:', error)
    }
  }

  const handleOpenProvider = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const getProviderInfo = (providerId: string) => {
    return emailProviders.find(p => p.id === providerId) || emailProviders[0]
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <CheckCircle className="h-4 w-4 text-emerald-500" />
      case 'disconnected': return <XCircle className="h-4 w-4 text-zinc-400" />
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />
      default: return <XCircle className="h-4 w-4 text-zinc-400" />
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', { 
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Email Accounts List */}
      <div className="w-96 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-pink-400" />
            <h2 className="font-semibold text-zinc-100">Email Accounts</h2>
          </div>
          <div className="flex gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={fetchAccounts}
              className="text-zinc-400 hover:text-zinc-100"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-pink-600 hover:bg-pink-700">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-zinc-100">Add Email Account</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div>
                    <Label className="text-zinc-300">Provider *</Label>
                    <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700">
                        {emailProviders.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id} className="text-zinc-200 focus:bg-zinc-800">
                            <span className="mr-2">{provider.icon}</span>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-zinc-300">Email Address *</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-zinc-100"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div>
                    <Label className="text-zinc-300">Display Name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-zinc-100"
                      placeholder="Optional name"
                    />
                  </div>
                  <Button onClick={handleAddAccount} className="w-full bg-pink-600 hover:bg-pink-700">
                    Add Account
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {accounts.length === 0 ? (
              <div className="text-center text-zinc-500 py-8">
                <Mail className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No email accounts added yet</p>
                <p className="text-sm">Click + to add your first account</p>
              </div>
            ) : (
              accounts.map((account) => {
                const provider = getProviderInfo(account.provider)
                return (
                  <Card key={account.id} className="bg-zinc-900 border-zinc-800">
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-lg",
                            provider.color
                          )}>
                            {provider.icon}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-zinc-100">
                                {account.displayName || account.email}
                              </span>
                              {getStatusIcon(account.status)}
                            </div>
                            <p className="text-xs text-zinc-500">{account.email}</p>
                            <p className="text-xs text-zinc-600 mt-1">
                              Last sync: {formatDate(account.lastSync)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleOpenProvider(provider.url)}
                            className="text-zinc-400 hover:text-zinc-100"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-zinc-100">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-700">
                              <DropdownMenuItem
                                onClick={() => handleDeleteAccount(account.id)}
                                className="text-red-400 focus:text-red-400 focus:bg-zinc-800"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Quick Access */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="font-semibold text-zinc-100">Quick Access</h3>
          <p className="text-sm text-zinc-400">Open email providers in a new tab</p>
        </div>
        
        <div className="flex-1 p-4">
          <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
            {emailProviders.map((provider) => (
              <Card
                key={provider.id}
                className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer"
                onClick={() => handleOpenProvider(provider.url)}
              >
                <CardContent className="py-6">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-2xl",
                      provider.color
                    )}>
                      {provider.icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-zinc-100">{provider.name}</h4>
                      <p className="text-xs text-zinc-500 flex items-center gap-1">
                        Click to open
                        <ExternalLink className="h-3 w-3" />
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {accounts.length > 0 && (
            <div className="mt-8 max-w-xl mx-auto">
              <h4 className="font-medium text-zinc-100 mb-4">Connected Accounts Summary</h4>
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400">Total Accounts</span>
                  <span className="text-zinc-100 font-medium">{accounts.length}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400">Connected</span>
                  <span className="text-emerald-400 font-medium">
                    {accounts.filter(a => a.status === 'connected').length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Providers</span>
                  <span className="text-zinc-100 font-medium">
                    {new Set(accounts.map(a => a.provider)).size}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
