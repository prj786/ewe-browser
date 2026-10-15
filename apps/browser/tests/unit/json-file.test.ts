import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJson, staleTemp } from '../../src/main/storage/json-file'

describe('atomic json files', () => {
  it('recognizes temp files that a killed process left behind', () => {
    expect(staleTemp('history.json', 'history.json.4242.7.tmp', 1)).toBe(true)
    expect(staleTemp('history.json', 'history.json.1.7.tmp', 1)).toBe(false)
    expect(staleTemp('history.json', 'history.json.bak', 1)).toBe(false)
    expect(staleTemp('history.json', 'other.json.4242.7.tmp', 1)).toBe(false)
    expect(staleTemp('history.json', 'history.json.x.7.tmp', 1)).toBe(false)
  })

  it('removes only its own temps that are old enough to be leftovers when it loads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-json-'))
    const file = join(dir, 'history.json')
    const old = new Date(Date.now() - 5 * 60_000)
    const temp = (name: string, aged: boolean): string => {
      const path = join(dir, name)
      writeFileSync(path, '{')
      if (aged) utimesSync(path, old, old)
      return path
    }
    writeFileSync(file, '{"ok":true}')
    const leftover = temp('history.json.4242.3.tmp', true)
    const inFlight = temp('history.json.4343.1.tmp', false)
    const own = temp(`history.json.${process.pid}.1.tmp`, true)
    const other = temp('session.json.4242.3.tmp', true)
    const value = await readJson(file, (v): v is { ok: boolean } => typeof v === 'object')
    expect(value).toEqual({ ok: true })
    expect(existsSync(leftover)).toBe(false)
    expect(existsSync(inFlight)).toBe(true)
    expect(existsSync(own)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })
})
