// Compressed frames (version 7): a frame stored as raw deflate, inflated on the board by the tinfl in the ESP32-S3's
// ROM into a window, right after the bytes of the frame it names as its base, so its back-references reach them as
// a preset dictionary. tools/export_frames.py writes them (the layout is in its docstring) and keeps one only if
// tools/pack_check.cpp, which builds this same file with the same tinfl, inflates it back to the frame byte for byte.
// Plain C++ with no Arduino dependencies.
#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef ARDUINO
#include "miniz.h"                 // esp_rom/include/miniz.h: tinfl_decompress is linked from the ROM (esp32s3.rom.ld)
#else
#include "tinfl.h"                 // tools/tinfl.h: the same tinfl, miniz 1.15, for the Mac
#endif

namespace packed {

constexpr uint32_t HEAD = 15;                  // u8 kind, u16 base, u32 size, u32 deflate length, u32 adler-32
constexpr uint16_t NONE = 0xFFFF;              // no base
constexpr uint32_t WINDOW = 3 * 240 * 240;     // a frame and its base together: the longest a pixel frame can be
constexpr uint32_t SLACK = 64;                 // past the window, so vec.h reading an instruction cut short stays inside

struct Head { uint8_t kind; uint16_t base; uint32_t size, len, adler; };

inline uint32_t rd32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (uint32_t(p[3]) << 24); }
inline Head head(const uint8_t* p) { return {p[0], uint16_t(p[1] | (p[2] << 8)), rd32(p + 3), rd32(p + 7), rd32(p + 11)}; }

// What it inflates to is a frame the board draws (0 pixels, 2 instructions, 3 glyphs), long enough to be one, and
// it fits the window on its own.
inline bool sane(const Head& h) {
  return ((h.kind == 0 && h.size >= 3) || (h.kind == 2 && h.size >= 2) || (h.kind == 3 && h.size >= 4)) && h.size <= WINDOW;
}

// Is the compressed frame at `at` in a table's frame data (`have` bytes) one the window can inflate: its head sane,
// its deflate inside the data, and its base, if it has one, a compressed frame of the same table with no base of its
// own, the two together within the window. The base's own deflate is checked when its turn comes.
inline bool check(const uint8_t* offsets, const uint8_t* data, size_t have, uint16_t nFrames, size_t at) {
  if (at > have || have - at < HEAD) return false;
  Head h = head(data + at);
  if (!sane(h) || have - at - HEAD < h.len) return false;
  if (h.base == NONE) return true;
  if (h.base >= nFrames) return false;
  uint32_t o = rd32(offsets + 4 * h.base); size_t b = o & 0x3FFFFFFF;
  if (o >> 30 != 1 || b > have || have - b < HEAD) return false;
  Head bh = head(data + b);
  return bh.base == NONE && sane(bh) && bh.size <= WINDOW - h.size;
}

// The window: the base a frame was inflated after stays at its start, so the frames that share it inflate only
// themselves, and the frame inflated last is not inflated again (the corner marks redraw it ten times a second).
// Frames are known by where their record is: forget() when the memory of one goes (a clip dropped).
struct Window {
  uint8_t* buf = nullptr;                      // WINDOW + SLACK bytes
  tinfl_decompressor* dec = nullptr;
  const uint8_t* first = nullptr;              // the frame with no base whose bytes start the window
  uint32_t firstSize = 0;
  const uint8_t* last = nullptr;               // the frame inflated last, at buf + lastAt
  uint32_t lastAt = 0;
  const uint8_t* bad = nullptr;                // the last frame that did not inflate, not tried again
  uint32_t inflates = 0;                       // runs of tinfl, for the checks

  void forget() { first = last = bad = nullptr; firstSize = lastAt = 0; }

  // The compressed frame whose record is rec (its base's record, or nullptr): its bytes as an uncompressed frame of
  // its kind is stored, or nullptr if it does not inflate to exactly what its head says. Both records are check()ed.
  const uint8_t* open(const uint8_t* rec, const uint8_t* base) {
    if (rec == last) return buf + lastAt;
    if (rec == bad) return nullptr;
    if (!base && rec == first) { last = rec; lastAt = 0; return buf; }
    last = nullptr;
    uint32_t at = 0;
    if (base) {
      if (base != first) {
        first = nullptr;
        if (!inflate(base, 0)) { bad = rec; return nullptr; }
        first = base; firstSize = head(base).size;
      }
      at = firstSize;
    }
    if (!inflate(rec, at)) {                   // tinfl writes only from buf + at on, so a base before it is intact
      if (!base) first = nullptr;
      bad = rec; return nullptr;
    }
    if (!base) { first = rec; firstSize = head(rec).size; }
    last = rec; lastAt = at;
    return buf + at;
  }

 private:
  bool inflate(const uint8_t* rec, uint32_t at) {
    Head h = head(rec);
    if (h.size > WINDOW - at) return false;
    tinfl_init(dec);
    size_t in = h.len, out = h.size;
    inflates++;
    tinfl_status s = tinfl_decompress(dec, rec + HEAD, &in, buf, buf + at, &out,
                                      TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF | TINFL_FLAG_COMPUTE_ADLER32);
    if (s != TINFL_STATUS_DONE || out != h.size || tinfl_get_adler32(dec) != h.adler) return false;
    const uint8_t* p = buf + at;               // an instruction or glyph frame's own length agrees with its size
    uint32_t n = p[0] | (p[1] << 8);
    return h.kind == 0 || (n + 2 == h.size && (h.kind == 2 || n >= 2));
  }
};

}  // namespace packed
