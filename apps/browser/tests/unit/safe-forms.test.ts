import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import type * as Forms from '../../src/preload/safe/forms'

let forms: typeof Forms
const window = new Window({ url: 'https://example.com/login' })
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

function page(html: string): Document {
  document.body.innerHTML = html
  return document
}

const input = (doc: Document, selector: string): HTMLInputElement => {
  const el = doc.querySelector(selector)
  if (el === null) throw new Error(`no ${selector}`)
  return el as HTMLInputElement
}

describe('classify', () => {
  it('finds a plain login form', () => {
    const doc = page(`<form><input id="u" name="email" type="email"><input id="p" type="password">
      <button>Sign in</button></form>`)
    expect(forms.classify(input(doc, '#u'), visible)).toBe('login')
    expect(forms.classify(input(doc, '#p'), visible)).toBe('login')
  })

  it('uses autocomplete hints first', () => {
    const doc = page(`<form><input id="u" autocomplete="username"><input id="n" type="password"
      autocomplete="new-password"></form>`)
    expect(forms.classify(input(doc, '#u'), visible)).toBe('login')
    expect(forms.classify(input(doc, '#n'), visible)).toBe('new-password')
  })

  it('treats two password fields as a sign-up and three as a change', () => {
    const signup = page(`<form><input id="u" name="user"><input id="a" type="password">
      <input id="b" type="password"></form>`)
    expect(forms.classify(input(signup, '#a'), visible)).toBe('new-password')
    expect(forms.classify(input(signup, '#b'), visible)).toBe('new-password')
    const change = page(`<form><input id="c" type="password"><input id="n" type="password">
      <input id="r" type="password"></form>`)
    expect(forms.classify(input(change, '#c'), visible)).toBe('login')
    expect(forms.classify(input(change, '#n'), visible)).toBe('new-password')
    expect(forms.classify(input(change, '#r'), visible)).toBe('new-password')
  })

  it('reads a single password as new on a register form', () => {
    const doc = page(`<form id="register"><input name="email"><input id="p" type="password">
      <button>Create account</button></form>`)
    expect(forms.classify(input(doc, '#p'), visible)).toBe('new-password')
  })

  it('finds one-time code fields', () => {
    const doc = page(`<input id="a" autocomplete="one-time-code">
      <input id="b" name="otp" maxlength="6"><input id="c" name="totp_code" type="tel">`)
    expect(forms.classify(input(doc, '#a'), visible)).toBe('otp')
    expect(forms.classify(input(doc, '#b'), visible)).toBe('otp')
    expect(forms.classify(input(doc, '#c'), visible)).toBe('otp')
  })

  it('leaves search boxes, unrelated and hidden fields alone', () => {
    const doc = page(`<input id="s" type="search" name="q"><input id="t" name="city">
      <form><input id="h" name="user" style="display:none"><input id="p" type="password"></form>`)
    expect(forms.classify(input(doc, '#s'), visible)).toBeNull()
    expect(forms.classify(input(doc, '#t'), visible)).toBeNull()
    expect(forms.usernameFor(input(doc, '#p'), visible)).toBeNull()
  })

  it('does not take a field after the password as the username', () => {
    const doc = page(`<form><input id="p" type="password"><input id="after" name="user"></form>`)
    expect(forms.classify(input(doc, '#after'), visible)).toBeNull()
  })
})

describe('field pairing', () => {
  it('pairs the username before the password, preferring hinted fields', () => {
    const doc = page(`<form><input id="name" name="fullname"><input id="mail" name="email">
      <input id="p" type="password"></form>`)
    expect(forms.loginFields(input(doc, '#p'), visible)).toEqual({
      username: input(doc, '#mail'),
      password: input(doc, '#p'),
    })
    expect(forms.loginFields(input(doc, '#mail'), visible).password).toBe(input(doc, '#p'))
  })

  it('works without a form element', () => {
    const doc = page(`<div><input id="u" name="login"><input id="p" type="password"></div>`)
    expect(forms.loginFields(input(doc, '#u'), visible).password).toBe(input(doc, '#p'))
  })

  it('fills every new-password field together', () => {
    const doc = page(`<form><input id="c" type="password"><input id="n" type="password">
      <input id="r" type="password"></form>`)
    expect(forms.newPasswordFields(input(doc, '#n'), visible).map((el) => el.id)).toEqual([
      'n',
      'r',
    ])
  })

  it('splits a code over one-digit boxes', () => {
    const doc = page(`<div class="otp"><span><input id="d1" maxlength="1" name="code1"></span>
      <span><input id="d2" maxlength="1"></span><span><input id="d3" maxlength="1"></span></div>`)
    const boxes = forms.otpFields(input(doc, '#d1'), visible)
    expect(boxes.map((el) => el.id)).toEqual(['d1', 'd2', 'd3'])
    forms.fillOtp(boxes, '482')
    expect(boxes.map((el) => el.value)).toEqual(['4', '8', '2'])
  })
})

describe('setFieldValue', () => {
  it('sets the value and fires input and change', () => {
    const doc = page(`<input id="u">`)
    const el = input(doc, '#u')
    const seen: string[] = []
    el.addEventListener('input', () => seen.push(`input:${el.value}`))
    el.addEventListener('change', () => seen.push(`change:${el.value}`))
    forms.setFieldValue(el, 'sam')
    expect(seen).toEqual(['input:sam', 'change:sam'])
  })
})

describe('captureFrom', () => {
  it('captures a sign-in', () => {
    const doc = page(`<form><input id="u" name="email"><input id="p" type="password"></form>`)
    input(doc, '#u').value = ' sam@example.com '
    input(doc, '#p').value = 'hunter2!'
    expect(forms.captureFrom(doc, visible)).toEqual({
      kind: 'login',
      username: 'sam@example.com',
      password: 'hunter2!',
    })
  })

  it('captures the new password of a change form', () => {
    const doc = page(`<form><input id="u" name="user"><input id="c" type="password">
      <input id="n" type="password"><input id="r" type="password"></form>`)
    input(doc, '#u').value = 'sam'
    input(doc, '#c').value = 'old'
    input(doc, '#n').value = 'new-one'
    input(doc, '#r').value = 'new-one'
    expect(forms.captureFrom(doc, visible)).toEqual({
      kind: 'new-password',
      username: 'sam',
      password: 'new-one',
    })
  })

  it('captures nothing without a typed password', () => {
    const doc = page(`<form><input id="u" name="user"><input id="p" type="password"></form>`)
    input(doc, '#u').value = 'sam'
    expect(forms.captureFrom(doc, visible)).toBeNull()
  })
})
