import { promises as fs } from 'fs'
import path from 'path'

export interface OutlookAccount {
  email: string
  displayName?: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
}

interface OutlookStore {
  accounts: OutlookAccount[]
}

const STORE_PATH = path.join(process.cwd(), 'db', 'outlook_tokens.json')

async function ensureStore(): Promise<void> {
  const dir = path.dirname(STORE_PATH)
  await fs.mkdir(dir, { recursive: true })
  try {
    await fs.access(STORE_PATH)
  } catch {
    const initial: OutlookStore = { accounts: [] }
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8')
  }
}

export async function readOutlookStore(): Promise<OutlookStore> {
  await ensureStore()
  const raw = await fs.readFile(STORE_PATH, 'utf-8')
  try {
    const data = JSON.parse(raw) as OutlookStore
    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
    }
  } catch {
    return { accounts: [] }
  }
}

export async function writeOutlookStore(store: OutlookStore): Promise<void> {
  await ensureStore()
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

export async function upsertOutlookAccount(account: OutlookAccount): Promise<void> {
  const store = await readOutlookStore()
  const idx = store.accounts.findIndex((a) => a.email.toLowerCase() === account.email.toLowerCase())
  if (idx >= 0) {
    store.accounts[idx] = account
  } else {
    store.accounts.push(account)
  }
  await writeOutlookStore(store)
}

export async function getOutlookAccount(email?: string): Promise<OutlookAccount | null> {
  const store = await readOutlookStore()
  if (store.accounts.length === 0) return null
  if (!email) return store.accounts[0]
  return store.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) || null
}

export async function listOutlookAccounts(): Promise<OutlookAccount[]> {
  const store = await readOutlookStore()
  return store.accounts
}

export async function removeOutlookAccount(email?: string): Promise<void> {
  const store = await readOutlookStore()
  if (!email) {
    store.accounts = []
  } else {
    store.accounts = store.accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase())
  }
  await writeOutlookStore(store)
}
