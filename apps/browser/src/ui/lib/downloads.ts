import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { DownloadEntry } from '@ewe/shared'
import { api } from './api'

export function createDownloads(): Accessor<DownloadEntry[]> {
  const [downloads, setDownloads] = createSignal<DownloadEntry[]>([])
  let pushed = false
  const off = api.onDownloads((list) => {
    pushed = true
    setDownloads(list)
  })
  void api.getDownloads().then((list) => {
    if (!pushed) setDownloads(list)
  })
  onCleanup(off)
  return downloads
}

export function isActiveDownload(entry: DownloadEntry): boolean {
  return entry.status === 'progressing' || entry.status === 'paused'
}
