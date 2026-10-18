import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SafeAddressFill, SafeCardFill } from '@ewe/shared'
import type * as Forms from '../../src/preload/safe/forms'
import type * as Wallet from '../../src/preload/safe/wallet'

let forms: typeof Forms
let wallet: typeof Wallet
const window = new Window({ url: 'https://shop.example.com/checkout' })
const document = window.document as unknown as Document

beforeAll(async () => {
  Object.assign(globalThis, {
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event,
  })
  forms = await import('../../src/preload/safe/forms')
  wallet = await import('../../src/preload/safe/wallet')
})

const visible = (el: HTMLElement) => !el.hidden && el.style.display !== 'none'

function page(html: string): Document {
  document.body.innerHTML = html
  return document
}

function find(selector: string): Element {
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`no ${selector}`)
  return found
}

const el = (selector: string) => find(selector) as HTMLInputElement
const value = (selector: string) => (find(selector) as HTMLInputElement | HTMLSelectElement).value

const CARD: SafeCardFill = {
  holder: 'Sam Q Moe',
  number: '4242424242424242',
  expiryMonth: '08',
  expiryYear: '2029',
  securityCode: '123',
  brand: 'visa',
}

const ADDRESS: SafeAddressFill = {
  fullName: 'Sam Moe',
  givenName: 'Sam',
  familyName: 'Moe',
  organization: 'Moe Ltd',
  line1: '12 Main St',
  line2: 'Flat 3',
  city: 'Tbilisi',
  region: 'Tbilisi',
  postalCode: '0105',
  country: 'GE',
  phone: '+995 555 000 000',
  email: 'sam@example.com',
}

describe('detection', () => {
  it('reads cc-* and address autocomplete tokens, with sections and billing/shipping', () => {
    page(`<form>
      <input id="num" autocomplete="section-pay billing cc-number">
      <input id="exp" autocomplete="cc-exp"><input id="csc" autocomplete="cc-csc">
      <input id="ship" autocomplete="shipping address-line1"></form>`)
    expect(wallet.walletFieldOf(el('#num'))).toMatchObject({
      kind: 'card',
      part: 'number',
      section: 'section-pay billing',
      auto: true,
    })
    expect(wallet.walletFieldOf(el('#csc'))).toMatchObject({ kind: 'card', part: 'csc' })
    expect(wallet.walletFieldOf(el('#ship'))).toMatchObject({
      kind: 'address',
      part: 'line1',
      section: 'shipping',
    })
  })

  it('knows common names and labels when there is no autocomplete', () => {
    page(`<form>
      <label for="a">Name on card</label><input id="a">
      <input id="b" name="cardNumber"><input id="c" name="expMonth">
      <input id="d" name="exp_year"><input id="e" name="cvv"><input id="f" placeholder="MM / YY">
      <input id="g" name="zip_code"><input id="h" name="billingCity">
      <input id="i" name="street"><select id="j" name="country"></select></form>`)
    const part = (s: string) => wallet.walletFieldOf(el(s))?.part
    expect(['#a', '#b', '#c', '#d', '#e', '#f'].map(part)).toEqual([
      'name',
      'number',
      'exp-month',
      'exp-year',
      'csc',
      'exp',
    ])
    expect(['#g', '#h', '#i', '#j'].map(part)).toEqual(['postal', 'city', 'line1', 'country'])
  })

  it('opens the address list only on real address forms', () => {
    page(`<form><input id="u" type="email" autocomplete="email"><input type="password"></form>`)
    expect(wallet.walletKindOf(el('#u'), visible)).toBeNull()
    page(`<form><input id="n" name="fullname"><input id="m" type="email"><input type="tel">
      </form>`)
    expect(wallet.walletKindOf(el('#n'), visible)).toBeNull()
    page(`<form><input id="n" autocomplete="name"><input id="l" autocomplete="address-line1">
      </form>`)
    expect(wallet.walletKindOf(el('#n'), visible)).toBe('address')
    page(`<form><input id="n" name="first_name"><input id="s" name="street">
      <input id="z" name="zip"></form>`)
    expect(wallet.walletKindOf(el('#n'), visible)).toBe('address')
    page(`<form><input id="n" name="first_name"><select id="st" name="state"></select></form>`)
    expect(wallet.walletKindOf(el('#n'), visible)).toBeNull()
  })

  it('opens the card list on card fields, also alone in a payment frame', () => {
    page(`<input id="only" autocomplete="cc-number" inputmode="numeric">`)
    expect(wallet.walletKindOf(el('#only'), visible)).toBe('card')
    page(`<input id="cvc" name="cvc">`)
    expect(wallet.walletKindOf(el('#cvc'), visible)).toBeNull()
    page(`<form><input id="num" name="card_number"><input id="cvc" name="cvc"></form>`)
    expect(wallet.walletKindOf(el('#cvc'), visible)).toBe('card')
  })
})

describe('card fill', () => {
  it('fills a whole card form, keeps maxlength and leaves the PIN out', () => {
    page(`<form>
      <input id="name" autocomplete="cc-name"><input id="num" autocomplete="cc-number" maxlength="19">
      <input id="exp" autocomplete="cc-exp" placeholder="MM / YY">
      <input id="csc" autocomplete="cc-csc" maxlength="4">
      <select id="type" autocomplete="cc-type"><option value="">Brand</option>
        <option value="MC">Mastercard</option><option value="VI">Visa</option></select>
      </form>`)
    const filled = wallet.fillCard(el('#num'), CARD, visible)
    expect(filled).toBe(5)
    expect(value('#name')).toBe('Sam Q Moe')
    expect(value('#num')).toBe('4242424242424242')
    expect(value('#exp')).toBe('08 / 29')
    expect(value('#csc')).toBe('123')
    expect(value('#type')).toBe('VI')
  })

  it('writes the expiry the way the field wants it', () => {
    const exp = (attrs: string) => {
      page(`<input id="n" autocomplete="cc-number"><input id="e" autocomplete="cc-exp" ${attrs}>`)
      return wallet.expiryText(el('#e'), '08', '2029')
    }
    expect(exp('placeholder="MM/YY"')).toBe('08/29')
    expect(exp('placeholder="MM/YYYY"')).toBe('08/2029')
    expect(exp('placeholder="MMYY"')).toBe('0829')
    expect(exp('maxlength="4"')).toBe('0829')
    expect(exp('maxlength="7"')).toBe('08/2029')
    expect(exp('maxlength="6"')).toBe('082029')
    expect(exp('placeholder="MM / YY" maxlength="5"')).toBe('08/29')
    expect(exp('')).toBe('08/29')
    expect(exp('type="month"')).toBe('2029-08')
  })

  it('fills separate month and year selects and a two-digit year field', () => {
    page(`<form><input id="num" autocomplete="cc-number">
      <select id="m" autocomplete="cc-exp-month"><option value="">Month</option>
        <option value="1">01 - January</option><option value="8">08 - August</option></select>
      <select id="y" autocomplete="cc-exp-year"><option>2028</option><option>2029</option></select>
      </form>`)
    wallet.fillCard(el('#num'), CARD, visible)
    expect(value('#m')).toBe('8')
    expect(value('#y')).toBe('2029')
    page(`<form><input id="num" autocomplete="cc-number">
      <select id="m" name="exp_month"><option value="jan">Jan</option><option value="aug">Aug</option>
      </select><input id="y" name="exp_year" maxlength="2"></form>`)
    wallet.fillCard(el('#num'), CARD, visible)
    expect(value('#m')).toBe('aug')
    expect(value('#y')).toBe('29')
  })

  it('splits a number over four boxes', () => {
    page(
      `<form>${[1, 2, 3, 4]
        .map((i) => `<input id="n${String(i)}" autocomplete="cc-number" maxlength="4">`)
        .join('')}</form>`,
    )
    wallet.fillCard(el('#n1'), CARD, visible)
    expect(['#n1', '#n2', '#n3', '#n4'].map(value)).toEqual(['4242', '4242', '4242', '4242'])
  })

  it('in a payment frame fills only the fields that frame has', () => {
    page(`<input id="num" autocomplete="cc-number" placeholder="1234 1234 1234 1234">`)
    expect(wallet.fillCard(el('#num'), CARD, visible)).toBe(1)
    expect(value('#num')).toBe('4242 4242 4242 4242')
  })

  it('does not overwrite what the user typed, except the field it was picked in', () => {
    page(`<form><input id="name" autocomplete="cc-name" value="S. Moe">
      <input id="num" autocomplete="cc-number" value="4">
      <input id="csc" autocomplete="cc-csc"></form>`)
    wallet.fillCard(el('#num'), CARD, visible)
    expect(value('#name')).toBe('S. Moe')
    expect(value('#num')).toBe('4242424242424242')
    expect(value('#csc')).toBe('123')
  })
})

describe('address fill', () => {
  it('fills the related fields, country and region selects, maxlength', () => {
    page(`<form>
      <input id="g" autocomplete="given-name"><input id="f" autocomplete="family-name">
      <input id="o" autocomplete="organization">
      <input id="l1" autocomplete="address-line1"><input id="l2" autocomplete="address-line2">
      <input id="c" autocomplete="address-level2">
      <select id="r" autocomplete="address-level1"><option value="">Region</option>
        <option value="AJ">Adjara</option><option value="TB">Tbilisi</option></select>
      <input id="z" autocomplete="postal-code" maxlength="3">
      <select id="co" autocomplete="country"><option value="DE">Germany</option>
        <option value="GE">Georgia</option></select>
      <input id="t" autocomplete="tel"><input id="e" autocomplete="email">
      <input id="ship" autocomplete="shipping address-line1"></form>`)
    wallet.fillAddress(el('#l1'), ADDRESS, visible)
    expect(
      ['#g', '#f', '#o', '#l1', '#l2', '#c', '#r', '#z', '#co', '#t', '#e'].map(value),
    ).toEqual([
      'Sam',
      'Moe',
      'Moe Ltd',
      '12 Main St',
      'Flat 3',
      'Tbilisi',
      'TB',
      '010',
      'GE',
      '+995 555 000 000',
      'sam@example.com',
    ])
    expect(value('#ship')).toBe('')
  })

  it('matches a country select by name and writes a street textarea and a name field', () => {
    page(`<form><input id="n" autocomplete="name">
      <textarea id="s" autocomplete="street-address"></textarea>
      <select id="co" name="country"><option value="">Choose</option>
        <option value="276">Germany</option><option value="268">Georgia</option></select>
      <input id="cn" autocomplete="country-name"><input id="cc" autocomplete="country"
      maxlength="2"></form>`)
    wallet.fillAddress(el('#n'), ADDRESS, visible)
    expect(value('#n')).toBe('Sam Moe')
    expect((find('#s') as HTMLTextAreaElement).value).toBe('12 Main St\nFlat 3')
    expect(value('#co')).toBe('268')
    expect(value('#cn')).toBe('Georgia')
    expect(value('#cc')).toBe('GE')
  })

  it('splits a full name when Safe has no given and family names', () => {
    page(`<form><input id="g" name="first_name"><input id="f" name="last_name">
      <input id="s" name="street"><input id="z" name="zip"></form>`)
    wallet.fillAddress(el('#s'), { ...ADDRESS, givenName: '', familyName: '' }, visible)
    expect([value('#g'), value('#f')]).toEqual(['Sam', 'Moe'])
  })

  it('never touches the password or login fields of the page', () => {
    page(`<form><input id="l1" autocomplete="address-line1"><input id="c"
      autocomplete="address-level2"><input id="p" type="password" autocomplete="email"></form>`)
    wallet.fillAddress(el('#l1'), ADDRESS, visible)
    expect(value('#p')).toBe('')
    expect(forms.passwordsIn(document, visible)).toHaveLength(1)
  })
})
