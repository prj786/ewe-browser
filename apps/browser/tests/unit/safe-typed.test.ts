import { Window } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Captured } from '../../src/preload/safe/forms'
import type * as Typed from '../../src/preload/safe/typed'

let typed: typeof Typed
const window = new Window({ url: 'https://spa.example.com/signup' })
const document = window.document as unknown as Document
const saved = { window: globalThis.window, document: globalThis.document }

beforeAll(async () => {
  Object.assign(globalThis, {
    window,
    document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    MutationObserver: window.MutationObserver,
    Event: window.Event,
  })
  typed = await import('../../src/preload/safe/typed')
})

afterAll(() => {
  Object.assign(globalThis, saved)
})

const visible = (el: HTMLElement) => el.isConnected && !el.hidden && el.style.display !== 'none'

function setup(): {
  watch: Typed.TypedWatch
  captures: Captured[]
  drafts: [string, boolean][]
} {
  document.body.innerHTML = `<div id="box"><input id="u" type="email">
    <input id="p" type="password" autocomplete="new-password"></div>`
  const captures: Captured[] = []
  const drafts: [string, boolean][] = []
  const watch = new typed.TypedWatch({
    visible,
    capture: (found) => captures.push(found),
    draft: (username, keep) => drafts.push([username, keep]),
  })
  watch.install()
  return { watch, captures, drafts }
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TypedWatch', () => {
  it('captures when the typed password field leaves the page', async () => {
    const { watch, captures } = setup()
    field('u').value = 'sam@spa.test'
    field('p').value = 'pw-typed'
    watch.input(field('p'))
    document.getElementById('box')?.remove()
    await wait(200)
    expect(captures).toEqual([{ kind: 'signup', username: 'sam@spa.test', password: 'pw-typed' }])
    watch.clear()
  })

  it('captures on an in-page navigation and only once', async () => {
    const { watch, captures } = setup()
    field('u').value = 'sam@spa.test'
    field('p').value = 'pw-nav'
    watch.input(field('p'))
    window.dispatchEvent(new window.Event('popstate'))
    window.dispatchEvent(new window.Event('hashchange'))
    await wait(50)
    expect(captures).toHaveLength(1)
    watch.clear()
  })

  it('a generated password reports the username as a draft and drops it once changed', async () => {
    const { watch, drafts, captures } = setup()
    field('p').value = 'gen-pw'
    watch.generated(field('p'), 'gen-pw')
    field('u').value = 'sam'
    watch.input(field('u'))
    await wait(500)
    expect(drafts).toEqual([
      ['', true],
      ['sam', true],
    ])
    field('p').value = 'gen-pw-edited'
    watch.input(field('p'))
    expect(drafts.at(-1)).toEqual(['', false])
    window.dispatchEvent(new window.Event('pagehide'))
    expect(captures).toEqual([{ kind: 'signup', username: 'sam', password: 'gen-pw-edited' }])
    watch.clear()
  })

  it('a generated password is left to the browser on page hide, only the draft goes', () => {
    const { watch, drafts, captures } = setup()
    field('u').value = 'sam'
    field('p').value = 'gen-pw'
    watch.generated(field('p'), 'gen-pw')
    window.dispatchEvent(new window.Event('pagehide'))
    expect(captures).toEqual([])
    expect(drafts.at(-1)).toEqual(['sam', true])
    watch.clear()
  })
})
