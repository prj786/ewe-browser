import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@ewe/shared'
import { pageScript, type PageBridge } from './page-script'

const REFUSED = { ok: false, name: 'NotAllowedError', message: 'Safe could not be reached.' }

function invoke(request: Record<string, unknown>): Promise<unknown> {
  return ipcRenderer.invoke(IPC.safePasskey, request).catch(() => REFUSED)
}

export function installPasskeys(): void {
  const bridge: PageBridge = {
    available: () =>
      ipcRenderer
        .invoke(IPC.safePasskey, { op: 'available' })
        .then((value: unknown) => value === true)
        .catch(() => false),
    create: (id, options) => invoke({ op: 'create', id, origin: location.origin, options }),
    get: (id, options, mediation) =>
      invoke({ op: 'get', id, origin: location.origin, options, mediation }),
    abort: (id) => {
      void invoke({ op: 'abort', id })
    },
  }
  try {
    contextBridge.executeInMainWorld({ func: pageScript, args: [bridge] })
  } catch {
    return
  }
}
