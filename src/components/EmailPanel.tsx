'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Mail,
  Search,
  ExternalLink,
  RefreshCw,
  Check,
  Inbox,
  Link,
  Unlink,
  Clock,
  Send,
  Bot,
  Reply,
  Filter,
  X,
} from 'lucide-react'

type Provider = 'outlook' | 'gmail'

type ProviderAccountStatus = {
  email: string
  displayName: string
  expiresAt: number
}

type ProviderStatus = {
  connected: boolean
  accounts: ProviderAccountStatus[]
}

type InboxMessage = {
  id: string
  provider: Provider
  subject: string
  receivedDateTime: string
  bodyPreview?: string
  fromName?: string
  fromAddress?: string
}

type AnalyzeResponse = {
  analysis?: {
    summary: string
    urgency: 'low' | 'medium' | 'high'
    routedAgents: Array<{ type: string; name: string; reason: string }>
  }
  error?: string
}

type MailboxRuleAction = 'important' | 'junk'

type MailboxSenderRule = {
  id: string
  senderPattern: string
  action: MailboxRuleAction
  createdAt: string
  updatedAt: string
}

export default function EmailPanel() {
  const {
    setActivePanel,
    addMessage,
    currentConversation,
    createNewConversation,
    selectedModel,
    isLoading: chatIsLoading,
    setIsLoading,
    emailEntityFilter,
    setEmailEntityFilter,
  } = useApp()

  const [searchQuery, setSearchQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all')
  const [outlookStatus, setOutlookStatus] = useState<ProviderStatus>({ connected: false, accounts: [] })
  const [gmailStatus, setGmailStatus] = useState<ProviderStatus>({ connected: false, accounts: [] })
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [connectingProvider, setConnectingProvider] = useState<Provider | null>(null)
  const [sending, setSending] = useState(false)
  const [composeProvider, setComposeProvider] = useState<Provider>('outlook')
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<InboxMessage | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [lastAction, setLastAction] = useState('')
  const [mailboxRules, setMailboxRules] = useState<MailboxSenderRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [rulePattern, setRulePattern] = useState('')
  const [ruleAction, setRuleAction] = useState<MailboxRuleAction>('important')
  const [fullAuditRunning, setFullAuditRunning] = useState(false)

  const fetchStatus = async () => {
    const [outlookRes, gmailRes] = await Promise.allSettled([
      fetch('/api/auth/outlook/status'),
      fetch('/api/auth/gmail/status'),
    ])

    if (outlookRes.status === 'fulfilled') {
      const data = await outlookRes.value.json()
      setOutlookStatus({
        connected: !!data.connected,
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
      })
    }

    if (gmailRes.status === 'fulfilled') {
      const data = await gmailRes.value.json()
      setGmailStatus({
        connected: !!data.connected,
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
      })
    }
  }

  const fetchInbox = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ top: '60' })
      if (emailEntityFilter.trim()) {
        params.set('entityKey', emailEntityFilter.trim())
      }
      const res = await fetch(`/api/emails/unified/inbox?${params.toString()}`)
      const data = await res.json()
      const mapped = Array.isArray(data.messages)
        ? data.messages.map((m: any) => ({
            id: m.id,
            provider: m.provider,
            subject: m.subject,
            receivedDateTime: m.receivedDateTime,
            bodyPreview: m.bodyPreview,
            fromName: m.fromName,
            fromAddress: m.fromAddress,
          }))
        : []
      setMessages(mapped)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }

  const fetchMailboxRules = async () => {
    setRulesLoading(true)
    try {
      const res = await fetch('/api/emails/rules')
      const data = await res.json()
      const rules = Array.isArray(data.rules)
        ? data.rules.map((rule: MailboxSenderRule) => ({
            id: String(rule.id),
            senderPattern: String(rule.senderPattern || ''),
            action: rule.action === 'junk' ? 'junk' : 'important',
            createdAt: String(rule.createdAt || ''),
            updatedAt: String(rule.updatedAt || ''),
          }))
        : []
      setMailboxRules(rules)
    } catch {
      setMailboxRules([])
    } finally {
      setRulesLoading(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
    void fetchInbox()
    void fetchMailboxRules()
  }, [])

  useEffect(() => {
    setProviderFilter('all')
    if (emailEntityFilter.trim()) {
      setSearchQuery(emailEntityFilter.trim())
      setLastAction(`Filtered by entity: ${emailEntityFilter.trim()}`)
    }
    void fetchInbox()
  }, [emailEntityFilter])

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return messages.filter((m) => {
      if (providerFilter !== 'all' && m.provider !== providerFilter) return false
      if (!q) return true
      const from = `${m.fromName || ''} ${m.fromAddress || ''}`.toLowerCase()
      return (
        (m.subject || '').toLowerCase().includes(q) ||
        (m.bodyPreview || '').toLowerCase().includes(q) ||
        from.includes(q)
      )
    })
  }, [messages, searchQuery, providerFilter])

  const connectProvider = (provider: Provider) => {
    setConnectingProvider(provider)
    window.location.href = provider === 'outlook' ? '/api/auth/outlook/login' : '/api/auth/gmail/login'
  }

  const disconnectProvider = async (provider: Provider) => {
    await fetch(
      provider === 'outlook' ? '/api/auth/outlook/disconnect' : '/api/auth/gmail/disconnect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    )
    await fetchStatus()
    await fetchInbox()
  }

  const openProviderWeb = (provider: Provider) => {
    window.open(
      provider === 'outlook' ? 'https://outlook.office.com/mail/' : 'https://mail.google.com',
      '_blank'
    )
  }

  const openChatWithEmail = (email: InboxMessage) => {
    if (!currentConversation) createNewConversation()
    setActivePanel('chat')
    const sender = email.fromName || email.fromAddress || 'unknown sender'
    setTimeout(() => {
      addMessage({
        role: 'user',
        content: `Summarize this ${email.provider} email and suggest next steps: From ${sender}, Subject ${email.subject}. Context: ${email.bodyPreview || ''}`,
      })
    }, 100)
  }

  const sendCompose = async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return
    setSending(true)
    setLastAction('')
    try {
      const res = await fetch(`/api/emails/${composeProvider}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composeTo.trim(),
          subject: composeSubject.trim(),
          body: composeBody,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Send failed')
      setComposeTo('')
      setComposeSubject('')
      setComposeBody('')
      setLastAction(`Sent via ${composeProvider.toUpperCase()}`)
      await fetchInbox()
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  const sendReply = async () => {
    if (!replyingTo || !replyBody.trim()) return
    setSending(true)
    setLastAction('')
    try {
      const res = await fetch(`/api/emails/${replyingTo.provider}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: replyingTo.id,
          body: replyBody.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Reply failed')
      setReplyBody('')
      setReplyingTo(null)
      setLastAction(`Reply sent via ${replyingTo.provider.toUpperCase()}`)
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : 'Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  const analyzeAndRoute = async (email: InboxMessage) => {
    setLastAction('')
    try {
      const res = await fetch('/api/emails/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: email.provider,
          messageId: email.id,
        }),
      })
      const data: AnalyzeResponse = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Analyze failed')

      const summary = data.analysis?.summary || 'Email analyzed.'
      const routed = (data.analysis?.routedAgents || []).map((a) => a.name).join(', ')
      setLastAction(`Analyzed and routed: ${routed || 'Email Agent'}`)

      if (!currentConversation) createNewConversation()
      setActivePanel('chat')
      setTimeout(() => {
        addMessage({
          role: 'agent',
          agentType: 'email',
          agentName: 'Email Agent',
          content: `${summary}\n\nRouted to: ${routed || 'Email Agent'}.\nUrgency: ${data.analysis?.urgency || 'low'}.`,
        })
      }, 100)
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : 'Analyze and route failed')
    }
  }

  const saveMailboxRule = async () => {
    const pattern = rulePattern.trim().toLowerCase()
    if (!pattern) return
    setLastAction('')
    try {
      const res = await fetch('/api/emails/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderPattern: pattern,
          action: ruleAction,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to save sender rule')
      const rules = Array.isArray(data.rules) ? data.rules : []
      setMailboxRules(rules)
      setRulePattern('')
      setLastAction(`Sender rule saved: "${pattern}" => ${ruleAction}`)
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : 'Failed to save sender rule')
    }
  }

  const deleteMailboxRule = async (id: string) => {
    setLastAction('')
    try {
      const res = await fetch('/api/emails/rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to delete sender rule')
      const rules = Array.isArray(data.rules) ? data.rules : []
      setMailboxRules(rules)
      setLastAction('Sender rule deleted.')
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : 'Failed to delete sender rule')
    }
  }

  const runFullMailboxAudit = async () => {
    if (!anyConnected || fullAuditRunning || chatIsLoading) return

    const prompt =
      'Analyze all connected Gmail and Outlook emails from 2024 onward, including flagged/pinned and important items. Categorize solicitor, accountant, supplier, banking, and property topics, and include junk/spam cleanup recommendations using sender rules.'
    setFullAuditRunning(true)
    setLastAction('Running full mailbox audit (2024+)...')
    setActivePanel('chat')

    if (!currentConversation) {
      createNewConversation()
      await new Promise((resolve) => setTimeout(resolve, 120))
    }

    const history = currentConversation?.messages.slice(-10) || []
    addMessage({ role: 'user', content: prompt })
    setIsLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          model: selectedModel,
          conversationHistory: history,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Full mailbox audit failed')

      if (data.response) {
        addMessage({ role: 'assistant', content: data.response })
      }
      if (Array.isArray(data.agents)) {
        data.agents.forEach((agent: { type: string; name: string; contribution: string }) => {
          addMessage({
            role: 'agent',
            content: agent.contribution,
            agentType: agent.type,
            agentName: agent.name,
          })
        })
      }
      setLastAction('Full mailbox audit completed.')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Full mailbox audit failed'
      addMessage({ role: 'assistant', content: `Mailbox audit failed: ${errorMessage}` })
      setLastAction(errorMessage)
    } finally {
      setIsLoading(false)
      setFullAuditRunning(false)
    }
  }

  const clearEntityFilter = () => {
    setEmailEntityFilter('')
    setSearchQuery('')
    setLastAction('Entity filter cleared.')
  }

  const outlookAccount = outlookStatus.accounts[0]
  const gmailAccount = gmailStatus.accounts[0]
  const anyConnected = outlookStatus.connected || gmailStatus.connected

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-b border-zinc-800 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-blue-500" />
            <div>
              <h2 className="text-lg font-semibold text-white">Gmail + Outlook Full Access</h2>
              <p className="text-xs text-zinc-500">Read, write, reply, analyze and route to agents</p>
            </div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <Card className="border-zinc-800 bg-zinc-900">
            <CardContent className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-white">Outlook</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openProviderWeb('outlook')}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Open
                  </Button>
                  {outlookStatus.connected ? (
                    <Button variant="destructive" size="sm" onClick={() => disconnectProvider('outlook')}>
                      <Unlink className="mr-1 h-3 w-3" />
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => connectProvider('outlook')}
                      disabled={connectingProvider === 'outlook'}
                    >
                      <Link className="mr-1 h-3 w-3" />
                      Connect
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                {outlookStatus.connected ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Clock className="h-3 w-3 text-yellow-500" />
                )}
                <span>{outlookStatus.connected ? outlookAccount?.email : 'Not connected'}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900">
            <CardContent className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-white">Gmail</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openProviderWeb('gmail')}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Open
                  </Button>
                  {gmailStatus.connected ? (
                    <Button variant="destructive" size="sm" onClick={() => disconnectProvider('gmail')}>
                      <Unlink className="mr-1 h-3 w-3" />
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="bg-rose-600 hover:bg-rose-700"
                      onClick={() => connectProvider('gmail')}
                      disabled={connectingProvider === 'gmail'}
                    >
                      <Link className="mr-1 h-3 w-3" />
                      Connect
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                {gmailStatus.connected ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Clock className="h-3 w-3 text-yellow-500" />
                )}
                <span>{gmailStatus.connected ? gmailAccount?.email : 'Not connected'}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <Input
            placeholder="To"
            value={composeTo}
            onChange={(e) => setComposeTo(e.target.value)}
            className="border-zinc-700 bg-zinc-900"
          />
          <Input
            placeholder="Subject"
            value={composeSubject}
            onChange={(e) => setComposeSubject(e.target.value)}
            className="border-zinc-700 bg-zinc-900"
          />
          <Input
            placeholder="Provider (gmail or outlook)"
            value={composeProvider}
            onChange={(e) => {
              const value = e.target.value.toLowerCase()
              if (value === 'gmail' || value === 'outlook') {
                setComposeProvider(value)
              }
            }}
            className="border-zinc-700 bg-zinc-900"
          />
          <Button onClick={sendCompose} disabled={sending || !anyConnected}>
            <Send className="mr-2 h-4 w-4" />
            Send Email
          </Button>
        </div>

        <Input
          placeholder="Compose body"
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
          className="mb-3 border-zinc-700 bg-zinc-900"
        />

        <div className="mb-3 flex gap-2">
          <Button
            variant={providerFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProviderFilter('all')}
          >
            All
          </Button>
          <Button
            variant={providerFilter === 'outlook' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProviderFilter('outlook')}
          >
            Outlook
          </Button>
          <Button
            variant={providerFilter === 'gmail' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProviderFilter('gmail')}
          >
            Gmail
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search inbox subject/body/sender..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-zinc-700 bg-zinc-900 pl-10"
          />
        </div>

        {emailEntityFilter && (
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="outline" className="border-blue-500 text-blue-300">
              <Filter className="mr-1 h-3 w-3" />
              Entity: {emailEntityFilter}
            </Badge>
            <Button variant="ghost" size="sm" onClick={clearEntityFilter}>
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
        )}

        <Card className="mt-3 border-zinc-800 bg-zinc-900">
          <CardContent className="space-y-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">Mailbox Audit + Sender Rules</p>
                <p className="text-xs text-zinc-500">
                  Run deep 2024+ audit and keep sender priorities/junk patterns updated.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void runFullMailboxAudit()}
                disabled={!anyConnected || fullAuditRunning || chatIsLoading}
              >
                {fullAuditRunning ? 'Running Full Audit...' : 'Full Mail Audit (2024+)'}
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
              <Input
                placeholder="Sender pattern (e.g. token dispatch, @domain.com)"
                value={rulePattern}
                onChange={(e) => setRulePattern(e.target.value)}
                className="border-zinc-700 bg-zinc-950"
              />
              <select
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value === 'junk' ? 'junk' : 'important')}
                className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"
              >
                <option value="important">Mark Important</option>
                <option value="junk">Mark Junk</option>
              </select>
              <Button size="sm" variant="outline" onClick={saveMailboxRule} disabled={!rulePattern.trim()}>
                Save Rule
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchMailboxRules()}
                disabled={rulesLoading}
              >
                {rulesLoading ? 'Loading rules...' : 'Refresh Rules'}
              </Button>
              <span className="self-center text-xs text-zinc-500">
                {mailboxRules.length} rules configured
              </span>
            </div>

            {mailboxRules.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mailboxRules.map((rule) => (
                  <Badge
                    key={rule.id}
                    variant="outline"
                    className={rule.action === 'junk' ? 'border-amber-500 text-amber-300' : 'border-emerald-500 text-emerald-300'}
                  >
                    {rule.action.toUpperCase()}: {rule.senderPattern}
                    <button
                      type="button"
                      onClick={() => void deleteMailboxRule(rule.id)}
                      className="ml-2 rounded px-1 text-zinc-200 hover:bg-zinc-700"
                    >
                      x
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-white">Unified Inbox</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void fetchStatus()
              void fetchInbox()
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Refresh
          </Button>
        </div>

        {replyingTo && (
          <Card className="mb-3 border-zinc-800 bg-zinc-900">
            <CardContent className="p-3">
              <div className="mb-2 text-xs text-zinc-400">
                Replying to: {replyingTo.subject || '(No Subject)'} via {replyingTo.provider.toUpperCase()}
              </div>
              <Input
                placeholder="Reply body"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                className="mb-2 border-zinc-700 bg-zinc-950"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={sendReply} disabled={sending}>
                  <Reply className="mr-1 h-3 w-3" />
                  Send Reply
                </Button>
                <Button variant="outline" size="sm" onClick={() => setReplyingTo(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!anyConnected ? (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardContent className="p-4 text-sm text-zinc-300">
              Connect Gmail and/or Outlook to enable read, write, reply and analysis routing.
            </CardContent>
          </Card>
        ) : loading ? (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardContent className="p-4 text-sm text-zinc-300">Loading inbox...</CardContent>
          </Card>
        ) : filteredMessages.length === 0 ? (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardContent className="p-4 text-sm text-zinc-300">No messages match your query.</CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredMessages.map((email) => {
              const sender = email.fromName || email.fromAddress || 'Unknown'
              const when = new Date(email.receivedDateTime).toLocaleString()
              return (
                <Card
                  key={email.id}
                  className="border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-700"
                >
                  <CardContent className="p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-zinc-200">{sender}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{when}</span>
                    </div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-white">{email.subject || '(No Subject)'}</p>
                      <Badge
                        variant="outline"
                        className={email.provider === 'gmail' ? 'border-rose-500 text-rose-400' : 'border-blue-500 text-blue-400'}
                      >
                        {email.provider.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-zinc-500">{email.bodyPreview || ''}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openChatWithEmail(email)}>
                        Chat
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setReplyingTo(email)}>
                        <Reply className="mr-1 h-3 w-3" />
                        Reply
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => analyzeAndRoute(email)}>
                        <Bot className="mr-1 h-3 w-3" />
                        Analyze & Route
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {lastAction && (
          <Card className="mt-3 border-zinc-800 bg-zinc-900">
            <CardContent className="p-3 text-xs text-zinc-300">{lastAction}</CardContent>
          </Card>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setActivePanel('chat')}>
            <Inbox className="mr-1 h-3 w-3" />
            Ask In Chat
          </Button>
        </div>
      </ScrollArea>
    </div>
  )
}
