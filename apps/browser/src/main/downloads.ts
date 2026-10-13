import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { shell, type DownloadItem, type Session, type WebContents } from 'electron'
import type { DownloadAction, DownloadEntry } from '@ewe/shared'
import { isActive, uniquePath, type DownloadsStore } from './storage/downloads-store'

const PROGRESS_MS = 250

export interface DownloadEvents {
  onStart(entry: DownloadEntry, source: WebContents | null): void
  onDone(entry: DownloadEntry): void
  onError(message: string): void
  onShow(path: string): void
}

export class DownloadManager {
  private readonly items = new Map<string, DownloadItem>()
  private readonly lastUpdate = new Map<string, number>()
  private readonly store: DownloadsStore
  private readonly session: Session
  private readonly dir: () => string
  private readonly events: DownloadEvents

  constructor(session: Session, store: DownloadsStore, dir: () => string, events: DownloadEvents) {
    this.session = session
    this.store = store
    this.dir = dir
    this.events = events
    session.on('will-download', (_event, item, source) => this.track(item, source))
  }

  private track(item: DownloadItem, source: WebContents | null): void {
    const path = uniquePath(
      this.dir(),
      item.getFilename(),
      (p) => existsSync(p) || this.store.hasActivePath(p),
    )
    item.setSavePath(path)
    const id = randomUUID()
    const entry: DownloadEntry = {
      id,
      url: item.getURL(),
      filename: basename(path),
      path,
      mime: item.getMimeType(),
      received: item.getReceivedBytes(),
      total: item.getTotalBytes(),
      speed: 0,
      status: 'progressing',
      started: Math.round(item.getStartTime() * 1000) || Date.now(),
      ended: null,
    }
    this.items.set(id, item)
    this.store.add(entry)
    this.events.onStart(entry, source)

    item.on('updated', (_event, state) => {
      const now = Date.now()
      const paused = item.isPaused()
      const status = state === 'interrupted' ? 'interrupted' : paused ? 'paused' : 'progressing'
      const statusChanged = this.store.get(id)?.status !== status
      if (!statusChanged && now - (this.lastUpdate.get(id) ?? 0) < PROGRESS_MS) return
      this.lastUpdate.set(id, now)
      this.store.update(id, {
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        speed: paused ? 0 : item.getCurrentBytesPerSecond(),
        status,
      })
    })
    item.once('done', (_event, state) => {
      this.items.delete(id)
      this.lastUpdate.delete(id)
      const done = this.store.update(id, {
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        speed: 0,
        status: state,
        ended: Date.now(),
      })
      if (done !== undefined && state !== 'cancelled') this.events.onDone(done)
    })
  }

  run(id: string, action: DownloadAction): void {
    const entry = this.store.get(id)
    if (entry === undefined) return
    const item = this.items.get(id)
    switch (action) {
      case 'pause':
        if (item !== undefined && !item.isPaused()) item.pause()
        break
      case 'resume':
        if (item?.canResume() === true) item.resume()
        else if (item === undefined && entry.status === 'interrupted') this.retry(entry)
        break
      case 'cancel':
        item?.cancel()
        break
      case 'retry':
        if (item === undefined && !isActive(entry.status)) this.retry(entry)
        break
      case 'open':
        if (entry.status !== 'completed') return
        if (!existsSync(entry.path)) {
          this.events.onError(`${entry.filename} was moved or deleted`)
          return
        }
        void shell.openPath(entry.path).then((error) => {
          if (error !== '') this.events.onError(`Could not open ${entry.filename}`)
        })
        break
      case 'show':
        if (existsSync(entry.path)) this.events.onShow(entry.path)
        else this.events.onError(`${entry.filename} was moved or deleted`)
        break
      case 'remove':
        item?.cancel()
        this.store.remove(id)
        break
    }
  }

  private retry(entry: DownloadEntry): void {
    this.store.remove(entry.id)
    this.session.downloadURL(entry.url)
  }

  clear(): void {
    this.store.clearFinished()
  }
}
