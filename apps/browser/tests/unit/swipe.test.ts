import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { OverlayPart, UiEvent } from '@ewe/shared'
import type { OverlayController } from '../../src/main/overlay'
import { SWIPE_IDLE_MS, SwipeController } from '../../src/main/swipe'

class FakeOverlay {
  part: OverlayPart = 'none'
  sent: UiEvent[] = []
  private readonly watchers = new Set<(part: OverlayPart) => void>()
  watch(fn: (part: OverlayPart) => void) {
    this.watchers.add(fn)
    return () => this.watchers.delete(fn)
  }
  private set(part: OverlayPart) {
    if (part === this.part) return
    this.part = part
    for (const fn of this.watchers) fn(part)
  }
  show(part: OverlayPart, _size: unknown, extra?: UiEvent) {
    this.set(part)
    if (extra !== undefined) this.sent.push(extra)
  }
  hide() {
    this.set('none')
  }
  sendUi(event: UiEvent) {
    this.sent.push(event)
  }
}

function fakeContents(goBack: () => void = () => undefined): WebContents {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isDestroyed: () => false,
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => false,
      goBack,
      goForward: () => undefined,
    },
  }) as unknown as WebContents
}

describe('SwipeController', () => {
  let overlay: FakeOverlay
  let tab: WebContents
  let other: WebContents
  let swipe: SwipeController
  let goBack: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    overlay = new FakeOverlay()
    goBack = vi.fn<() => void>()
    tab = fakeContents(goBack)
    other = fakeContents()
    swipe = new SwipeController({
      overlay: overlay as unknown as OverlayController,
      enabled: () => true,
      activeContents: () => tab,
      pageRect: () => ({ x: 264, y: 8, width: 1000, height: 700 }),
      contentSize: () => ({ width: 1280, height: 820 }),
    })
  })

  afterEach(() => vi.useRealTimers())

  it('only starts with history that way', () => {
    expect(swipe.start(tab, 'forward', 0.1)).toBe(false)
    expect(swipe.start(other, 'back', 0.1)).toBe(false)
    expect(swipe.start(tab, 'back', 0.1)).toBe(true)
    expect(overlay.part).toBe('swipe')
  })

  it('drops the arrow when the page navigates, crashes or goes away', () => {
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
      swipe.start(tab, 'back', 0.2)
      expect(overlay.part).toBe('swipe')
      tab.emit(event, { isMainFrame: true, isSameDocument: false })
      expect(overlay.part, event).toBe('none')
    }
  })

  it('keeps it through same-document and subframe navigations', () => {
    swipe.start(tab, 'back', 0.2)
    tab.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    tab.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(overlay.part).toBe('swipe')
  })

  it('drops it on a tab switch and after a second without movement', () => {
    swipe.start(tab, 'back', 0.2)
    swipe.tabChanged(other)
    expect(overlay.part).toBe('none')
    swipe.start(tab, 'back', 0.2)
    vi.advanceTimersByTime(SWIPE_IDLE_MS - 100)
    swipe.move(tab, 'back', 0.4)
    vi.advanceTimersByTime(SWIPE_IDLE_MS - 100)
    expect(overlay.part).toBe('swipe')
    vi.advanceTimersByTime(200)
    expect(overlay.part).toBe('none')
  })

  it('navigates only past the threshold', () => {
    swipe.start(tab, 'back', 0.5)
    swipe.end(tab, 'back', 0.9)
    expect(goBack).not.toHaveBeenCalled()
    swipe.start(tab, 'back', 0.5)
    swipe.end(tab, 'back', 1)
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(overlay.sent.at(-1)).toEqual({ type: 'swipe', dir: 'back', progress: 1, done: true })
  })
})
