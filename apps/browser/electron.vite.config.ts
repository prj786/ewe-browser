import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import solid from 'vite-plugin-solid'

const shared = resolve(__dirname, '../../packages/shared/src/index.ts')

function devCsp(): Plugin {
  return {
    name: 'ewe-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' http://localhost:*")
        .replace(
          "style-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' http://localhost:*",
        )
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*")
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@ewe/shared': shared } },
    build: {
      externalizeDeps: { exclude: ['@ewe/shared', 'music-metadata'] },
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: { '@ewe/shared': shared } },
    build: {
      externalizeDeps: { exclude: ['@ewe/shared'] },
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [solid(), devCsp()],
    resolve: { alias: { '@ewe/shared': shared, '@ui': resolve(__dirname, 'src/ui') } },
    server: { hmr: { host: 'localhost' } },
    build: {
      rollupOptions: {
        input: {
          shell: resolve(__dirname, 'src/ui/shell/index.html'),
          overlay: resolve(__dirname, 'src/ui/overlay/index.html'),
          sidebar: resolve(__dirname, 'src/ui/sidebar/index.html'),
          home: resolve(__dirname, 'src/pages/home/index.html'),
          newtab: resolve(__dirname, 'src/pages/newtab/index.html'),
          settings: resolve(__dirname, 'src/pages/settings/index.html'),
          files: resolve(__dirname, 'src/pages/files/index.html'),
          music: resolve(__dirname, 'src/pages/music/index.html'),
          sad: resolve(__dirname, 'src/pages/sad/index.html'),
        },
      },
    },
  },
})
