import { join } from 'node:path'
import {
  isRestorableUrl,
  isSidebarSection,
  isWorkspaceColor,
  type Rect,
  type SessionFile,
  type SessionTab,
  type SessionWindow,
  type Workspace,
} from '@ewe/shared'
import { debounce, readJson, writeJsonAtomic } from './json-file'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRect(value: unknown): value is Rect {
  if (!isObject(value)) return false
  return ['x', 'y', 'width', 'height'].every(
    (k) => typeof value[k] === 'number' && Number.isFinite(value[k]),
  )
}

function isSessionTab(value: unknown): value is SessionTab {
  return (
    isObject(value) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    (value.workspace === undefined || Number.isInteger(value.workspace)) &&
    (value.pinned === undefined || typeof value.pinned === 'boolean')
  )
}

function isWorkspace(value: unknown): value is Workspace {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isWorkspaceColor(value.color)
  )
}

function isSessionWindow(value: unknown): value is SessionWindow {
  if (!isObject(value)) return false
  if (!Array.isArray(value.tabs) || !value.tabs.every(isSessionTab)) return false
  if (!Number.isInteger(value.activeIndex)) return false
  if (
    value.workspaces !== undefined &&
    !(Array.isArray(value.workspaces) && value.workspaces.every(isWorkspace))
  )
    return false
  if (value.activeWorkspace !== undefined && !Number.isInteger(value.activeWorkspace)) return false
  if (value.sidebar !== undefined && value.sidebar !== null && !isSidebarSection(value.sidebar))
    return false
  return value.bounds === null || value.bounds === undefined || isRect(value.bounds)
}

export function isSessionFile(value: unknown): value is SessionFile {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.windows)) return false
  return value.windows.every(isSessionWindow)
}

export function sanitizeWindows(windows: SessionWindow[]): SessionWindow[] {
  return windows
    .map((win) => {
      const workspaces = (win.workspaces ?? []).map((w) => ({ ...w, name: w.name.slice(0, 40) }))
      const lastWorkspace = Math.max(0, workspaces.length - 1)
      const tabs = win.tabs
        .filter((t) => isRestorableUrl(t.url))
        .map((t) => ({
          url: t.url,
          title: t.title.slice(0, 500),
          workspace: Math.min(Math.max(0, t.workspace ?? 0), lastWorkspace),
          pinned: t.pinned === true,
        }))
      const activeIndex = Math.min(Math.max(0, win.activeIndex), Math.max(0, tabs.length - 1))
      const activeWorkspace = Math.min(Math.max(0, win.activeWorkspace ?? 0), lastWorkspace)
      return {
        bounds: win.bounds ?? null,
        tabs,
        activeIndex,
        workspaces,
        activeWorkspace,
        sidebar: win.sidebar ?? null,
      }
    })
    .filter((win) => win.tabs.length > 0)
}

export class SessionStore {
  private readonly path: string
  private latest: SessionFile = { version: 1, windows: [] }
  private readonly write = debounce((file: SessionFile) => {
    void writeJsonAtomic(this.path, file)
  }, 500)

  constructor(userData: string) {
    this.path = join(userData, 'session.json')
  }

  async load(): Promise<SessionWindow[]> {
    const file = await readJson(this.path, isSessionFile)
    if (file !== null) this.latest = { version: 1, windows: sanitizeWindows(file.windows) }
    return this.latest.windows
  }

  save(windows: SessionWindow[]): void {
    this.latest = { version: 1, windows }
    this.write(this.latest)
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.latest)
  }
}
