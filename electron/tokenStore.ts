import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { app } from 'electron'
import * as os from 'os'

export interface BalanceData {
  isAvailable: boolean
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
  isTokenQuota?: boolean
  remainingRequests?: number
  remainingTokens?: number
  note?: string
}

export interface BalanceResult {
  success: boolean
  data?: BalanceData
  error?: string
}

export interface TokenKeyConfig {
  id: string
  platform: string
  label: string
  createdAt: number
  balance?: BalanceResult
  // key field is never persisted in plaintext; it is decrypted on demand
}

export interface PlatformInfo {
  id: string
  name: string
  description: string
  website: string
  rechargeUrl: string
  currency: string
  credentialType: string
  credentialHint: string
  isTokenQuota: boolean
  note?: string
}

// ─── Encrypted storage schema ────────────────────────────────
//
// File: token-keys.enc.json  (in userData)
// {
//   version: 1,
//   salt: "<base64 random salt>",
//   keys: [
//     {
//       id, platform, label, createdAt,
//       encryptedKey: { iv: "<base64>", ciphertext: "<base64>", tag: "<base64>" },
//       balance?: BalanceResult
//     }
//   ]
// }
//
// Encryption: AES-256-GCM
// Key derivation: scrypt( machineFingerprint + appPepper, salt )
//   machineFingerprint = hostname + username + userData path
//   => keys are bound to the machine + user, not portable
// ─────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN = 32 // bytes for AES-256
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const IV_LEN = 12 // bytes, recommended for GCM
const TAG_LEN = 16 // bytes

// App-specific pepper (not secret by itself, but combined with machine fingerprint + salt)
const APP_PEPPER = 'clipboard-vibe::token-key::pepper::v1'

interface EncryptedBlob {
  iv: string
  ciphertext: string
  tag: string
}

interface StoredKey {
  id: string
  platform: string
  label: string
  createdAt: number
  encryptedKey: EncryptedBlob
  balance?: BalanceResult
}

interface EncryptedStoreFile {
  version: number
  salt: string
  keys: StoredKey[]
}

function getMachineFingerprint(): string {
  const hostname = os.hostname()
  const username = os.userInfo().username
  const userDataPath = app.getPath('userData')
  return `${hostname}::${username}::${userDataPath}::${APP_PEPPER}`
}

function deriveKey(saltBuf: Buffer): Buffer {
  const fingerprint = getMachineFingerprint()
  return crypto.scryptSync(fingerprint, saltBuf, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
}

function encryptValue(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  }
}

function decryptValue(blob: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(blob.iv, 'base64')
  const ciphertext = Buffer.from(blob.ciphertext, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

export class TokenStore {
  private keys: StoredKey[] = []
  private salt: Buffer = Buffer.alloc(0)
  private derivedKey: Buffer = Buffer.alloc(0)
  private filePath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'token-keys.enc.json')
    this.load()
  }

  private ensureKeyDerived() {
    if (this.derivedKey.length === KEY_LEN) return
    if (this.salt.length === 0) {
      this.salt = crypto.randomBytes(32)
    }
    this.derivedKey = deriveKey(this.salt)
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed: EncryptedStoreFile = JSON.parse(raw)
        if (parsed.version !== 1 || !parsed.salt || !Array.isArray(parsed.keys)) {
          throw new Error('Invalid token store file format')
        }
        this.salt = Buffer.from(parsed.salt, 'base64')
        this.keys = parsed.keys
      } else {
        // First run - generate salt
        this.salt = crypto.randomBytes(32)
        this.keys = []
        this.save()
      }
    } catch (e) {
      console.error('Failed to load token keys:', e)
      this.salt = crypto.randomBytes(32)
      this.keys = []
    }
    this.ensureKeyDerived()
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const data: EncryptedStoreFile = {
        version: 1,
        salt: this.salt.toString('base64'),
        keys: this.keys,
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.error('Failed to save token keys:', e)
    }
  }

  /** Return public key info (no plaintext key) for the renderer */
  getKeys(): TokenKeyConfig[] {
    return this.keys.map(k => ({
      id: k.id,
      platform: k.platform,
      label: k.label,
      createdAt: k.createdAt,
      balance: k.balance,
    }))
  }

  getKey(id: string): TokenKeyConfig | undefined {
    const k = this.keys.find(k => k.id === id)
    if (!k) return undefined
    return {
      id: k.id,
      platform: k.platform,
      label: k.label,
      createdAt: k.createdAt,
      balance: k.balance,
    }
  }

  /** Decrypt and return the raw API key — only use in main process, never send to renderer */
  getDecryptedKey(id: string): string | null {
    const k = this.keys.find(k => k.id === id)
    if (!k) return null
    try {
      this.ensureKeyDerived()
      return decryptValue(k.encryptedKey, this.derivedKey)
    } catch (e) {
      console.error('Failed to decrypt key:', e)
      return null
    }
  }

  addKey(platform: string, key: string, label: string): TokenKeyConfig {
    this.ensureKeyDerived()
    const encryptedKey = encryptValue(key, this.derivedKey)
    const newKey: StoredKey = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      platform,
      encryptedKey,
      label: label || `${platform}-${this.keys.filter(k => k.platform === platform).length + 1}`,
      createdAt: Date.now(),
    }
    this.keys.push(newKey)
    this.save()
    return {
      id: newKey.id,
      platform: newKey.platform,
      label: newKey.label,
      createdAt: newKey.createdAt,
    }
  }

  deleteKey(id: string): boolean {
    const index = this.keys.findIndex(k => k.id === id)
    if (index !== -1) {
      this.keys.splice(index, 1)
      this.save()
      return true
    }
    return false
  }

  setBalance(id: string, balance: BalanceResult): void {
    const key = this.keys.find(k => k.id === id)
    if (key) {
      key.balance = balance
      this.save()
    }
  }

  /**
   * Re-encrypt all keys with a freshly derived key.
   * Useful if machine fingerprint changes (rare).
   */
  reencryptAll(): boolean {
    try {
      this.ensureKeyDerived()
      const oldKey = this.derivedKey
      // Generate new salt and derive new key
      this.salt = crypto.randomBytes(32)
      const newKey = deriveKey(this.salt)
      this.derivedKey = newKey

      // Re-encrypt each key
      for (const k of this.keys) {
        const plaintext = decryptValue(k.encryptedKey, oldKey)
        k.encryptedKey = encryptValue(plaintext, newKey)
      }
      this.save()
      return true
    } catch (e) {
      console.error('Failed to re-encrypt keys:', e)
      return false
    }
  }
}
