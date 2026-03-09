# Business Management System Migration to Accomplish AI

## Architecture Overview

### Current System (Next.js)
- **Framework**: Next.js 16 + React + TypeScript
- **Database**: Prisma + SQLite
- **API**: REST API routes
- **Storage**: Web-based file system access
- **Email**: Gmail/Outlook OAuth via Next.js API
- **Voice**: API routes for transcription/synthesis

### Target System (Accomplish AI Electron)
- **Framework**: Electron + React + TypeScript
- **Database**: better-sqlite3 with migrations
- **API**: IPC (Inter-Process Communication)
- **Storage**: Local file system via Node.js
- **Email**: OAuth in main process
- **Voice**: Direct service integration

## Migration Mapping

### 1. Database Schema Migration

| Current (Prisma) | New (SQLite Migration) | Notes |
|------------------|------------------------|-------|
| `Solicitor` | `business_solicitors` | Add migration v009 |
| `SolicitorCase` | `business_solicitor_cases` | Linked to solicitors |
| `SolicitorDocument` | `business_documents` | Generic document table |
| `SolicitorCommunication` | `business_communications` | Generic comms table |
| `Accountant` | `business_accountants` | Add migration v010 |
| `Supplier` | `business_suppliers` | Add migration v011 |
| `User` | Use existing auth | Migrate to Accomplish |
| `Conversation` | `business_conversations` | Extend existing |
| `Message` | `business_messages` | Extend existing |
| `EmailAccount` | `business_email_accounts` | Gmail/Outlook tokens |

### 2. API Migration (Next.js Routes → IPC Handlers)

| Current Route | New IPC Handler | Location |
|---------------|-----------------|----------|
| `GET /api/solicitors` | `business:solicitors:list` | `ipc/handlers.ts` |
| `POST /api/solicitors` | `business:solicitors:create` | `ipc/handlers.ts` |
| `GET /api/accountants` | `business:accountants:list` | `ipc/handlers.ts` |
| `POST /api/accountants` | `business:accountants:create` | `ipc/handlers.ts` |
| `GET /api/suppliers` | `business:suppliers:list` | `ipc/handlers.ts` |
| `POST /api/suppliers` | `business:suppliers:create` | `ipc/handlers.ts` |
| `GET /api/emails/gmail/*` | `email:gmail:*` | New handlers |
| `GET /api/emails/outlook/*` | `email:outlook:*` | New handlers |
| `POST /api/voice/transcribe` | `voice:transcribe` | Extend existing |
| `POST /api/voice/speak` | `voice:speak` | Extend existing |
| `POST /api/chat` | Use existing task system | Adapt for business |
| `GET /api/agents/*` | `business:agents:*` | New handlers |
| `GET /api/documents/*` | `business:documents:*` | New handlers |

### 3. Component Migration (Next.js → Accomplish Web)

| Current Component | New Location | Changes |
|-------------------|--------------|---------|
| `ChatInterface.tsx` | `web/src/client/components/business/Chat.tsx` | Adapt IPC calls |
| `SolicitorPanel.tsx` | `web/src/client/components/business/SolicitorPanel.tsx` | Use accomplishAPI |
| `AccountantPanel.tsx` | `web/src/client/components/business/AccountantPanel.tsx` | Use accomplishAPI |
| `SupplierPanel.tsx` | `web/src/client/components/business/SupplierPanel.tsx` | Use accomplishAPI |
| `EmailPanel.tsx` | `web/src/client/components/business/EmailPanel.tsx` | Use accomplishAPI |
| `DocumentVaultPanel.tsx` | `web/src/client/components/business/DocumentVault.tsx` | Use accomplishAPI |
| `AgentStatusPanel.tsx` | `web/src/client/components/business/AgentStatus.tsx` | Use accomplishAPI |
| `Sidebar.tsx` | Extend existing | Add business nav items |
| `MessageBubble.tsx` | Adapt existing | Add business context |

### 4. Preload API Extensions

Add to `desktop/src/preload/index.ts`:

```typescript
// Business operations
business: {
  // Solicitors
  getSolicitors: () => Promise<Solicitor[]>
  createSolicitor: (data: SolicitorInput) => Promise<Solicitor>
  updateSolicitor: (id: string, data: Partial<SolicitorInput>) => Promise<Solicitor>
  deleteSolicitor: (id: string) => Promise<void>
  
  // Accountants
  getAccountants: () => Promise<Accountant[]>
  createAccountant: (data: AccountantInput) => Promise<Accountant>
  
  // Suppliers
  getSuppliers: () => Promise<Supplier[]>
  createSupplier: (data: SupplierInput) => Promise<Supplier>
  
  // Documents
  getDocuments: (entityType: string, entityId: string) => Promise<Document[]>
  saveDocument: (data: DocumentInput) => Promise<Document>
  
  // Email
  getGmailAuthStatus: () => Promise<AuthStatus>
  connectGmail: () => Promise<void>
  getOutlookAuthStatus: () => Promise<AuthStatus>
  connectOutlook: () => Promise<void>
  
  // Agents
  getActiveAgents: () => Promise<Agent[]>
  runAgent: (agentType: string, context: unknown) => Promise<void>
}
```

### 5. Skills Migration

Convert business features to Accomplish Skills:

| Feature | Skill Name | Description |
|---------|------------|-------------|
| Solicitor Management | `business-solicitor` | Manage UK solicitors and cases |
| Accountant Management | `business-accountant` | UK tax compliance and deadlines |
| Supplier Management | `business-supplier` | Supplier tracking and procurement |
| Email Management | `business-email` | Gmail/Outlook integration |
| Document Vault | `business-documents` | Document storage and OCR |
| Business Chat | `business-chat` | AI chat with business context |
| Voice Interface | `business-voice` | Voice commands for business |

## Implementation Phases

### Phase 1: Foundation
1. Clone Accomplish AI ✓
2. Analyze architecture ✓
3. Create migration plan ✓
4. Set up development environment
5. Install dependencies

### Phase 2: Database & Storage
1. Create migration v009-v011 for business entities
2. Create repositories for business data
3. Set up document storage
4. Migrate existing data

### Phase 3: Backend (IPC)
1. Add business IPC handlers
2. Port email OAuth flows
3. Port voice services
4. Create business agents

### Phase 4: Frontend
1. Port React components
2. Add business routes
3. Integrate with existing UI
4. Add business navigation

### Phase 5: Skills & Agents
1. Create business skills
2. Implement agent orchestration
3. Add UK-specific workflows
4. Test agent collaboration

### Phase 6: Testing & Build
1. Test all workflows
2. Build for Windows
3. Create installer
4. Document usage

## File Structure Changes

```
accomplish/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── business/           # NEW: Business IPC handlers
│   │   │   │   │   ├── handlers.ts
│   │   │   │   │   ├── email.ts
│   │   │   │   │   ├── voice.ts
│   │   │   │   │   └── agents.ts
│   │   │   │   └── ipc/
│   │   │   │       └── handlers.ts     # MODIFIED: Add business handlers
│   │   │   └── preload/
│   │   │       └── index.ts            # MODIFIED: Add business APIs
│   │   └── bundled-skills/
│   │       └── business/               # NEW: Business skills
│   │           ├── business-solicitor/
│   │           ├── business-accountant/
│   │           ├── business-supplier/
│   │           ├── business-email/
│   │           └── business-documents/
│   └── web/
│       └── src/client/
│           ├── components/
│           │   └── business/           # NEW: Business components
│           │       ├── Chat.tsx
│           │       ├── SolicitorPanel.tsx
│           │       ├── AccountantPanel.tsx
│           │       ├── SupplierPanel.tsx
│           │       ├── EmailPanel.tsx
│           │       ├── DocumentVault.tsx
│           │       └── AgentStatus.tsx
│           └── pages/
│               └── business/           # NEW: Business pages
├── packages/
│   └── agent-core/
│       └── src/
│           ├── storage/
│           │   └── migrations/         # MODIFIED: Add v009-v011
│           │       ├── v009-business-solicitors.ts
│           │       ├── v010-business-accountants.ts
│           │       └── v011-business-suppliers.ts
│           └── storage/repositories/   # NEW: Business repositories
│               ├── solicitorRepository.ts
│               ├── accountantRepository.ts
│               └── supplierRepository.ts
```

## Key Technical Decisions

1. **Database**: Use existing better-sqlite3, extend migrations
2. **Storage**: Use Electron's userData path for documents
3. **IPC**: Follow existing pattern (invoke/handle)
4. **UI**: Integrate with existing design system
5. **Skills**: Use Accomplish's skill system for business logic
6. **OAuth**: Move from Next.js to Electron main process
7. **Voice**: Extend existing speech services

## Risk Mitigation

1. **Data Migration**: Create backup and rollback scripts
2. **OAuth Flows**: Test thoroughly in Electron context
3. **File System**: Handle Windows/Mac/Linux paths
4. **Performance**: Lazy load business panels
5. **Security**: Keep IPC API minimal and validated
