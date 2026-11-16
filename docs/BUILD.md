# Building one

What it takes to put this on a desk: what to buy, where, what it costs, and how it goes together. Prices were read from each shop on 2026-11-16, in the shop's own currency, and change; shipping and taxes are not included unless a line says so.

The hardware and the code that drives it (the firmware, the Mac bridge, the emulator, the enclosure) are MIT, so anyone can build the device. Sage itself is not: its art is all rights reserved (see [LICENSE-ART.md](../LICENSE-ART.md)), and a board built from this guide plays Sage only on the author's desk. Anyone else's build runs the same engine with a character of their own.

## What to buy

| What | Why | Where | Price | Needed |
|---|---|---|---|---|
| Waveshare ESP32-S3-LCD-1.3-C (SKU 30559): the board with its 1.3 inch display, a plastic case, the stand and the prism cube | It is the whole device | [Waveshare](https://www.waveshare.com/esp32-s3-lcd-1.3.htm?sku=30559) | US$26.99 (US$26.31 to 26.59 for several) | Yes |
| | | [SpotPear](https://spotpear.com/shop/ESP32-S3-1.3-inch-LCD-ST7789-240x240-3D-Display-Transparent-Screen-Refractive-Prism-Mini-TV.html), the same board | $24.9 (the page does not name its currency) | |
| | | [elty.pl](https://elty.pl/en_US/p/ESP32-S3-with-1.3-240240-Display-ST7789V2-Prism-Cube/4002) | €28.66 with 23% VAT, unavailable on that day | |
| A USB-C cable that carries data | Power, and the bridge's link to the board; the -C comes without one | Any | Whatever you have | Yes |
| A Mac | The bridge runs on macOS (it starts with launchd and plays sounds with afplay) | | | Yes |
| A 3.7 V lithium battery with a 1.25 mm two-pin plug (MX1.25) | Only to run unplugged; the board charges it (a PL4054 charger) | For example [The Pi Hut, 1200 mAh](https://thepihut.com/products/1200mah-3-7v-lipo-battery-1-25mm-picoblade-connector) | £8 as listed (the page does not make clear whether with VAT) | No |
| The monitor mount's filament: at most 58 g of PLA | To sit the device on top of a monitor (`enclosure/`) | For example [Bambu Lab's US store](https://us.store.bambulab.com/en/pages/promotions/filament-bulk-sale), PLA Basic | US$19.99 a 1 kg refill, so about US$1.20 of it | No |
| Double-sided mounting tape | The mount's plate sticks to the back of the monitor | Any | | Only with the mount |

**What it costs:** US$26.99 for the device from Waveshare, plus its shipping (it ships from China; the cost is shown at checkout) and a cable if you have none. The monitor mount adds about a dollar of filament. A battery is not needed: the device lives on its USB cable.

A few things worth knowing before you order:

- Waveshare sells the same board three ways: the bare board with two loose pin headers (SKU 30558, US$12.99), in its case (-B, SKU 29962, US$14.99), and in its case with the stand and the prism cube (-C, SKU 30559, US$26.99). The prism is what makes the picture float, and Waveshare's page does not sell the cube on its own: buy the -C.
- The -C's box holds the board (in its case and stand) and the prism cube. No cable, no battery, no screws to fit.
- Batteries with a 1.25 mm plug do not all wire it the same way round. Check the plug's polarity against the board's header, marked "- +" beside it, before connecting one. Whether a battery fits inside the stand was not checked.
- The mount's 58 g is its parts printed solid (46.7 cm³, measured from `enclosure/print/*.stl`); with the usual infill it takes less. Its own notes (`enclosure/lump_monitor_mount.scad`) say how to print it and to print the thread test first.

## Putting it together

- The -C comes assembled: the board in its case, the case in its stand. The prism cube stands on the display. There is nothing to solder.
- The first install goes over the USB cable: `tools/flash.sh` builds the firmware with PlatformIO and writes it and the art with esptool. After that, `tools/ota.py` updates it over Wi-Fi (set up with `tools/wifi_setup.py`).
- On the Mac, `tools/install_bridge.sh` installs the bridge as a login item and `tools/install_hooks.py` adds the Claude Code hooks it listens to.

What is not checked yet: the author has no board on the desk, so these steps are the engine's, and everything has been run only in the emulator. `tools/flash.sh` and `tools/ota.py` still look for the art as `firmware/data/lump.bin`, so for now the art file has to be copied to that name (`docs/ROADMAP.md`, Phase 6).

## Where the facts come from

- The board, its variants and their prices: [Waveshare's product page](https://www.waveshare.com/esp32-s3-lcd-1.3.htm), its [wiki](https://www.waveshare.com/wiki/ESP32-S3-LCD-1.3) and its [schematic](https://files.waveshare.com/wiki/ESP32-S3-LCD-1.3/ESP32S3_1.3inch.pdf).
