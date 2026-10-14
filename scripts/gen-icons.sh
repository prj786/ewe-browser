#!/usr/bin/env bash
# Rasterise the app's one SVG source into the PNGs the package installs.
#   packaging/ewe-browser.svg → packaging/icons/{32,64,128,256,512}x*.png
# Needs rsvg-convert (librsvg). Run after editing the SVG; the PNGs are
# committed so a checkout builds without librsvg.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v rsvg-convert >/dev/null || { echo "rsvg-convert (librsvg) is required" >&2; exit 1; }
src=packaging/ewe-browser.svg
out=packaging/icons
mkdir -p "$out"
for s in 32 64 128 256 512; do
    rsvg-convert -w "$s" -h "$s" "$src" -o "$out/${s}x${s}.png"
done
ls -1 "$out"
