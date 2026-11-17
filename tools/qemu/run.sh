#!/bin/bash
# The real firmware in Espressif's QEMU for the ESP32-S3, without the board (tools/qemu/README.md).
#   tools/qemu/run.sh image             fetch the pinned QEMU, build the firmware's QEMU variant, write the flash image
#   tools/qemu/run.sh [options]         the same, then run it
#     --serial stdio|pty|tcp:PORT       UART0, where the bridge talks to the board (default stdio; pty prints its path)
#     --wait                            with tcp:PORT, start the chip only once something connects (no boot line lost)
#     --qmp PORT                        QEMU's control protocol on 127.0.0.1:PORT (screendump, stop, cont)
#     --window                          show the virtual panel in a window (SDL)
#     --no-build                        run the image already written
# ART=path chooses the art written at 0x410000 (default firmware/data/sage.bin), ART=0 leaves the partition empty.
# Apple Silicon only; needs Homebrew's pixman, libgcrypt and SDL2, which the release is linked against.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/tools/qemu"
CACHE="$HERE/.cache"                   # git-ignored: QEMU and the flash image
VENV="${VENV:-$ROOT/tools/.venv}"
TAG=esp-develop-9.2.2-20261109        # ESP32-S3 with QIO flash and octal PSRAM boots from this release on
ASSET=qemu-xtensa-softmmu-esp_develop_9.2.2_20261109-aarch64-apple-darwin.tar.xz
SHA256=35d0b68908c90697f997543e0c604d4462b46abff7c4bcb07ba513dcc300c792
QEMU="$CACHE/$TAG/qemu/bin/qemu-system-xtensa"
IMG="$CACHE/flash.bin"
B="$ROOT/firmware/.pio/build/qemu"
BOOT_APP0="$HOME/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
ART_ADDR=0x410000                      # the "sage" partition in firmware/partitions_sage.csv

fetch() {
  [ -x "$QEMU" ] && return
  [ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] || { echo "tools/qemu pins QEMU for Apple Silicon only"; exit 1; }
  mkdir -p "$CACHE/$TAG"
  curl -fsSL -o "$CACHE/$ASSET" "https://github.com/espressif/qemu/releases/download/$TAG/$ASSET"
  echo "$SHA256  $CACHE/$ASSET" | shasum -a 256 -c - >/dev/null || { rm -f "$CACHE/$ASSET"; echo "QEMU's archive does not match its pinned SHA-256"; exit 1; }
  tar -xJf "$CACHE/$ASSET" -C "$CACHE/$TAG" && rm -f "$CACHE/$ASSET"
}

libs() {
  for l in /opt/homebrew/opt/pixman/lib/libpixman-1.0.dylib /opt/homebrew/opt/libgcrypt/lib/libgcrypt.20.dylib; do
    [ -f "$l" ] || { echo "QEMU needs $l: brew install pixman libgcrypt sdl2-compat"; exit 1; }
  done
  [ -f /opt/homebrew/opt/sdl2-compat/lib/libSDL2-2.0.0.dylib ] || [ -f /opt/homebrew/opt/sdl2/lib/libSDL2-2.0.0.dylib ] \
    || { echo "QEMU needs SDL2: brew install sdl2-compat"; exit 1; }
}

image() {
  [ -x "$VENV/bin/pio" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" -q install platformio; }
  [ "$("$VENV/bin/esptool" version 2>/dev/null | tail -1)" = "5.6.0" ] || "$VENV/bin/pip" -q install esptool==5.6.0
  (cd "$ROOT/firmware" && nice -n 19 "$VENV/bin/pio" run -e qemu) >&2
  local art=()
  [ "${ART:-}" = "0" ] || art=("$ART_ADDR" "${ART:-$ROOT/firmware/data/sage.bin}")
  # as tools/flash.sh writes the board: DIO, 16 MB, the program in app0 made the boot slot
  nice -n 19 "$VENV/bin/esptool" --chip esp32s3 merge-bin -o "$IMG" --flash-mode dio --flash-size 16MB --pad-to-size 16MB \
    0x0 "$B/bootloader.bin" 0x8000 "$B/partitions.bin" 0xe000 "$BOOT_APP0" 0x10000 "$B/firmware.bin" ${art[@]+"${art[@]}"} >/dev/null
  echo "$IMG"
}

fetch
libs
if [ "${1:-}" = "image" ]; then image; exit; fi

serial=stdio wait=off qmp= display=none build=1
while [ $# -gt 0 ]; do
  case "$1" in
    --serial) serial="$2"; shift ;;
    --wait) wait=on ;;
    --qmp) qmp="$2"; shift ;;
    --window) display=sdl ;;
    --no-build) build=0 ;;
    *) echo "unknown option $1 (see the top of tools/qemu/run.sh)"; exit 1 ;;
  esac
  shift
done
[ "$build" = 0 ] && [ -f "$IMG" ] || image >/dev/null
case "$serial" in
  tcp:*) serial="tcp:127.0.0.1:${serial#tcp:},server=on,wait=$wait" ;;
esac
args=(-machine esp32s3 -m 8M -global driver=ssi_psram,property=is_octal,value=true   # the board's 8 MB of octal PSRAM
      -drive "file=$IMG,if=mtd,format=raw" -display "$display" -serial "$serial" -monitor none)
[ -n "$qmp" ] && args+=(-qmp "tcp:127.0.0.1:$qmp,server=on,wait=off")
# The release looks for SDL2 where Homebrew's sdl2-compat puts it; the older sdl2 formula is the same library.
exec nice -n 19 env DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/opt/sdl2-compat/lib:/opt/homebrew/opt/sdl2/lib "$QEMU" "${args[@]}"
