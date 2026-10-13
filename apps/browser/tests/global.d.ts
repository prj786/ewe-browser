import type { BrowserApi } from '@ewe/shared'

declare global {
  interface Window {
    ewe: BrowserApi
  }
}

export {}
