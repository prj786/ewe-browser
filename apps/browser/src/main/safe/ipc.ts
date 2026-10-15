import { ipcMain, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron'
import { IPC, isSafePageRequest, isSafePasskeyRequest, type ApiLayer } from '@ewe/shared'
import type { SafeService } from './service'
import type { SafeWindow } from './window'
import { fail } from './webauthn'

export interface SafeOwners {
  fromContents(contents: WebContents): {
    controller: { safeUi: SafeWindow | null }
    layer: ApiLayer
  } | null
}

function pageFrame(
  owners: SafeOwners,
  event: IpcMainInvokeEvent,
): { ui: SafeWindow; frame: WebFrameMain } | null {
  const owner = owners.fromContents(event.sender)
  if (owner?.layer !== 'page' || owner.controller.safeUi === null) return null
  const frame = event.senderFrame
  if (frame === null || frame.isDestroyed() || !/^https?:\/\//.test(frame.url)) return null
  return { ui: owner.controller.safeUi, frame }
}

export function registerSafeIpc(owners: SafeOwners, safe: SafeService): void {
  ipcMain.handle(IPC.safePage, (event, raw: unknown) => {
    const found = pageFrame(owners, event)
    if (found === null || !isSafePageRequest(raw)) return null
    if (raw.op === 'state') return safe.pageState()
    found.ui.page(event.sender, found.frame, raw)
    return null
  })

  ipcMain.handle(IPC.safePasskey, (event, raw: unknown) => {
    const found = pageFrame(owners, event)
    if (found === null) return { native: true }
    if (!isSafePasskeyRequest(raw)) return fail('TypeError', 'The passkey request is not valid.')
    return found.ui.passkey(event.sender, found.frame, raw)
  })
}
