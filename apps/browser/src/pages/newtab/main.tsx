import { createEffect, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import '../../ui/styles/base.css'
import '../pages.css'
import { Palette } from '../../ui/components/Palette'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

function NewTab(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  return (
    <div class="page page-newtab">
      <Palette
        large
        tabs={store.tabs()}
        bookmarks={store.bookmarks()}
        engine={store.settings().searchEngine}
        onNavigate={(input) => void api.send({ type: 'tab.navigate', input })}
        onActivate={(id) => void api.send({ type: 'tab.activate', id })}
      />
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <NewTab />, root)
