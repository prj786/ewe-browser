import { siteOf } from './site'

export const STEP_TTL_MS = 5 * 60_000
export const DRAFT_TTL_MS = 30 * 60_000

export interface DraftFrame {
  contentsId: number
  processId: number
  routingId: number
  origin: string
}

export interface Draft extends DraftFrame {
  password: string
  username: string
  at: number
}

interface Step {
  site: string
  username: string
  at: number
}

export function siteKey(origin: string): string | null {
  const site = siteOf(origin)
  if (site === null) return null
  return site.domain ?? site.host
}

const sameFrame = (a: DraftFrame, b: DraftFrame): boolean =>
  a.contentsId === b.contentsId &&
  a.processId === b.processId &&
  a.routingId === b.routingId &&
  a.origin === b.origin

export class SignupMemory {
  private readonly steps = new Map<number, Step>()
  private readonly drafts = new Map<number, Draft>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  private prune(): void {
    const now = this.now()
    for (const [id, s] of this.steps) if (now - s.at > STEP_TTL_MS) this.steps.delete(id)
    for (const [id, d] of this.drafts) {
      if (now - d.at > DRAFT_TTL_MS) {
        d.password = ''
        this.drafts.delete(id)
      }
    }
  }

  rememberUsername(contentsId: number, origin: string, username: string): void {
    const site = siteKey(origin)
    const name = username.trim()
    if (site === null || name === '') return
    this.steps.set(contentsId, { site, username: name, at: this.now() })
  }

  usernameFor(contentsId: number, origin: string): string {
    this.prune()
    const step = this.steps.get(contentsId)
    const site = siteKey(origin)
    if (step === undefined || site === null || step.site !== site) return ''
    return step.username
  }

  generated(frame: DraftFrame, password: string): void {
    this.prune()
    this.drafts.set(frame.contentsId, { ...frame, password, username: '', at: this.now() })
  }

  draft(frame: DraftFrame, username: string, keep: boolean): void {
    const d = this.drafts.get(frame.contentsId)
    if (d === undefined || !sameFrame(d, frame)) return
    if (!keep) {
      this.drop(frame.contentsId)
      return
    }
    d.username = username.trim()
    d.at = this.now()
  }

  hasDraft(contentsId: number): boolean {
    this.prune()
    return this.drafts.has(contentsId)
  }

  draftFrame(contentsId: number): DraftFrame | null {
    return this.drafts.get(contentsId) ?? null
  }

  take(contentsId: number): Draft | null {
    this.prune()
    const d = this.drafts.get(contentsId)
    if (d === undefined) return null
    this.drafts.delete(contentsId)
    return { ...d }
  }

  drop(contentsId: number, origin?: string): void {
    const d = this.drafts.get(contentsId)
    if (d === undefined || (origin !== undefined && d.origin !== origin)) return
    d.password = ''
    this.drafts.delete(contentsId)
  }

  forget(contentsId: number): void {
    this.steps.delete(contentsId)
    this.drop(contentsId)
  }
}
