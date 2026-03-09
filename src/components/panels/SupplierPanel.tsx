'use client'

import * as React from 'react'
import { 
  Truck, Plus, Phone, Mail, MapPin, FileText, MessageSquare, 
  MoreHorizontal, Pencil, Trash2, Loader2, Package, Receipt,
  Globe, DollarSign
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

interface Supplier {
  id: string
  name: string
  category: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
  status: string
  notes: string | null
  createdAt: string
}

interface SupplierOrder {
  id: string
  orderNumber: string | null
  description: string
  amount: number | null
  currency: string
  status: string
  orderDate: string
  deliveryDate: string | null
}

interface SupplierInvoice {
  id: string
  invoiceNumber: string | null
  amount: number
  currency: string
  status: string
  issueDate: string
  dueDate: string | null
}

interface SupplierCommunication {
  id: string
  type: string
  subject: string | null
  content: string
  date: string
}

export function SupplierPanel() {
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([])
  const [selectedSupplier, setSelectedSupplier] = React.useState<Supplier | null>(null)
  const [orders, setOrders] = React.useState<SupplierOrder[]>([])
  const [invoices, setInvoices] = React.useState<SupplierInvoice[]>([])
  const [communications, setCommunications] = React.useState<SupplierCommunication[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  
  const [formData, setFormData] = React.useState({
    name: '',
    category: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    notes: '',
  })

  React.useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/suppliers')
      const data = await response.json()
      setSuppliers(data.suppliers || [])
    } catch (error) {
      console.error('Error fetching suppliers:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchSupplierDetails = async (id: string) => {
    try {
      const [ordersRes, invoicesRes, commsRes] = await Promise.all([
        fetch(`/api/suppliers/${id}/orders`),
        fetch(`/api/suppliers/${id}/invoices`),
        fetch(`/api/suppliers/${id}/communications`),
      ])
      
      const [ordersData, invoicesData, commsData] = await Promise.all([
        ordersRes.json(),
        invoicesRes.json(),
        commsRes.json(),
      ])
      
      setOrders(ordersData.orders || [])
      setInvoices(invoicesData.invoices || [])
      setCommunications(commsData.communications || [])
    } catch (error) {
      console.error('Error fetching supplier details:', error)
    }
  }

  const handleSelectSupplier = (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    fetchSupplierDetails(supplier.id)
  }

  const handleAddSupplier = async () => {
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      
      if (response.ok) {
        fetchSuppliers()
        setIsAddDialogOpen(false)
        setFormData({
          name: '',
          category: '',
          email: '',
          phone: '',
          address: '',
          website: '',
          notes: '',
        })
      }
    } catch (error) {
      console.error('Error adding supplier:', error)
    }
  }

  const handleDeleteSupplier = async (id: string) => {
    try {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        setSuppliers(suppliers.filter(s => s.id !== id))
        if (selectedSupplier?.id === id) {
          setSelectedSupplier(null)
        }
      }
    } catch (error) {
      console.error('Error deleting supplier:', error)
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

  const getOrderStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-zinc-500/10 text-zinc-400'
      case 'processing': return 'bg-blue-500/10 text-blue-400'
      case 'shipped': return 'bg-amber-500/10 text-amber-400'
      case 'delivered': return 'bg-emerald-500/10 text-emerald-400'
      case 'cancelled': return 'bg-red-500/10 text-red-400'
      default: return 'bg-zinc-500/10 text-zinc-400'
    }
  }

  const getInvoiceStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-zinc-500/10 text-zinc-400'
      case 'paid': return 'bg-emerald-500/10 text-emerald-400'
      case 'overdue': return 'bg-red-500/10 text-red-400'
      default: return 'bg-zinc-500/10 text-zinc-400'
    }
  }

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Supplier List */}
      <div className="w-80 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-orange-400" />
            <h2 className="font-semibold text-zinc-100">Suppliers</h2>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">Add New Supplier</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label className="text-zinc-300">Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="Supplier name"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300">Category</Label>
                  <Input
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="e.g., IT, Office, Manufacturing"
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
                  <Label className="text-zinc-300">Website</Label>
                  <Input
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100"
                    placeholder="https://..."
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
                <Button onClick={handleAddSupplier} className="w-full bg-orange-600 hover:bg-orange-700">
                  Add Supplier
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {suppliers.length === 0 ? (
              <div className="text-center text-zinc-500 py-8">
                <Truck className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No suppliers added yet</p>
                <p className="text-sm">Click + to add your first supplier</p>
              </div>
            ) : (
              suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  onClick={() => handleSelectSupplier(supplier)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-colors group",
                    selectedSupplier?.id === supplier.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "hover:bg-zinc-800/50 text-zinc-300"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{supplier.name}</span>
                        <Badge className={cn("text-xs", getStatusColor(supplier.status))}>
                          {supplier.status}
                        </Badge>
                      </div>
                      {supplier.category && (
                        <p className="text-xs text-orange-400 truncate">{supplier.category}</p>
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
                            handleDeleteSupplier(supplier.id)
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

      {/* Supplier Details */}
      <div className="flex-1 flex flex-col">
        {selectedSupplier ? (
          <>
            <div className="p-4 border-b border-zinc-800">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100">{selectedSupplier.name}</h2>
                  {selectedSupplier.category && (
                    <Badge variant="outline" className="border-orange-500/50 text-orange-400 mt-1">
                      {selectedSupplier.category}
                    </Badge>
                  )}
                </div>
                <Badge className={getStatusColor(selectedSupplier.status)}>
                  {selectedSupplier.status}
                </Badge>
              </div>
              
              <div className="flex flex-wrap gap-4 mt-4 text-sm">
                {selectedSupplier.email && (
                  <a href={`mailto:${selectedSupplier.email}`} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Mail className="h-4 w-4" />
                    {selectedSupplier.email}
                  </a>
                )}
                {selectedSupplier.phone && (
                  <a href={`tel:${selectedSupplier.phone}`} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Phone className="h-4 w-4" />
                    {selectedSupplier.phone}
                  </a>
                )}
                {selectedSupplier.website && (
                  <a href={selectedSupplier.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                    <Globe className="h-4 w-4" />
                    {selectedSupplier.website}
                  </a>
                )}
              </div>
              
              {selectedSupplier.address && (
                <div className="flex items-center gap-1 mt-2 text-sm text-zinc-400">
                  <MapPin className="h-4 w-4" />
                  {selectedSupplier.address}
                </div>
              )}
            </div>

            <Tabs defaultValue="orders" className="flex-1 flex flex-col">
              <TabsList className="mx-4 mt-4 bg-zinc-800/50">
                <TabsTrigger value="orders" className="data-[state=active]:bg-zinc-700">
                  <Package className="h-4 w-4 mr-2" />
                  Orders
                </TabsTrigger>
                <TabsTrigger value="invoices" className="data-[state=active]:bg-zinc-700">
                  <Receipt className="h-4 w-4 mr-2" />
                  Invoices
                </TabsTrigger>
                <TabsTrigger value="communications" className="data-[state=active]:bg-zinc-700">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Communications
                </TabsTrigger>
              </TabsList>

              <TabsContent value="orders" className="flex-1 m-0">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {orders.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8">
                        <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No orders yet</p>
                      </div>
                    ) : (
                      orders.map((order) => (
                        <Card key={order.id} className="bg-zinc-900 border-zinc-800">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <CardTitle className="text-base text-zinc-100">{order.description}</CardTitle>
                                {order.orderNumber && (
                                  <p className="text-xs text-zinc-500">Order #{order.orderNumber}</p>
                                )}
                              </div>
                              <Badge className={getOrderStatusColor(order.status)}>
                                {order.status}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between text-sm">
                              <div className="text-zinc-500">
                                Ordered: {new Date(order.orderDate).toLocaleDateString('en-GB')}
                              </div>
                              {order.amount && (
                                <div className="flex items-center gap-1 text-zinc-300">
                                  <DollarSign className="h-4 w-4" />
                                  {formatCurrency(order.amount, order.currency)}
                                </div>
                              )}
                            </div>
                            {order.deliveryDate && (
                              <div className="text-xs text-zinc-500 mt-2">
                                Delivery: {new Date(order.deliveryDate).toLocaleDateString('en-GB')}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="invoices" className="flex-1 m-0">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {invoices.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8">
                        <Receipt className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No invoices yet</p>
                      </div>
                    ) : (
                      invoices.map((invoice) => (
                        <Card key={invoice.id} className="bg-zinc-900 border-zinc-800">
                          <CardContent className="py-3">
                            <div className="flex items-start justify-between">
                              <div>
                                {invoice.invoiceNumber && (
                                  <p className="text-xs text-zinc-500 mb-1">Invoice #{invoice.invoiceNumber}</p>
                                )}
                                <div className="flex items-center gap-1 text-zinc-100 font-medium">
                                  <DollarSign className="h-4 w-4" />
                                  {formatCurrency(invoice.amount, invoice.currency)}
                                </div>
                              </div>
                              <Badge className={getInvoiceStatusColor(invoice.status)}>
                                {invoice.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                              <span>Issued: {new Date(invoice.issueDate).toLocaleDateString('en-GB')}</span>
                              {invoice.dueDate && (
                                <span>Due: {new Date(invoice.dueDate).toLocaleDateString('en-GB')}</span>
                              )}
                            </div>
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
            <Truck className="h-16 w-16 text-zinc-700 mb-4" />
            <h3 className="text-lg font-medium text-zinc-400 mb-2">Select a Supplier</h3>
            <p className="text-zinc-500 max-w-sm">
              Choose a supplier from the list to view their details, orders, invoices, and communication history.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
