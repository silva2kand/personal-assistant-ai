import { promises as fs } from 'fs'
import path from 'path'

export interface GmailAccount {
  email: string
  displayName?: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
}

interface GmailStore {
  accounts: GmailAccount[]
}

const STORE_PATH = path.join(process.cwd(), 'db', 'gmail_tokens.json')

async function ensureStore(): Promise<void> {
  const dir = path.dirname(STORE_PATH)
  await fs.mkdir(dir, { recursive: true })
  try {
    await fs.access(STORE_PATH)
  } catch {
    const initial: GmailStore = { accounts: [] }
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8')
  }
}

export async function readGmailStore(): Promise<GmailStore> {
  await ensureStore()
  const raw = await fs.readFile(STORE_PATH, 'utf-8')
  try {
    const data = JSON.parse(raw) as GmailStore
    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
    }
  } catch {
    return { accounts: [] }
  }
}

export async function writeGmailStore(store: GmailStore): Promise<void> {
  await ensureStore()
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

export async function upsertGmailAccount(account: GmailAccount): Promise<void> {
  const store = await readGmailStore()
  const idx = store.accounts.findIndex((a) => a.email.toLowerCase() === account.email.toLowerCase())
  if (idx >= 0) {
    store.accounts[idx] = account
  } else {
    store.accounts.push(account)
  }
  await writeGmailStore(store)
}

export async function getGmailAccount(email?: string): Promise<GmailAccount | null> {
  const store = await readGmailStore()
  if (store.accounts.length === 0) return null
  if (!email) return store.accounts[0]
  return store.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) || null
}

export async function listGmailAccounts(): Promise<GmailAccount[]> {
  const store = await readGmailStore()
  return store.accounts
}

export async function removeGmailAccount(email?: string): Promise<void> {
  const store = await readGmailStore()
  if (!email) {
    store.accounts = []
  } else {
    store.accounts = store.accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase())
  }
  await writeGmailStore(store)
}
