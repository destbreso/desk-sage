// Desk Buddy's frame player, playing Sage.
// Plays the frames baked from design/sage.html (tools/export_frames.py -> data/sage.bin).
// Most frames are stored as drawing instructions and drawn here by vec.h, frames made of text as glyphs
// drawn by glyphs.h, and the rest as pixels; from version 7 most of them compressed, inflated by the ROM's tinfl
// through packed.h.
// The frames live in their own flash partition ("sage"), not in the program, so the art and the
// program can each be updated over Wi-Fi on their own (tools/ota.py; see "Updates" below).
// The previous Vec firmware lives in archive/vec_main.cpp.
//
// Moods loop (idle, working, alert, done, waiting, longhaul, night, ...: the art's names). Changing mood always
// plays the drawn transition; acts (events) play once and return to their mood. Nothing here names an act of the
// art but the rain's (glyph_form, glyph_dissolve) and hello, played only if the art holds them.
//
// Serial protocol (115200, newline-terminated), answered with "ok ..." or "err ...":
//   s <mood>          head to a mood: idle working alert done waiting longhaul night ...
//   s demo            showcase every mood and every act of the art, in turn, on a loop
//   e <act>           play an act the art (or a clip) holds; "e tap" and "e fidget" let the board choose one of the
//                     art's tap_* acts (all but tap_dizzy) or fidget_* acts, never the same twice running
//   o <working> <waiting> <unseen>   corner extras: counts of sessions working, waiting on you,
//                     and finished-but-not-looked-at (drawn over the animation)
//   c <RRGGBB>        body colour (fades over ~1 s); default Tangerine FF7A45
//   i                 motion sensor stats: peak jolt in the last few seconds, taps seen, threshold
//   T <g>             tap sensitivity: jolt (in g) that counts as a tap (default 0.35)
//   h <secs>          heartbeat from the bridge, with the local time of day (seconds since midnight);
//                     no reply. Any command counts as hearing from the bridge.
//   ?                 report state
//   W                 Wi-Fi status: connected or not, IP, signal, where the clock comes from
//   w <ssid>\t<password>\t<token>\t<tz>   save Wi-Fi details (USB only; tools/wifi_setup.py
//                     sends this so the password never passes through the bridge or its log),
//                     then restart. "w" alone forgets them.
// The board prints "tap" when the glass is tapped. With the bridge there that is all it does (Sage's mind chooses
// what plays, so nothing reacts twice); offline it plays one of the art's taps itself, as "e tap" does.
//
// The rain at its own moments, when the art holds the acts: glyph_form once the art is loaded after a boot;
// glyph_dissolve when it decides it is offline, glyph_form straight after it (the dissolve ends where the form
// starts, so it never cuts from the rain to the illustrated Sage); hello when the bridge comes back. Asleep (the
// night mood) it notices neither.
//
// On its own: with no word from the bridge for a minute (or since boot) it is "offline": it
// drops what it was showing, idles and fidgets (asleep at night if a heartbeat ever told it the
// time), and shows it on its antenna: the ball dark, and a faint ring going out every four seconds
// (antenna.h, where the art marks the ball; art that marks none shows a small unplugged-cable mark in
// the bottom-right corner instead). Just powered from a charger, it lives like this. When the bridge
// speaks again it prints "resync" so it resends, and the ball lights again with a bright ring.
//
// Wi-Fi (once set up): it joins your network as sage.local and takes the same commands over TCP
// port 4210, so the bridge can drive it without a USB data cable. A connection must start with
// "k <token>" (the pairing token from setup) or it's dropped. Replies go to USB and to the
// network client. It also sets its clock from the internet, so it sleeps at night on its own.
//
// Updates over Wi-Fi (tools/ota.py does all this): a small web server on port 80, every request
// carrying the pairing token in X-Sage-Token.
//   GET  /info?app_len=N&art_len=M   SHA-256 of the first N bytes of the running program and the
//                                    first M bytes of the art, so the uploader sends only what changed
//   POST /update/app                 new firmware.bin (application/octet-stream, X-Sage-MD5 checked),
//                                    written to the other program slot, then restart into it
//   POST /update/art                 new sage.bin (X-Sage-Sha256 checked) into the art partition, then restart
//   POST /clip                       an extra animation: a small file in sage.bin's layout holding only events
//                                    (X-Sage-Name names it, X-Sage-Size is its length). It is kept in RAM until
//                                    it restarts and plays like any other act ("e <name>"). No restart.
//                                    When there's no room for another it drops the one played longest ago and
//                                    prints "clip gone <name>", so the bridge knows to send it again.
//                                    X-Sage-Tap: 1 makes it a tap reaction: it is kept, and its acts are in the
//                                    running when the board chooses a tap.
// While an update streams in it shows a progress bar instead of animating. If the art is missing or
// bad it says so on screen but keeps Wi-Fi and updates working, so it can be fixed without a cable.
// On its own the device also: fidgets every minute or so while idle and offline, escalates "alert" to
// "waiting" after 45 s, slides "working" into "longhaul" after 10 min, and dims at night.

#include <Arduino.h>
#include <LovyanGFX.hpp>
#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <time.h>
#include <stdarg.h>
#include <WebServer.h>
#include <Update.h>
#include <esp_partition.h>
#include <esp_ota_ops.h>
#include <esp_heap_caps.h>
#include "mbedtls/sha256.h"
#define VEC_SWAPPED                    // the sprite buffer holds byte-swapped RGB565
#include "vec.h"
#include "glyphs.h"
#include "packed.h"
#include "antenna.h"

constexpr int PIN_SCLK = 40, PIN_MOSI = 41, PIN_DC = 38, PIN_CS = 39, PIN_RST = 42, PIN_BL = 20;
constexpr bool PRISM_MIRROR = true;  // rotations 4–7 are mirrored for the prism
constexpr uint32_t ESCALATE_MS = 45000, LONGHAUL_MS = 10UL * 60 * 1000;
constexpr uint8_t BL_DAY = 255, BL_NIGHT = 70;
constexpr uint32_t HOST_TIMEOUT_MS = 60000;    // bridge heartbeats every 15 s
constexpr uint32_t OFFLINE_MARK_AFTER_MS = 8000;  // at boot, give the bridge a moment before showing the mark
constexpr uint8_t NIGHT_FROM = 0, NIGHT_UNTIL = 8;   // midnight to 8am; matches the bridge

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789 panel;
  lgfx::Bus_SPI bus;
 public:
  LGFX() {
    auto b = bus.config();
    b.spi_host = SPI2_HOST; b.spi_mode = 0; b.freq_write = 80000000;
    b.pin_sclk = PIN_SCLK; b.pin_mosi = PIN_MOSI; b.pin_miso = -1; b.pin_dc = PIN_DC;
    b.dma_channel = SPI_DMA_CH_AUTO;
    bus.config(b); panel.setBus(&bus);
    auto p = panel.config();
    p.pin_cs = PIN_CS; p.pin_rst = PIN_RST; p.pin_busy = -1;
    p.panel_width = 240; p.panel_height = 240; p.memory_width = 240; p.memory_height = 320;
    p.invert = true; p.readable = false;
    panel.config(p); setPanel(&panel);
  }
};
static LGFX tft;
static LGFX_Sprite fb(&tft);
static vec::Canvas cv;                 // draws instruction frames straight into fb
static packed::Window win;             // compressed frames are inflated here (its buffer in PSRAM)
static tinfl_decompressor inflater;    // tinfl's state, 10,992 bytes: static, as it is too big for the loop's stack

// ---------- animation data: the "sage" flash partition, memory-mapped, plus any clips sent over Wi-Fi ----------
static const esp_partition_t* artPart = nullptr;
static const uint8_t* art = nullptr;            // mapped start of the partition
static size_t artSize = 0;                      // mapped length (the whole partition)
static esp_partition_mmap_handle_t artMap;
static bool mapArt() {
  artPart = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "sage");
  if (!artPart) return false;
  const void* ptr = nullptr;
  if (esp_partition_mmap(artPart, 0, artPart->size, ESP_PARTITION_MMAP_DATA, &ptr, &artMap) != ESP_OK) return false;
  art = (const uint8_t*)ptr; artSize = artPart->size;
  return true;
}

constexpr int MAX_MOODS = 12, MAX_SRC = 33;                    // source 0 is the flash art, the rest are clips
constexpr int MAX_SEQ = 750 + MAX_SRC - 1;                     // 750 sequences in the art, and one for each clip
enum Kind : uint8_t { LOOP = 0, TRANS = 1, EVENT = 2 };
struct Src {                                    // where a sequence's frames live
  const uint8_t* offsets = nullptr; const uint8_t* data = nullptr; const uint8_t* end = nullptr;
  glyphs::Atlas atlas;                           // the bitmaps its glyph frames draw with (version 6)
  uint8_t* own = nullptr; String name;           // a clip's RAM buffer and name
  uint32_t used = 0;                             // when it was last played (or arrived)
  bool tap = false;                              // a tap reaction: kept, and its acts in the running when the board chooses a tap
};
struct Anim {
  uint16_t nFrames = 0, nSeqs = 0; uint8_t fps = 24, nMoods = 0;
  uint8_t base[MAX_MOODS]; String moodName[MAX_MOODS];
  uint8_t kind[MAX_SEQ], from[MAX_SEQ], to[MAX_SEQ], src[MAX_SEQ]; uint16_t len[MAX_SEQ]; const uint8_t* seq[MAX_SEQ]; String name[MAX_SEQ];
  int16_t loopOf[MAX_MOODS], transOf[MAX_MOODS][MAX_MOODS];
  Src srcs[MAX_SRC];
  bool anchors = false;                          // its frames mark the antenna's ball (version 8's flags, bit 0)
  bool ok = false;
} A;

static inline uint16_t rd16(const uint8_t* p) { return p[0] | (p[1] << 8); }
static inline uint32_t rd32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (uint32_t(p[3]) << 24); }
static String rdStr(const uint8_t*& p) { int n = *p++; String s; s.reserve(n); for (int i = 0; i < n; i++) s += char(p[i]); p += n; return s; }
static int moodIndex(const String& n);

// Reads the flash art (si 0), or a clip into source si: its events join the list after the ones
// already there, with its moods matched to ours by name. Every read is bounds-checked: half-written
// or garbage data must fail cleanly (and leave Wi-Fi updates working), never crash.
static bool parseArt(const uint8_t* buf, size_t size, int si) {
  if (!buf || size < 16) return false;
  const uint8_t* p = buf; const uint8_t* end = buf + size;
  auto room = [&](size_t n) { return size_t(end - p) >= n; };
  bool clip = si > 0;
  if (memcmp(p, "SAGE", 4) != 0 && memcmp(p, "LUMP", 4) != 0) return false;   // LUMP: what the bake wrote before
  p += 4;
  uint16_t version = rd16(p); p += 2;            // 3: every frame is pixels. 4: a frame may be instructions. 5: up to 65535 sequences. 6: glyph frames and their atlas. 7: compressed frames. 8: flags
  if (version < 3 || version > 8) return false;
  uint16_t nFrames = rd16(p); p += 2;
  uint8_t nMoods = *p++, fps = *p++, moodOf[MAX_MOODS];
  uint8_t flags = version >= 8 ? *p++ : 0;
  if (nMoods > MAX_MOODS) return false;
  for (int m = 0; m < nMoods; m++) {
    if (!room(2) || !room(2 + p[1])) return false;
    uint8_t base = *p++; String name = rdStr(p);
    if (clip) { int k = moodIndex(name); if (k < 0) return false; moodOf[m] = k; continue; }
    A.base[m] = base; A.moodName[m] = name; A.loopOf[m] = -1; moodOf[m] = m;
    if (base >= nMoods) return false;
  }
  if (!clip) { A.nMoods = nMoods; A.fps = fps; A.nFrames = nFrames; A.nSeqs = 0; A.anchors = flags & 1; memset(A.transOf, -1, sizeof(A.transOf)); }
  int wide = version >= 5 ? 2 : 1;               // bytes in the sequence count
  if (!room(wide)) return false;
  int n = wide == 2 ? rd16(p) : *p, first = A.nSeqs; p += wide;
  if (first + n > MAX_SEQ) return false;
  for (int i = first; i < first + n; i++) {
    if (!room(4) || !room(4 + p[3] + 2)) return false;
    if (p[1] >= nMoods || p[2] >= nMoods || (clip && p[0] != EVENT)) return false;
    A.kind[i] = p[0]; A.from[i] = moodOf[p[1]]; A.to[i] = moodOf[p[2]]; A.src[i] = si; p += 3;
    A.name[i] = rdStr(p);
    A.len[i] = rd16(p); p += 2;
    if (!A.len[i] || !room(size_t(A.len[i]) * 2)) return false;
    A.seq[i] = p; p += A.len[i] * 2;
    for (int k = 0; k < A.len[i]; k++) if (rd16(A.seq[i] + 2 * k) >= nFrames) return false;
    if (A.kind[i] == LOOP) A.loopOf[A.from[i]] = i;
    else if (A.kind[i] == TRANS) A.transOf[A.from[i]][A.to[i]] = i;
  }
  if (!clip) for (int m = 0; m < nMoods; m++) if (A.loopOf[m] < 0) return false;
  glyphs::Atlas atlas;
  if (version >= 6 && !glyphs::parseAtlas(p, end, atlas)) return false;
  if (!room(size_t(nFrames) * 4)) return false;
  Src& S = A.srcs[si];
  S.offsets = p; p += nFrames * 4; S.data = p; S.end = end; S.atlas = atlas;
  size_t have = end - S.data;
  for (int f = 0; f < nFrames; f++) {             // the top two bits: 00 pixels, 01 compressed (version 7), 10 instructions, 11 glyphs (version 6)
    uint32_t o = rd32(S.offsets + 4 * f), kind = o >> 30; size_t at = o & 0x3FFFFFFF;
    if ((kind == 1 && version < 7) || (kind == 3 && version < 6)) return false;
    if (kind == 1) { if (!packed::check(S.offsets, S.data, have, nFrames, at)) return false; continue; }
    if (at >= have || (kind >= 2 && (at + 2 > have || at + 2 + rd16(S.data + at) > have))) return false;
    if (kind == 3 && rd16(S.data + at) < 2) return false;
  }
  A.nSeqs = first + n;
  return true;
}
static int moodIndex(const String& n) { for (int m = 0; m < A.nMoods; m++) if (A.moodName[m] == n) return m; return -1; }
static int eventIndex(const String& n) { for (int i = A.nSeqs - 1; i >= 0; i--) if (A.kind[i] == EVENT && A.name[i] == n) return i; return -1; }   // newest first

// ---------- body colour ----------
// Made for Lump's art, whose frames carried his body in pure magenta (FF00FF); Sage's has no such marker
// (docs/ROADMAP.md, Phase 6). The only colour besides the cream
// line (FFF1DC) and black (props with their own colour, like the yellow banana, are left alone). Every pixel is some mix  alpha*magenta + beta*cream  (plus black), and
// since magenta has no green, beta = G/241 and alpha = R/255 - beta. Swapping magenta for the
// current body colour recolours the fill, its soft edges, the tongue and the blanket alike.
static float tintR = 255, tintG = 122, tintB = 69;        // current (fading) colour, Tangerine
static float goalR = 255, goalG = 122, goalB = 69;        // colour we're fading to
static inline uint16_t sw16(uint16_t v) { return (v >> 8) | (v << 8); }
static uint16_t recolor(uint16_t stored) {               // stored = byte-swapped RGB565
  uint16_t v = sw16(stored);
  int r = (v >> 11) << 3, g = ((v >> 5) & 63) << 2, b = (v & 31) << 3;
  if (r < 8 && g < 8 && b < 8) return stored;            // black stays black
  float beta = g / 241.f, alpha = r / 255.f - beta;
  if (alpha <= 0.02f) return stored;                     // pure line colour: unchanged
  if (b < alpha * 255 + beta * 220 - 48) return stored;  // a real colour (the yellow banana): keep it
  int nr = min(255, int(alpha * tintR + beta * 255)), ng = min(255, int(alpha * tintG + beta * 241)), nb = min(255, int(alpha * tintB + beta * 220));
  return sw16(lgfx::color565(nr, ng, nb));
}

// The same swap for an instruction frame, done once per shape colour instead of once per pixel.
static void recolour8(uint8_t* c) {
  int r = c[0], g = c[1], b = c[2];
  if (r < 8 && g < 8 && b < 8) return;
  float beta = g / 241.f, alpha = r / 255.f - beta;
  if (alpha <= 0.02f || b < alpha * 255 + beta * 220 - 48) return;
  c[0] = min(255, int(alpha * tintR + beta * 255)); c[1] = min(255, int(alpha * tintG + beta * 241)); c[2] = min(255, int(alpha * tintB + beta * 220));
}

// A frame is drawing instructions (vec.h draws them), glyphs (glyphs.h), or pixels: RLE runs of
// [count][rgb565 big-endian]. The sprite buffer wants byte-swapped RGB565, which is big-endian byte
// order, so each run's two bytes go in as stored (then recoloured). Glyphs keep their colours: the
// body-colour swap was made for Lump's magenta (docs/ROADMAP.md, Phase 6). A compressed frame is first
// inflated into the window; one that does not inflate is not drawn, and said once. Afterwards cv.anchored says
// whether the frame marked its antenna's ball, and where.
static void drawFrame(uint8_t src, uint16_t idx) {
  const Src& S = A.srcs[src];
  cv.anchored = false;
  uint32_t o = rd32(S.offsets + 4 * idx), kind = o >> 30;
  const uint8_t* p = S.data + (o & 0x3FFFFFFF);
  const uint8_t* end = S.end;
  if (kind == 1) {
    packed::Head h = packed::head(p);
    const uint8_t* base = h.base == packed::NONE ? nullptr : S.data + (rd32(S.offsets + 4 * h.base) & 0x3FFFFFFF);
    bool known = win.bad == p;
    const uint8_t* q = win.open(p, base);
    if (!q) { if (!known) Serial.printf("frame %u does not inflate\n", idx); return; }
    kind = h.kind; p = q; end = q + h.size;
  }
  if (kind == 3) { glyphs::draw((uint16_t*)fb.getBuffer(), S.atlas, p + 2, rd16(p)); return; }
  if (kind == 2) { cv.play(p + 2, rd16(p)); return; }
  uint16_t* out = (uint16_t*)fb.getBuffer();
  int i = 0;
  uint16_t lastIn = 0xFFFF, lastOut = 0;
  while (i < 240 * 240 && p + 3 <= end) {
    int n = p[0]; uint16_t v = p[1] | (p[2] << 8); p += 3;
    if (v != lastIn) { lastIn = v; lastOut = recolor(v); }
    v = lastOut;
    if (i + n > 240 * 240) n = 240 * 240 - i;
    for (int k = 0; k < n; k++) out[i + k] = v;
    i += n;
  }
}

// ---------- player ----------
// Always inside one sequence: a mood's loop, a transition, or an event. Nothing ever cuts:
// a new target waits for the current transition/event to finish, then routes there.
static int target = 0, curMood = 0, curSeq = 0, pendingEvent = -1;
static int pendingThen = -1, follow = -1;     // an act that goes on at once from the pending one, and from the one playing
static int moodAfter = -1;   // a mood asked for while an act waits that has none drawn for it: it follows the act
static uint32_t seqStart = 0, loopSince = 0, nextFidget = 0;
static int lastFrame = -1;
static float fps = 0;

static void say(const char* fmt, ...);   // below, with the link code
static void startSeq(int s) { curSeq = s; seqStart = millis(); lastFrame = -1; A.srcs[A.src[s]].used = seqStart; }
static int nextHop(int a, int b) {
  if (A.transOf[a][b] >= 0) return A.transOf[a][b];
  if (A.base[a] != a) return A.transOf[a][A.base[a]];
  if (A.base[b] != b && A.transOf[a][A.base[b]] >= 0) return A.transOf[a][A.base[b]];
  return -1;
}
static int variantFor(int e, int m) {   // act e as drawn for mood m (name_<mood>, else its base mood's), or -1
  String n = A.name[e]; int u = n.lastIndexOf('_'), e2 = -1;
  if (u > 0) { e2 = eventIndex(n.substring(0, u) + "_" + A.moodName[m]); if (e2 < 0) e2 = eventIndex(n.substring(0, u) + "_" + A.moodName[A.base[m]]); }
  return e2;
}
static void settle(int m) {  // arrived in mood m's loop
  curMood = m;
  if (follow >= 0) { int f = follow; follow = -1; if (A.from[f] == m) return startSeq(f); }
  if (moodAfter >= 0 && pendingEvent < 0) { target = moodAfter; moodAfter = -1; }   // the act it waited for has played
  if (target != m) {
    int h = nextHop(m, target);
    if (h >= 0) return startSeq(h);
    curMood = m = target;  // nothing drawn for this route: cut (shouldn't happen)
  }
  // an act queued for a mood it never settled in (the bridge moved it on meanwhile): the same act drawn for the
  // mood it did land in (name_<mood>), if the art has one, rather than silently dropping it
  if (pendingEvent >= 0 && A.from[pendingEvent] != m) {
    int e2 = variantFor(pendingEvent, m);
    pendingEvent = e2;
    if (e2 < 0) pendingThen = -1;
  }
  if (pendingEvent >= 0 && A.from[pendingEvent] == m) {
    int e = pendingEvent; pendingEvent = -1; follow = pendingThen; pendingThen = -1;
    return startSeq(e);
  }
  startSeq(A.loopOf[m]); loopSince = millis();
}
static void setTarget(int m) {
  target = m;
  if (A.kind[curSeq] == LOOP) settle(curMood);
}
// The board's own choice of an act (for a tap, or a fidget), from whatever the art and the clips hold: one named
// prefix*, or for a tap one of a clip sent as a tap reaction; never `except`; drawn for the target mood if any is
// (else for its base mood, else any); and never the one it chose last time while there is another. "" if none.
static bool pickable(int i, const char* prefix, const char* except) {
  if (A.kind[i] != EVENT || A.name[i] == except) return false;
  bool tapClip = A.srcs[A.src[i]].tap && strcmp(prefix, "tap_") == 0;
  return (A.name[i].startsWith(prefix) || tapClip) && eventIndex(A.name[i]) == i;   // each name once: its newest
}
static int moodTier(int i) { return A.from[i] == target ? 0 : A.from[i] == A.base[target] ? 1 : 2; }
static String pickAct(const char* prefix, const char* except, String& last) {
  int tier = 3, n = 0, fresh = 0;
  for (int i = 0; i < A.nSeqs; i++) if (pickable(i, prefix, except)) tier = min(tier, moodTier(i));
  for (int i = 0; i < A.nSeqs; i++) if (pickable(i, prefix, except) && moodTier(i) == tier) { n++; if (A.name[i] != last) fresh++; }
  if (!n) return "";
  int k = random(fresh ? fresh : n);
  for (int i = 0; i < A.nSeqs; i++)
    if (pickable(i, prefix, except) && moodTier(i) == tier && (!fresh || A.name[i] != last) && k-- == 0) return last = A.name[i];
  return "";
}
static String lastTapAct, lastFidgetAct;
// "tap" and "fidget" are the board's own choice (pickAct); any other name is an act, or resolves per mood to the
// one drawn for it (name_<mood>). `then` is an act to go on to at once after it. False if there is no such act.
static bool playEvent(String n, int then = -1) {
  if (n == "tap") n = pickAct("tap_", "tap_dizzy", lastTapAct);      // dizzy is its patience run out, not an answer to a tap
  else if (n == "fidget") n = pickAct("fidget_", "", lastFidgetAct);
  if (!n.length()) return false;
  int e = eventIndex(n);
  if (e < 0) {
    e = eventIndex(n + "_" + A.moodName[target]);
    if (e < 0) e = eventIndex(n + "_" + A.moodName[A.base[target]]);
  }
  if (e < 0) return false;
  pendingEvent = e; pendingThen = then;
  if (target != A.from[e]) setTarget(A.from[e]); else if (A.kind[curSeq] == LOOP) settle(curMood);
  return true;
}

// ---------- demo: every mood and every act of the art, in turn ----------
static bool demo = false;
static int demoStep = -1, demoMood = -1, demoAct = -1;
static uint32_t demoNext = 0;
static void runDemo(uint32_t now) {
  if (!demo || now < demoNext) return;
  if (++demoStep % 2 == 0) {                        // a mood for six seconds, with its transitions
    demoMood = (demoMood + 1) % A.nMoods; setTarget(demoMood); demoNext = now + 6000;
    return;
  }
  for (int k = 0; k < A.nSeqs; k++) if (A.kind[demoAct = (demoAct + 1) % A.nSeqs] == EVENT) break;
  demoNext = now + 1000;
  if (A.kind[demoAct] == EVENT && playEvent(A.name[demoAct])) demoNext = now + A.len[demoAct] * 1000UL / A.fps + 3000;   // and its way there
}

// ---------- things it does on its own ----------
static bool hostAlive(uint32_t now);
static void autoBehaviour(uint32_t now) {
  if (demo || A.kind[curSeq] != LOOP || target != curMood) return;
  const String& m = A.moodName[curMood];
  if (m == "idle" && pendingEvent < 0 && !hostAlive(now)) {      // with the bridge connected, it decides when Sage fidgets
    if (!nextFidget) nextFidget = now + 40000 + random(50000);
    if (now > nextFidget) { nextFidget = 0; playEvent("fidget"); }
  } else nextFidget = 0;
  int next = m == "alert" && now - loopSince > ESCALATE_MS ? moodIndex("waiting") : m == "working" && now - loopSince > LONGHAUL_MS ? moodIndex("longhaul") : -1;
  if (next >= 0) setTarget(next);                               // only a mood the art has
}

// ---------- backlight: dims gently at night ----------
static void backlight(uint32_t now) {
  static uint32_t last = 0; static float level = BL_DAY;
  if (now - last < 20) return; last = now;
  bool night = A.kind[curSeq] == LOOP && A.moodName[curMood] == "night";
  level += ((night ? BL_NIGHT : BL_DAY) - level) * 0.04f;
  analogWrite(PIN_BL, int(level));
}

// ---------- motion sensor (QMI8658 on I2C SDA 47 / SCL 48): tapping the glass ----------
// Sampled ~400x a second on core 0 so short taps aren't missed while core 1 is drawing.
// A tap is a sharp jolt: the acceleration jumps away from its slow-moving average.
constexpr int IMU_SDA = 47, IMU_SCL = 48;
static uint8_t imuAddr = 0;
static volatile bool tapPending = false;
static volatile float tapThreshold = 0.35f, peakJolt = 0;
static volatile uint32_t tapCount = 0;
static bool imuWrite(uint8_t reg, uint8_t v) { Wire.beginTransmission(imuAddr); Wire.write(reg); Wire.write(v); return Wire.endTransmission() == 0; }
static bool imuRead(uint8_t reg, uint8_t* buf, int n) {
  Wire.beginTransmission(imuAddr); Wire.write(reg); if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)imuAddr, n) != n) return false;
  for (int i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}
static bool imuInit() {
  Wire.begin(IMU_SDA, IMU_SCL, 400000);
  for (uint8_t a : {0x6B, 0x6A}) {
    imuAddr = a; uint8_t who = 0;
    if (imuRead(0x00, &who, 1) && who == 0x05) {
      imuWrite(0x60, 0xB0); delay(20);            // soft reset
      imuWrite(0x02, 0x40);                       // CTRL1: register auto-increment, little endian
      imuWrite(0x03, 0x15);                       // CTRL2: accel +-4 g, 250 Hz
      imuWrite(0x08, 0x01);                       // CTRL7: accelerometer on
      return true;
    }
  }
  imuAddr = 0; return false;
}
static void imuTask(void*) {
  float avg = 1.f; uint32_t lastTap = 0, peakAt = 0;
  for (;;) {
    uint8_t b[6];
    if (imuRead(0x35, b, 6)) {
      float x = int16_t(b[0] | b[1] << 8) / 8192.f, y = int16_t(b[2] | b[3] << 8) / 8192.f, z = int16_t(b[4] | b[5] << 8) / 8192.f;
      float mag = sqrtf(x * x + y * y + z * z), jolt = fabsf(mag - avg);
      avg += (mag - avg) * 0.02f;
      uint32_t now = millis();
      if (jolt > peakJolt || now - peakAt > 4000) { peakJolt = jolt; peakAt = now; }
      if (jolt > tapThreshold && now - lastTap > 600) { lastTap = now; tapCount++; tapPending = true; }
    }
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

// ---------- talking back: USB, and the Wi-Fi client if there is one ----------
constexpr uint16_t NET_PORT = 4210;
static String wifiSsid, netToken, tzRule;     // from flash (Preferences "sage"); password stays there
static bool wifiStarted = false, mdnsUp = false, netAuthed = false;
static WiFiServer server(NET_PORT);
static WiFiClient net;
static void say(const char* fmt, ...) {
  char b[256]; va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof b, fmt, ap); va_end(ap);
  Serial.println(b);
  if (netAuthed && net.connected()) net.println(b);
}

// ---------- on its own: no bridge ----------
static uint32_t lastHost = 0, clockAt = 0;
static int32_t clockBase = -1;                 // seconds since local midnight at clockAt; -1 = unknown
static bool hostSeen = false, offline = true;  // offline until the bridge says something
static uint32_t offlineSince = 0, relinkAt = 0;  // when it went offline; when its ball lit again
static bool relinking = false;
static bool offlineMark(uint32_t now);
static bool antennaDark(uint32_t now);
static int ovWorking = 0, ovWaiting = 0, ovUnseen = 0;
static bool hostAlive(uint32_t now) { return hostSeen && now - lastHost < HOST_TIMEOUT_MS; }
static bool nightHour(int h) {                 // works whether or not the window wraps past midnight
  return NIGHT_FROM < NIGHT_UNTIL ? (h >= NIGHT_FROM && h < NIGHT_UNTIL) : (h >= NIGHT_FROM || h < NIGHT_UNTIL);
}
static bool nightNow(uint32_t now) {
  struct tm t;                                 // the internet's clock first, then the bridge's
  if (tzRule.length() && getLocalTime(&t, 0)) return nightHour(t.tm_hour);
  if (clockBase < 0) return false;
  return nightHour(((clockBase + (now - clockAt) / 1000) % 86400) / 3600);
}
// asleep, or about to be: it notices neither the bridge going nor its coming back
static bool asleep(uint32_t now) { return nightNow(now) || A.moodName[target] == "night"; }
static void heardFromHost() {
  bool was = offline, back = offline && hostSeen;   // it had the bridge before, and lost it
  lastHost = millis();
  if (antennaDark(lastHost)) { relinking = true; relinkAt = lastHost; }   // its ball lights again, with a ring
  hostSeen = true; offline = false;
  if (was) say("resync");           // the bridge resends mood, colour and corner extras
  if (back && A.ok && !demo && !asleep(lastHost)) playEvent("hello");
}
static void runOffline(uint32_t now) {
  if (!offline && !hostAlive(now)) {           // lost the bridge: forget what it last told us, and go into the rain
    offline = true; offlineSince = now; relinking = false;
    ovWorking = ovWaiting = ovUnseen = 0;
    goalR = 255; goalG = 122; goalB = 69;      // back to Tangerine (a usage or meeting colour would be stale)
    if (!demo && !asleep(now)) playEvent("glyph_dissolve", eventIndex("glyph_form"));
  }
  if (!offline || demo) return;
  int want = moodIndex(nightNow(now) ? "night" : "idle");
  if (want >= 0 && target != want && pendingEvent < 0 && A.kind[curSeq] == LOOP) setTarget(want);
}
static bool offlineMark(uint32_t now) { return offline && !demo && now > OFFLINE_MARK_AFTER_MS; }
// shown on its antenna when the art marks it, else in a corner
static bool antennaDark(uint32_t now) { return A.anchors && offlineMark(now); }
static bool cornerMark(uint32_t now) { return !A.anchors && offlineMark(now); }
// What its antenna shows, as a number that changes whenever the drawing does: -1 nothing (the art's own ball), 0 the
// ball dark, 1 + k the dark ball and the faint ring at step k, -2 - k the relink's ring at step k.
static int antennaStep(uint32_t now) {
  if (antennaDark(now)) {
    uint32_t k = (now - offlineSince) % (antenna::EVERY * 1000 / antenna::FPS) * antenna::FPS / 1000;   // never overflows
    return k < antenna::RING ? 1 + int(k) : 0;
  }
  if (relinking && !offline) {
    uint32_t ms = now - relinkAt;
    if (ms < 1000 && ms * antenna::FPS / 1000 < antenna::RELINK) return -2 - int(ms * antenna::FPS / 1000);
    relinking = false;
  }
  return -1;
}
// over the frame just drawn, at the ball it marks (a frame with none shows nothing extra)
static void drawAntenna(int step) {
  static uint8_t buf[antenna::MAX];
  if (step == -1 || !cv.anchored) return;
  int n = step >= 0 ? antenna::offline(buf, cv.anchorX, cv.anchorY, cv.anchorR, step - 1)
                    : antenna::relink(buf, cv.anchorX, cv.anchorY, cv.anchorR, -2 - step);
  cv.play(buf, n);
}
// a little unplugged cable, gently reaching for its socket (art that does not mark its antenna)
static void drawOfflineMark(uint32_t now) {
  float t = now / 1000.f, k = 0.45f + 0.3f * sinf(t * 2.1f);
  uint16_t c = lgfx::color565(255 * k, 241 * k, 220 * k);
  int px = 200 + int(2.5f + 2.5f * sinf(t * 1.3f));  // plug drifts 0..5 px, never reaches the socket
  fb.fillRect(186, 226, px - 186, 2, c);              // cable
  fb.fillRoundRect(px, 221, 9, 12, 2, c);             // plug
  fb.fillRect(px + 9, 223, 4, 2, c); fb.fillRect(px + 9, 229, 4, 2, c);  // prongs
  fb.fillRoundRect(220, 219, 4, 16, 1, c);            // socket
}

// ---------- corner extras ----------
// Small marks drawn over the animation so nothing is hidden when several sessions are busy:
//   bottom-left  three bouncing dots: something is working in the background
//   top-left     amber dots, one per session waiting on you (when more than the mood can show)
//   top-right    a twinkling sparkle: something finished that you haven't looked at yet
static uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return lgfx::color565(r, g, b); }
static bool overlayVisible() {
  if (cornerMark(millis())) return true;
  const String& m = A.moodName[target];
  bool workingMood = m == "working" || m == "longhaul", alertMood = m == "alert" || m == "waiting";
  return (ovWorking > 0 && !workingMood) || ovWaiting >= 2 || (ovWaiting >= 1 && !alertMood) || (ovUnseen > 0 && m != "done");
}
static void drawOverlay(uint32_t now) {
  if (cornerMark(now)) drawOfflineMark(now);
  const String& m = A.moodName[target];
  bool workingMood = m == "working" || m == "longhaul", alertMood = m == "alert" || m == "waiting";
  float t = now / 1000.f;
  if (ovWorking > 0 && !workingMood) {
    for (int i = 0; i < 3; i++) {
      float b = max(0.f, sinf(t * 6 - i * 0.9f));
      fb.fillCircle(16 + i * 10, 226 - b * 4, 2.5f, rgb(255 * (0.45f + 0.55f * b), 241 * (0.45f + 0.55f * b), 220 * (0.45f + 0.55f * b)));
    }
  }
  if (ovWaiting >= 2 || (ovWaiting >= 1 && !alertMood)) {
    float pulse = 0.6f + 0.4f * sinf(t * 5);
    for (int i = 0; i < min(ovWaiting, 5); i++) fb.fillCircle(14 + i * 11, 14, 3.5f, rgb(255 * pulse, 181 * pulse, 71 * pulse));
  }
  if (ovUnseen > 0 && m != "done") {
    for (int k = 0; k < min(ovUnseen, 2); k++) {
      float s = (k ? 4.f : 6.f) * (0.75f + 0.25f * sinf(t * 4 + k * 2));
      int x = 224 - k * 13, y = 16 + k * 6;
      uint16_t c = rgb(200, 255, 210);
      fb.fillTriangle(x, y - s, x + s * 0.3f, y, x - s * 0.3f, y, c); fb.fillTriangle(x, y + s, x + s * 0.3f, y, x - s * 0.3f, y, c);
      fb.fillTriangle(x - s, y, x, y - s * 0.3f, x, y + s * 0.3f, c); fb.fillTriangle(x + s, y, x, y - s * 0.3f, x, y + s * 0.3f, c);
    }
  }
}

// ---------- serial ----------
static float slowestDraw = 0;         // the longest any frame took to draw since the last report, in ms
static void reply() {
  say("ok mode=%s target=%s playing=%s(%s) fps=%.1f frames=%u seqs=%u draw_ms=%.0f",
    demo ? "demo" : offline ? "offline" : "direct", A.moodName[target].c_str(), A.name[curSeq].c_str(),
    A.kind[curSeq] == LOOP ? "loop" : A.kind[curSeq] == TRANS ? "transition" : "event", fps, A.nFrames, A.nSeqs, slowestDraw);
  slowestDraw = 0;
}
static void setWifi(String a);
static void wifiReport();
static void handleLine(String ln, bool fromNet = false) {
  ln.trim(); if (!ln.length()) return;
  if (fromNet && !netAuthed) {                 // a network client must pair first
    if (netToken.length() >= 8 && ln == "k " + netToken) { netAuthed = true; net.println("ok paired"); heardFromHost(); }
    else { net.println("err pairing"); net.stop(); }
    return;
  }
  char cmd = ln[0];
  if (cmd == 'w') { if (fromNet) say("err w is USB only"); else setWifi(ln.substring(1)); return; }
  if (cmd == 'W') return wifiReport();
  String arg = ln.substring(1); arg.trim(); arg.toLowerCase();
  heardFromHost();
  if (cmd == 'h') { long s = arg.toInt(); if (s >= 0 && s < 86400) { clockBase = s; clockAt = millis(); } return; }
  if (cmd == 's') {
    if (arg == "demo" || arg == "cycle") { demo = true; demoNext = 0; moodAfter = -1; return reply(); }
    int m = moodIndex(arg);
    if (m < 0) { say("err unknown mood"); return; }
    // repeating the current mood is a no-op, so the bridge can re-assert its mood without
    // restarting the loop or undoing an escalation (alert -> waiting) the board made itself
    // (night is chosen by the bridge, so "s idle" while at night does wake it)
    bool selfEscalated = A.moodName[target] == "waiting" || A.moodName[target] == "longhaul";
    bool same = !demo && (m == target || (selfEscalated && A.base[target] == m));
    demo = false;
    // an act still waiting to play, with none drawn for this mood, would be lost on the way there (the hello when the
    // bridge comes back during the rain): it plays first, and this mood follows it
    if (!same && pendingEvent >= 0 && A.from[pendingEvent] != m && variantFor(pendingEvent, m) < 0) moodAfter = m;
    else if (!same) { moodAfter = -1; setTarget(m); }
    return reply();
  }
  if (cmd == 'e') {
    demo = false;
    if (!playEvent(arg)) { say("err unknown event"); return; }
    return reply();
  }
  if (cmd == 'o') {
    int w = 0, a = 0, u = 0;
    sscanf(arg.c_str(), "%d %d %d", &w, &a, &u);
    ovWorking = max(0, w); ovWaiting = max(0, a); ovUnseen = max(0, u); lastFrame = -1;
    say("ok overlay working=%d waiting=%d unseen=%d", ovWorking, ovWaiting, ovUnseen);
    return;
  }
  if (cmd == 'i') { say("ok imu=%s peak=%.2fg taps=%lu threshold=%.2fg", imuAddr ? "on" : "missing", (float)peakJolt, (unsigned long)tapCount, (float)tapThreshold); return; }
  if (cmd == 'T') { float t = arg.toFloat(); if (t > 0.05f && t < 4) tapThreshold = t; say("ok threshold=%.2fg", (float)tapThreshold); return; }
  if (cmd == 'c') {
    if (arg.startsWith("#")) arg = arg.substring(1);
    if (arg.length() != 6) { say("err bad colour"); return; }
    long c = strtol(arg.c_str(), nullptr, 16);
    goalR = (c >> 16) & 255; goalG = (c >> 8) & 255; goalB = c & 255;
    say("ok colour %06lX", c);
    return;
  }
  if (cmd == 'X') { tapPending = true; return; }     // pretend the glass was tapped (for testing)
  if (cmd == '?') return reply();
  say("err unknown command");
}
static void pollSerial() {
  static String buf;
  while (Serial.available()) { char ch = Serial.read(); if (ch == '\n' || ch == '\r') { if (buf.length()) handleLine(buf); buf = ""; } else if (buf.length() < 240) buf += ch; }
}

// ---------- Wi-Fi ----------
static void webBegin();                         // below, with the update server
static void wifiBegin() {
  Preferences pr; pr.begin("sage", true);
  wifiSsid = pr.getString("ssid", ""); String pass = pr.getString("pass", "");
  netToken = pr.getString("token", ""); tzRule = pr.getString("tz", "");
  pr.end();
  if (!wifiSsid.length()) { WiFi.mode(WIFI_OFF); Serial.println("wifi not set up"); return; }
  WiFi.mode(WIFI_STA); WiFi.setHostname("sage"); WiFi.setAutoReconnect(true);
  WiFi.begin(wifiSsid.c_str(), pass.c_str());
  if (tzRule.length()) configTzTime(tzRule.c_str(), "pool.ntp.org", "time.apple.com");
  server.begin(); server.setNoDelay(true);
  webBegin();
  wifiStarted = true;
  Serial.printf("wifi joining %s\n", wifiSsid.c_str());
}
// "w <ssid>\t<password>\t<token>\t<tz>" saves and restarts; "w" alone forgets
static void setWifi(String a) {
  if (a.startsWith(" ")) a = a.substring(1);
  Preferences pr; pr.begin("sage", false);
  if (!a.length()) { pr.clear(); pr.end(); say("ok wifi forgotten, restarting"); Serial.flush(); delay(300); ESP.restart(); }
  String f[4]; int n = 0, from = 0;
  for (int i = 0; i <= (int)a.length() && n < 4; i++)
    if (i == (int)a.length() || a[i] == '\t') { f[n++] = a.substring(from, i); from = i + 1; }
  if (n < 3 || !f[0].length() || f[2].length() < 8) { pr.end(); say("err use: w <ssid> TAB <password> TAB <token> [TAB <tz>]"); return; }
  pr.putString("ssid", f[0]); pr.putString("pass", f[1]); pr.putString("token", f[2]);
  if (n >= 4 && f[3].length()) pr.putString("tz", f[3]);
  pr.end();
  say("ok wifi saved ssid=%s, restarting", f[0].c_str()); Serial.flush(); delay(300); ESP.restart();
}
static void wifiReport() {
  if (!wifiStarted) return say("ok wifi=off");
  struct tm t; bool ntp = tzRule.length() && getLocalTime(&t, 0);
  bool up = WiFi.status() == WL_CONNECTED;
  say("ok wifi=%s ssid=%s ip=%s rssi=%d clock=%s client=%s", up ? "connected" : "joining", wifiSsid.c_str(),
      up ? WiFi.localIP().toString().c_str() : "-", up ? WiFi.RSSI() : 0,
      ntp ? "internet" : clockBase >= 0 ? "bridge" : "none", netAuthed && net.connected() ? "paired" : "none");
}
static void pollNet() {
  if (!wifiStarted) return;
  static uint32_t lastCheck = 0; static String buf;
  uint32_t now = millis();
  if (now - lastCheck > 1000) {                // announce sage.local whenever we're on the network
    lastCheck = now;
    bool up = WiFi.status() == WL_CONNECTED;
    if (up && !mdnsUp) { mdnsUp = MDNS.begin("sage"); if (mdnsUp) { MDNS.addService("deskbuddy", "tcp", NET_PORT); Serial.printf("wifi up %s\n", WiFi.localIP().toString().c_str()); } }
    else if (!up && mdnsUp) { MDNS.end(); mdnsUp = false; }
  }
  WiFiClient c = server.accept();
  if (c) { if (net) net.stop(); net = c; net.setNoDelay(true); netAuthed = false; buf = ""; }  // newest wins
  if (!net) return;
  if (!net.connected()) { net.stop(); netAuthed = false; return; }
  while (net.available()) {
    char ch = net.read();
    if (ch == '\n' || ch == '\r') { if (buf.length()) handleLine(buf, true); buf = ""; if (!net) return; }
    else if (buf.length() < 240) buf += ch;
  }
}

// ---------- updates over Wi-Fi ----------
static WebServer web(80);
static uint32_t restartAt = 0;
static bool webAuthed() { return netToken.length() >= 8 && web.header("X-Sage-Token") == netToken; }
static String hex(const uint8_t* b, int n) { static const char* H = "0123456789abcdef"; String s; for (int i = 0; i < n; i++) { s += H[b[i] >> 4]; s += H[b[i] & 15]; } return s; }
// SHA-256 of the first len bytes of a partition (len 0 = nothing to compare: empty string)
static String partSha(const esp_partition_t* part, size_t len) {
  if (!part || !len || len > part->size) return "";
  mbedtls_sha256_context c; mbedtls_sha256_init(&c); mbedtls_sha256_starts(&c, 0);
  static uint8_t buf[4096];
  for (size_t off = 0; off < len; off += sizeof buf) {
    size_t n = min(sizeof buf, len - off);
    if (esp_partition_read(part, off, buf, n) != ESP_OK) { mbedtls_sha256_free(&c); return ""; }
    mbedtls_sha256_update(&c, buf, n);
  }
  uint8_t out[32]; mbedtls_sha256_finish(&c, out); mbedtls_sha256_free(&c);
  return hex(out, 32);
}
// shown on the glass while an update streams in (drawn straight to the screen: it isn't animating)
static void progress(const char* what, size_t done, size_t total) {
  static uint32_t last = 0;
  if (done && done != total && millis() - last < 150) return;
  last = millis();
  uint16_t cream = lgfx::color565(255, 241, 220);
  if (!done) { tft.fillScreen(TFT_BLACK); tft.setTextColor(cream); tft.setTextDatum(middle_center); tft.drawString(what, 120, 100); tft.drawRect(30, 125, 180, 14, cream); }
  if (total) tft.fillRect(32, 127, int(176.f * min(done, total) / total), 10, cream);
}
static void onInfo() {
  if (!webAuthed()) return web.send(401, "text/plain", "pairing token needed\n");
  const esp_partition_t* running = esp_ota_get_running_partition();
  String j = "{\"running\":\"" + String(running ? running->label : "?") + "\"";
  j += ",\"app_sha\":\"" + partSha(running, web.arg("app_len").toInt()) + "\"";
  j += ",\"art_sha\":\"" + partSha(artPart, web.arg("art_len").toInt()) + "\"";
  j += ",\"art_ok\":" + String(A.ok ? "true" : "false");
  j += ",\"art_room\":" + String(artPart ? artPart->size : 0);
  const esp_partition_t* next = esp_ota_get_next_update_partition(nullptr);
  j += ",\"app_room\":" + String(next ? next->size : 0) + "}\n";
  web.send(200, "application/json", j);
}
// shared by both uploads: the streaming state of the one in progress
static bool upOk = false; static String upErr; static size_t upSize = 0, upErased = 0;
static mbedtls_sha256_context upSha;
static void upFail(const String& e) { if (upOk) { upOk = false; upErr = e; Serial.printf("update failed: %s\n", e.c_str()); } }
static void onAppData() {
  HTTPRaw& r = web.raw();
  if (r.status == RAW_START) {
    upOk = webAuthed(); upErr = upOk ? "" : "pairing token needed";
    if (!upOk) return;
    upSize = web.header("X-Sage-Size").toInt();
    A.ok = false; progress("updating program", 0, upSize);
    if (!Update.begin(upSize ? upSize : UPDATE_SIZE_UNKNOWN)) return upFail(String("begin: ") + Update.errorString());
    if (web.header("X-Sage-MD5").length() == 32) Update.setMD5(web.header("X-Sage-MD5").c_str());
  } else if (r.status == RAW_WRITE && upOk) {
    if (Update.write(r.buf, r.currentSize) != r.currentSize) return upFail(String("write: ") + Update.errorString());
    progress("updating program", r.totalSize, upSize);
  } else if (r.status == RAW_END && upOk) {
    if (!Update.end(true)) return upFail(String("check: ") + Update.errorString());
  } else if (r.status == RAW_ABORTED) { upFail("upload cut short"); Update.abort(); }
}
static void onArtData() {
  HTTPRaw& r = web.raw();
  if (r.status == RAW_START) {
    upOk = webAuthed(); upErr = upOk ? "" : "pairing token needed";
    if (!upOk) return;
    upSize = web.header("X-Sage-Size").toInt(); upErased = 0;
    if (!artPart || !upSize || upSize > artPart->size) return upFail("art missing size or too big for the partition");
    A.ok = false; progress("updating drawings", 0, upSize);
    mbedtls_sha256_init(&upSha); mbedtls_sha256_starts(&upSha, 0);
  } else if (r.status == RAW_WRITE && upOk) {
    size_t at = r.totalSize - r.currentSize;
    if (at + r.currentSize > upSize) return upFail("more data than X-Sage-Size");
    while (upErased < at + r.currentSize) {        // erase 64 KB blocks just ahead of the data
      size_t n = min<size_t>(0x10000, artPart->size - upErased);
      if (esp_partition_erase_range(artPart, upErased, n) != ESP_OK) return upFail("erase failed");
      upErased += n;
    }
    if (esp_partition_write(artPart, at, r.buf, r.currentSize) != ESP_OK) return upFail("write failed");
    mbedtls_sha256_update(&upSha, r.buf, r.currentSize);
    progress("updating drawings", r.totalSize, upSize);
  } else if (r.status == RAW_END && upOk) {
    uint8_t out[32]; mbedtls_sha256_finish(&upSha, out);
    if (r.totalSize != upSize) return upFail("size mismatch");
    String want = web.header("X-Sage-Sha256"); want.toLowerCase();
    if (want.length() && want != hex(out, 32)) return upFail("sha256 mismatch");
  } else if (r.status == RAW_ABORTED) upFail("upload cut short");
}
static void onUpdateDone() {
  if (upOk) { web.send(200, "text/plain", "ok, restarting\n"); Serial.println("update ok, restarting"); restartAt = millis() + 500; }
  else {
    web.send(upErr == "pairing token needed" ? 401 : 500, "text/plain", "err " + upErr + "\n");
    if (upErr != "pairing token needed") restartAt = millis() + 500;   // the screen was taken over: start clean
  }
}
static bool clipBusy(int si) {
  for (int s : {curSeq, pendingEvent, pendingThen, follow}) if (s >= 0 && A.src[s] == si) return true;
  return false;
}
// Forget a clip: its sequences close up in the list and its memory is freed.
static void dropClip(int si) {
  int w = 0;
  for (int s = 0; s < A.nSeqs; s++) {
    if (A.src[s] == si) continue;
    if (w != s) {
      A.kind[w] = A.kind[s]; A.from[w] = A.from[s]; A.to[w] = A.to[s]; A.src[w] = A.src[s]; A.len[w] = A.len[s]; A.seq[w] = A.seq[s]; A.name[w] = A.name[s];
      if (curSeq == s) curSeq = w;
      if (pendingEvent == s) pendingEvent = w;
      if (pendingThen == s) pendingThen = w;
      if (follow == s) follow = w;
    }
    w++;
  }
  A.nSeqs = w; win.forget(); free(A.srcs[si].own); A.srcs[si] = Src();
}
// Make room by dropping the clip played longest ago; false if there's none it can drop.
static bool dropOldestClip() {
  int old = -1;
  for (int i = 1; i < MAX_SRC; i++) if (A.srcs[i].own && !A.srcs[i].tap && !clipBusy(i) && (old < 0 || int32_t(A.srcs[i].used - A.srcs[old].used) < 0)) old = i;
  if (old < 0) return false;
  say("clip gone %s", A.srcs[old].name.c_str());
  dropClip(old);
  return true;
}
// A clip arrives whole in buf (which we own from here on success). One with a name it already has
// replaces the older one.
static String addClip(uint8_t* buf, size_t size, String name, bool tap) {
  name.toLowerCase();
  if (!name.length()) return "a clip needs a name (X-Sage-Name)";
  for (int i = 1; i < MAX_SRC; i++) if (A.srcs[i].own && A.srcs[i].name == name) {
    if (clipBusy(i)) return "that clip is playing, try again";
    dropClip(i);
  }
  for (;;) {
    int si = -1;
    for (int i = 1; i < MAX_SRC && si < 0; i++) if (!A.srcs[i].own) si = i;
    if (si > 0 && parseArt(buf, size, si)) {
      A.srcs[si].own = buf; A.srcs[si].name = name; A.srcs[si].used = millis(); A.srcs[si].tap = tap;
      Serial.printf("clip %s: %u bytes\n", name.c_str(), (unsigned)size);
      return "";
    }
    if (si > 0) A.srcs[si] = Src();
    if (!dropOldestClip()) return "not a clip it can read";       // with nothing left to drop, the clip itself is the problem
  }
}
static uint8_t* clipBuf = nullptr; static size_t clipSize = 0; static String clipErr;
static void clipFail(const char* e) { clipErr = e; free(clipBuf); clipBuf = nullptr; }
static void onClipData() {
  HTTPRaw& r = web.raw();
  if (r.status == RAW_START) {
    clipFail(""); clipSize = web.header("X-Sage-Size").toInt();
    if (!webAuthed()) return clipFail("pairing token needed");
    if (!A.ok) return clipFail("it has no drawings to add it to");
    if (!clipSize || clipSize > 2 * 1024 * 1024) return clipFail("missing X-Sage-Size, or over 2 MB");
    clipBuf = (uint8_t*)heap_caps_malloc(clipSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!clipBuf) clipFail("out of memory");
  } else if (r.status == RAW_WRITE && clipBuf) {
    size_t at = r.totalSize - r.currentSize;
    if (at + r.currentSize > clipSize) return clipFail("more data than X-Sage-Size");
    memcpy(clipBuf + at, r.buf, r.currentSize);
  } else if (r.status == RAW_END && clipBuf) { if (r.totalSize != clipSize) clipFail("size mismatch"); }
  else if (r.status == RAW_ABORTED) clipFail("upload cut short");
}
static void onClipDone() {
  if (clipBuf) { clipErr = addClip(clipBuf, clipSize, web.header("X-Sage-Name"), web.header("X-Sage-Tap") == "1"); if (clipErr.length()) free(clipBuf); clipBuf = nullptr; }
  if (clipErr.length()) web.send(clipErr == "pairing token needed" ? 401 : 400, "text/plain", "err " + clipErr + "\n");
  else web.send(200, "text/plain", "ok\n");
}
static void webBegin() {
  static const char* keep[] = {"X-Sage-Token", "X-Sage-Size", "X-Sage-MD5", "X-Sage-Sha256", "X-Sage-Name", "X-Sage-Tap"};
  web.collectHeaders(keep, 6);
  web.on("/info", HTTP_GET, onInfo);
  web.on("/update/app", HTTP_POST, onUpdateDone, onAppData);
  web.on("/update/art", HTTP_POST, onUpdateDone, onArtData);
  web.on("/clip", HTTP_POST, onClipDone, onClipData);
  web.begin();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BL, OUTPUT); analogWrite(PIN_BL, BL_DAY);
  tft.init(); tft.setRotation(PRISM_MIRROR ? 4 : 0); tft.fillScreen(TFT_BLACK);
  fb.setColorDepth(16); fb.setPsram(false);
  if (!fb.createSprite(240, 240)) { fb.setPsram(true); fb.createSprite(240, 240); }
  cv.fb = (uint16_t*)fb.getBuffer(); cv.recolour = recolour8;
  cv.acc = (float*)heap_caps_calloc(vec::STRIDE * (vec::H + 1), sizeof(float), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  for (auto& m : cv.clips) m = (uint8_t*)heap_caps_malloc(vec::W * vec::H, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  win.buf = (uint8_t*)heap_caps_calloc(packed::WINDOW + packed::SLACK, 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT); win.dec = &inflater;
  if (!cv.acc || !win.buf || !mapArt() || !parseArt(art, artSize, 0)) {
    A.ok = false;
    Serial.println("err art missing or bad (send it: tools/ota.py --art)");
    tft.setTextColor(lgfx::color565(255, 241, 220)); tft.setTextDatum(middle_center);
    tft.drawString("no drawings yet", 120, 104); tft.drawString("tools/ota.py --art", 120, 124);
    wifiBegin();                                   // still reachable, so the art can be sent
    return;
  }
  A.ok = true;
  Serial.printf("sage ready: %u moods, %u sequences, %u frames\n", A.nMoods, A.nSeqs, A.nFrames);
  randomSeed(esp_random());
  if (imuInit()) { xTaskCreatePinnedToCore(imuTask, "imu", 4096, nullptr, 2, nullptr, 0); Serial.println("imu ready"); }
  else Serial.println("imu not found");
  curMood = target = 0; startSeq(A.loopOf[0]); loopSince = millis();
  playEvent("glyph_form");                         // out of the rain, if the art has it
  wifiBegin();
}

void loop() {
  pollSerial();
  pollNet();
  if (wifiStarted) web.handleClient();
  if (restartAt && millis() > restartAt) ESP.restart();
  if (!A.ok) { delay(20); return; }
  if (tapPending) {
    tapPending = false;
    say("tap");                                    // the bridge decides what a tap means, and its mind what plays
    if (offline) playEvent("tap");                 // on its own, it answers itself
  }
  uint32_t now = millis();                         // read after the tap: an act started this pass must not look old
  runDemo(now);
  runOffline(now);
  autoBehaviour(now);
  backlight(now);

  int32_t age = int32_t(now - seqStart);         // signed: something started after 'now' is age 0, not 49 days
  uint32_t tick = age > 0 ? uint32_t(age) * A.fps / 1000 : 0;
  if (A.kind[curSeq] != LOOP && tick >= A.len[curSeq]) { settle(A.to[curSeq]); tick = 0; }
  uint32_t pos = A.kind[curSeq] == LOOP ? tick % A.len[curSeq] : min<uint32_t>(tick, A.len[curSeq] - 1);
  uint16_t idx = rd16(A.seq[curSeq] + 2 * pos);
  // fade the body colour toward its goal (~1 s), redrawing as it changes
  static uint32_t lastFade = 0;
  if (now - lastFade >= 30 && (fabsf(goalR - tintR) + fabsf(goalG - tintG) + fabsf(goalB - tintB)) > 1.5f) {
    lastFade = now;
    tintR += (goalR - tintR) * 0.12f; tintG += (goalG - tintG) * 0.12f; tintB += (goalB - tintB) * 0.12f;
    lastFrame = -1;
  }
  static uint32_t lastOverlayTick = 0;
  static int lastAntenna = -1;
  uint32_t overlayTick = now / 100;              // corner extras animate at ~10 fps
  bool ov = overlayVisible();
  int ant = antennaStep(now);                    // its antenna at 24 steps a second while a ring goes out
  int frame = (A.src[curSeq] << 16) | idx;
  if (frame != lastFrame || ant != lastAntenna || (ov && overlayTick != lastOverlayTick)) {
    lastOverlayTick = overlayTick;
    uint32_t began = micros();
    drawFrame(A.src[curSeq], idx);
    drawAntenna(ant);
    slowestDraw = max(slowestDraw, (micros() - began) / 1000.f);
    if (ov) drawOverlay(now);
    fb.pushSprite(0, 0);
    lastFrame = frame; lastAntenna = ant;
    static uint32_t t0 = now; static int n = 0;
    if (++n, now - t0 >= 2000) { fps = n * 1000.f / (now - t0); n = 0; t0 = now; }
  }
  delay(2);
}
