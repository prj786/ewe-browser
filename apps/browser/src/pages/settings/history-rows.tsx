import { For, type JSX } from 'solid-js'
import {
  HISTORY_KEEP_DAYS,
  HISTORY_KEEP_LABELS,
  HISTORY_URL,
  isHistoryKeepDays,
  type Settings,
} from '@ewe/shared'
import { Icon } from '../../ui/components/Icon'
import { api } from '../../ui/lib/api'

export function HistoryRows(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  return (
    <>
      <div class="list-divider" />
      <div class="row">
        <span class="row-tile">
          <Icon name="history" />
        </span>
        <span class="row-text">
          <span class="row-title">Keep history for</span>
          <span class="row-desc">
            Older visits are deleted every day. With sync on, this applies to all your computers.
          </span>
        </span>
        <span class="select">
          <select
            aria-label="Keep history for"
            class="settings-history-keep"
            value={String(props.settings().historyDays)}
            onChange={(e) => {
              const days = Number(e.currentTarget.value)
              if (isHistoryKeepDays(days)) props.update({ historyDays: days })
            }}
          >
            <For each={HISTORY_KEEP_DAYS}>
              {(days) => <option value={String(days)}>{HISTORY_KEEP_LABELS[days]}</option>}
            </For>
          </select>
          <Icon name="chevron-down" />
        </span>
      </div>
      <div class="list-divider" />
      <div class="row">
        <span class="row-tile">
          <Icon name="trash-2" />
        </span>
        <span class="row-text">
          <span class="row-title">History and browsing data</span>
          <span class="row-desc">
            Search and delete history, see tabs from your other computers, clear cookies and cached
            files. Ctrl+Shift+H.
          </span>
        </span>
        <button
          class="btn btn--secondary btn--sm settings-history-open"
          onClick={() => void api.send({ type: 'open.internal', page: 'history' })}
        >
          Open history
        </button>
        <button
          class="btn btn--secondary btn--sm settings-history-clear"
          onClick={() => void api.send({ type: 'tab.create', url: `${HISTORY_URL}?clear=1` })}
        >
          Clear data…
        </button>
      </div>
    </>
  )
}
