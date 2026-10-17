# Maintainer: scubba
#
# ewe browser — the ewe desktop's browser, files and music app. Electron, so the
# package carries its own runtime: Widevine needs castlabs' Electron build
# (electron-releases +wvcus), which no Arch package provides. electron-builder
# lays out that runtime plus app.asar; this PKGBUILD installs the directory.

pkgname=ewe-browser
# The git TAG and the pacman pkgver are different strings and always
# will be: a tag may carry -beta, an Arch pkgver may not contain a
# hyphen. Of the legal spellings only 0.12.1beta sorts BELOW the
# eventual 0.12.1 under vercmp. The archive is addressed by the TAG and
# extracts to <repo>-<tag without the leading v>, so the source URL and
# the directory below follow _tag, never pkgver. The release workflow
# rewrites both.
_tag=v0.3.0-beta
pkgver=0.3.0beta
pkgrel=1
pkgdesc="ewe browser — the web, your files and your music in one window"
arch=('x86_64')
url="https://github.com/prj786/ewe-browser"
license=('GPL-3.0-only')

depends=(
  # what the bundled Chromium links against (ldd); the rest come with gtk3
  'gtk3'
  'nss'
  'alsa-lib'
  'libpulse'                  # dlopened for audio output
  'libcups'
  'mesa'
  'libxkbcommon'
  'libdrm'
  'at-spi2-core'
  # the tools the app runs
  'glib2'                     # gio open / gio mime: files open with the GIO default
  'libarchive'                # bsdtar: archive listing, extract and compress
)
optdepends=(
  'ewe: the desktop this is the browser of (theme, ewe-cloud sync, ewe-pass, ewe-files)'
  'ffmpegthumbnailer: video thumbnails in the file manager and on the home page'
  'mpv: play videos Chromium cannot decode'
)
makedepends=('git' 'nodejs' 'npm')

# Chromium's binaries ship stripped already; makepkg's strip and debug passes
# over ~280 MB of runtime only cost minutes.
options=(!strip !debug)

source=("$pkgname-$pkgver.tar.gz::$url/archive/refs/tags/$_tag.tar.gz")
sha256sums=('SKIP')

build() {
  cd "$srcdir/$pkgname-${_tag#v}"
  # pnpm through npx at the version the lockfile was written with; the pnpm
  # shim some machines have is not reliable. The postinstall fetches castlabs'
  # Electron (github:castlabs/electron-releases) into node_modules/electron.
  npx -y pnpm@11.13.0 install --frozen-lockfile
  npx -y pnpm@11.13.0 build
  cd apps/browser
  npx -y pnpm@11.13.0 exec electron-builder --linux --publish never
}

package() {
  cd "$srcdir/$pkgname-${_tag#v}"

  install -d "$pkgdir/usr/lib/$pkgname"
  cp -a apps/browser/dist/linux-unpacked/. "$pkgdir/usr/lib/$pkgname/"
  # Electron's fallback app is never loaded (app.asar sits next to it), and the
  # runtime arrives group-writable from its zip; root-owned files should not be.
  rm -f "$pkgdir/usr/lib/$pkgname/resources/default_app.asar"
  chmod -R go-w "$pkgdir/usr/lib/$pkgname"
  # A small sh wrapper, not a symlink: a verb as the first argument
  # (ewe-browser help) runs the JSON command line in Electron's Node mode,
  # anything else starts the browser. Electron finds its resources next to the
  # real binary (/proc/self/exe) either way.
  install -Dm755 packaging/ewe-browser.sh "$pkgdir/usr/bin/ewe-browser"

  # chrome-sandbox stays non-setuid: Arch's kernel allows unprivileged user
  # namespaces, which is the sandbox Chromium uses first.
  chmod 0755 "$pkgdir/usr/lib/$pkgname/chrome-sandbox"

  install -Dm644 packaging/ewe-browser.desktop \
    "$pkgdir/usr/share/applications/ewe-browser.desktop"
  for s in 32 64 128 256 512; do
    install -Dm644 "packaging/icons/${s}x${s}.png" \
      "$pkgdir/usr/share/icons/hicolor/${s}x${s}/apps/ewe-browser.png"
  done
  install -Dm644 packaging/ewe-browser.svg \
    "$pkgdir/usr/share/icons/hicolor/scalable/apps/ewe-browser.svg"
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
