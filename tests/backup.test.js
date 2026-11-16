import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { exportBackup, loadGuitars, loadGuitarOrder, restoreBackup, saveGuitar, saveGuitarOrder, validateBackup } from '../src/storage.js'

const guitar = (id, model = id) => ({
  id, make: 'Test', model, serial: '123', specs: 'notes',
  photo: 'data:image/png;base64,abc', setup: { action: '1.5 mm' },
  stringChanges: [{ date: '2026-11-16', brand: 'Test', gauge: '10' }],
})
const backup = (guitars = [], guitarOrder = []) => ({
  format: 'guitarkeeper-backup', version: 1, exportedAt: '2026-11-16T00:00:00.000Z', guitars, guitarOrder,
})

beforeEach(async () => { await restoreBackup(backup()) })

test('export and restore round trip guitars, photos, history and order', async () => {
  await saveGuitar(guitar('a'))
  await saveGuitar(guitar('b'))
  await saveGuitarOrder(['b', 'deleted', 'a'])
  const exported = JSON.parse(JSON.stringify(await exportBackup()))
  assert.deepEqual(exported.guitarOrder, ['b', 'a'])
  assert.deepEqual(exported.guitars, [guitar('a'), guitar('b')])
  await restoreBackup(backup([guitar('other')]))
  await restoreBackup(exported)
  assert.deepEqual(await loadGuitars(), [guitar('a'), guitar('b')])
  assert.deepEqual(await loadGuitarOrder(), ['b', 'a'])
})

test('invalid backups never replace existing data', async () => {
  await saveGuitar(guitar('existing'))
  await saveGuitarOrder(['existing'])
  const invalid = [
    {},
    { ...backup(), version: 2 },
    backup([guitar('a'), guitar('a')]),
    backup([guitar('a')], ['missing']),
    backup([guitar('a')], ['a', 'a']),
    backup([{ ...guitar('a'), stringChanges: [null] }]),
    backup([{ ...guitar('a'), photo: 'https://example.com/image' }]),
  ]
  for (const value of invalid) {
    assert.throws(() => validateBackup(value))
    await assert.rejects(restoreBackup(value))
    assert.deepEqual(await loadGuitars(), [guitar('existing')])
    assert.deepEqual(await loadGuitarOrder(), ['existing'])
  }
})

test('empty backup explicitly replaces collection', async () => {
  await saveGuitar(guitar('existing'))
  await saveGuitarOrder(['existing'])
  await restoreBackup(backup())
  assert.deepEqual(await loadGuitars(), [])
  assert.deepEqual(await loadGuitarOrder(), [])
})
