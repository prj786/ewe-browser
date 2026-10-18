import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, isPageInput, type ApiLayer, type PageInput } from '@ewe/shared'

export interface PageInputTarget {
  pageInput(
    event: IpcMainInvokeEvent,
    layer: ApiLayer,
    input: PageInput,
    mainFrame: boolean,
    frameUrl: string,
  ): boolean
}

export interface PageInputOwners {
  fromContents(
    contents: Electron.WebContents,
  ): { controller: PageInputTarget; layer: ApiLayer } | null
}

export function registerPageInputIpc(owners: PageInputOwners): void {
  ipcMain.handle(IPC.pageInput, (event, raw: unknown) => {
    if (!isPageInput(raw)) return false
    const frame = event.senderFrame
    if (frame === null || frame.isDestroyed()) return false
    const owner = owners.fromContents(event.sender)
    if (owner === null) return false
    const mainFrame = frame === event.sender.mainFrame
    return owner.controller.pageInput(event, owner.layer, raw, mainFrame, frame.url)
  })
}
