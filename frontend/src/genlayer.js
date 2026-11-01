import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

export const CHAIN_ID = 61999
export const CHAIN_ID_HEX = '0xf22f'
export const RPC_URL = 'https://studio.genlayer.com/api'
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || ''
export const EXPLORER = 'https://explorer-studio.genlayer.com'

export function explorerAddress(addr) { return `${EXPLORER}/address/${addr}` }
export function explorerTx(hash) { return `${EXPLORER}/tx/${hash}` }

export function readClient() {
  return createClient({ chain: studionet })
}

export function writeClient(accountAddress) {
  return createClient({ chain: studionet, account: accountAddress })
}

// Wallet-agnostic fallback for wallets that cannot install the GenLayer
// Snap (OKX, Rabby, mobile wallets, etc.): generate an ephemeral account
// in the browser and sign with it. Studionet is gasless and permissionless,
// so this produces a REAL on-chain transaction — but the requester on-chain
// will be this ephemeral address, NOT the reviewer's wallet address, and
// the key lives only in browser memory and is discarded on refresh. Callers
// must show that honestly; never present it as a wallet-signed transaction.
export function reviewerClient() {
  const account = createAccount(generatePrivateKey())
  return { address: account.address, client: createClient({ chain: studionet, account }) }
}

// Connect any injected EVM wallet (MetaMask, OKX, Rabby, Coinbase, …) for
// address + chain only, without requiring the Snap. Returns the wallet
// address; callers then try the Snap separately.
export async function connectWalletAddress() {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet found. Install a wallet extension (MetaMask, OKX, Rabby, …), then try again.')
  const accounts = await eth.request({ method: 'eth_requestAccounts' })
  const address = accounts[0]
  if (!address) throw new Error('No account selected in the wallet.')
  await ensureStudionet()
  return address
}

export async function ensureStudionet() {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet found. Install MetaMask, then try again.')
  const current = await eth.request({ method: 'eth_chainId' })
  if (current !== CHAIN_ID_HEX) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] })
    } catch (err) {
      if (err && err.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: CHAIN_ID_HEX, chainName: 'GenLayer Studio Network', rpcUrls: [RPC_URL], nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 }, blockExplorerUrls: [EXPLORER] }],
        })
      } else throw err
    }
  }
}

// Current write path (see App.jsx): connectWalletAddress() for address +
// chain, then client.connect('studionet') for the GenLayer Snap, falling
// back to reviewerClient() for wallets without Snap support. There is
// intentionally no single connectWallet() helper — the Snap-only version
// was a dead end because its error text contradicted the fallback.
export async function waitFinal(client, hash, onProgress) {
  onProgress && onProgress('submitted')
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 180,
    interval: 5000,
  })
  onProgress && onProgress('finalized')
  return receipt
}

export function parseRecord(raw) {
  if (typeof raw === 'string') return JSON.parse(raw)
  return raw
}

export const CATEGORIES = ['Prediction', 'Birthday message', 'Goal', 'Milestone', 'Sports', 'Other']

// Commit-reveal helpers. The commitment is SHA-256(salt + "\n" +
// prediction), computed here in the browser with WebCrypto. The
// prediction and the salt NEVER leave the browser at seal time — only
// the resulting 64-hex hash is sent to the contract, which recomputes
// the same hash in-contract (pure-Python SHA-256) at reveal time.
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const SALT_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'
export function generateSalt(length = 16) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => SALT_CHARS[b % SALT_CHARS.length]).join('')
}

// The same two public, keyless UTC time sources the contract tries, in
// the same order. The browser preview uses them too, so what you see
// before sealing is the same kind of source GenLayer will check.
export const TIME_SOURCES = [
  { url: 'https://timeapi.io/api/time/current/zone?timeZone=UTC', field: 'dateTime', label: 'timeapi.io' },
  { url: 'https://worldtime.timezone.io/api/timezone/Etc/UTC', field: 'utc_datetime', label: 'worldtime.timezone.io' },
]

export async function fetchUtcPreview() {
  for (const src of TIME_SOURCES) {
    try {
      const res = await fetch(src.url)
      if (!res.ok) continue
      const data = await res.json()
      const value = data[src.field]
      if (typeof value === 'string' && value.length >= 10) {
        return { source: src.label, utcDate: value.slice(0, 10), utcDateTime: value, local: false }
      }
    } catch { continue }
  }
  // Honest fallback for display only: the browser's own clock, labelled
  // as local. The contract never uses this — it only fetches the sources
  // above, and unlocking waits if they are all down.
  const now = new Date()
  return { source: 'local clock (browser, preview only)', utcDate: now.toISOString().slice(0, 10), utcDateTime: now.toISOString(), local: true }
}

export function countdownTo(unlockDate, nowMs) {
  const target = Date.parse(unlockDate + 'T00:00:00Z')
  let diff = target - nowMs
  if (diff <= 0) return null
  const days = Math.floor(diff / 86400000); diff -= days * 86400000
  const hours = Math.floor(diff / 3600000); diff -= hours * 3600000
  const mins = Math.floor(diff / 60000); diff -= mins * 60000
  const secs = Math.floor(diff / 1000)
  return { days, hours, mins, secs }
}
