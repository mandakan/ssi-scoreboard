#!/usr/bin/env bash
# generate-icons.sh
#
# Generates all derivative icon/logo assets from the master source SVG:
#   assets/icons/source/checkmark-logo.svg
#
# Outputs:
#   assets/icons/pwa/         source-of-truth for generated PNGs
#   public/icons/             deploy-ready copies
#   public/logo-dark.svg      transparent-bg logo for dark backgrounds
#   public/logo-light.svg     transparent-bg logo for light backgrounds
#   app/favicon.ico           16/32/48/256 multi-size browser favicon
#   app/icon.svg              SVG favicon (Next.js auto-links this)
#
# Requirements: inkscape, imagemagick (magick), python3
#
# Usage:
#   pnpm icons            (via package.json)
#   bash scripts/generate-icons.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/assets/icons/source/checkmark-logo.svg"
PWA="$REPO_ROOT/assets/icons/pwa"
PUB_ICONS="$REPO_ROOT/public/icons"
APP="$REPO_ROOT/app"
PUB="$REPO_ROOT/public"

# Background colour used when padding icons to a square canvas
DARK_BG="#09090b"

# Rounded-corner radii (~22% of icon size, close to iOS squircle)
R_512=115
R_192=43

# ── dependency check ─────────────────────────────────────────────────────────
for cmd in inkscape magick python3; do
  command -v "$cmd" >/dev/null 2>&1 \
    || { echo "ERROR: '$cmd' is required but not found in PATH"; exit 1; }
done

echo "Source: $SRC"
echo ""

# ── working directory ─────────────────────────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$PWA" "$PUB_ICONS"

# ── 1. high-res PNG from drawing area ────────────────────────────────────────
echo "[1/6] Exporting high-res PNG from drawing area…"
inkscape \
  --export-type=png \
  --export-area-drawing \
  --export-width=1024 \
  --export-filename="$TMP/logo-hires.png" \
  "$SRC" 2>/dev/null

# ── 2. maskable icons (solid square, full-bleed) ─────────────────────────────
echo "[2/6] Generating maskable icons (solid square)…"

# Centre the (slightly non-square) logo on a square canvas with the dark bg
magick "$TMP/logo-hires.png" \
  -background "$DARK_BG" -gravity Center -extent 1024x1024 \
  -resize 512x512 \
  "$PWA/icon-512.png"

magick "$PWA/icon-512.png" -resize 192x192 "$PWA/icon-192.png"
magick "$PWA/icon-512.png" -resize 180x180 "$PWA/apple-touch-icon.png"

# ── 3. "any" icons (transparent rounded corners) ─────────────────────────────
echo "[3/6] Generating rounded-corner icons (any)…"

_round() {
  local src="$1" dst="$2" r="$3"
  magick "$src" \
    \( +clone -alpha extract \
       -draw "fill black polygon 0,0 0,$r $r,0 \
              fill white circle $r,$r $r,0" \
       \( +clone -flip \) -compose Multiply -composite \
       \( +clone -flop \) -compose Multiply -composite \
    \) -alpha off -compose CopyOpacity -composite \
    "$dst"
}

_round "$PWA/icon-512.png" "$PWA/icon-512-any.png" "$R_512"
_round "$PWA/icon-192.png" "$PWA/icon-192-any.png" "$R_192"

# ── 4. copy to public/icons/ ─────────────────────────────────────────────────
echo "[4/6] Copying to public/icons/…"
cp "$PWA/icon-512.png"         "$PUB_ICONS/icon-512.png"
cp "$PWA/icon-192.png"         "$PUB_ICONS/icon-192.png"
cp "$PWA/icon-512-any.png"     "$PUB_ICONS/icon-512-any.png"
cp "$PWA/icon-192-any.png"     "$PUB_ICONS/icon-192-any.png"
cp "$PWA/apple-touch-icon.png" "$PUB_ICONS/apple-touch-icon.png"

# ── 5. favicon.ico (16 / 32 / 48 / 256) ─────────────────────────────────────
echo "[5/6] Generating favicon.ico and app/icon.svg…"

inkscape \
  --export-type=png \
  --export-area-drawing \
  --export-width=256 \
  --export-filename="$TMP/fav-raw.png" \
  "$SRC" 2>/dev/null

magick "$TMP/fav-raw.png" \
  -background "$DARK_BG" -gravity Center -extent 256x256 \
  "$TMP/fav-256.png"

magick "$TMP/fav-256.png" -resize 48x48 "$TMP/fav-48.png"
magick "$TMP/fav-256.png" -resize 32x32 "$TMP/fav-32.png"
magick "$TMP/fav-256.png" -resize 16x16 "$TMP/fav-16.png"

magick "$TMP/fav-16.png" "$TMP/fav-32.png" "$TMP/fav-48.png" "$TMP/fav-256.png" \
  "$APP/favicon.ico"

# SVG favicon: plain SVG cropped to the drawing area, no Inkscape metadata
inkscape \
  --export-type=svg \
  --export-area-drawing \
  --export-plain-svg \
  --export-filename="$APP/icon.svg" \
  "$SRC" 2>/dev/null

# ── 6. theme-adaptive logos for the app header ───────────────────────────────
echo "[6/6] Generating public/logo-dark.svg and public/logo-light.svg…"

python3 - "$SRC" "$PUB" << 'PYEOF'
import sys, xml.etree.ElementTree as ET

ET.register_namespace('', 'http://www.w3.org/2000/svg')
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
ET.register_namespace('inkscape', 'http://www.inkscape.org/namespaces/inkscape')
ET.register_namespace('sodipodi', 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.0')

src, pub = sys.argv[1], sys.argv[2]

BG_IDS = {'bg-rect', 'bg-gradient-base', 'bg-gradient'}

def load():
    return ET.parse(src)

def remove_background(root):
    """Strip the dark background rect and its gradient definitions."""
    for parent in root.iter():
        for child in list(parent):
            if child.get('id', '') in BG_IDS:
                parent.remove(child)

def adjust_for_light(root):
    """
    Make the target-body circle visible on white backgrounds by darkening it
    slightly. This is a rendering adjustment, not a design colour change.
    """
    for el in root.iter():
        style = el.get('style', '')
        if 'fill:#f3f4f6' in style:
            el.set('style', style.replace('fill:#f3f4f6', 'fill:#dde1e7'))

def write(tree, path):
    tree.write(path, xml_declaration=True, encoding='UTF-8')
    with open(path) as f:
        content = f.read()
    # ET adds namespace prefixes; strip them so the file is clean SVG.
    content = content.replace('ns0:', '').replace(':ns0', '')
    with open(path, 'w') as f:
        f.write(content)

# Dark variant — transparent background, original element colours
t = load()
remove_background(t.getroot())
write(t, f'{pub}/logo-dark.svg')

# Light variant — transparent background, target circle darkened for contrast
t = load()
remove_background(t.getroot())
adjust_for_light(t.getroot())
write(t, f'{pub}/logo-light.svg')
PYEOF

# ── summary ──────────────────────────────────────────────────────────────────
echo ""
echo "Done. Generated assets:"
echo ""
echo "  assets/icons/pwa/"
for f in icon-512.png icon-192.png apple-touch-icon.png icon-512-any.png icon-192-any.png; do
  size=$(magick identify -format '%wx%h' "$PWA/$f" 2>/dev/null || echo '?')
  echo "    $f  ($size)"
done
echo ""
echo "  public/icons/         (deploy-ready copies of the above)"
echo ""
echo "  app/favicon.ico       $(magick identify "$APP/favicon.ico" 2>/dev/null | awk '{print $3}' | tr '\n' ' ')"
echo "  app/icon.svg          SVG favicon (Next.js auto-links)"
echo "  public/logo-dark.svg  transparent logo for dark backgrounds"
echo "  public/logo-light.svg transparent logo for light backgrounds"
