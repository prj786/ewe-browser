import { render } from 'solid-js/web'
import '../styles/base.css'
import { ShellApp } from './App'

const root = document.getElementById('root')
if (root !== null) render(() => <ShellApp />, root)
