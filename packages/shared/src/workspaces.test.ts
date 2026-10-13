import { describe, expect, it } from 'vitest'
import { defaultWorkspaceName, isWorkspaceColor, nextWorkspaceColor } from './workspaces'

describe('workspaces', () => {
  it('hands out unused colours first, then cycles', () => {
    expect(nextWorkspaceColor([])).toBe('ewellow')
    expect(nextWorkspaceColor(['ewellow'])).toBe('sky')
    expect(
      nextWorkspaceColor(['ewellow', 'sky', 'mint', 'violet', 'coral', 'amber', 'rose', 'slate']),
    ).toBe('ewellow')
  })

  it('names new workspaces without clashing', () => {
    const existing = [
      { id: 'a', name: 'Home', color: 'ewellow' as const },
      { id: 'b', name: 'Workspace 3', color: 'sky' as const },
    ]
    expect(defaultWorkspaceName(existing)).toBe('Workspace 4')
    expect(defaultWorkspaceName([])).toBe('Workspace 1')
  })

  it('validates colours', () => {
    expect(isWorkspaceColor('mint')).toBe(true)
    expect(isWorkspaceColor('neon')).toBe(false)
  })
})
