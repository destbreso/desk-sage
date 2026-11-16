// The page: the scene, the levels and their camera, picking, the callouts beside the model, and the parts list.
(function () {
  "use strict";
  const NS = (window.DeskSageHardware = window.DeskSageHardware || {});

  NS.start = function (THREE, addons) {
    const { OrbitControls, RoomEnvironment } = addons;
    const LEVELS = NS.levels, LAST = LEVELS.length - 1;
    const params = new URLSearchParams(location.search);
    const CAPTURE = params.has("capture");
    if (CAPTURE) document.body.classList.add("capture");

    const viewer = document.getElementById("viewer");
    const host = document.getElementById("stage");
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c0b);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(70, 130, 90);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.45);
    fill.position.set(-90, 40, 50);
    const rim = new THREE.DirectionalLight(0xf2fff0, 0.9);
    rim.position.set(-30, 90, -130);
    scene.add(key, fill, rim);

    const camera = new THREE.PerspectiveCamera(30, 1, 1, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.screenSpacePanning = true;
    controls.minDistance = 15;
    controls.maxDistance = 1200;

    const model = NS.buildModel(THREE, addons);
    scene.add(model.root);

    // the desk: a faint millimetre grid, fading out, and soft shadows under each piece
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0xa0e299) } },
        vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: `uniform vec3 uColor; varying vec3 vW;
          float line(float c){ float d = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - min(d, 1.0); }
          void main(){
            float minor = max(line(vW.x / 10.0), line(vW.z / 10.0));
            float major = max(line(vW.x / 50.0), line(vW.z / 50.0));
            float fade = 1.0 - smoothstep(60.0, 240.0, length(vW.xz));
            gl_FragColor = vec4(uColor, (minor * 0.035 + major * 0.06) * fade);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    grid.renderOrder = -1;
    scene.add(grid);
    const blobTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, "rgba(0,0,0,0.85)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const blobs = [["stand", 48, 62, 0.7], ["case", 34, 38, 0.5], ["pcb", 32, 36, 0.45], ["display", 30, 34, 0.45], ["prism", 32, 32, 0.4]].map(([id, w, d, a]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: a }));
      m.renderOrder = -1;
      m.userData = { id, a };
      scene.add(m);
      return m;
    });

    // ---------- parts, units and what each level shows ----------
    const COMPOSITE = {
      prism: ["prism-lower", "prism-upper"],
      display: ["display-glass", "display-panel", "display-driver", "display-backlight", "display-back", "display-tape", "display-flex"],
    };
    const parentOf = {};
    Object.entries(COMPOSITE).forEach(([p, kids]) => kids.forEach((k) => (parentOf[k] = p)));
    const SPLIT_LEVEL = LAST;
    const split = { prism: 0, display: 0 }, splitGoal = { prism: 0, display: 0 };
    let d = 0, selected = null, hover = null, hoverFromDom = false;
    const level = () => Math.max(0, Math.min(LAST, Math.round(d)));
    function unitOf(leaf) {
      const p = parentOf[leaf];
      if (!p) return leaf;
      if (level() >= SPLIT_LEVEL || split[p] > 0.5) return leaf;
      return p;
    }
    function leavesOf(unit) {
      if (unit === "reflection") return ["prism-lower", "prism-upper"];
      return COMPOSITE[unit] || [unit];
    }
    const pickables = [];
    model.parts.forEach((p) => p.group.traverse((o) => o.isMesh && pickables.push(o)));
    // which of the big pieces each part travels with, so pieces set aside can be dimmed
    const topOf = new Map(Object.entries(model.tops).map(([k, o]) => [o, k]));
    const partTop = {};
    model.parts.forEach((p) => {
      let o = p.group;
      while (o && !topOf.has(o)) o = o.parent;
      partTop[p.id] = o ? topOf.get(o) : null;
    });
    const DIM_KEEP = {
      device: null,
      "board+display": ["pcb", "display", "prism", "headers"],
      board: ["pcb", "headers"],
      column: ["display", "prism"],
    };
    const looseMats = [];
    model.root.traverse((o) => {
      if ((o.isMesh || o.isLine) && !o.userData.partId && o.material && o.material.userData) {
        if (o.material.userData.baseOpacity === undefined) o.material.userData.baseOpacity = o.material.opacity;
        looseMats.push(o.material);
      }
    });

    // ---------- the camera: each level framed from its own angle, leaving room for the callouts ----------
    const focusTops = {
      device: ["stand", "case", "pcb", "display", "prism"],
      "board+display": ["pcb", "display", "prism"],
      board: ["pcb", "headers"],
      column: ["display", "prism"],
    };
    const box = new THREE.Box3(), tmpBox = new THREE.Box3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
    function topsBox(names, out) {
      out.makeEmpty();
      names.forEach((n) => {
        const o = model.tops[n];
        o.updateMatrixWorld(true);
        tmpBox.setFromObject(o);
        if (!tmpBox.isEmpty()) out.union(tmpBox);
      });
      return out;
    }
    const UP = new THREE.Vector3(0, 1, 0);
    function dirFrom(az, el) {
      const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
      return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    }
    function layoutBand() {
      const W = viewer.clientWidth, H = viewer.clientHeight;
      const col = columnWidth(W);
      const vt = viewer.getBoundingClientRect().top;
      const top = Math.max(...["level", "hint", "phone-hint"].map((id) => document.getElementById(id).getBoundingClientRect().bottom)) - vt + 8;
      const ctrl = document.getElementById("controls").getBoundingClientRect();
      const bottom = ctrl.height ? viewer.getBoundingClientRect().bottom - ctrl.top + 8 : 8;
      return { W, H, col, top: Math.max(8, top), bottom: Math.max(8, bottom) };
    }
    function fit(b, az, el) {
      const { W, H, col, top, bottom } = layoutBand();
      const c = b.getCenter(new THREE.Vector3());
      const dir = dirFrom(az, el), F = dir.clone().negate();
      const R = new THREE.Vector3().crossVectors(F, UP).normalize(), U = new THREE.Vector3().crossVectors(R, F).normalize();
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const fracW = Math.max(0.3, (W - 2 * col - (col ? 60 : 24)) / W), fracH = Math.max(0.35, (H - top - bottom - 10) / H);
      const tv = tanV * fracH, th = tanV * (W / H) * fracW;
      let D = 0;
      for (let i = 0; i < 8; i++) {
        v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(c);
        const x = v3.dot(R), y = v3.dot(U), z = v3.dot(F);
        D = Math.max(D, Math.abs(x) / th - z, Math.abs(y) / tv - z);
      }
      D *= 1.03;
      // centre the box in the band between the level panel and the controls
      const bandMid = top + (H - top - bottom) / 2, ndcY = 1 - (2 * bandMid) / H;
      const target = c.clone().addScaledVector(U, -ndcY * D * tanV);
      return { target, D, az, el };
    }
    let fits = [];
    function computeFits() {
      fits = LEVELS.map((L, i) => {
        model.update(i, { prism: 0, display: 0 });
        return fit(topsBox(focusTops[L.focus], box), L.view.az, L.view.el);
      });
      model.update(d, split);
    }
    const smooth = (t) => t * t * (3 - 2 * t);
    function levelView(dd) {
      const a = Math.max(0, Math.min(LAST, Math.floor(dd))), b = Math.min(LAST, a + 1), t = smooth(Math.max(0, Math.min(1, dd - a)));
      const A = fits[a], B = fits[b];
      return { target: A.target.clone().lerp(B.target, t), D: A.D + (B.D - A.D) * t, az: A.az + (B.az - A.az) * t, el: A.el + (B.el - A.el) * t };
    }
    const cam = { target: new THREE.Vector3(), D: 200, az: 30, el: 15 };
    let auto = true;
    function cameraFromSpherical() {
      camera.position.copy(cam.target).addScaledVector(dirFrom(cam.az, cam.el), cam.D);
      controls.target.copy(cam.target);
      camera.lookAt(cam.target);
    }
    function sphericalFromCamera() {
      cam.target.copy(controls.target);
      v3.copy(camera.position).sub(controls.target);
      cam.D = v3.length();
      cam.el = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, v3.y / cam.D))));
      cam.az = THREE.MathUtils.radToDeg(Math.atan2(v3.x, v3.z));
    }
    function unitBox(unit, out) {
      out.makeEmpty();
      leavesOf(unit).forEach((id) => {
        const p = model.parts.get(id);
        if (p) out.union(tmpBox.setFromObject(p.group));
      });
      return out;
    }
    controls.addEventListener("start", () => {
      auto = false;
      play = null;
    });

    // ---------- callouts: a column either side, a fine line to a dot on each part ----------
    const layer = document.getElementById("callouts");
    const svg = layer.querySelector("svg");
    const C = new Map();
    const SVGNS = "http://www.w3.org/2000/svg";
    NS.parts.forEach((p) => {
      const el = document.createElement("div");
      el.className = "callout";
      el.innerHTML = `<b></b><span></span>`;
      el.querySelector("b").textContent = p.name;
      el.querySelector("span").textContent = p.line;
      el.dataset.id = p.id;
      layer.appendChild(el);
      const path = document.createElementNS(SVGNS, "path"), dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("r", "2.2");
      svg.appendChild(path);
      svg.appendChild(dot);
      el.addEventListener("pointerenter", () => {
        hover = p.id;
        hoverFromDom = true;
      });
      el.addEventListener("pointerleave", () => {
        if (hover === p.id) hover = null;
        hoverFromDom = false;
      });
      el.addEventListener("click", () => select(p.id));
      C.set(p.id, { el, path, dot, side: 0, h: 0, hCompact: 0, shown: false });
    });
    // under 600 px wide there is no room for columns: the model takes the width, and a tap opens a part's card
    const NARROW = 600;
    function columnWidth(W) {
      return W >= 1200 ? 240 : W >= 960 ? 210 : W >= 700 ? 170 : W >= NARROW ? 118 : 0;
    }
    const anchorV = new THREE.Vector3();
    const COMPOSITE_ANCHOR = {
      prism: () => model.tops.prism.localToWorld(anchorV.set(NS.dims.PRISM.x, NS.dims.PRISM.y, 0)),
      display: () => model.tops.display.localToWorld(anchorV.set(7, NS.dims.GAP + 1.6, 12.2)),
      reflection: () => model.reflectionCentre(anchorV),
    };
    function anchorOf(id) {
      if (COMPOSITE_ANCHOR[id]) return COMPOSITE_ANCHOR[id]();
      const p = model.parts.get(id);
      if (!p) return null;
      const obj = p.anchorObj || p.group;
      if (p.anchor) return obj.localToWorld(anchorV.copy(p.anchor));
      tmpBox.setFromObject(p.group);
      return tmpBox.getCenter(anchorV).setY(tmpBox.max.y);
    }
    function calloutIds() {
      if (viewer.clientWidth < NARROW) return [];
      if (selected) {
        if (COMPOSITE[selected] && split[selected] > 0.5) return COMPOSITE[selected].slice();
        return [selected];
      }
      const ids = LEVELS[level()].callouts.slice();
      if (hover && !ids.includes(hover) && C.has(hover)) ids.push(hover);
      return ids;
    }
    function measure(id, compact) {
      const c = C.get(id);
      const key = compact ? "hCompact" : "h";
      if (!c[key]) {
        c.el.classList.toggle("compact", compact);
        c.el.style.display = "flex";
        c.el.style.maxWidth = currentCol - 8 + "px";
        c[key] = c.el.offsetHeight || 16;
      }
      return c[key];
    }
    let currentCol = 240;
    function resetMeasures() {
      C.forEach((c) => (c.h = c.hCompact = 0));
    }
    const proj = new THREE.Vector3();
    let calloutAlpha = 0;
    function layoutCallouts() {
      const band = layoutBand();
      const { W, H } = band;
      currentCol = band.col;
      const near = Math.abs(d - Math.round(d));
      const wantAlpha = selected ? 1 : play && !play.hold ? 0 : Math.max(0, 1 - near / 0.12);
      calloutAlpha += (wantAlpha - calloutAlpha) * 0.25;
      if (wantAlpha === 0 && calloutAlpha < 0.02) calloutAlpha = 0;
      layer.style.opacity = calloutAlpha.toFixed(3);
      const ids = calloutIds();
      const showing = new Set();
      const pts = [];
      ids.forEach((id) => {
        const a = anchorOf(id);
        if (!a) return;
        proj.copy(a).project(camera);
        if (proj.z > 1 || proj.z < -1) return;
        const x = ((proj.x + 1) / 2) * W, y = ((1 - proj.y) / 2) * H;
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
        pts.push({ id, x, y });
      });
      // the model's reach on screen, so the columns sit outside it
      let minX = Infinity, maxX = -Infinity;
      const fb = selected ? unitBox(selected, box) : topsBox(focusTops[LEVELS[level()].focus], box);
      for (let i = 0; i < 8; i++) {
        proj.set(i & 1 ? fb.max.x : fb.min.x, i & 2 ? fb.max.y : fb.min.y, i & 4 ? fb.max.z : fb.min.z).project(camera);
        const x = ((proj.x + 1) / 2) * W;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      pts.forEach((p) => (minX = Math.min(minX, p.x), maxX = Math.max(maxX, p.x)));
      const col = band.col;
      const mid = (minX + maxX) / 2;
      const xL = Math.max(col + 12, Math.min(W / 2 - 40, minX - 26));
      const xR = Math.min(W - col - 12, Math.max(W / 2 + 40, maxX + 26));
      const top = band.top, bottom = H - band.bottom;
      const cardBox = document.getElementById("card").hidden ? null : document.getElementById("card").getBoundingClientRect();
      const vr = viewer.getBoundingClientRect();
      // sides: by where the part is, kept unless it moves well past the middle; then balanced
      pts.forEach((p) => {
        const c = C.get(p.id);
        if (!c.side || Math.abs(p.x - mid) > 26) c.side = p.x < mid ? -1 : 1;
        p.side = c.side;
      });
      const gap = W < 700 ? 3 : 7;
      for (let pass = 0; pass < 2; pass++) {
        const n = { "-1": pts.filter((p) => p.side < 0).length, 1: pts.filter((p) => p.side > 0).length };
        const cap = Math.max(1, Math.floor((bottom - top) / (W < 700 ? 22 : 36)));
        for (const s of [-1, 1]) {
          if (n[s] > cap && n[-s] < cap) {
            const move = pts.filter((p) => p.side === s).sort((a, b) => (s < 0 ? b.x - a.x : a.x - b.x)).slice(0, Math.min(n[s] - cap, cap - n[-s]));
            move.forEach((p) => (p.side = -s, C.get(p.id).side = -s));
          }
        }
      }
      for (const side of [-1, 1]) {
        const colPts = pts.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
        if (!colPts.length) continue;
        let colTop = top;
        if (side > 0 && cardBox) colTop = Math.max(top, cardBox.bottom - vr.top + 8);
        let compact = W < 700;
        let hs = colPts.map((p) => measure(p.id, compact));
        const total = () => hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
        if (!compact && total() > bottom - colTop) {
          compact = true;
          hs = colPts.map((p) => measure(p.id, true));
        }
        const ys = colPts.map((p) => p.y);
        for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], i ? ys[i - 1] + (hs[i - 1] + hs[i]) / 2 + gap : colTop + hs[i] / 2);
        for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], i < ys.length - 1 ? ys[i + 1] - (hs[i + 1] + hs[i]) / 2 - gap : bottom - hs[i] / 2);
        colPts.forEach((p, i) => {
          const c = C.get(p.id);
          const x = side < 0 ? xL : xR, y = ys[i];
          c.el.classList.toggle("compact", compact);
          c.el.classList.toggle("left", side < 0);
          c.el.style.maxWidth = col - 8 + "px";
          c.el.style.display = "flex";
          c.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${side < 0 ? "-100%" : "0"}, -50%)`;
          c.path.setAttribute("d", `M${(x - side * 6).toFixed(1)} ${y.toFixed(1)}H${(x - side * 18).toFixed(1)}L${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
          c.dot.setAttribute("cx", p.x.toFixed(1));
          c.dot.setAttribute("cy", p.y.toFixed(1));
          const hot = hover && (hover === p.id || unitOf(hover) === p.id);
          c.el.classList.toggle("hot", !!hot);
          c.path.classList.toggle("hot", !!hot);
          c.path.style.display = c.dot.style.display = "";
          showing.add(p.id);
        });
      }
      C.forEach((c, id) => {
        if (!showing.has(id)) {
          c.el.style.display = "none";
          c.path.style.display = c.dot.style.display = "none";
        }
      });
    }

    // ---------- highlight, isolation ----------
    const GREEN = new THREE.Color(0xa0e299);
    function applyLook(dt) {
      const k = Math.min(1, dt * 10);
      const hotLeaves = new Set(hover ? leavesOf(hover) : []);
      const keep = new Set(selected ? leavesOf(selected) : []);
      const lit = DIM_KEEP[LEVELS[litLevel === null ? level() : litLevel].focus];
      model.parts.forEach((p) => {
        const dim = !selected && lit && !lit.includes(partTop[p.id]);
        const ghost = (selected && !keep.has(p.id)) || dim;
        p.dim = ghost;
        const hot = !keep.has(p.id) && (hotLeaves.has(p.id) || (hover && unitOf(p.id) === hover));
        p.materials.forEach((m) => {
          const base = m.userData.baseOpacity;
          const goal = ghost ? Math.min(base, dim ? 0.12 : 0.05) : base;
          m.opacity += (goal - m.opacity) * k;
          const needT = m.userData.baseTransparent || m.opacity < base - 0.01;
          if (m.transparent !== needT) {
            m.transparent = needT;
            m.needsUpdate = true;
          }
          m.depthWrite = m.userData.baseDepthWrite && !(ghost || m.opacity < base - 0.01);
          if (m.transmission > 0) m.visible = !ghost;
          if (m.emissive) {
            const gi = hot ? 0.16 : 0;
            m.emissive.lerpColors(m.userData.baseEmissive, GREEN, hot ? 1 : 0);
            m.emissiveIntensity += ((hot ? gi : m.userData.baseEmissiveIntensity) - m.emissiveIntensity) * k;
            if (!hot && m.emissiveIntensity - m.userData.baseEmissiveIntensity < 0.01) m.emissive.copy(m.userData.baseEmissive);
          }
        });
        p.lines.forEach((m) => {
          const base = m.userData.baseOpacity;
          m.opacity += ((ghost ? base * 0.35 : hot ? Math.min(1, base * 2.2) : base) - m.opacity) * k;
        });
      });
      looseMats.forEach((m) => {
        const base = m.userData.baseOpacity;
        const off = selected || (lit && !lit.includes("pcb"));
        m.opacity += ((off ? Math.min(base, 0.1) : base) - m.opacity) * k;
      });
      const prismOn = !model.parts.get("prism-lower").dim || (hover && leavesOf(hover).includes("prism-lower"));
      reflK += ((prismOn ? 1 : 0) - reflK) * k;
      model.setReflection(reflK);
      blobs.forEach((b) => {
        const off = selected || (lit && !lit.includes(b.userData.id));
        b.material.opacity += ((off ? 0.08 : b.userData.a) * blobHeight(b) - b.material.opacity) * k;
      });
    }
    let reflK = 1, litLevel = null;
    function blobHeight(b) {
      const o = model.tops[b.userData.id];
      return Math.max(0, 1 - Math.max(0, o.position.y - 5) / 140);
    }
    const card = document.getElementById("card");
    function showCard(id) {
      if (!id) {
        card.hidden = true;
        return;
      }
      const p = NS.partById[id];
      card.hidden = false;
      card.querySelector("h3").textContent = p.name;
      card.querySelector(".pn").textContent = p.pn;
      card.querySelector(".what").textContent = p.what;
      const dl = card.querySelector("dl");
      dl.innerHTML = "";
      [["Size (mm)", p.size], ["Source", p.source], ["Position", p.pos + (p.posNote ? ". " + p.posNote : "")]].forEach(([k, v]) => {
        if (!v) return;
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = k;
        dd.textContent = v;
        dl.append(dt, dd);
      });
    }
    function select(id) {
      if (!id) return deselect();
      if (id === "reflection") id = "prism";
      play = null;
      selected = id;
      const parent = parentOf[id];
      Object.keys(splitGoal).forEach((k) => (splitGoal[k] = 0));
      if (COMPOSITE[id]) splitGoal[id] = 1;
      if (parent && level() < SPLIT_LEVEL) splitGoal[parent] = 1;
      auto = false;
      focusing = 1.2;
      showCard(id);
      document.body.classList.add("isolated");
    }
    function deselect() {
      selected = null;
      Object.keys(splitGoal).forEach((k) => (splitGoal[k] = 0));
      showCard(null);
      auto = true;
      document.body.classList.remove("isolated");
    }
    card.querySelector("button").addEventListener("click", deselect);
    let focusing = 0;

    // ---------- pointer: hover, click and tap ----------
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let pointerMoved = false, pointerIn = false, down = null;
    const el = renderer.domElement;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      pointerMoved = e.pointerType === "mouse";
      pointerIn = true;
    });
    el.addEventListener("pointerleave", () => {
      pointerIn = false;
      if (!hoverFromDom) hover = null;
    });
    el.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    el.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 600;
      down = null;
      if (moved > 7 || !quick) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const hit = pick();
      if (!hit) return deselect();
      const u = unitOf(hit);
      if (selected === u) return deselect();
      select(u);
    });
    function pick() {
      ray.setFromCamera(ndc, camera);
      const keep = selected ? new Set(leavesOf(selected)) : null;
      const hits = ray.intersectObjects(pickables, false);
      for (const h of hits) {
        let o = h.object, id = o.userData.partId;
        if (!id) continue;
        if (!o.visible) continue;
        let p = o;
        let vis = true;
        while (p) {
          if (p.visible === false) vis = false;
          p = p.parent;
        }
        if (!vis) continue;
        if (keep && !keep.has(id)) continue;
        return id;
      }
      return null;
    }

    // ---------- levels: steps, scrubbing, the montage ----------
    const stepsEl = document.getElementById("steps");
    LEVELS.forEach((L, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i>${i}</i><span>${L.short}</span>`;
      b.title = L.name;
      b.addEventListener("click", () => goTo(i));
      stepsEl.appendChild(b);
    });
    const scrub = document.getElementById("scrub");
    scrub.max = String(LAST);
    scrub.addEventListener("input", () => {
      play = null;
      if (selected) deselect();
      auto = true;
      d = parseFloat(scrub.value);
    });
    let play = null; // { target, hold, speed, holds }
    function goTo(i) {
      if (selected) deselect();
      auto = true;
      play = { target: i, hold: 0, speed: 0.75, holds: false };
    }
    function runMontage(dir) {
      if (selected) deselect();
      auto = true;
      const target = dir > 0 ? LAST : 0;
      if (Math.abs(d - target) < 1e-3) d = dir > 0 ? 0 : LAST;
      play = { target, hold: 0.25, speed: 1.55, holds: true };
    }
    document.getElementById("apart").addEventListener("click", () => runMontage(1));
    document.getElementById("together").addEventListener("click", () => runMontage(-1));
    document.getElementById("reset").addEventListener("click", () => {
      if (selected) deselect();
      auto = true;
    });
    window.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "range") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") goTo(Math.min(LAST, (play ? play.target : level()) + 1));
      else if (e.key === "ArrowLeft" || e.key === "PageUp") goTo(Math.max(0, (play ? play.target : level()) - 1));
      else if (e.key === "Escape") deselect();
      else return;
      e.preventDefault();
    });
    function advance(dt) {
      if (!play) return;
      if (play.hold > 0) {
        play.hold -= dt;
        return;
      }
      const dir = Math.sign(play.target - d);
      if (!dir) {
        play = null;
        return;
      }
      const next = play.holds ? (dir > 0 ? Math.floor(d + 1e-6) + 1 : Math.ceil(d - 1e-6) - 1) : play.target;
      d += (dir * dt) / play.speed;
      if ((dir > 0 && d >= next) || (dir < 0 && d <= next)) {
        d = next;
        if (d === play.target) play = null;
        else play.hold = 1.15;
      }
    }

    // ---------- the level's words and controls ----------
    const lvN = document.getElementById("lvN"), lvName = document.getElementById("lvName"), lvText = document.getElementById("lvText");
    let shownLevel = -1;
    function updateHud() {
      const L = level();
      if (L !== shownLevel) {
        shownLevel = L;
        lvN.textContent = String(L);
        lvName.textContent = LEVELS[L].name;
        lvText.textContent = LEVELS[L].text;
        [...stepsEl.children].forEach((b, i) => b.setAttribute("aria-current", i === L ? "step" : "false"));
        resetMeasures();
      }
      if (document.activeElement !== scrub) scrub.value = d.toFixed(3);
      scrub.style.setProperty("--p", (d / LAST) * 100 + "%");
    }

    // ---------- the parts list ----------
    const tbody = document.getElementById("parts-body");
    let lastGroup = "";
    NS.parts.forEach((p) => {
      if (p.group !== lastGroup) {
        lastGroup = p.group;
        const tr = document.createElement("tr");
        tr.className = "group";
        tr.innerHTML = `<th colspan="6"></th>`;
        tr.firstChild.textContent = p.group;
        tbody.appendChild(tr);
      }
      const tr = document.createElement("tr");
      tr.dataset.id = p.id;
      const pos = p.pos + (p.posNote ? `. ${p.posNote}` : "");
      [p.name, p.pn, p.what, p.size, p.source, pos].forEach((t, i) => {
        const td = document.createElement(i ? "td" : "th");
        if (!i) td.scope = "row";
        td.textContent = t;
        if (i === 5) td.className = /Not published|Inferred/.test(p.pos) ? "pos warn" : "pos";
        tr.appendChild(td);
      });
      tr.tabIndex = 0;
      tr.addEventListener("pointerenter", () => {
        hover = p.id;
        hoverFromDom = true;
      });
      tr.addEventListener("pointerleave", () => {
        hover = null;
        hoverFromDom = false;
      });
      const go = () => {
        select(p.id);
        viewer.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => e.key === "Enter" && go());
      tbody.appendChild(tr);
    });

    // ---------- size, loop ----------
    function resize() {
      const W = viewer.clientWidth, H = viewer.clientHeight;
      renderer.setSize(W, H, false);
      renderer.domElement.style.width = W + "px";
      renderer.domElement.style.height = H + "px";
      svg.setAttribute("width", W);
      svg.setAttribute("height", H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      resetMeasures();
      computeFits();
    }
    new ResizeObserver(resize).observe(viewer);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => resetMeasures());

    const hashLevel = parseFloat((location.hash.match(/level=([\d.]+)/) || [])[1]);
    if (!isNaN(hashLevel)) d = Math.max(0, Math.min(LAST, hashLevel));
    resize();
    Object.assign(cam, levelView(d));
    cameraFromSpherical();

    let last = performance.now(), frames = 0, fpsT = last, fps = 0, frameMs = [], slow = 0;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      advance(dt);
      ["prism", "display"].forEach((k) => (split[k] += (splitGoal[k] - split[k]) * Math.min(1, dt * 5)));
      model.update(d, split);
      // camera: the level's framing, or the selected part's, eased
      if (selected && (auto || focusing > 0)) {
        focusing -= dt;
        const f = fit(unitBox(selected, box), cam.az, cam.el);
        f.D = Math.max(f.D, 45);
        const k = Math.min(1, dt * 4);
        cam.target.lerp(f.target, k);
        cam.D += (f.D - cam.D) * k;
        cameraFromSpherical();
      } else if (auto) {
        const f = levelView(d), k = play ? Math.min(1, dt * 6) : Math.min(1, dt * 4);
        cam.target.lerp(f.target, k);
        cam.D += (f.D - cam.D) * k;
        cam.az += (f.az - cam.az) * k;
        cam.el += (f.el - cam.el) * k;
        cameraFromSpherical();
      } else sphericalFromCamera();
      controls.update();
      if (pointerIn && pointerMoved && !hoverFromDom) {
        pointerMoved = false;
        const h = pick();
        hover = h ? unitOf(h) : null;
        el.style.cursor = h ? "pointer" : "";
      }
      applyLook(dt);
      blobs.forEach((b) => {
        const o = model.tops[b.userData.id];
        b.position.set(o.position.x, 0.05, o.position.z);
      });
      model.updateReflection(camera);
      renderer.render(scene, camera);
      layoutCallouts();
      updateHud();
      frames++;
      frameMs.push(dt * 1000);
      if (frameMs.length > 240) frameMs.shift();
      if (now - fpsT >= 1000) {
        fps = (frames * 1000) / (now - fpsT);
        frames = 0;
        fpsT = now;
        // a slow GPU draws fewer pixels rather than fewer frames
        slow = fps < 40 ? slow + 1 : 0;
        if (slow >= 2 && renderer.getPixelRatio() > 1) {
          renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.5));
          resize();
          slow = 0;
        }
      }
      api.ready = true;
    }
    function loop(now) {
      requestAnimationFrame(loop);
      frame(now);
    }

    // for the checks and the README's captures
    const api = (window.hardware = {
      ready: false,
      get depth() {
        return d;
      },
      get fps() {
        return fps;
      },
      frameTimes: () => frameMs.slice(),
      level: () => level(),
      goTo,
      montage: runMontage,
      setDepth(x) {
        play = null;
        auto = true;
        if (selected) deselect();
        d = Math.max(0, Math.min(LAST, x));
      },
      select,
      deselect,
      callouts() {
        const out = [];
        C.forEach((c, id) => {
          if (c.el.style.display === "none") return;
          const r = c.el.getBoundingClientRect();
          out.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        });
        return out;
      },
      screenOf(id) {
        model.update(d, split);
        const a = anchorOf(id);
        if (!a) return null;
        proj.copy(a).project(camera);
        const r = viewer.getBoundingClientRect();
        return { x: r.left + ((proj.x + 1) / 2) * r.width, y: r.top + ((1 - proj.y) / 2) * r.height };
      },
      get selected() {
        return selected;
      },
      // a still for the captures: depth, an optional view, then one frame drawn
      still(opts = {}) {
        play = null;
        if (opts.depth !== undefined) d = opts.depth;
        if (opts.split) Object.assign(split, opts.split), Object.assign(splitGoal, opts.split);
        litLevel = opts.lit === undefined ? null : opts.lit;
        grid.visible = opts.grid !== false;
        model.update(d, split, !!opts.forceSplit);
        (opts.hide || []).forEach((id) => {
          const o = model.tops[id] || model.parts.get(id).group;
          o.visible = false;
          blobs.forEach((b) => b.userData.id === id && (b.visible = false));
        });
        if (opts.view) {
          const f = opts.view.fitTo ? fit(topsBox(opts.view.fitTo, box), opts.view.az, opts.view.el) : levelView(d);
          cam.target.copy(opts.view.target ? new THREE.Vector3(...opts.view.target) : f.target);
          cam.D = (opts.view.D || f.D) * (opts.view.zoom || 1);
          cam.az = opts.view.az !== undefined ? opts.view.az : f.az;
          cam.el = opts.view.el !== undefined ? opts.view.el : f.el;
        } else Object.assign(cam, levelView(d));
        auto = false;
        cameraFromSpherical();
        controls.update();
        applyLook(1);
        model.updateReflection(camera);
        renderer.render(scene, camera);
        calloutAlpha = 1;
        layoutCallouts();
        updateHud();
        return { target: cam.target.toArray(), D: cam.D, az: cam.az, el: cam.el };
      },
    });
    model.ready.then(() => {
      if (CAPTURE) {
        api.ready = true;
        api.still({ depth: d });
      } else requestAnimationFrame(loop);
    });
  };
})();
