import type { WebContents } from 'electron'
import type { FindResult, OverlayPart, Size } from '@ewe/shared'
import type { OverlayController } from './overlay'

export const FIND_SELECTION_MAX = 200
const OWN_FIND = /^app:\/\/(files|music|history)\//

export function ownsFind(url: string): boolean {
  return OWN_FIND.test(url)
}
const SELECTION_WORLD = 1011
const SELECTION_SCRIPT = 'String(getSelection() ?? "")'

export interface FindHost {
  overlay: OverlayController
  activeContents(): WebContents | null
  contentSize(): Size
}

export function findPrefill(selection: unknown, last: string): string {
  const text = typeof selection === 'string' ? selection.replace(/\s+/g, ' ').trim() : ''
  if (text === '' || text.length > FIND_SELECTION_MAX) return last
  return text
}

export class FindController {
  private readonly host: FindHost
  private contents: WebContents | null = null
  private text = ''
  private requestId = 0
  private readonly last = new WeakMap<WebContents, string>()
  private readonly wired = new WeakSet<WebContents>()
  private reload = false

  constructor(host: FindHost) {
    this.host = host
    host.overlay.watch((part) => this.onPart(part))
  }

  get open(): boolean {
    return this.contents !== null && this.host.overlay.part === 'find'
  }

  private wire(contents: WebContents): void {
    if (this.wired.has(contents)) return
    this.wired.add(contents)
    contents.on('found-in-page', (_event, result) => {
      if (contents !== this.contents || result.requestId !== this.requestId) return
      this.send({ matches: result.matches, active: result.activeMatchOrdinal })
    })
    contents.on('did-start-navigation', (details) => {
      if (contents !== this.contents || !details.isMainFrame || details.isSameDocument) return
      this.requestId = 0
      this.reload = true
      this.send(null)
    })
    contents.on('did-stop-loading', () => {
      if (contents !== this.contents || !this.reload) return
      this.reload = false
      if (this.open && this.text !== '') this.query(this.text)
    })
    contents.once('destroyed', () => {
      if (contents === this.contents) this.close()
    })
  }

  private send(result: FindResult | null): void {
    if (this.host.overlay.part === 'find') this.host.overlay.sendUi({ type: 'find.result', result })
  }

  async show(): Promise<void> {
    const contents = this.host.activeContents()
    if (contents === null || contents.isDestroyed()) return
    if (this.contents !== null && this.contents !== contents) this.stop()
    this.wire(contents)
    const last = this.last.get(contents) ?? ''
    const selection: unknown = await contents
      .executeJavaScriptInIsolatedWorld(SELECTION_WORLD, [{ code: SELECTION_SCRIPT }])
      .catch(() => '')
    if (contents.isDestroyed() || this.host.activeContents() !== contents) return
    const query = this.open && this.contents === contents ? this.text : findPrefill(selection, last)
    this.contents = contents
    this.host.overlay.show('find', this.host.contentSize(), { type: 'find.open', query })
    this.host.overlay.webContents.focus()
    if (query !== this.text || this.requestId === 0) this.query(query)
  }

  query(text: string): void {
    const contents = this.contents
    if (contents === null || contents.isDestroyed()) return
    this.text = text
    this.last.set(contents, text)
    if (text === '') {
      if (this.requestId !== 0) contents.stopFindInPage('clearSelection')
      this.requestId = 0
      this.send(null)
      return
    }
    this.requestId = contents.findInPage(text, { findNext: true })
  }

  step(forward: boolean): void {
    const contents = this.contents
    if (!this.open || contents === null || contents.isDestroyed()) {
      void this.show()
      return
    }
    if (this.text === '') return
    if (this.requestId === 0) {
      this.query(this.text)
      return
    }
    this.requestId = contents.findInPage(this.text, { forward, findNext: false })
  }

  private stop(): void {
    const contents = this.contents
    this.contents = null
    this.requestId = 0
    if (contents !== null && !contents.isDestroyed()) contents.stopFindInPage('keepSelection')
  }

  close(): void {
    if (this.contents === null) return
    this.stop()
    if (this.host.overlay.part === 'find') this.host.overlay.hide()
  }

  tabChanged(contents: WebContents | null): void {
    if (this.contents !== null && contents !== this.contents) this.close()
  }

  private onPart(part: OverlayPart): void {
    if (part !== 'find' && this.contents !== null) this.stop()
  }
}
