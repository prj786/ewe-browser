import { render } from 'solid-js/web'
import '../styles/base.css'
import { OverlayApp } from './App'

const root = document.getElementById('root')
if (root !== null) render(() => <OverlayApp />, root)
