// Draws an instruction frame and then what the board shows on its antenna over it (firmware/src/antenna.h, as
// drawAntenna() in main.cpp does), with the firmware's own vec.h, and compares the result with a reference picture
// (emulator/checks/antenna_fidelity.mjs hands it the emulator's).
// stdin, per frame:  u32 length, the instructions, s32 the antenna's step (antennaStep(): 0 the ball dark, 1 + k a ring's
//                    step k, -2 - k the relink's step k), 240*240*4 bytes of RGBA
// stdout, per frame: "<mean difference, % of full scale> <pixels off by more than 25%> <1 if the frame marked its
//                    ball> <the overlay's bytes in hex, or ->"
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "vec.h"
#include "antenna.h"

int main() {
  static vec::Canvas cv;
  const int N = vec::W * vec::H;
  cv.fb = (uint16_t*)calloc(N, 2);
  cv.acc = (float*)calloc(vec::STRIDE * (vec::H + 1), sizeof(float));
  for (auto& c : cv.clips) c = (uint8_t*)malloc(N);
  std::vector<uint8_t> ops, ref(N * 4);
  uint8_t buf[antenna::MAX];
  uint32_t len; int32_t step;
  while (fread(&len, 4, 1, stdin) == 1) {
    ops.resize(len);
    if (fread(ops.data(), 1, len, stdin) != len || fread(&step, 4, 1, stdin) != 1 || fread(ref.data(), 1, ref.size(), stdin) != ref.size()) return 1;
    cv.play(ops.data(), len);
    bool anchored = cv.anchored;
    int n = 0;
    if (anchored && step != -1) {
      n = step >= 0 ? antenna::offline(buf, cv.anchorX, cv.anchorY, cv.anchorR, step - 1) : antenna::relink(buf, cv.anchorX, cv.anchorY, cv.anchorR, -2 - step);
      cv.play(buf, n);
    }
    double sum = 0; int far = 0;
    for (int i = 0; i < N; i++) {
      uint16_t v = cv.fb[i];
      int got[3] = {(v >> 11) << 3 | (v >> 13), ((v >> 5) & 63) << 2 | ((v >> 9) & 3), (v & 31) << 3 | ((v >> 2) & 7)};
      int want[3] = {(ref[i * 4] & 0xF8) | (ref[i * 4] >> 5), (ref[i * 4 + 1] & 0xFC) | (ref[i * 4 + 1] >> 6), (ref[i * 4 + 2] & 0xF8) | (ref[i * 4 + 2] >> 5)};
      int d = 0; for (int k = 0; k < 3; k++) d = abs(got[k] - want[k]) > d ? abs(got[k] - want[k]) : d;
      sum += d; far += d > 64;
    }
    printf("%.3f %d %d ", sum / N / 2.55, far, anchored ? 1 : 0);
    if (!n) printf("-");
    for (int i = 0; i < n; i++) printf("%02x", buf[i]);
    printf("\n");
  }
}
