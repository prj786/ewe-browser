import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Session } from 'electron'
import {
  canBrowseFrom,
  isRemoteId,
  matchComputer,
  remoteChoices,
  remotePartition,
  type RemoteChoice,
  type RemoteComputer,
} from '@ewe/shared'
import {
  NO_STATUS,
  STATUS_TIMEOUT_MS,
  TUNNEL_TIMEOUT_MS,
  parseStatus,
  parseTunnel,
  proxyConfig,
  remoteBin,
  runRemote,
  tunnelFailure,
  type RemoteStatus,
  type RunRemote,
  type TunnelResult,
} from './cli'

export const STATUS_TTL_MS = 15_000

export type RequestGate = () => boolean

export interface RemoteDeps {
  userData: string
  fromPartition(partition: string): Session
  setup(session: Session, gate: RequestGate): void
  bin?: (() => string | null) | undefined
  run?: RunRemote | undefined
  now?: (() => number) | undefined
}

interface Remote {
  id: string
  session: Session
  ready: boolean
  host: string | null
  port: number | null
  pending: Promise<TunnelResult> | null
}

export type PickResult =
  { ok: true; computer: RemoteComputer } | { ok: false; error: string; message: string }

const PARTITION_DIR = /^remote-([a-z0-9][a-z0-9-]{0,63})$/

export class RemoteService {
  private status: RemoteStatus | null = null
  private statusAt = 0
  private statusPending: Promise<RemoteStatus> | null = null
  private readonly remotes = new Map<string, Remote>()
  private readonly bySession = new WeakMap<Session, string>()
  private readonly deps: RemoteDeps

  constructor(deps: RemoteDeps) {
    this.deps = deps
  }

  private bin(): string | null {
    return (this.deps.bin ?? (() => remoteBin()))()
  }

  private run(args: string[], timeout: number): Promise<unknown> {
    const bin = this.bin()
    if (bin === null) return Promise.resolve(null)
    return (this.deps.run ?? runRemote)(bin, args, timeout)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  available(): boolean {
    return this.bin() !== null
  }

  computers(maxAge = STATUS_TTL_MS): Promise<RemoteStatus> {
    if (this.status !== null && this.now() - this.statusAt < maxAge)
      return Promise.resolve(this.status)
    if (this.statusPending !== null) return this.statusPending
    if (!this.available()) return Promise.resolve(NO_STATUS)
    const pending = this.run(['status'], STATUS_TIMEOUT_MS).then((raw) => {
      const parsed = parseStatus(raw) ?? NO_STATUS
      this.status = parsed
      this.statusAt = this.now()
      return parsed
    })
    this.statusPending = pending
    void pending.finally(() => {
      if (this.statusPending === pending) this.statusPending = null
    })
    return pending
  }

  async choices(): Promise<RemoteChoice[]> {
    const status = await this.computers()
    return remoteChoices(status.computers, status.thisId)
  }

  async pick(key: string, maxAge = STATUS_TTL_MS): Promise<PickResult> {
    if (!this.available())
      return { ok: false, error: 'no-remote', message: 'ewe Remote is not installed' }
    const status = await this.computers(maxAge)
    const computer = matchComputer(status.computers, key)
    if (computer === undefined)
      return {
        ok: false,
        error: 'not-found',
        message: `no computer named ${key} (ewe-remote status lists them)`,
      }
    if (computer.id === status.thisId)
      return {
        ok: false,
        error: 'this-computer',
        message: `${computer.name} is this computer; its own workspaces already browse from it`,
      }
    if (!computer.paired)
      return { ok: false, error: 'not-paired', message: `pair with ${computer.name} first` }
    if (!canBrowseFrom(computer, status.thisId))
      return {
        ok: false,
        error: 'not-sharing',
        message: `${computer.name} is not sharing (turn on Share this computer there)`,
      }
    return { ok: true, computer }
  }

  sessionFor(id: string): Session {
    return this.remote(id).session
  }

  remoteOf(session: Session): string | null {
    return this.bySession.get(session) ?? null
  }

  ready(id: string): boolean {
    return this.remotes.get(id)?.ready === true
  }

  ensure(id: string, force = false): Promise<TunnelResult> {
    const remote = this.remote(id)
    if (remote.pending !== null) return remote.pending
    if (!force && remote.ready && remote.host !== null && remote.port !== null)
      return Promise.resolve({ ok: true, host: remote.host, port: remote.port })
    const pending = this.open(remote)
    remote.pending = pending
    void pending.finally(() => {
      if (remote.pending === pending) remote.pending = null
    })
    return pending
  }

  private async open(remote: Remote): Promise<TunnelResult> {
    if (!this.available()) return tunnelFailure('no-remote')
    if ((await this.computers()).thisId === remote.id) return tunnelFailure('this-computer')
    const result = parseTunnel(await this.run(['tunnel', remote.id], TUNNEL_TIMEOUT_MS))
    if (!result.ok) return result
    const moved =
      remote.port !== null && (remote.port !== result.port || remote.host !== result.host)
    try {
      await remote.session.setProxy(proxyConfig(result.host, result.port))
      if (moved) await remote.session.closeAllConnections()
    } catch (error) {
      return tunnelFailure('proxy', error instanceof Error ? error.message : String(error))
    }
    remote.host = result.host
    remote.port = result.port
    remote.ready = true
    return result
  }

  knownSessions(): Session[] {
    const ids = new Set(this.remotes.keys())
    try {
      for (const name of readdirSync(join(this.deps.userData, 'Partitions'))) {
        const id = PARTITION_DIR.exec(name)?.[1]
        if (id !== undefined) ids.add(id)
      }
    } catch {
      return [...this.remotes.values()].map((r) => r.session)
    }
    return [...ids].map((id) => this.sessionFor(id))
  }

  private remote(id: string): Remote {
    if (!isRemoteId(id)) throw new Error('not a remote computer id')
    const existing = this.remotes.get(id)
    if (existing !== undefined) return existing
    const session = this.deps.fromPartition(remotePartition(id))
    const remote: Remote = { id, session, ready: false, host: null, port: null, pending: null }
    this.remotes.set(id, remote)
    this.bySession.set(session, id)
    this.deps.setup(session, () => remote.ready)
    return remote
  }
}
