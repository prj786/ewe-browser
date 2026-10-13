import type { Workspace, WorkspaceColor } from './models'

export const WORKSPACE_COLORS: Record<WorkspaceColor, string> = {
  ewellow: '#eeb407',
  amber: '#f9a870',
  coral: '#ff7a6b',
  rose: '#f28bb4',
  violet: '#b48cff',
  sky: '#76c7ff',
  mint: '#69d6aa',
  slate: '#a8a49d',
}

export const WORKSPACE_COLOR_ORDER: WorkspaceColor[] = [
  'ewellow',
  'sky',
  'mint',
  'violet',
  'coral',
  'amber',
  'rose',
  'slate',
]

export function isWorkspaceColor(value: unknown): value is WorkspaceColor {
  return typeof value === 'string' && value in WORKSPACE_COLORS
}

export function nextWorkspaceColor(used: WorkspaceColor[]): WorkspaceColor {
  const free = WORKSPACE_COLOR_ORDER.find((c) => !used.includes(c))
  return free ?? WORKSPACE_COLOR_ORDER[used.length % WORKSPACE_COLOR_ORDER.length] ?? 'ewellow'
}

export function defaultWorkspaceName(existing: Workspace[]): string {
  const taken = new Set(existing.map((w) => w.name))
  for (let n = existing.length + 1; ; n++) {
    const name = `Workspace ${n}`
    if (!taken.has(name)) return name
  }
}

export function workspaceColorValue(color: WorkspaceColor): string {
  return WORKSPACE_COLORS[color]
}
