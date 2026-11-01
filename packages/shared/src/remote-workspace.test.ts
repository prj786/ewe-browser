import { describe, expect, it } from 'vitest'
import { isShellCommand } from './ipc-contract'
import {
  canBrowseFrom,
  cleanRemoteName,
  isRemoteBinding,
  isRemoteId,
  matchComputer,
  remoteChoices,
  remotePartition,
  type RemoteComputer,
} from './remote-workspace'

const work: RemoteComputer = {
  id: '3f9c0a1b2c3d4e5f',
  name: 'work-pc',
  online: true,
  sharing: true,
  paired: true,
}
const attic: RemoteComputer = {
  id: 'bb',
  name: 'Attic',
  online: false,
  sharing: false,
  paired: true,
}
const self: RemoteComputer = { id: 'aa', name: 'home', online: true, sharing: true, paired: true }
const stranger: RemoteComputer = { id: 'cc', name: 'x', online: true, sharing: true, paired: false }

describe('remote workspaces', () => {
  it('ids are safe for a partition name and an argv', () => {
    expect(isRemoteId('3f9c0a1b2c3d4e5f')).toBe(true)
    expect(isRemoteId('work-pc')).toBe(true)
    for (const bad of ['', '-a', 'A1', '../x', 'a b', 'a/b', 'a'.repeat(65), 7, null])
      expect(isRemoteId(bad)).toBe(false)
    expect(remotePartition('3f9c')).toBe('persist:remote-3f9c')
  })

  it('names lose control and direction characters', () => {
    expect(cleanRemoteName(' work\u202e-pc\u200b\n')).toBe('work-pc')
    expect(cleanRemoteName('   ')).toBeNull()
    expect(cleanRemoteName(3)).toBeNull()
    expect(cleanRemoteName('x'.repeat(100))).toHaveLength(64)
    expect(isRemoteBinding({ id: 'aa', name: 'home' })).toBe(true)
    expect(isRemoteBinding({ id: 'aa', name: 'ho\nme' })).toBe(false)
    expect(isRemoteBinding({ id: 'A', name: 'home' })).toBe(false)
  })

  it('offers paired computers other than this one; only sharing ones are usable', () => {
    expect(remoteChoices([work, attic, self, stranger], 'aa')).toEqual([
      { id: 'bb', name: 'Attic', online: false, usable: false },
      { id: work.id, name: 'work-pc', online: true, usable: true },
    ])
    expect(canBrowseFrom(work, 'aa')).toBe(true)
    expect(canBrowseFrom(work, work.id)).toBe(false)
    expect(canBrowseFrom(attic, 'aa')).toBe(false)
    expect(canBrowseFrom(stranger, 'aa')).toBe(false)
  })

  it('matches a computer by id, name in any case, or a unique id prefix', () => {
    const all = [work, attic, self]
    expect(matchComputer(all, work.id)).toBe(work)
    expect(matchComputer(all, 'WORK-PC')).toBe(work)
    expect(matchComputer(all, 'attic')).toBe(attic)
    expect(matchComputer(all, '3f9c')).toBe(work)
    expect(matchComputer(all, '3f9')).toBeUndefined()
    expect(matchComputer(all, '')).toBeUndefined()
    expect(matchComputer([work, { ...attic, name: 'work-pc' }], 'work-pc')).toBeUndefined()
  })

  it('commands carry a valid computer id', () => {
    expect(isShellCommand({ type: 'workspace.create', remote: work.id })).toBe(true)
    expect(isShellCommand({ type: 'workspace.create', remote: '../default' })).toBe(false)
    expect(isShellCommand({ type: 'workspace.new', x: 10, y: 700 })).toBe(true)
    expect(isShellCommand({ type: 'workspace.new', x: 'a', y: 1 })).toBe(false)
    expect(
      isShellCommand({ type: 'menu.open', menu: { kind: 'workspace-new', id: 'm' }, x: 1, y: 1 }),
    ).toBe(false)
  })
})
