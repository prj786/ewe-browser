import type { SafeCaptureKind } from '@ewe/shared'

export interface SaveCandidate {
  id: string
  title: string
  username: string
  samePassword: boolean
  exact?: boolean | undefined
}

export type SaveDecision =
  { mode: 'none' } | { mode: 'save' } | { mode: 'update'; id: string; title: string }

export const sameUser = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

function decideSignup(username: string, candidates: readonly SaveCandidate[]): SaveDecision {
  if (username.trim() === '') return { mode: 'save' }
  const same = candidates.filter((c) => c.exact !== false && sameUser(c.username, username))
  if (same.some((c) => c.samePassword)) return { mode: 'none' }
  const first = same[0]
  if (first !== undefined) return { mode: 'update', id: first.id, title: first.title }
  return { mode: 'save' }
}

export function decideSave(
  username: string,
  candidates: readonly SaveCandidate[],
  kind: SafeCaptureKind = 'login',
): SaveDecision {
  if (kind === 'signup') return decideSignup(username, candidates)
  if (username.trim() === '') {
    if (candidates.some((c) => c.samePassword)) return { mode: 'none' }
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (only !== undefined) return { mode: 'update', id: only.id, title: only.title }
    return { mode: 'save' }
  }
  const same = candidates.filter((c) => sameUser(c.username, username))
  if (same.some((c) => c.samePassword)) return { mode: 'none' }
  const first = same[0]
  if (first !== undefined) return { mode: 'update', id: first.id, title: first.title }
  return { mode: 'save' }
}

export function candidatesToCheck<T extends { username: string; match?: string | undefined }>(
  username: string,
  logins: readonly T[],
  limit = 5,
  kind: SafeCaptureKind = 'login',
): T[] {
  if (kind === 'signup') {
    if (username.trim() === '') return []
    return logins
      .filter((l) => l.match !== 'domain' && sameUser(l.username, username))
      .slice(0, limit)
  }
  if (username.trim() === '') return logins.slice(0, limit)
  return logins.filter((l) => sameUser(l.username, username)).slice(0, limit)
}
