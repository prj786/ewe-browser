import { ipcMain, webContents } from 'electron'
import { IPC, SETTINGS_URL, isPermissionsRequest } from '@ewe/shared'
import { senderFrameUrl } from '../ipc'
import type { WindowManager } from '../window-manager'
import type { PermissionStore } from './permissions'
import type { PrivacyService } from './service'

export function registerPrivacyIpc(
  windows: WindowManager,
  service: PrivacyService,
  permissions: PermissionStore,
): void {
  ipcMain.handle(IPC.permissions, (event, raw: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return null
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(SETTINGS_URL) ?? false)) return null
    if (!isPermissionsRequest(raw)) return null
    return raw.op === 'list' ? permissions.list() : service.status()
  })

  ipcMain.on(IPC.privacyFrame, (event) => {
    const frame = event.senderFrame
    const url = frame?.url ?? ''
    if (frame === null || frame !== event.sender.mainFrame || !/^https?:/i.test(url)) {
      event.returnValue = { gpc: false, ask: [] }
      return
    }
    event.returnValue = service.frameFlags(event.sender)
  })

  permissions.on('change', () => {
    for (const contents of webContents.getAllWebContents())
      if (!contents.isDestroyed() && contents.getURL().startsWith(SETTINGS_URL))
        contents.send(IPC.permissionsChanged)
  })
}
