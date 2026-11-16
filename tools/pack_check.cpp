// Inflates every compressed frame of a .bin with firmware/src/packed.h and tinfl (tools/tinfl.h, the ROM's miniz 1.15),
// each one cold: the window forgotten first, so a frame with a base inflates its base too, as after a seek on the board.
// tools/export_frames.py builds and runs this to keep only the frames it inflates back byte for byte;
// emulator/checks/pack_fidelity.mjs compares it with the emulator.
// stdin: u32 frames, u32 where the offsets start, u32 where the frame data starts, u32 length, then the file
// stdout, per compressed frame: u32 index, u32 size (0xFFFFFFFF refused by check(), 0xFFFFFFFE did not inflate), its bytes
// With --time, instead a line per compressed frame, "<index> <kind> <size> <base or -1> <cold ns> <warm ns>": the best
// of 50 runs each, cold as above and warm with its base already in the window (the same as cold without a base).
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "packed.h"

static uint32_t u32(FILE* f) { uint8_t b[4]; if (fread(b, 1, 4, f) != 4) exit(1); return packed::rd32(b); }
static void put32(uint32_t v) { uint8_t b[4] = {uint8_t(v), uint8_t(v >> 8), uint8_t(v >> 16), uint8_t(v >> 24)}; fwrite(b, 1, 4, stdout); }

int main(int argc, char** argv) {
  bool timing = argc > 1 && !strcmp(argv[1], "--time");
  uint32_t nFrames = u32(stdin), offAt = u32(stdin), dataAt = u32(stdin), n = u32(stdin);
  std::vector<uint8_t> file(n), win(packed::WINDOW + packed::SLACK);
  if (fread(file.data(), 1, n, stdin) != n || offAt > n || n - offAt < 4ull * nFrames || dataAt > n) return 1;
  static tinfl_decompressor dec;
  packed::Window w; w.buf = win.data(); w.dec = &dec;
  const uint8_t *offsets = file.data() + offAt, *data = file.data() + dataAt;
  size_t have = n - dataAt;
  auto rec = [&](uint32_t f) { return data + (packed::rd32(offsets + 4 * f) & 0x3FFFFFFF); };
  for (uint32_t f = 0; f < nFrames; f++) {
    uint32_t o = packed::rd32(offsets + 4 * f);
    if (o >> 30 != 1) continue;
    bool ok = packed::check(offsets, data, have, uint16_t(nFrames), o & 0x3FFFFFFF);
    packed::Head h = ok ? packed::head(rec(f)) : packed::Head{};
    const uint8_t* base = ok && h.base != packed::NONE ? rec(h.base) : nullptr;
    if (timing) {
      if (!ok) continue;
      using clock = std::chrono::steady_clock;
      long long cold = -1, warm = -1;
      for (int k = 0; k < 50; k++) {
        w.forget();
        auto t0 = clock::now(); const uint8_t* p = w.open(rec(f), base); auto t1 = clock::now();
        if (!p) break;
        long long c = std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count(), m = c;
        if (base) {
          w.last = nullptr;
          auto t2 = clock::now(); w.open(rec(f), base); auto t3 = clock::now();
          m = std::chrono::duration_cast<std::chrono::nanoseconds>(t3 - t2).count();
        }
        if (cold < 0 || c < cold) cold = c;
        if (warm < 0 || m < warm) warm = m;
      }
      printf("%u %u %u %d %lld %lld\n", f, h.kind, h.size, base ? int(h.base) : -1, cold, warm);
      continue;
    }
    put32(f);
    if (!ok) { put32(0xFFFFFFFF); continue; }
    w.forget();
    const uint8_t* p = w.open(rec(f), base);
    if (!p) { put32(0xFFFFFFFE); continue; }
    put32(h.size); fwrite(p, 1, h.size, stdout);
  }
}
