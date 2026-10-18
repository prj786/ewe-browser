import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js'
import {
  DOH_PROVIDERS,
  PERMISSION_KINDS,
  PERMISSION_LABELS,
  PERMISSION_NOTES,
  isDohTemplate,
  originHost,
  type DohProvider,
  type PermissionKind,
  type PermissionSite,
  type PermissionValue,
  type PrivacySettings,
  type PrivacyStatus,
  type Settings,
} from '@ewe/shared'
import { Icon, type IconName } from '../../ui/components/Icon'
import { api } from '../../ui/lib/api'
import { PERMISSION_ICONS } from '../../ui/lib/permissions'
import './privacy.css'

const PROVIDERS: DohProvider[] = ['cloudflare', 'quad9', 'mullvad', 'adguard', 'nextdns', 'custom']

function dnsChoice(p: PrivacySettings): string {
  return p.secureDns === 'secure' ? p.dnsProvider : p.secureDns
}

function dnsDescription(p: PrivacySettings): string {
  if (p.secureDns === 'off')
    return 'Off: your system looks up site names (systemd-resolved, your router or your VPN).'
  if (p.secureDns === 'automatic')
    return 'Encrypts lookups when your network’s DNS provider supports it, and uses it as is when not.'
  const name = DOH_PROVIDERS[p.dnsProvider].name
  return `Every lookup goes encrypted to ${p.dnsProvider === 'custom' ? 'your server' : name}. There is no fallback: when it cannot be reached, sites do not load.`
}

function Choice(props: {
  icon: IconName
  title: string
  description: JSX.Element
  label: string
  class: string
  value: string
  options: { value: string; label: string }[]
  onChange(value: string): void
}): JSX.Element {
  return (
    <div class="row">
      <span class="row-tile">
        <Icon name={props.icon} />
      </span>
      <span class="row-text">
        <span class="row-title">{props.title}</span>
        <span class="row-desc">{props.description}</span>
      </span>
      <span class="select">
        <select
          aria-label={props.label}
          class={props.class}
          value={props.value}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        >
          <For each={props.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
        </select>
        <Icon name="chevron-down" />
      </span>
    </div>
  )
}

function DnsField(props: {
  privacy: PrivacySettings
  update(patch: Partial<PrivacySettings>): void
}): JSX.Element {
  const nextdns = () => props.privacy.dnsProvider === 'nextdns'
  const current = () => (nextdns() ? props.privacy.nextdnsId : props.privacy.dnsTemplate)
  const [draft, setDraft] = createSignal(current())
  createEffect(on(current, (value) => setDraft(value)))
  const valid = () =>
    nextdns() ? /^[a-z0-9]{1,32}$/i.test(draft().trim()) : isDohTemplate(draft().trim())
  const save = () => {
    if (draft().trim() === current()) return
    props.update(nextdns() ? { nextdnsId: draft().trim() } : { dnsTemplate: draft().trim() })
  }
  return (
    <div class="row">
      <span class="row-tile">
        <Icon name="server" />
      </span>
      <span class="row-text">
        <span class="row-title">
          {nextdns() ? 'NextDNS configuration ID' : 'DNS-over-HTTPS address'}
        </span>
        <span class="row-desc" classList={{ 'row-warning': draft().trim() !== '' && !valid() }}>
          {nextdns()
            ? 'The six letters and digits from my.nextdns.io, like abc123.'
            : 'An https:// address, like https://dns.example/dns-query (add {?dns} for servers that only take GET).'}
        </span>
      </span>
      <input
        class="settings-ext-link settings-dns-field"
        value={draft()}
        placeholder={nextdns() ? 'abc123' : 'https://dns.example/dns-query'}
        spellcheck={false}
        aria-label={nextdns() ? 'NextDNS configuration ID' : 'DNS-over-HTTPS address'}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
        onBlur={save}
      />
      <button
        class="btn btn--secondary btn--sm settings-dns-save"
        disabled={!valid()}
        onClick={save}
      >
        Use
      </button>
    </div>
  )
}

function SitePermissions(props: { sites: PermissionSite[] }): JSX.Element {
  const set = (origin: string, kind: PermissionKind, value: PermissionValue) =>
    void api.send({ type: 'permission.set', origin, kind, value })
  return (
    <For
      each={props.sites}
      fallback={
        <div class="row">
          <span class="row-text">
            <span class="row-desc">No site has been allowed or blocked yet.</span>
          </span>
        </div>
      }
    >
      {(site) => (
        <div class="settings-site" data-origin={site.origin}>
          <div class="row">
            <span class="row-tile">
              <Icon name={site.origin.startsWith('https:') ? 'lock' : 'lock-open'} />
            </span>
            <span class="row-text">
              <span class="row-title">{originHost(site.origin)}</span>
              <span class="row-desc">{site.origin}</span>
            </span>
            <button
              class="btn btn--ghost btn--sm settings-site-forget"
              onClick={() => void api.send({ type: 'permission.forget', origin: site.origin })}
            >
              Forget
            </button>
          </div>
          <For each={PERMISSION_KINDS.filter((k) => site.permissions[k] !== undefined)}>
            {(kind) => (
              <div class="row settings-site-perm" data-kind={kind}>
                <span class="settings-site-icon">
                  <Icon name={PERMISSION_ICONS[kind]} />
                </span>
                <span class="row-text">
                  <span class="row-title">{PERMISSION_LABELS[kind]}</span>
                </span>
                <span class="select">
                  <select
                    aria-label={`${PERMISSION_LABELS[kind]} for ${originHost(site.origin)}`}
                    value={site.permissions[kind] ?? 'ask'}
                    onChange={(e) =>
                      set(site.origin, kind, e.currentTarget.value as PermissionValue)
                    }
                  >
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                    <option value="ask">Ask</option>
                  </select>
                  <Icon name="chevron-down" />
                </span>
              </div>
            )}
          </For>
        </div>
      )}
    </For>
  )
}

export function Privacy(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [sites, setSites] = createSignal<PermissionSite[]>([])
  const [status, setStatus] = createSignal<PrivacyStatus | null>(null)
  let section: HTMLHeadingElement | undefined
  const privacy = () => props.settings().privacy
  const update = (patch: Partial<PrivacySettings>) =>
    props.update({ privacy: { ...privacy(), ...patch } })
  const loadSites = () =>
    void api.permissions<PermissionSite[]>({ op: 'list' }).then((list) => setSites(list ?? []))
  const loadStatus = () => void api.permissions<PrivacyStatus>({ op: 'status' }).then(setStatus)

  onMount(() => {
    loadSites()
    loadStatus()
    const off = api.onPermissions(loadSites)
    onCleanup(off)
    if (location.hash === '#privacy')
      queueMicrotask(() => section?.scrollIntoView({ block: 'start' }))
  })
  createEffect(on(privacy, loadStatus, { defer: true }))

  const restart = () => {
    const s = status()
    return s !== null && s.thirdPartyBlocked !== privacy().blockThirdPartyCookies
  }

  return (
    <>
      <h2 class="section-header" id="privacy" ref={section}>
        Privacy and security
      </h2>
      <div class="list settings-privacy">
        <Choice
          icon="server"
          title="Secure DNS"
          label="Secure DNS"
          class="settings-secure-dns"
          description={
            <>
              {dnsDescription(privacy())}
              <Show when={status()?.dnsError}>
                {(error) => <span class="row-warning settings-dns-error">{error()}</span>}
              </Show>
            </>
          }
          value={dnsChoice(privacy())}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'automatic', label: 'Automatic' },
            ...PROVIDERS.map((p) => ({ value: p, label: DOH_PROVIDERS[p].name })),
          ]}
          onChange={(value) => {
            if (value === 'off' || value === 'automatic') update({ secureDns: value })
            else update({ secureDns: 'secure', dnsProvider: value as DohProvider })
          }}
        />
        <Show
          when={
            privacy().secureDns === 'secure' &&
            (privacy().dnsProvider === 'nextdns' || privacy().dnsProvider === 'custom')
          }
        >
          <DnsField privacy={privacy()} update={update} />
        </Show>
        <div class="list-divider" />
        <Choice
          icon="lock"
          title="HTTPS-Only"
          label="HTTPS-Only"
          class="settings-https-only"
          description="Opens every site over https://. When a site has no secure version, a warning page lets you continue over http for that site until ewe browser closes. Local addresses (localhost, 192.168.x.x, .local) are left alone."
          value={privacy().httpsOnly ? 'on' : 'off'}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(value) => update({ httpsOnly: value === 'on' })}
        />
        <div class="list-divider" />
        <Choice
          icon="eye-off"
          title="Third-party cookies"
          label="Third-party cookies"
          class="settings-third-party"
          description={
            <>
              Blocked: sites embedded in the page you visit (ads, trackers, like buttons) cannot
              read or set their cookies. A few embedded sign-ins and comment boxes need them.
              <Show when={restart()}>
                <span class="row-warning settings-restart">Restart ewe browser to apply.</span>
              </Show>
            </>
          }
          value={privacy().blockThirdPartyCookies ? 'block' : 'allow'}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'allow', label: 'Allow' },
          ]}
          onChange={(value) => update({ blockThirdPartyCookies: value === 'block' })}
        />
        <div class="list-divider" />
        <Choice
          icon="shield-check"
          title="Ask sites not to sell or share your data"
          label="Global Privacy Control"
          class="settings-gpc"
          description="Global Privacy Control: sends Sec-GPC: 1 with every request and tells page scripts. Sites under privacy laws such as the CCPA must honour it."
          value={privacy().gpc ? 'on' : 'off'}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(value) => update({ gpc: value === 'on' })}
        />
      </div>
      <h2 class="section-header">Site permissions</h2>
      <div class="list settings-permissions">
        <div class="row">
          <span class="row-tile">
            <Icon name="camera" />
          </span>
          <span class="row-text">
            <span class="row-title">Sites ask first</span>
            <span class="row-desc">
              Camera, microphone, location, notifications, clipboard, MIDI and devices on your
              network: a site asks, and your answer is kept here. The lock in the address field
              changes them for the open site. {PERMISSION_NOTES.location}
            </span>
          </span>
        </div>
        <div class="list-divider" />
        <SitePermissions sites={sites()} />
      </div>
    </>
  )
}
