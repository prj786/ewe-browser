import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import type * as Forms from '../../src/preload/safe/forms'

let forms: typeof Forms
const window = new Window({ url: 'https://shop.example.com/register' })
const document = window.document as unknown as Document

beforeAll(async () => {
  Object.assign(globalThis, {
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
  })
  forms = await import('../../src/preload/safe/forms')
})

const visible = (el: HTMLElement) => !el.hidden && el.style.display !== 'none'

function page(html: string, title = ''): Document {
  document.title = title
  document.body.innerHTML = html
  return document
}

const input = (doc: Document, selector: string): HTMLInputElement => {
  const el = doc.querySelector(selector)
  if (el === null) throw new Error(`no ${selector}`)
  return el as HTMLInputElement
}

function type(doc: Document, values: Record<string, string>): void {
  for (const [selector, value] of Object.entries(values)) input(doc, selector).value = value
}

describe('sign-up capture', () => {
  it('a form with a confirm field is a sign-up with the email as the username', () => {
    const doc = page(`<form><input id="first" name="first_name"><input id="last" name="last_name">
      <input id="mail" type="email" name="email"><input id="p" type="password">
      <input id="c" type="password"><button>Create account</button></form>`)
    type(doc, {
      '#first': 'Sam',
      '#last': 'Moe',
      '#mail': 'sam@new.test',
      '#p': 'pw1',
      '#c': 'pw1',
    })
    expect(forms.captureFrom(doc, visible)).toEqual({
      kind: 'signup',
      username: 'sam@new.test',
      password: 'pw1',
    })
  })

  it('takes autocomplete=username over an email field, and email over a plain text field', () => {
    const both = page(`<form><input id="u" name="handle" autocomplete="username">
      <input id="m" type="email" name="email"><input id="p" type="password"
      autocomplete="new-password"></form>`)
    type(both, { '#u': 'sammy', '#m': 'sam@new.test', '#p': 'pw' })
    expect(forms.captureFrom(both, visible)?.username).toBe('sammy')
    const plain = page(`<form><input id="n" name="nick"><input id="m" type="email" name="contact">
      <input id="p" type="password" autocomplete="new-password"></form>`)
    type(plain, { '#n': 'Sam', '#m': 'sam@new.test', '#p': 'pw' })
    expect(forms.captureFrom(plain, visible)?.username).toBe('sam@new.test')
  })

  it('a single new password with Sign up words is a sign-up', () => {
    const doc = page(`<form action="/signup"><input id="u" name="login"><input id="p"
      type="password"><button>Sign up</button></form>`)
    type(doc, { '#u': 'sam', '#p': 'pw' })
    expect(forms.captureFrom(doc, visible)).toMatchObject({ kind: 'signup', username: 'sam' })
  })

  it('a form without a <form> element uses the page headings and buttons', () => {
    const doc = page(
      `<h1>Create your account</h1><div><input id="u" name="email" type="email">
      <input id="p" type="password" autocomplete="new-password">
      <input id="c" type="password" autocomplete="new-password"><div role="button">Go</div></div>`,
      'Join us',
    )
    type(doc, { '#u': 'sam@spa.test', '#p': 'pw', '#c': 'pw' })
    expect(forms.captureFrom(doc, visible)).toEqual({
      kind: 'signup',
      username: 'sam@spa.test',
      password: 'pw',
    })
  })

  it('a step with only new passwords is a sign-up when the page says so, else a reset', () => {
    const signup = page(`<form id="register"><input id="p" type="password"
      autocomplete="new-password"><input id="c" type="password"><button>Create account</button>
      </form>`)
    type(signup, { '#p': 'pw', '#c': 'pw' })
    expect(forms.captureFrom(signup, visible)).toEqual({
      kind: 'signup',
      username: '',
      password: 'pw',
    })
    const reset = page(`<form id="reset"><input id="p" type="password" autocomplete="new-password">
      <input id="c" type="password"><button>Set password</button></form>`)
    type(reset, { '#p': 'pw', '#c': 'pw' })
    expect(forms.captureFrom(reset, visible)?.kind).toBe('change')
  })

  it('a current password makes it a change', () => {
    const doc = page(`<form><input id="o" type="password" autocomplete="current-password">
      <input id="n" type="password" autocomplete="new-password"></form>`)
    type(doc, { '#o': 'old', '#n': 'new' })
    expect(forms.captureFrom(doc, visible)).toMatchObject({ kind: 'change', password: 'new' })
  })

  it('reads a hidden or read-only username the site keeps on the password step', () => {
    const doc = page(`<form><input type="hidden" autocomplete="username" value="sam@step.test">
      <input id="p" type="password" autocomplete="new-password"><button>Next</button></form>`)
    type(doc, { '#p': 'pw' })
    expect(forms.captureFrom(doc, visible)).toMatchObject({ username: 'sam@step.test' })
  })

  it('never takes a card security code for a password', () => {
    const doc = page(`<form><input id="n" autocomplete="cc-number"><input id="cvc" type="password"
      name="cvc" maxlength="4"><input id="cvv" type="password" placeholder="Security code"
      maxlength="3"></form>`)
    type(doc, { '#n': '4242424242424242', '#cvc': '123', '#cvv': '123' })
    expect(forms.passwordsIn(doc, visible)).toEqual([])
    expect(forms.captureFrom(doc, visible)).toBeNull()
    expect(forms.isCardCodeField(input(doc, '#cvc'))).toBe(true)
  })

  it('keeps the element references so a field that left the page can still be read', () => {
    const doc = page(`<div id="box"><input id="u" type="email"><input id="p" type="password"
      autocomplete="new-password"></div>`)
    type(doc, { '#u': 'sam@spa.test', '#p': 'pw' })
    const targets = forms.captureTargets(doc, visible)
    if (targets === null) throw new Error('no targets')
    doc.getElementById('box')?.remove()
    expect(forms.readCapture(targets)).toEqual({
      kind: 'signup',
      username: 'sam@spa.test',
      password: 'pw',
    })
  })
})

describe('stepUsername', () => {
  it('finds the username of a username-only step', () => {
    const doc = page(`<form><input id="u" type="email" name="identifier"><button>Next</button>
      </form>`)
    type(doc, { '#u': ' sam@step.test ' })
    expect(forms.stepUsername(doc.querySelector('form') ?? doc, visible)).toBe('sam@step.test')
  })

  it('ignores searches, forms with passwords and long forms', () => {
    const search = page(`<form><input id="q" name="q"><button>Search</button></form>`)
    type(search, { '#q': 'shoes' })
    expect(forms.stepUsername(search, visible)).toBeNull()
    const login = page(`<form><input id="u" type="email"><input id="p" type="password"></form>`)
    type(login, { '#u': 'sam@step.test' })
    expect(forms.stepUsername(login, visible)).toBeNull()
    const long = page(`<form><input id="a" type="email"><input id="b"><input id="c">
      <input id="d"></form>`)
    type(long, { '#a': 'sam@step.test', '#b': 'x', '#c': 'y', '#d': 'z' })
    expect(forms.stepUsername(long, visible)).toBeNull()
  })
})
