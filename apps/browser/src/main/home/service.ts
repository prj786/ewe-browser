import type { FsResult, HomeRequest } from '@ewe/shared'
import { errorMessage, openWithDefault, playInMpv } from '../files/service'
import { computePlaces, systemPlacesEnv } from '../files/places'
import type { RecentStore } from '../storage/recent-store'
import type { RecentsService } from './recents'

export interface HomeServiceDeps {
  recents: RecentsService
  store: RecentStore
  token(): string
}

export class HomeService {
  private readonly deps: HomeServiceDeps

  constructor(deps: HomeServiceDeps) {
    this.deps = deps
  }

  async handle(request: HomeRequest): Promise<FsResult> {
    try {
      switch (request.op) {
        case 'token':
          return { ok: true, value: this.deps.token() }
        case 'places':
          return { ok: true, value: await computePlaces(systemPlacesEnv()) }
        case 'recents':
          return {
            ok: true,
            value: await this.deps.recents.collect(request.filter, request.limit),
          }
        case 'open':
        case 'mpv': {
          if (!this.deps.recents.knows(request.path)) return { ok: false, error: 'Not allowed' }
          const started =
            request.op === 'mpv'
              ? await playInMpv(request.path)
              : await openWithDefault(request.path)
          if (!started)
            return {
              ok: false,
              error: request.op === 'mpv' ? 'mpv is not installed' : 'No app opens this file',
            }
          this.deps.store.record(request.path, 'opened')
          return { ok: true, value: true }
        }
        case 'forget':
          this.deps.store.forget(request.key)
          return { ok: true, value: true }
      }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }
}
