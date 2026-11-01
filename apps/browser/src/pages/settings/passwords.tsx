import { For, Show, type JSX } from 'solid-js'
import type { SafeSettings, Settings } from '@ewe/shared'
import { Switch } from '../../ui/components/Switch'
import { Divider, Group, Row } from './controls'

type Flag = Exclude<keyof SafeSettings, 'neverSave'>

const ROWS: { key: Flag; title: string; description: string; class: string }[] = [
  {
    key: 'fill',
    title: 'Fill from ewe Safe',
    description: 'A key in sign-in fields lists your logins for that site',
    class: 'settings-safe-fill',
  },
  {
    key: 'suggest',
    title: 'Show logins when a field gets focus',
    description: 'Off: only the key in the field opens the list',
    class: 'settings-safe-suggest',
  },
  {
    key: 'passkeys',
    title: 'Passkeys',
    description: 'Sites save passkeys in ewe Safe and sign you in with them',
    class: 'settings-safe-passkeys',
  },
  {
    key: 'fillAddresses',
    title: 'Fill addresses',
    description: 'Address fields list your addresses',
    class: 'settings-safe-addresses',
  },
  {
    key: 'fillCards',
    title: 'Fill cards',
    description: 'ewe Safe asks for your password first. Secure (https) pages only.',
    class: 'settings-safe-cards',
  },
  {
    key: 'offerSave',
    title: 'Offer to save logins',
    description: 'After you sign in or sign up, and when a password changes',
    class: 'settings-safe-save',
  },
]

export function Passwords(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const safe = () => props.settings().safe
  const set = (patch: Partial<SafeSettings>) => props.update({ safe: { ...safe(), ...patch } })
  return (
    <>
      <Group class="settings-passwords">
        <For each={ROWS}>
          {(row, i) => (
            <>
              <Show when={i() > 0}>
                <Divider />
              </Show>
              <Row title={row.title} description={row.description}>
                <Switch
                  label={row.title}
                  class={row.class}
                  checked={safe()[row.key]}
                  onChange={(on) => set({ [row.key]: on })}
                />
              </Row>
            </>
          )}
        </For>
      </Group>
      <Show when={safe().neverSave.length > 0}>
        <Group title="Never offered to save on">
          <For each={safe().neverSave}>
            {(host, i) => (
              <>
                <Show when={i() > 0}>
                  <Divider />
                </Show>
                <Row title={host} class="settings-safe-never">
                  <button
                    class="btn btn--ghost btn--sm"
                    onClick={() => set({ neverSave: safe().neverSave.filter((h) => h !== host) })}
                  >
                    Remove
                  </button>
                </Row>
              </>
            )}
          </For>
        </Group>
      </Show>
      <p class="settings-note settings-safe-only">
        ewe Browser fills passwords only from ewe Safe, so password-manager extensions (1Password,
        Bitwarden, LastPass and others) can’t be added. Ctrl+Shift+L, the key in the address field
        and the right-click menu open ewe Safe in a sign-in field.
      </p>
    </>
  )
}
