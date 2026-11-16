// Draws glyph frames with firmware/src/glyphs.h and compares each with the browser's picture.
// tools/export_frames.py builds and runs this to decide which frames can be stored as glyphs.
// stdin: u32 length and the atlas, as the .bin stores it; then per frame: u32 length, the glyph frame (the bytes
//        after its own u16 length), 240*240*4 bytes of RGBA (the browser's picture)
// stdout, per frame: "<mean difference, % of full scale> <pixels off by more than 25%>", as tools/vec_check.cpp
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "glyphs.h"

int main() {
  const int N = glyphs::W * glyphs::H;
  std::vector<uint16_t> fb(N);
  std::vector<uint8_t> atlas, frame, ref(N * 4);
  uint32_t len;
  if (fread(&len, 4, 1, stdin) != 1) return 1;
  atlas.resize(len);
  if (fread(atlas.data(), 1, len, stdin) != len) return 1;
  glyphs::Atlas a;
  const uint8_t* p = atlas.data();
  if (!glyphs::parseAtlas(p, atlas.data() + len, a)) { fprintf(stderr, "bad atlas\n"); return 2; }
  while (fread(&len, 4, 1, stdin) == 1) {
    frame.resize(len);
    if (fread(frame.data(), 1, len, stdin) != len || fread(ref.data(), 1, ref.size(), stdin) != ref.size()) return 1;
    glyphs::draw(fb.data(), a, frame.data(), len);
    double sum = 0; int far = 0;
    for (int i = 0; i < N; i++) {
      uint16_t v = fb[i];
      int got[3] = {(v >> 11) << 3 | (v >> 13), ((v >> 5) & 63) << 2 | ((v >> 9) & 3), (v & 31) << 3 | ((v >> 2) & 7)};
      int want[3] = {(ref[i * 4] & 0xF8) | (ref[i * 4] >> 5), (ref[i * 4 + 1] & 0xFC) | (ref[i * 4 + 1] >> 6), (ref[i * 4 + 2] & 0xF8) | (ref[i * 4 + 2] >> 5)};
      int d = 0; for (int k = 0; k < 3; k++) d = abs(got[k] - want[k]) > d ? abs(got[k] - want[k]) : d;
      sum += d; far += d > 64;
    }
    printf("%.3f %d\n", sum / N / 2.55, far);
  }
}
