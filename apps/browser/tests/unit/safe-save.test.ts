import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SafeWalletFill } from '@ewe/shared'
import { SafeClient } from '../../src/main/safe/client'
import { SafeService } from '../../src/main/safe/service'
import { STEP_TTL_MS, SignupMemory } from '../../src/main/safe/signup'
import { cardOriginOk, type WalletRef, type WalletTarget } from '../../src/main/safe/wallet'
import { SettingsStore } from '../../src/main/storage/settings-store'
import { startFakeSafe, writeFakeCli, type FakeSafe } from '../fake-safed'

const ORIGIN = 'https://shop.example.com'
const CARD = {
  holder: 'Sam Moe',
  number: '4242424242424242',
  expiry: '08/2029',
  security_code: '123',
  pin: '9876',
  brand: 'visa',
}
const ADDRESS = {
  full_name: 'Sam Moe',
  organization: '',
  line1: '12 Main St',
  line2: '',
  city: 'Tbilisi',
  region: '',
  postal_code: '0105',
  country: 'GE',
  phone: '',
  email: 'sam@example.com',
}

let dir = ''
let fake: FakeSafe
let store: SettingsStore
let safe: SafeService
let log = ''
let refuse = ''
let sent: { channel: string; value: unknown }[] = []
let target: WalletTarget | null = null
const env = { ...process.env }

const frame = (origin = ORIGIN): WalletRef => ({
  contentsId: 1,
  processId: 2,
  routingId: 3,
  origin,
})

function cliCalls(): string[][] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as string[])
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ewe-save-'))
  fake = await startFakeSafe(join(dir, 's.sock'))
  log = join(dir, 'cli.log')
  refuse = join(dir, 'refuse')
  process.env.EWE_SAFE_SOCKET = fake.path
  process.env.EWE_FAKE_CLI_LOG = log
  process.env.EWE_FAKE_CLI_REFUSE = refuse
  const cli = writeFakeCli(dir)
  store = new SettingsStore(join(dir, 'profile'))
  sent = []
  target = {
    send: (channel, value) => sent.push({ channel, value }),
    focus: () => undefined,
  }
  safe = new SafeService(
    store,
    new SafeClient(() => fake.path),
    { cli: () => cli, app: () => null },
    () => target,
  )
})

afterEach(async () => {
  await fake.close()
  rmSync(dir, { recursive: true, force: true })
  process.env = { ...env }
})

describe('saving a sign-up', () => {
  it('offers to save a new login and adds it with the host and the username', async () => {
    const id = safe.capture(1, ORIGIN, {
      kind: 'signup',
      username: 'sam@new.test',
      password: 'pw-1',
    })
    if (id === null) throw new Error('no capture')
    expect(await safe.prompt(id)).toEqual({
      promptId: id,
      mode: 'save',
      host: 'shop.example.com',
      username: 'sam@new.test',
      title: 'shop.example.com',
      locked: false,
    })
    expect(await safe.settle(id, 'save')).toEqual({ ok: true, message: 'Saved to Safe' })
    expect(fake.calls.find((c) => c.verb === 'add')?.args).toEqual({
      kind: 'login',
      title: 'shop.example.com',
      url: [ORIGIN],
      username: 'sam@new.test',
      password_value: 'pw-1',
    })
  })

  it('a sign-up without a known username saves a new login, never updates the only one', async () => {
    fake.addLogin('Shop', 'old@shop.test', ORIGIN, 'old-pw')
    const id = safe.capture(1, ORIGIN, { kind: 'signup', username: '', password: 'pw-2' })
    if (id === null) throw new Error('no capture')
    expect((await safe.prompt(id))?.mode).toBe('save')
    expect(fake.calls.some((c) => c.verb === 'reveal')).toBe(false)
    const change = safe.capture(1, ORIGIN, { kind: 'change', username: '', password: 'pw-3' })
    if (change === null) throw new Error('no capture')
    expect((await safe.prompt(change))?.mode).toBe('update')
  })

  it('offers an update when the same host has that username, nothing when it is the same', async () => {
    fake.addLogin('Shop', 'sam', ORIGIN, 'old-pw')
    fake.addLogin('Shop sub', 'sam', 'https://example.com', 'x')
    const update = safe.capture(1, ORIGIN, { kind: 'signup', username: 'Sam', password: 'new' })
    if (update === null) throw new Error('no capture')
    expect(await safe.prompt(update)).toMatchObject({ mode: 'update', title: 'Shop' })
    const same = safe.capture(2, ORIGIN, { kind: 'signup', username: 'sam', password: 'old-pw' })
    if (same === null) throw new Error('no capture')
    expect(await safe.prompt(same)).toBeNull()
  })

  it('a locked Safe still asks, and Unlock and save unlocks then saves', async () => {
    fake.lock()
    const id = safe.capture(1, ORIGIN, { kind: 'signup', username: 'sam', password: 'pw' })
    if (id === null) throw new Error('no capture')
    expect(await safe.prompt(id)).toMatchObject({ mode: 'save', locked: true, username: 'sam' })
    expect(await safe.unlockAndSave(id)).toEqual({
      kind: 'done',
      outcome: { ok: true, message: 'Saved to Safe' },
    })
    expect(fake.locked).toBe(false)
    expect(cliCalls()).toEqual([['unlock', '--ask']])
    expect(fake.items.find((i) => i.username === 'sam')?.password).toBe('pw')
  })

  it('Unlock and save that turns out to be a changed password asks to update', async () => {
    fake.addLogin('Shop', 'sam', ORIGIN, 'old')
    fake.lock()
    const id = safe.capture(1, ORIGIN, { kind: 'login', username: 'sam', password: 'new' })
    if (id === null) throw new Error('no capture')
    expect((await safe.prompt(id))?.locked).toBe(true)
    const next = await safe.unlockAndSave(id)
    expect(next).toMatchObject({ kind: 'prompt', prompt: { mode: 'update', locked: false } })
    expect(await safe.settle(id, 'update')).toEqual({
      ok: true,
      message: 'Password updated in Safe',
    })
  })

  it('a cancelled unlock saves nothing', async () => {
    fake.lock()
    writeFileSync(refuse, '')
    const id = safe.capture(1, ORIGIN, { kind: 'signup', username: 'sam', password: 'pw' })
    if (id === null) throw new Error('no capture')
    expect(await safe.unlockAndSave(id)).toEqual({
      kind: 'done',
      outcome: { ok: false, message: 'Safe is still locked. The login was not saved.' },
    })
    expect(fake.calls.some((c) => c.verb === 'add')).toBe(false)
  })

  it('uses the username typed on an earlier step of the same site in the same tab', async () => {
    safe.rememberUsername(1, 'https://accounts.example.com', 'sam@step.test')
    const id = safe.capture(1, ORIGIN, { kind: 'signup', username: '', password: 'pw' })
    if (id === null) throw new Error('no capture')
    expect((await safe.prompt(id))?.username).toBe('sam@step.test')
    const otherTab = safe.capture(2, ORIGIN, { kind: 'signup', username: '', password: 'pw' })
    const otherSite = safe.capture(1, 'https://other.test', {
      kind: 'signup',
      username: '',
      password: 'pw',
    })
    if (otherTab === null || otherSite === null) throw new Error('no capture')
    expect((await safe.prompt(otherTab))?.username).toBe('')
    expect((await safe.prompt(otherSite))?.username).toBe('')
  })

  it('a strong password Safe made becomes a draft that saves with the username typed later', async () => {
    safe.signup.generated(frame(), 'gen-pw')
    safe.draft(frame(), 'sam', true)
    safe.draft({ ...frame(), origin: 'https://evil.test' }, 'mallory', true)
    const draft = safe.signup.take(1)
    expect(draft).toMatchObject({ username: 'sam', password: 'gen-pw', origin: ORIGIN })
    if (draft === null) throw new Error('no draft')
    const id = safe.captureDraft(draft)
    if (id === null) throw new Error('no capture')
    expect(await safe.prompt(id)).toMatchObject({ mode: 'save', username: 'sam' })
    safe.signup.generated(frame(), 'gen-2')
    safe.capture(1, ORIGIN, { kind: 'signup', username: 'sam', password: 'gen-2' })
    expect(safe.signup.take(1)).toBeNull()
  })

  it('drops the capture when Safe is not there and when saving is off', async () => {
    const id = safe.capture(1, ORIGIN, { kind: 'signup', username: 'sam', password: 'pw' })
    if (id === null) throw new Error('no capture')
    await fake.close()
    expect(await safe.prompt(id)).toBeNull()
    store.update({ safe: { ...DEFAULT_SETTINGS.safe, offerSave: false } })
    expect(safe.capture(1, ORIGIN, { kind: 'signup', username: 'sam', password: 'pw' })).toBeNull()
  })
})

describe('SignupMemory', () => {
  it('forgets a step after five minutes', () => {
    let now = 1_000
    const memory = new SignupMemory(() => now)
    memory.rememberUsername(1, 'https://a.example.com', 'sam')
    expect(memory.usernameFor(1, 'https://b.example.com')).toBe('sam')
    now += STEP_TTL_MS + 1
    expect(memory.usernameFor(1, 'https://a.example.com')).toBe('')
  })
})

describe('cards and addresses', () => {
  const fills = () =>
    sent.filter((s) => s.channel === 'ewe:safe-wallet-fill').map((s) => s.value as SafeWalletFill)

  it('lists cards by brand, last 4 and expiry, never the number', async () => {
    fake.addCard('Visa •• 4242', CARD)
    fake.addAddress('Home', ADDRESS)
    const menu = await safe.wallet.menu(frame(), 'card')
    expect(menu.state).toBe('ready')
    expect(menu.cards).toEqual([
      {
        id: menu.cards?.[0]?.id,
        title: 'Visa •• 4242',
        brand: 'visa',
        last4: '4242',
        expiry: '08/2029',
        holder: 'Sam Moe',
      },
    ])
    expect(JSON.stringify(menu)).not.toContain(CARD.number)
    const addresses = await safe.wallet.menu(frame(), 'address')
    expect(addresses.addresses?.map((a) => a.title)).toEqual(['Home'])
  })

  it('confirm-needed asks through ewe-safe confirm, then fills; a second fill needs no confirm', async () => {
    const card = fake.addCard('Visa •• 4242', CARD)
    const menu = await safe.wallet.menu(frame(), 'card')
    expect(await safe.choose(menu.requestId, card.id)).toBeNull()
    expect(cliCalls()).toEqual([
      ['confirm', '--ask', '--reason', 'Fill Visa •• 4242 on shop.example.com'],
    ])
    expect(fills()).toEqual([
      {
        kind: 'card',
        card: {
          holder: 'Sam Moe',
          number: '4242424242424242',
          expiryMonth: '08',
          expiryYear: '2029',
          securityCode: '123',
          brand: 'visa',
        },
      },
    ])
    expect(JSON.stringify(fills())).not.toContain(CARD.pin)
    const again = await safe.wallet.menu(frame(), 'card')
    expect(await safe.choose(again.requestId, card.id)).toBeNull()
    expect(cliCalls()).toHaveLength(1)
    expect(fills()).toHaveLength(2)
  })

  it('a refused confirm fills nothing', async () => {
    const card = fake.addCard('Visa •• 4242', CARD)
    writeFileSync(refuse, '')
    const menu = await safe.wallet.menu(frame(), 'card')
    expect(await safe.choose(menu.requestId, card.id)).toEqual({
      ok: false,
      message: 'Safe did not fill the card.',
    })
    expect(fills()).toEqual([])
  })

  it('never offers or fills a card on an http page, localhost aside', async () => {
    const card = fake.addCard('Visa •• 4242', CARD)
    const menu = await safe.wallet.menu(frame('http://shop.example.com'), 'card')
    expect(menu).toMatchObject({ state: 'empty', insecure: true, cards: [] })
    expect(await safe.choose(menu.requestId, card.id)).toMatchObject({ ok: false })
    expect(fake.calls.some((c) => c.verb === 'fields' || c.verb === 'list')).toBe(false)
    expect(cardOriginOk('http://localhost:8080')).toBe(true)
    expect(cardOriginOk('http://127.0.0.1:8080')).toBe(false)
    expect(cardOriginOk('http://shop.localhost')).toBe(true)
  })

  it('re-checks the frame before filling: a frame that changed gets nothing', async () => {
    const card = fake.addCard('Visa •• 4242', CARD)
    fake.confirmCards = false
    const menu = await safe.wallet.menu(frame(), 'card')
    target = null
    expect(await safe.choose(menu.requestId, card.id)).toEqual({
      ok: false,
      message: 'The page changed. Try again.',
    })
    expect(fills()).toEqual([])
  })

  it('fills an address without a confirm; only offered items fill', async () => {
    const home = fake.addAddress('Home', ADDRESS)
    const card = fake.addCard('Visa •• 4242', CARD)
    const menu = await safe.wallet.menu(frame(), 'address')
    expect(await safe.choose(menu.requestId, card.id)).toMatchObject({ ok: false })
    const again = await safe.wallet.menu(frame(), 'address')
    expect(await safe.choose(again.requestId, home.id)).toBeNull()
    expect(fills()).toEqual([
      {
        kind: 'address',
        address: expect.objectContaining({
          fullName: 'Sam Moe',
          givenName: 'Sam',
          familyName: 'Moe',
          line1: '12 Main St',
          country: 'GE',
        }) as unknown,
      },
    ])
    expect(cliCalls()).toEqual([])
  })

  it('respects Fill cards and Fill addresses in Settings', async () => {
    fake.addCard('Visa •• 4242', CARD)
    store.update({ safe: { ...DEFAULT_SETTINGS.safe, fillCards: false } })
    expect((await safe.wallet.menu(frame(), 'card')).state).toBe('unavailable')
    expect(safe.pageState()).toMatchObject({ cards: false, addresses: true })
  })
})
