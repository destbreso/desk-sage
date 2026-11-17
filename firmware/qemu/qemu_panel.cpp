// Built only into the QEMU variant (pio run -e qemu; tools/qemu/README.md). Espressif's QEMU has no ST7789 and no
// SPI2, so LovyanGFX's writes to the screen go nowhere. The link wraps LGFXBase::pushImage, and every whole-screen
// sprite pushed is also copied into QEMU's virtual RGB panel (hw/display/esp_rgb.c in espressif/qemu): main.cpp stays
// the board's, unchanged. What is copied is the sprite as drawn, before LovyanGFX mirrors it for the prism.
#include <Arduino.h>
#include <LovyanGFX.hpp>

#define PUSH_IMAGE _ZN4lgfx2v18LGFXBase9pushImageEllllPNS0_11pixelcopy_tEb
#define WRAP2(p, s) p##s
#define WRAP(p, s) WRAP2(p, s)

extern "C" void WRAP(__real_, PUSH_IMAGE)(lgfx::LGFXBase*, int32_t, int32_t, int32_t, int32_t, lgfx::pixelcopy_t*, bool);

namespace {

constexpr int W = 240, H = 240;
constexpr uint32_t ORIGIN_REG = 0x600263F8, ORIGIN = 0x51454d55;   // "QEMU", just before APB_CTRL's date register
volatile uint32_t* const RGB = (volatile uint32_t*)0x21000000;     // version, size, from, to, content, status, bpp
uint32_t* const VRAM = (uint32_t*)0x20000000;                      // the panel's own memory, read on each refresh
enum { SIZE = 1, FROM = 2, TO = 3, CONTENT = 4, STATUS = 5, BPP = 6 };

int state = -1;                                                    // -1 not looked yet, 0 not in QEMU, 1 ready
uint32_t frames = 0;

// The panel copies from `content` only when QEMU refreshes (a window's timer, or a screendump), so frames alternate
// between two halves of its memory and `content` names the last whole one: a refresh never sees one half-written.
void show(const uint16_t* sprite) {
  if (state < 0) {
    state = *(volatile uint32_t*)ORIGIN_REG == ORIGIN;
    if (state) { RGB[SIZE] = (W << 16) | H; RGB[BPP] = 16; }
  }
  if (!state) return;
  uint32_t half = (frames++ & 1) * (W * H / 2);
  const uint32_t* in = (const uint32_t*)sprite;
  uint32_t* out = VRAM + half;
  for (int i = 0; i < W * H / 2; i++) {                            // the sprite is byte-swapped RGB565, the panel wants it as is
    uint32_t v = in[i];
    out[i] = ((v & 0xFF00FF00u) >> 8) | ((v & 0x00FF00FFu) << 8);
  }
  RGB[FROM] = 0; RGB[TO] = (W << 16) | H;
  RGB[CONTENT] = uint32_t(out);
  RGB[STATUS] = 1;
}

}  // namespace

extern "C" void WRAP(__wrap_, PUSH_IMAGE)(lgfx::LGFXBase* self, int32_t x, int32_t y, int32_t w, int32_t h, lgfx::pixelcopy_t* p, bool dma) {
  if (x == 0 && y == 0 && w == W && h == H && p->src_bits == 16 && p->src_data) show((const uint16_t*)p->src_data);
  WRAP(__real_, PUSH_IMAGE)(self, x, y, w, h, p, dma);
}
