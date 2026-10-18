import { app, type Session, type WebContents } from 'electron'
import {
  PERMISSION_KINDS,
  SITE_INFO_KINDS,
  dohConfig,
  webOrigin,
  type PermissionKind,
  type PrivacyStatus,
  type SiteInfo,
} from '@ewe/shared'
import type { SettingsStore } from '../storage/settings-store'
import { HttpsOnlyState } from './https-only'
import {
  Dismissals,
  INTERNAL_ALLOW,
  SILENT_ALLOW,
  kindsFor,
  verdict,
  type PermissionStore,
} from './permissions'

export type PermissionAsk = (
  contents: WebContents,
  origin: string,
  kinds: PermissionKind[],
  callback: (granted: boolean) => void,
) => boolean

export interface PrivacyDeps {
  settings: SettingsStore
  permissions: PermissionStore
  thirdPartyBlocked: boolean
  ask: PermissionAsk
  configureHostResolver?: (options: Electron.ConfigureHostResolverOptions) => void
}

export const PERMISSION_API_NAMES: Record<PermissionKind, string[]> = {
  camera: ['camera'],
  microphone: ['microphone'],
  location: ['geolocation'],
  notifications: ['notifications'],
  clipboard: ['clipboard-read'],
  midi: ['midi'],
  'local-network': ['local-network-access', 'local-network', 'loopback-network'],
  windows: ['window-management'],
  idle: ['idle-detection'],
}

export interface FrameFlags {
  gpc: boolean
  ask: string[]
}

function topOrigin(contents: WebContents | null, fallback: string): string | null {
  const url = contents === null || contents.isDestroyed() ? '' : contents.getURL()
  return webOrigin(url) ?? webOrigin(fallback)
}

export class PrivacyService {
  readonly https: HttpsOnlyState
  readonly dismissals = new Dismissals()
  private dnsError: string | null = null
  private lastDns = ''
  private readonly deps: PrivacyDeps

  constructor(deps: PrivacyDeps) {
    this.deps = deps
    this.https = new HttpsOnlyState(() => deps.settings.get().privacy.httpsOnly)
    deps.settings.on('change', () => this.applyDns())
  }

  install(session: Session): void {
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      const requesting = details.requestingUrl
      if (requesting.startsWith('app://') || contents.getURL().startsWith('app://')) {
        callback(INTERNAL_ALLOW.has(permission))
        return
      }
      if (SILENT_ALLOW.has(permission)) {
        callback(true)
        return
      }
      const media = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      const kinds = kindsFor(permission, media)
      const origin = topOrigin(contents, requesting)
      if (origin === null || kinds.length === 0) {
        callback(false)
        return
      }
      const decided = verdict(this.deps.permissions.get(origin), kinds)
      if (decided !== 'ask') {
        callback(decided === 'allow')
        return
      }
      if (this.dismissals.quiet(origin) || !this.deps.ask(contents, origin, kinds, callback))
        callback(false)
    })
    session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      const requesting = details.requestingUrl ?? requestingOrigin
      if (requesting.startsWith('app://') || (contents?.getURL().startsWith('app://') ?? false))
        return INTERNAL_ALLOW.has(permission)
      if (SILENT_ALLOW.has(permission)) return true
      const mediaType = 'mediaType' in details ? details.mediaType : undefined
      const kinds = kindsFor(permission, mediaType === undefined ? ['video', 'audio'] : [mediaType])
      const embedding = details.embeddingOrigin
      const origin = topOrigin(
        contents,
        embedding !== undefined && embedding !== '' ? embedding : requestingOrigin,
      )
      if (origin === null || kinds.length === 0) return false
      if (permission === 'media' && mediaType === undefined)
        return kinds.some((k) => this.deps.permissions.value(origin, k) === 'allow')
      return verdict(this.deps.permissions.get(origin), kinds) === 'allow'
    })
    session.webRequest.onBeforeRequest(
      { urls: ['http://*/*'], types: ['mainFrame', 'subFrame'] },
      (details, callback) => {
        const target = this.https.upgrade(
          details.webContentsId,
          details.url,
          details.resourceType === 'mainFrame',
        )
        callback(target === null ? {} : { redirectURL: target })
      },
    )
  }

  extraHeaders(): Record<string, string> {
    return this.deps.settings.get().privacy.gpc ? { 'Sec-GPC': '1' } : {}
  }

  frameFlags(contents: WebContents): FrameFlags {
    const gpc = this.deps.settings.get().privacy.gpc
    const origin = topOrigin(contents, '')
    if (origin === null) return { gpc, ask: [] }
    const site = this.deps.permissions.get(origin)
    const ask = PERMISSION_KINDS.filter((k) => site?.[k] === undefined).flatMap(
      (k) => PERMISSION_API_NAMES[k],
    )
    return { gpc, ask }
  }

  applyDns(): void {
    const config = dohConfig(this.deps.settings.get().privacy)
    const configure =
      this.deps.configureHostResolver ??
      ((options: Electron.ConfigureHostResolverOptions) => app.configureHostResolver(options))
    const apply = (options: Electron.ConfigureHostResolverOptions): boolean => {
      const key = JSON.stringify(options)
      if (key === this.lastDns) return true
      try {
        configure(options)
        this.lastDns = key
        return true
      } catch (error) {
        this.dnsError = error instanceof Error ? error.message : String(error)
        return false
      }
    }
    if (!config.ok) {
      if (this.lastDns === '') apply({ secureDnsMode: 'off' })
      this.dnsError = config.error
      return
    }
    if (
      apply(
        config.mode === 'secure'
          ? { secureDnsMode: 'secure', secureDnsServers: config.servers }
          : { secureDnsMode: config.mode },
      )
    )
      this.dnsError = null
  }

  appliedDns(): string {
    return this.lastDns
  }

  status(): PrivacyStatus {
    return { thirdPartyBlocked: this.deps.thirdPartyBlocked, dnsError: this.dnsError }
  }

  siteInfo(url: string): SiteInfo {
    const origin = webOrigin(url)
    const parsed = URL.canParse(url) ? new URL(url) : null
    const host = parsed?.host ?? url
    const scheme = parsed?.protocol ?? ''
    const kind: SiteInfo['kind'] =
      scheme === 'https:'
        ? 'https'
        : scheme === 'http:'
          ? 'http'
          : scheme === 'file:'
            ? 'file'
            : scheme === 'app:'
              ? 'internal'
              : 'other'
    if (origin === null) return { origin: '', host, kind, permissions: [], httpAllowed: false }
    const site = this.deps.permissions.get(origin) ?? {}
    const kinds = PERMISSION_KINDS.filter(
      (k) => SITE_INFO_KINDS.includes(k) || site[k] !== undefined,
    )
    return {
      origin,
      host,
      kind,
      permissions: kinds.map((k) => ({ kind: k, value: site[k] ?? 'ask' })),
      httpAllowed: kind === 'http' && this.https.isAllowed(new URL(origin).hostname),
    }
  }

  async clearSiteData(origin: string, session: Session): Promise<void> {
    const host = new URL(origin).hostname
    await session.clearStorageData({ origin })
    const cookies = await session.cookies.get({})
    await Promise.all(
      cookies
        .filter((c) => {
          const domain = (c.domain ?? '').replace(/^\./, '')
          return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)
        })
        .map((c) => {
          const scheme = c.secure === true ? 'https' : 'http'
          const domain = (c.domain ?? host).replace(/^\./, '')
          return session.cookies.remove(`${scheme}://${domain}${c.path ?? '/'}`, c.name)
        }),
    )
  }
}
