import type { BrowserApi } from '@ewe/shared'

declare global {
  const __APP_VERSION__: string

  interface Window {
    ewe: BrowserApi
  }
}

export {}
