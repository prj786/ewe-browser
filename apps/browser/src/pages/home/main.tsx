import { createEffect, Show, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import '../../ui/styles/base.css'
import '../pages.css'
import { Palette } from '../../ui/components/Palette'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function Home(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const name = () => (store.account()?.name ?? '').split('@')[0] ?? ''
  return (
    <div class="page page-home">
      <div class="home">
        <div class="home-head">
          <h1>
            {greeting(new Date())}
            <Show when={name() !== ''}>{`, ${name()}`}</Show>
          </h1>
          <p>Where to next?</p>
        </div>
        <Palette
          large
          tabs={store.tabs()}
          bookmarks={store.bookmarks()}
          engine={store.settings().searchEngine}
          onNavigate={(input) => void api.send({ type: 'tab.navigate', input })}
          onActivate={(id) => void api.send({ type: 'tab.activate', id })}
        />
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <Home />, root)
