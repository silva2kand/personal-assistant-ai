'use client'

import React, { useState, useEffect } from 'react'
import { useApp, Supplier } from '@/context/AppContext'
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
  Truck,
  Phone,
  Mail,
  Building,
  Globe,
  FileText,
  MessageSquare,
  ShoppingCart,
  Receipt,
  Package,
} from 'lucide-react'

export default function SupplierPanel() {
  const { suppliers, setSuppliers, setActivePanel, addMessage, currentConversation, createNewConversation } = useApp()
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    category: '',
    email: '',
    phone: '',
    website: '',
  })

  // Sample categories
  const categories = ['all', 'IT', 'Office Supplies', 'Manufacturing', 'Services', 'Logistics']

  // Sample recent orders
  const recentOrders = [
    { id: 'ORD-001', supplier: 'Tech Solutions', status: 'delivered', amount: 1250.00 },
    { id: 'ORD-002', supplier: 'Office Pro', status: 'shipped', amount: 450.00 },
    { id: 'ORD-003', supplier: 'Global Parts', status: 'processing', amount: 3200.00 },
  ]

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/suppliers')
      const data = await response.json()
      setSuppliers(data.suppliers || [])
    } catch (error) {
      console.error('Failed to fetch suppliers:', error)
    }
  }

  useEffect(() => {
    fetchSuppliers()
  }, [])

  const addSupplier = async () => {
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSupplier),
      })
      const data = await response.json()
      if (data.supplier) {
        setSuppliers([...suppliers, data.supplier])
        setNewSupplier({ name: '', category: '', email: '', phone: '', website: '' })
        setIsAddDialogOpen(false)
      }
    } catch (error) {
      console.error('Failed to add supplier:', error)
    }
  }

  const chatWithSupplier = (supplier: Supplier) => {
    if (!currentConversation) {
      createNewConversation()
    }
    setActivePanel('chat')
    setTimeout(() => {
      addMessage({
        role: 'user',
        content: `I need help with supplier ${supplier.name} (${supplier.category || 'General'}). Can you help me manage orders, invoices, and communications with them?`,
      })
    }, 100)
  }

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return 'bg-green-600'
      case 'shipped': return 'bg-blue-600'
      case 'processing': return 'bg-yellow-600'
      case 'pending': return 'bg-zinc-600'
      default: return 'bg-zinc-600'
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Truck className="w-6 h-6 text-orange-500" />
            <div>
              <h2 className="text-lg font-semibold text-white">UK Supplier Tracking</h2>
              <p className="text-xs text-zinc-500">Manage your suppliers and orders</p>
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-orange-600 hover:bg-orange-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Supplier
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
              <DialogHeader>
                <DialogTitle>Add New Supplier</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <Input
                  placeholder="Supplier Name"
                  value={newSupplier.name}
                  onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Category (e.g., IT, Office, Manufacturing)"
                  value={newSupplier.category}
                  onChange={(e) => setNewSupplier({ ...newSupplier, category: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={newSupplier.email}
                  onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Phone"
                  value={newSupplier.phone}
                  onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Website"
                  value={newSupplier.website}
                  onChange={(e) => setNewSupplier({ ...newSupplier, website: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
                <Button onClick={addSupplier} className="w-full bg-orange-600 hover:bg-orange-700">
                  Add Supplier
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search suppliers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-900 border-zinc-700"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 text-sm text-white"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-medium text-white">Recent Orders</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {recentOrders.map((order) => (
            <Badge key={order.id} variant="outline" className="shrink-0 border-zinc-600 text-zinc-300">
              <ShoppingCart className="w-3 h-3 mr-1" />
              {order.id}: <span className={`ml-1 ${getStatusColor(order.status)} px-1 rounded text-[10px]`}>{order.status}</span>
            </Badge>
          ))}
        </div>
      </div>

      {/* Supplier List */}
      <ScrollArea className="flex-1 p-4">
        {filteredSuppliers.length === 0 ? (
          <div className="text-center py-8">
            <Truck className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">No suppliers found</p>
            <p className="text-xs text-zinc-600 mt-1">Add your first supplier to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSuppliers.map((supplier) => (
              <Card key={supplier.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center shrink-0">
                        <Truck className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-white">{supplier.name}</h3>
                        {supplier.category && (
                          <Badge variant="outline" className="mt-1 text-xs border-orange-500 text-orange-400">
                            {supplier.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge 
                      variant={supplier.status === 'active' ? 'default' : 'secondary'}
                      className={supplier.status === 'active' ? 'bg-green-600' : ''}
                    >
                      {supplier.status}
                    </Badge>
                  </div>

                  <Separator className="my-3 bg-zinc-800" />

                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    {supplier.email && (
                      <div className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{supplier.email}</span>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <span>{supplier.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => chatWithSupplier(supplier)}
                    >
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Chat
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <ShoppingCart className="w-3 h-3 mr-1" />
                      Orders
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Receipt className="w-3 h-3 mr-1" />
                      Invoices
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
