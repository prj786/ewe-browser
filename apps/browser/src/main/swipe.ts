import type { WebContents } from 'electron'
import type { OverlayPart, Rect, Size, SwipeDirection } from '@ewe/shared'
import { swipeBounds } from './layout'
import type { OverlayController } from './overlay'

const DONE_MS = 220
export const SWIPE_IDLE_MS = 1_000

export interface SwipeHost {
  overlay: OverlayController
  enabled(): boolean
  activeContents(): WebContents | null
  pageRect(contents: WebContents): Rect | null
  contentSize(): Size
}

interface Session {
  contents: WebContents
  dir: SwipeDirection
}

export function canGo(contents: WebContents, dir: SwipeDirection): boolean {
  if (contents.isDestroyed()) return false
  const history = contents.navigationHistory
  return dir === 'back' ? history.canGoBack() : history.canGoForward()
}

export function go(contents: WebContents, dir: SwipeDirection): boolean {
  if (!canGo(contents, dir)) return false
  if (dir === 'back') contents.navigationHistory.goBack()
  else contents.navigationHistory.goForward()
  return true
}

export class SwipeController {
  private readonly host: SwipeHost
  private session: Session | null = null
  private doneTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private readonly watched = new WeakSet<WebContents>()

  constructor(host: SwipeHost) {
    this.host = host
    host.overlay.watch((part) => this.onPart(part))
  }

  private onPart(part: OverlayPart): void {
    if (part === 'swipe') return
    this.session = null
    this.clearIdle()
  }

  private watch(contents: WebContents): void {
    if (this.watched.has(contents)) return
    this.watched.add(contents)
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.abandon(contents)
    })
    contents.on('render-process-gone', () => this.abandon(contents))
    contents.once('destroyed', () => this.abandon(contents))
  }

  private abandon(contents: WebContents): void {
    if (this.session?.contents !== contents) return
    this.session = null
    this.clearIdle()
    if (this.host.overlay.part === 'swipe') this.host.overlay.hide()
  }

  tabChanged(contents: WebContents): void {
    const s = this.session
    if (s !== null && s.contents !== contents) this.abandon(s.contents)
  }

  private clearIdle(): void {
    if (this.idleTimer === null) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private armIdle(contents: WebContents): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this.abandon(contents)
    }, SWIPE_IDLE_MS)
  }

  private clearDone(): void {
    if (this.doneTimer === null) return
    clearTimeout(this.doneTimer)
    this.doneTimer = null
  }

  start(contents: WebContents, dir: SwipeDirection, progress: number): boolean {
    if (!this.host.enabled() || this.host.activeContents() !== contents) return false
    if (!canGo(contents, dir)) return false
    const part = this.host.overlay.part
    if (part !== 'none' && part !== 'toast' && part !== 'swipe') return false
    const page = this.host.pageRect(contents)
    if (page === null) return false
    this.clearDone()
    this.watch(contents)
    this.session = { contents, dir }
    this.armIdle(contents)
    this.host.overlay.show(
      'swipe',
      this.host.contentSize(),
      { type: 'swipe', dir, progress },
      swipeBounds(dir, page, this.host.contentSize()),
    )
    return true
  }

  private mine(contents: WebContents, dir: SwipeDirection): boolean {
    const s = this.session
    return s !== null && s.contents === contents && s.dir === dir
  }

  move(contents: WebContents, dir: SwipeDirection, progress: number): void {
    if (!this.mine(contents, dir)) return
    this.armIdle(contents)
    this.host.overlay.sendUi({ type: 'swipe', dir, progress })
  }

  end(contents: WebContents, dir: SwipeDirection, progress: number): void {
    if (!this.mine(contents, dir)) return
    this.session = null
    this.clearIdle()
    if (progress < 1 || !go(contents, dir)) {
      this.host.overlay.hide()
      return
    }
    this.host.overlay.sendUi({ type: 'swipe', dir, progress: 1, done: true })
    this.clearDone()
    this.doneTimer = setTimeout(() => {
      this.doneTimer = null
      if (this.host.overlay.part === 'swipe') this.host.overlay.hide()
    }, DONE_MS)
  }

  cancel(contents: WebContents, dir: SwipeDirection): void {
    if (!this.mine(contents, dir)) return
    this.abandon(contents)
  }
}
