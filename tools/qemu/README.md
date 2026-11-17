# The real firmware in QEMU

The board's own firmware, the compiled binary, running in Espressif's QEMU for the ESP32-S3: its loop and tasks, the art partition read from flash, the serial protocol in C++, the offline mode and the antenna. It is the firmware the board will run, with one addition that only the QEMU build has, so its screen can be seen. Nothing here flashes anything.

## Running it

```sh
tools/qemu/run.sh                     # build, then run with UART0 on this terminal: type "s working", "e holo_tests", "?"
tools/qemu/run.sh --window            # the same, with the panel in a window
tools/qemu/run.sh --serial pty        # UART0 on a pty, for the bridge (its path is printed)
tools/qemu/run.sh image               # only fetch QEMU, build and write the flash image
```

- The first run downloads QEMU `esp-develop-9.2.2-20261109` for Apple Silicon (its SHA-256 is pinned in `run.sh`) into `tools/qemu/.cache/`, which git ignores, with the flash image. The release is linked against Homebrew's `pixman`, `libgcrypt` and SDL2 (`sdl2-compat`, or the older `sdl2`), and needs macOS 15.
- It builds with PlatformIO in `tools/.venv` (created with PlatformIO and esptool 5.6.0 if missing) and merges a 16 MB image as `tools/flash.sh` writes the board: bootloader, partition table, `boot_app0`, the program in `app0`, and `firmware/data/sage.bin` at 0x410000 (`ART=path` for another, `ART=0` for none).
- QEMU gets the board's 8 MB of octal PSRAM (`-m 8M` and `is_octal`). `--serial tcp:PORT` puts UART0 on a TCP port instead (`--wait` holds the chip until something connects), `--qmp PORT` opens QEMU's control protocol, `--snapshot` drops whatever the firmware writes to flash, and `--no-build` runs the image already written. Ctrl-C stops it.
- QEMU runs under `nice -n 19`.

The real bridge talks to it as to a board on USB: run QEMU with `--serial pty`, then, from the repository, `DESKBUDDY_PORT=/dev/ttys001 tools/.venv/bin/python tools/buddy_bridge.py` with the path it printed. The bridge needs pyserial, which `tools/.venv` has. Stop a bridge that is already running first: both want port 47823, which is where Claude Code's hooks post.

## The checks

```sh
node tools/qemu/check.mjs [--no-build] [--sheet out.png]    # the protocol, every mood, acts of each kind, offline and back
node tools/qemu/bridge.mjs [--no-build] [--sheet out.png]   # the real bridge and Sage's mind driving it
```

- `check.mjs` (about three minutes, a minute of it the board's own wait for the bridge) boots the image and talks to UART0 as the bridge does. It checks the boot lines (the art's moods, sequences and frames, as the emulator reads the same file; no motion sensor, no Wi-Fi set up), the rain after a boot, the antenna dark with no bridge and its relink ring when the bridge speaks, every mood, six acts (instructions, a hologram, glyphs, the Game of Life, a camera move, a failing test), the board's own choice of a tap and a fidget, a tap only reported while the bridge is there, the replies of every other command, the corner extras, a minute of silence (offline, through the rain, the antenna dark) and the bridge coming back with a hello.
- At each moment it stops the chip, takes the panel with QEMU's `screendump`, and finds the frame of the sequence the board said it was playing, with the antenna's step where it shows, that is closest when the emulator's board (`emulator/board.mjs`) draws it. It passes within the bake's tolerance (a mean of 2% of full scale, 300 pixels off by more than a quarter). The output gives each match with how many pixels differ at all and by how much, the closest frame that looks different, and for the antenna the best without it, so a match is seen to tell frames apart.
- `bridge.mjs` (under a minute) runs QEMU with UART0 on a pty, starts the real bridge on it from `tools/.venv` with a temporary home, posts hooks as Claude Code posts them (a session starting, a failing `npm test`, a compaction, a push), and for each reads the act the mind chose, asks the board through the bridge's `/cmd` until it plays that act, and sets the panel against the emulator's frames of it. A tap goes the other way: `X` makes the firmware say `tap`, and the mind answers it.
- `--sheet` writes a contact sheet: one row a moment, QEMU's panel, the emulator's frame and their difference four times brighter.
- QEMU is not cycle-accurate: the `fps` and `draw_ms` the firmware reports there, and every time the checks print, are this Mac's emulation, never the board's.

## The QEMU build

`firmware/platformio.ini` has an env `qemu` beside the board's `buddy`. It builds the same sources with the same flags, and adds `firmware/qemu/qemu_panel.cpp` and a linker flag that wraps LovyanGFX's `LGFXBase::pushImage`: every whole-screen sprite the firmware pushes is also copied into QEMU's virtual RGB panel (`hw/display/esp_rgb.c` in espressif/qemu), byte-swapped to the panel's RGB565, into one half of the panel's memory while the other holds the last whole frame. What is copied is the sprite as drawn, before LovyanGFX mirrors it for the prism, which is what the emulator's page shows too.

`main.cpp` is not touched, and `pio run` builds only `buddy` (`default_envs`). The board's `firmware.bin` was checked byte for byte against the one built from main before this work, both built with `SOURCE_DATE_EPOCH` fixed: the Arduino core prints its compile date and time at boot, so two builds made at different times differ in those bytes and in the hashes after them.

The wrap names LovyanGFX's function by its mangled name. If a LovyanGFX update renames it, the QEMU build fails to link, and says so; the board's build is not affected.

## What QEMU has, and what it does not

Observed with this release, with this firmware:

| Part | In QEMU | What it means here |
|---|---|---|
| CPU, both cores, FreeRTOS | yes | `setup()`, the loop, the timers |
| ROM | Espressif's ROM image, shipped with QEMU | the ROM's tinfl inflates every compressed frame |
| 16 MB flash, its MMU and cache | yes | the art partition memory-mapped and read; NVS written and read back |
| Octal PSRAM | yes, with `-m 8M` and `is_octal` | the inflate window and the renderer's buffers live there. Without PSRAM, or with quad PSRAM, ESP-IDF says the chip is not connected and the firmware stops at "err art missing or bad" |
| UART0 | yes | the whole serial protocol, over TCP or a pty |
| ST7789 on SPI2 | no: SPI2 has no model, its registers read 0 and take nothing | LovyanGFX's init and every push run without hanging and draw nothing; the QEMU build copies the sprite to the virtual panel instead |
| Virtual RGB panel | yes (not on any real chip) | the screen in the checks and the window; refreshed only on a screendump or by the window |
| QMI8658 on I2C | no I2C controller is modelled | "imu not found", and the firmware carries on; taps only as `X` |
| Wi-Fi | no radio | not set up, the firmware carries on ("wifi not set up", `W` says `wifi=off`). Set up with `w`, it saves to NVS, restarts, and then hangs in the radio's calibration (`esp_phy_enable`, `rf_init`, `ram_read_sar2_code`) before its loop |
| LEDC (the backlight) | no model | `analogWrite` runs and changes nothing |
| Random numbers, a restart | yes | the board's own picks; the restart after `w` boots again |
| Timer group watchdogs | modelled | none fired in any run |

What this leaves unchecked: the panel itself (LovyanGFX's ST7789 init, the mirroring for the prism, the SPI at 80 MHz and its DMA), the backlight, the motion sensor (a real tap, a tap offline, which a command cannot pretend as any command counts as the bridge), everything over Wi-Fi (the TCP link and its pairing, updates, clips, mDNS, the internet clock), the screens drawn straight to the display rather than through the sprite (an update's progress, "no drawings yet"), and every timing.
