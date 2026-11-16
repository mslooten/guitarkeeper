import { toRaw } from 'vue'

const DATABASE_NAME = 'guitarkeeper'
const DATABASE_VERSION = 2
const STORE_NAME = 'guitars'
const SETTINGS_STORE_NAME = 'settings'
const GUITAR_ORDER_KEY = 'guitarOrder'

let databasePromise

function openDatabase() {
  if (databasePromise) return databasePromise

  let opening
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    let blocked = false

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME)
      }
    }
    request.onblocked = () => {
      blocked = true
      reject(new Error('Opening the guitar database was blocked by another connection'))
    }
    request.onerror = () => reject(request.error || new Error('Could not open the guitar database'))
    request.onsuccess = () => {
      const db = request.result
      if (blocked) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        if (databasePromise === opening) databasePromise = undefined
      }
      db.onclose = () => {
        if (databasePromise === opening) databasePromise = undefined
      }
      resolve(db)
    }
  }).catch((error) => {
    if (databasePromise === opening) databasePromise = undefined
    throw error
  })
  databasePromise = opening
  return opening
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(toRaw(value))
  return prototype === Object.prototype || prototype === null
}

function validateId(id) {
  if ((typeof id === 'string' && id.trim().length > 0) ||
      (typeof id === 'number' && Number.isFinite(id))) return
  throw new TypeError('Guitar id must be a non-empty string or a finite number')
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('A secure random number generator is required to create a guitar id')
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// IndexedDB cannot clone Vue proxies. Copy nested arrays and records without
// mutating the caller; leave other values to IndexedDB's structured clone.
function unwrap(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value)
  if (seen.has(raw)) return seen.get(raw)
  if (!Array.isArray(raw) && !isRecord(raw)) return raw

  const copy = Array.isArray(raw) ? [] : {}
  seen.set(raw, copy)
  for (const key of Object.keys(raw)) {
    // Define properties rather than assigning so a '__proto__' key stays data.
    Object.defineProperty(copy, key, {
      value: unwrap(raw[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return copy
}

function prepareGuitar(guitar) {
  if (!isRecord(guitar)) throw new TypeError('Guitar must be an object')

  const record = unwrap(guitar)
  if (record.id === undefined || record.id === null) record.id = createId()
  validateId(record.id)

  for (const field of ['make', 'model', 'serial']) {
    if (record[field] === undefined || record[field] === null) record[field] = ''
    if (typeof record[field] !== 'string') throw new TypeError(`Guitar ${field} must be a string`)
  }
  if (record.specs === undefined || record.specs === null) record.specs = {}
  if (typeof record.specs !== 'string' && !isRecord(record.specs)) {
    throw new TypeError('Guitar specs must be a string or an object')
  }
  if (record.photo === undefined || record.photo === null) record.photo = ''
  if (typeof record.photo !== 'string' ||
      (record.photo !== '' && !/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(record.photo))) {
    throw new TypeError('Guitar photo must be an image data URL or an empty string')
  }
  if (record.setup === undefined || record.setup === null) record.setup = {}
  if (!isRecord(record.setup)) throw new TypeError('Guitar setup must be an object')
  if (record.stringChanges === undefined || record.stringChanges === null) record.stringChanges = []
  if (!Array.isArray(record.stringChanges)) throw new TypeError('Guitar stringChanges must be an array')
  return record
}

async function transact(mode, operation, storeName = STORE_NAME) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction
    let request
    let requestError
    try {
      transaction = db.transaction(storeName, mode)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => {
        requestError = request?.error || transaction.error || new Error('Guitar database transaction failed')
      }
      transaction.onabort = () => reject(requestError || transaction.error || new Error('Guitar database transaction aborted'))
      request = operation(transaction.objectStore(storeName))
    } catch (error) {
      if (transaction) {
        try { transaction.abort() } catch { /* The transaction is already inactive. */ }
      }
      reject(error)
    }
  })
}

/** Load every saved guitar. Resolves to an empty array for a new database. */
export async function loadGuitars() {
  return transact('readonly', (store) => store.getAll())
}

/** Insert or replace a guitar and resolve to its saved snapshot, including its id. */
export async function saveGuitar(guitar) {
  const record = prepareGuitar(guitar)
  await transact('readwrite', (store) => store.put(record))
  return record
}

/** Delete a guitar by id; deleting an unknown id is a successful no-op. */
export async function deleteGuitar(id) {
  validateId(id)
  await transact('readwrite', (store) => store.delete(id))
}

/** Load the saved collection order, or an empty array if none has been saved. */
export async function loadGuitarOrder() {
  return (await transact('readonly', (store) => store.get(GUITAR_ORDER_KEY), SETTINGS_STORE_NAME)) ?? []
}

/** Atomically replace the collection order with a snapshot of unique guitar ids. */
export async function saveGuitarOrder(ids) {
  if (!Array.isArray(ids)) throw new TypeError('Guitar order must be an array')

  const order = Array.from(ids)
  const seen = new Set()
  for (const id of order) {
    validateId(id)
    if (seen.has(id)) throw new TypeError('Guitar order must not contain duplicate ids')
    seen.add(id)
  }

  await transact('readwrite', (store) => store.put(order, GUITAR_ORDER_KEY), SETTINGS_STORE_NAME)
}

// Copy only values that can survive a JSON round trip without losing data.
function copyBackupValue(value, path, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object') throw new TypeError(`${path} must contain only JSON values`)

  const raw = toRaw(value)
  if (!Array.isArray(raw) && !isRecord(raw)) {
    throw new TypeError(`${path} must contain only JSON objects and arrays`)
  }
  if (ancestors.has(raw)) throw new TypeError(`${path} must not contain circular references`)
  if (Object.getOwnPropertySymbols(raw).length) {
    throw new TypeError(`${path} must not contain symbol properties`)
  }
  ancestors.add(raw)
  try {
    if (Array.isArray(raw)) {
      const keys = Object.keys(raw)
      if (keys.length !== raw.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError(`${path} must be a dense array without extra properties`)
      }
      return raw.map((entry, index) => copyBackupValue(entry, `${path}[${index}]`, ancestors))
    }

    const copy = {}
    for (const key of Object.keys(raw)) {
      Object.defineProperty(copy, key, {
        value: copyBackupValue(raw[key], `${path}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return copy
  } finally {
    ancestors.delete(raw)
  }
}

/** Validate and copy a version 1 backup, preserving JSON-compatible unknown fields. */
export function validateBackup(input) {
  if (!isRecord(input)) throw new TypeError('Backup must be an object')
  const backup = copyBackupValue(input, 'Backup')
  if (backup.format !== 'guitarkeeper-backup') throw new TypeError('Invalid backup format')
  if (backup.version !== 1) throw new TypeError('Unsupported backup version')
  if (typeof backup.exportedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(backup.exportedAt) ||
      !Number.isFinite(Date.parse(backup.exportedAt))) {
    throw new TypeError('Backup exportedAt must be an ISO date string')
  }
  if (!Array.isArray(backup.guitars)) throw new TypeError('Backup guitars must be an array')
  if (!Array.isArray(backup.guitarOrder)) throw new TypeError('Backup guitarOrder must be an array')

  const ids = new Set()
  backup.guitars = backup.guitars.map((guitar, index) => {
    if (!isRecord(guitar)) throw new TypeError(`Backup guitar ${index} must be an object`)
    validateId(guitar.id) // Backups must never generate replacement ids.
    if (ids.has(guitar.id)) throw new TypeError('Backup guitars must not contain duplicate ids')
    ids.add(guitar.id)
    const record = prepareGuitar(guitar)
    for (const field of ['action', 'relief', 'pickupHeights', 'mods']) {
      if (record.setup[field] !== undefined && typeof record.setup[field] !== 'string') {
        throw new TypeError(`Backup guitar ${index} setup ${field} must be a string`)
      }
    }
    for (const [changeIndex, change] of record.stringChanges.entries()) {
      if (!isRecord(change)) {
        throw new TypeError(`Backup guitar ${index} string change ${changeIndex} must be an object`)
      }
      for (const field of ['date', 'brand', 'gauge']) {
        if (change[field] !== undefined && typeof change[field] !== 'string') {
          throw new TypeError(`Backup guitar ${index} string change ${changeIndex} ${field} must be a string`)
        }
      }
    }
    if (isRecord(record.specs)) {
      for (const value of Object.values(record.specs)) {
        try { String(value) } catch {
          throw new TypeError(`Backup guitar ${index} specs values must be displayable`)
        }
      }
    }
    return record
  })

  const ordered = new Set()
  for (const id of backup.guitarOrder) {
    validateId(id)
    if (ordered.has(id)) throw new TypeError('Backup guitarOrder must not contain duplicate ids')
    if (!ids.has(id)) throw new TypeError('Backup guitarOrder references an unknown guitar id')
    ordered.add(id)
  }
  return backup
}

/** Export a consistent, JSON-serializable snapshot of guitars and their saved order. */
export async function exportBackup() {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction
    let requestError
    try {
      transaction = db.transaction([STORE_NAME, SETTINGS_STORE_NAME], 'readonly')
      const guitars = transaction.objectStore(STORE_NAME).getAll()
      const order = transaction.objectStore(SETTINGS_STORE_NAME).get(GUITAR_ORDER_KEY)
      transaction.onerror = (event) => {
        requestError = event.target?.error || transaction.error || new Error('Could not export backup')
      }
      transaction.onabort = () => reject(requestError || transaction.error || new Error('Backup export aborted'))
      transaction.oncomplete = () => {
        try {
          const savedOrder = order.result ?? []
          if (!Array.isArray(savedOrder)) throw new TypeError('Saved guitar order must be an array')
          for (const id of savedOrder) validateId(id)
          const ids = new Set(guitars.result.map((guitar) => guitar.id))
          resolve(validateBackup({
            format: 'guitarkeeper-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            guitars: guitars.result,
            guitarOrder: savedOrder.filter((id) => ids.has(id)),
          }))
        } catch (error) {
          reject(error)
        }
      }
    } catch (error) {
      if (transaction) {
        try { transaction.abort() } catch { /* The transaction is already inactive. */ }
      }
      reject(error)
    }
  })
}

/** Validate and atomically replace all guitars and their saved order. */
export async function restoreBackup(input) {
  const backup = validateBackup(input)
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction
    let requestError
    try {
      transaction = db.transaction([STORE_NAME, SETTINGS_STORE_NAME], 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onerror = (event) => {
        requestError = event.target?.error || transaction.error || new Error('Could not restore backup')
      }
      transaction.onabort = () => reject(requestError || transaction.error || new Error('Backup restore aborted'))
      const guitars = transaction.objectStore(STORE_NAME)
      guitars.clear()
      for (const guitar of backup.guitars) guitars.put(guitar)
      transaction.objectStore(SETTINGS_STORE_NAME).put(backup.guitarOrder, GUITAR_ORDER_KEY)
    } catch (error) {
      if (transaction) {
        try { transaction.abort() } catch { /* The transaction is already inactive. */ }
      }
      reject(error)
    }
  })
}