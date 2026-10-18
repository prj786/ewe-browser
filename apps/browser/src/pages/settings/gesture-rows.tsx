import type { JSX } from 'solid-js'
import type { Settings } from '@ewe/shared'
import { Icon } from '../../ui/components/Icon'

export function GestureRows(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  return (
    <>
      <div class="list-divider" />
      <div class="row">
        <span class="row-tile">
          <Icon name="arrow-left" />
        </span>
        <span class="row-text">
          <span class="row-title">Swipe to go back</span>
          <span class="row-desc">
            Two fingers left or right on the touchpad go back or forward. The mouse side buttons
            always do.
          </span>
        </span>
        <span class="select">
          <select
            aria-label="Swipe to go back"
            class="settings-swipe"
            value={props.settings().gestures.swipe ? 'on' : 'off'}
            onChange={(e) => props.update({ gestures: { swipe: e.currentTarget.value === 'on' } })}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <Icon name="chevron-down" />
        </span>
      </div>
    </>
  )
}
