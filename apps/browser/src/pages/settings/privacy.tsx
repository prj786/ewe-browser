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
import { EmptyState } from '../../ui/components/EmptyState'
import { Icon } from '../../ui/components/Icon'
import { Segmented } from '../../ui/components/Segmented'
import { Switch } from '../../ui/components/Switch'
import { api } from '../../ui/lib/api'
import { PERMISSION_ICONS } from '../../ui/lib/permissions'
import { Divider, Group, Row, Select } from './controls'
import './privacy.css'

const PROVIDERS: DohProvider[] = ['cloudflare', 'quad9', 'mullvad', 'adguard', 'nextdns', 'custom']

function dnsChoice(p: PrivacySettings): string {
  return p.secureDns === 'secure' ? p.dnsProvider : p.secureDns
}

function dnsDescription(p: PrivacySettings): string {
  if (p.secureDns === 'off') return 'Your network looks up site names, as usual'
  if (p.secureDns === 'automatic') return 'Encrypted when your network’s DNS supports it'
  const name = p.dnsProvider === 'custom' ? 'your server' : DOH_PROVIDERS[p.dnsProvider].name
  return `Always encrypted, through ${name}. If it can’t be reached, sites don’t load.`
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
    <Row
      title={nextdns() ? 'NextDNS configuration ID' : 'DNS-over-HTTPS address'}
      description={
        <span classList={{ 'row-warning': draft().trim() !== '' && !valid() }}>
          {nextdns()
            ? 'Six letters and digits from my.nextdns.io, like abc123'
            : 'Like https://dns.example/dns-query'}
        </span>
      }
    >
      <input
        class="settings-field settings-dns-field"
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
    </Row>
  )
}

const PERMISSION_CHOICES = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'block', label: 'Block' },
]

function SiteRows(props: { sites: PermissionSite[] }): JSX.Element {
  const set = (origin: string, kind: PermissionKind, value: PermissionValue) =>
    void api.send({ type: 'permission.set', origin, kind, value })
  return (
    <For
      each={props.sites}
      fallback={
        <EmptyState
          compact
          icon="shield-check"
          title="No site has asked yet"
          class="settings-sites-empty"
        >
          When a site asks for your camera, microphone or location, your answer is kept here.
        </EmptyState>
      }
    >
      {(site, i) => (
        <>
          <Show when={i() > 0}>
            <Divider />
          </Show>
          <div class="settings-site" data-origin={site.origin}>
            <div class="row settings-site-head">
              <span class="settings-site-icon">
                <Icon name={site.origin.startsWith('https:') ? 'lock' : 'lock-open'} />
              </span>
              <span class="row-text">
                <span class="row-title">{originHost(site.origin)}</span>
                <span class="row-desc">{site.origin}</span>
              </span>
              <span class="row-trail">
                <button
                  class="btn btn--ghost btn--sm settings-site-forget"
                  onClick={() => void api.send({ type: 'permission.forget', origin: site.origin })}
                >
                  Forget
                </button>
              </span>
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
                  <span class="row-trail">
                    <Segmented
                      small
                      label={`${PERMISSION_LABELS[kind]} for ${originHost(site.origin)}`}
                      value={site.permissions[kind] ?? 'ask'}
                      options={PERMISSION_CHOICES}
                      onChange={(value) => set(site.origin, kind, value as PermissionValue)}
                    />
                  </span>
                </div>
              )}
            </For>
          </div>
        </>
      )}
    </For>
  )
}

export function SitePermissions(): JSX.Element {
  const [sites, setSites] = createSignal<PermissionSite[]>([])
  const load = () =>
    void api.permissions<PermissionSite[]>({ op: 'list' }).then((list) => setSites(list ?? []))
  onMount(() => {
    load()
    onCleanup(api.onPermissions(load))
  })
  return (
    <>
      <Group class="settings-permissions">
        <SiteRows sites={sites()} />
      </Group>
      <p class="settings-note">
        The lock in the address field changes them for the site you have open.{' '}
        {PERMISSION_NOTES.location}
      </p>
    </>
  )
}

export function Privacy(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [status, setStatus] = createSignal<PrivacyStatus | null>(null)
  const privacy = () => props.settings().privacy
  const update = (patch: Partial<PrivacySettings>) =>
    props.update({ privacy: { ...privacy(), ...patch } })
  const loadStatus = () => void api.permissions<PrivacyStatus>({ op: 'status' }).then(setStatus)

  onMount(loadStatus)
  createEffect(on(privacy, loadStatus, { defer: true }))

  const restart = () => {
    const s = status()
    return s !== null && s.thirdPartyBlocked !== privacy().blockThirdPartyCookies
  }

  return (
    <Group class="settings-privacy">
      <Row
        title="Secure DNS"
        description={
          <>
            {dnsDescription(privacy())}
            <Show when={status()?.dnsError}>
              {(error) => <span class="row-warning settings-dns-error">{error()}</span>}
            </Show>
          </>
        }
      >
        <Select
          label="Secure DNS"
          class="settings-secure-dns"
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
      </Row>
      <Show
        when={
          privacy().secureDns === 'secure' &&
          (privacy().dnsProvider === 'nextdns' || privacy().dnsProvider === 'custom')
        }
      >
        <DnsField privacy={privacy()} update={update} />
      </Show>
      <Divider />
      <Row
        title="HTTPS-Only"
        description="Opens sites over https:// and warns you before an http one. Local addresses are left alone."
      >
        <Switch
          label="HTTPS-Only"
          class="settings-https-only"
          checked={privacy().httpsOnly}
          onChange={(on) => update({ httpsOnly: on })}
        />
      </Row>
      <Divider />
      <Row
        title="Third-party cookies"
        description={
          <>
            Blocking stops trackers embedded in pages. A few embedded sign-ins need them.
            <Show when={restart()}>
              <span class="row-warning settings-restart">Restart ewe Browser to apply.</span>
            </Show>
          </>
        }
      >
        <Segmented
          small
          label="Third-party cookies"
          class="settings-third-party"
          value={privacy().blockThirdPartyCookies ? 'block' : 'allow'}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'allow', label: 'Allow' },
          ]}
          onChange={(value) => update({ blockThirdPartyCookies: value === 'block' })}
        />
      </Row>
      <Divider />
      <Row
        title="Ask sites not to sell or share your data"
        description="Sends Global Privacy Control with every request"
      >
        <Switch
          label="Ask sites not to sell or share your data"
          class="settings-gpc"
          checked={privacy().gpc}
          onChange={(on) => update({ gpc: on })}
        />
      </Row>
    </Group>
  )
}
