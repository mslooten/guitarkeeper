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