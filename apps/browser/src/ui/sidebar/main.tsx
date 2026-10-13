import { render } from 'solid-js/web'
import '../styles/base.css'
import { SidebarApp } from './App'

const root = document.getElementById('root')
if (root !== null) render(() => <SidebarApp />, root)
