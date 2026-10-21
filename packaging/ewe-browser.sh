#!/bin/sh
# /usr/bin/ewe-browser: the browser, or its JSON command line when the first
# argument is a verb (ewe-browser help). Verbs are lower-case words; a word
# that names an existing file or folder in the working directory still opens
# it in the browser, and so do urls, paths and options. The command line runs
# in Electron's Node mode, so it starts in milliseconds and needs no display.
lib=${EWE_BROWSER_LIB:-/usr/lib/ewe-browser}
cli=
case "$1" in
  --help|-h|--version) cli=1 ;;
  ''|*[!a-z_]*) ;;
  *) [ -e "$1" ] || cli=1 ;;
esac
if [ -n "$cli" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$lib/ewe-browser" "$lib/resources/app.asar/out/main/cli.js" "$@"
fi
# Opened FROM another Electron app (Unity Hub's sign-in, VS Code's links) we
# inherit its CHROME_DESKTOP, and Electron's zygote dies on start with any
# value of it — the link never opens. Electron sets its own when unset.
unset CHROME_DESKTOP
exec "$lib/ewe-browser" "$@"
