// The device drawn from Waveshare's published numbers, in millimetres: y up, its front (where you see Sage) +z.
// The board's own frame: the display side +y, its top edge (USB-C, battery header) -z. Positions on the component
// side are in the numbered photo's frame (u right, v down, from the board's centre) and turned over onto the board.
(function () {
  "use strict";
  const NS = (window.DeskSageHardware = window.DeskSageHardware || {});

  const PCB = { w: 26.25, h: 29.22, t: 1.6 };
  const M2 = { dx: 22.55 / 2, zTop: -12.61, zBot: 12.83, drill: 1.1, pad: 1.95 };
  const HDR = { dx: 23.72 / 2, z0: 8.99 - 7 * 2.54, pitch: 2.54, drill: 0.5, pad: 0.85 };
  const GAP = 3.4; // display to board, side view
  const DISP = { w: 23.4, zBack: -14.5, zFront: 8.9, active: 22.6 };
  const DISP_CZ = (DISP.zBack + DISP.zFront) / 2;
  const PRISM = { x: 12.7, y: 12.75, z: 12.7 };
  const CASE = { w: 28.65, d: 31.75, h: 12.55, floor: 1.15, side: 1.1, end: 1.07 };
  const STAND = { w: 33.1, d: 50.55, h: 36.9, deck: 35.4, wall: 2.1 };
  const REFLECT = 0.9; // a beam splitter's share of the display's light, by eye
  const USB_SLOTS = { u: -0.16, du: 4.35, v: [-12.19, -8.21] };
  const LEFT_PINS = ["5V", "GND", "3V3", "IO1", "IO2", "IO3", "IO4", "IO5"];
  const RIGHT_PINS = ["IO14", "IO13", "IO12", "IO11", "IO10", "IO9", "IO8", "IO7"];

  NS.dims = { PCB, M2, HDR, GAP, DISP, PRISM, CASE, STAND };

  NS.buildModel = function (THREE, addons) {
    const { mergeGeometries } = addons;
    const root = new THREE.Group();
    const parts = new Map(); // id -> { id, group, anchor }
    const nodes = []; // everything with keyframes, in update order
    const splitNodes = { prism: [], display: [] };

    // ---------- small helpers ----------
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const bx = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const cy = (r, h, x = 0, y = 0, z = 0, seg = 20) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z);
    const merge = (list) => mergeGeometries(list, false);
    const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
    function group(...children) {
      const g = new THREE.Group();
      children.forEach((c) => c && g.add(c));
      return g;
    }
    // profile in the (z, y) plane, extruded along +x from 0 to t
    function slabZY(pts, t) {
      const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
      return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).rotateY(Math.PI / 2);
    }
    // a wall in its own plane (u across, v up), thickness behind it (-z), optional shaped outline and holes
    function wall(outline, holes, t) {
      const s = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)));
      (holes || []).forEach((h) => s.holes.push(h));
      return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, -t);
    }
    function circlePath(x, y, r) {
      const p = new THREE.Path();
      p.absarc(x, y, r, 0, Math.PI * 2, true);
      return p;
    }
    function stadiumPath(cx, cy0, w, h) {
      const r = h / 2, p = new THREE.Path();
      p.moveTo(cx - w / 2 + r, cy0 - r);
      p.lineTo(cx + w / 2 - r, cy0 - r);
      p.absarc(cx + w / 2 - r, cy0, r, -Math.PI / 2, Math.PI / 2, false);
      p.lineTo(cx - w / 2 + r, cy0 + r);
      p.absarc(cx - w / 2 + r, cy0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
      return p;
    }
    function canvas(w, h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }
    function tex(c, srgb = true) {
      const t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    }
    function textPlane(lines, w, h, opts = {}) {
      const px = opts.px || 48, c = canvas(Math.round(w * px), Math.round(h * px)), g = c.getContext("2d");
      g.fillStyle = opts.color || "#8d9296";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const lh = c.height / lines.length;
      lines.forEach((l, i) => {
        g.font = `${opts.weight || 600} ${Math.round(lh * (opts.size || 0.62))}px ui-monospace, Menlo, monospace`;
        g.fillText(l, c.width / 2, lh * (i + 0.5));
      });
      const m = new THREE.MeshStandardMaterial({ map: tex(c), transparent: true, depthWrite: false, roughness: 0.6 });
      return mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), m);
    }
    function keyed(obj, list) {
      obj.userData.keys = list.map(([d, k]) => ({
        d,
        p: V(...(k.p || [0, 0, 0])),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(...(k.r || [0, 0, 0]))),
      }));
      return obj;
    }

    // ---------- materials (cloned per part later, so each can be lit or faded on its own) ----------
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const M = {
      plastic: std({ color: 0x0b0c0c, roughness: 0.72, metalness: 0, envMapIntensity: 0.5 }),
      caseBlack: std({ color: 0x101112, roughness: 0.5, metalness: 0, envMapIntensity: 0.6 }),
      brass: std({ color: 0xd2a650, roughness: 0.3, metalness: 1 }),
      gold: std({ color: 0xdcb45c, roughness: 0.24, metalness: 1 }),
      tin: std({ color: 0xcfd2d6, roughness: 0.28, metalness: 1 }),
      steel: std({ color: 0xb4b9be, roughness: 0.34, metalness: 1 }),
      darkSteel: std({ color: 0x55595d, roughness: 0.4, metalness: 1 }),
      epoxy: std({ color: 0x1a1b1c, roughness: 0.5, metalness: 0 }),
      fr4: std({ color: 0x8c8650, roughness: 0.62, metalness: 0 }),
      nylon: std({ color: 0xece7d8, roughness: 0.55, metalness: 0 }),
      redCeramic: std({ color: 0xbb3426, roughness: 0.45, metalness: 0 }),
      tan: std({ color: 0x9d8a6e, roughness: 0.5, metalness: 0 }),
      darkCeramic: std({ color: 0x3b342c, roughness: 0.6, metalness: 0 }),
      amber: std({ color: 0xbd7720, roughness: 0.38, metalness: 0.1 }),
      tape: std({ color: 0x0e0f10, roughness: 0.5, metalness: 0 }),
      diffuser: std({ color: 0xf2f3ee, roughness: 0.9, metalness: 0, emissive: 0xdfe6dc, emissiveIntensity: 0.18 }),
      silicon: std({ color: 0x30343b, roughness: 0.16, metalness: 0.7 }),
      panelEdge: std({ color: 0x8fa79f, roughness: 0.12, metalness: 0.2 }),
      panelTop: std({ color: 0x040505, roughness: 0.3, metalness: 0 }),
      ledBody: std({ color: 0xf4f2ea, roughness: 0.2, metalness: 0 }),
      hole: std({ color: 0x050505, roughness: 0.9 }),
      hidden: new THREE.MeshBasicMaterial({ visible: false }),
      frontGlass: new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, depthWrite: false }),
      prismGlass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transmission: 1, thickness: 20, ior: 1.52, attenuationColor: new THREE.Color(0xe6f5ec), attenuationDistance: 260, envMapIntensity: 1.35, specularIntensity: 1, side: THREE.DoubleSide, depthWrite: false }),
      coating: new THREE.MeshPhysicalMaterial({ color: 0xcdd8dc, roughness: 0.12, metalness: 0.85, transparent: true, opacity: 0.12, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false }),
      ghost: (color) => std({ color, roughness: 0.5, transparent: true, opacity: 0.42, depthWrite: false }),
    };
    const EDGE = new THREE.LineBasicMaterial({ color: 0x8f9a92, transparent: true, opacity: 0.16, depthWrite: false });
    const GLASS_EDGE = new THREE.LineBasicMaterial({ color: 0xe8f5ee, transparent: true, opacity: 0.32, depthWrite: false });
    const DASH = new THREE.LineDashedMaterial({ color: 0xa0e299, dashSize: 0.32, gapSize: 0.24, transparent: true, opacity: 0.95, depthWrite: false });
    function edges(geo, mat = EDGE, angle = 32) {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), mat);
      l.userData.isEdge = true;
      return l;
    }
    function dashed(geo) {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), DASH);
      l.computeLineDistances();
      l.userData.isEdge = true;
      return l;
    }

    function addPart(id, g, anchor) {
      g.userData.partId = id;
      parts.set(id, { id, group: g, anchor: anchor || null });
      return g;
    }

    // ---------- the Sage frame on the display, mirrored as the board draws it for the prism ----------
    const sageCanvas = canvas(240, 240);
    const sageTex = tex(sageCanvas);
    sageTex.magFilter = THREE.NearestFilter;
    const sageImg = new Image();
    const sageReady = new Promise((resolve) => {
      sageImg.onload = () => {
        const g = sageCanvas.getContext("2d");
        g.translate(0, 240);
        g.scale(1, -1);
        g.drawImage(sageImg, 0, 0);
        sageTex.needsUpdate = true;
        resolve();
      };
      sageImg.onerror = () => resolve();
    });
    sageImg.src = NS.sageFrame;

    // ---------- the PCB's two faces, drawn as textures: black mask, gold pads, white silkscreen ----------
    const S = 1024 / PCB.w; // px per mm
    const TW = 1024, TH = Math.round(PCB.h * S);
    const pads = { comp: [], disp: [] }; // [u, v, w, h, round] in each face's drawing frame
    function padRect(face, u, v, w, h, round) {
      pads[face].push([u, v, w, h, !!round]);
    }

    // ---------- the board's node: everything on it moves with it ----------
    const pcbNode = new THREE.Group();
    const compSide = new THREE.Group(); // photo frame: x = u, z = v, y away from the board
    compSide.position.y = -PCB.t / 2;
    compSide.rotation.z = Math.PI;
    const dispSide = new THREE.Group(); // board frame, y away from the board
    dispSide.position.y = PCB.t / 2;
    pcbNode.add(compSide, dispSide);

    // PCB body: the outline with its holes, the sides in FR4, the faces textured
    const outline = new THREE.Shape();
    outline.moveTo(-PCB.w / 2, -PCB.h / 2);
    outline.lineTo(PCB.w / 2, -PCB.h / 2);
    outline.lineTo(PCB.w / 2, PCB.h / 2);
    outline.lineTo(-PCB.w / 2, PCB.h / 2);
    outline.lineTo(-PCB.w / 2, -PCB.h / 2);
    const holeList = [];
    for (const sx of [-1, 1]) for (const z of [M2.zTop, M2.zBot]) holeList.push([sx * M2.dx, z, M2.drill]);
    for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) holeList.push([sx * HDR.dx, HDR.z0 + i * HDR.pitch, HDR.drill]);
    holeList.forEach(([x, z, r]) => outline.holes.push(circlePath(x, -z, r)));
    const pcbSides = new THREE.ExtrudeGeometry(outline, { depth: PCB.t, bevelEnabled: false, curveSegments: 16 })
      .rotateX(-Math.PI / 2)
      .translate(0, -PCB.t / 2, 0);
    function capGeo(top) {
      const g = new THREE.ShapeGeometry(outline, 16).rotateX(-Math.PI / 2);
      if (!top) g.rotateZ(Math.PI);
      g.translate(0, (top ? 1 : -1) * (PCB.t / 2 + 0.002), 0);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const u = top ? x : -x; // the component side is drawn in the photo's frame
        uv.setXY(i, (u + PCB.w / 2) / PCB.w, 1 - (z + PCB.h / 2) / PCB.h);
      }
      return g;
    }
    const compCanvas = canvas(TW, TH), compRM = canvas(TW, TH);
    const dispCanvas = canvas(TW, TH), dispRM = canvas(TW, TH);
    const compMat = std({ map: tex(compCanvas), metalnessMap: tex(compRM, false), roughnessMap: tex(compRM, false), roughness: 1, metalness: 1 });
    const dispMat = std({ map: tex(dispCanvas), metalnessMap: tex(dispRM, false), roughnessMap: tex(dispRM, false), roughness: 1, metalness: 1 });
    const pcbGroup = group(
      mesh(pcbSides, [M.hidden, M.fr4]),
      mesh(capGeo(true), dispMat),
      mesh(capGeo(false), compMat),
    );
    pcbNode.add(addPart("pcb", pcbGroup, V(-PCB.w / 2, 0, 9)));

    // plated holes: walls and rings (the rings are on the textures)
    const holeWalls = [];
    holeList.forEach(([x, z, r]) => holeWalls.push(new THREE.CylinderGeometry(r, r, PCB.t, 16, 1, true).translate(x, 0, z)));
    const plating = M.gold.clone();
    plating.side = THREE.DoubleSide;
    const hdrRings = [];
    for (const sx of [-1, 1])
      for (let i = 0; i < 8; i++)
        for (const sy of [-1, 1])
          hdrRings.push(new THREE.RingGeometry(HDR.drill, HDR.pad, 20).rotateX(sy > 0 ? -Math.PI / 2 : Math.PI / 2).translate(sx * HDR.dx, sy * (PCB.t / 2 + 0.004), HDR.z0 + i * HDR.pitch));
    const headerHoles = group(mesh(merge(holeWalls), plating), mesh(merge(hdrRings), M.gold));
    pcbNode.add(addPart("headerholes", headerHoles, V(HDR.dx, PCB.t / 2, HDR.z0 + 2 * HDR.pitch)));
    for (const sx of [-1, 1]) for (const z of [M2.zTop, M2.zBot]) for (const face of ["comp", "disp"]) padRect(face, sx * M2.dx, z, M2.pad * 2, M2.pad * 2, true);

    // ---------- component builders (photo frame, y up from the board) ----------
    function gull(list, x, z, dirx, dirz, w, h) {
      // a gull-wing lead leaving the body at (x, z) towards (dirx, dirz)
      const len = 0.62, sh = Math.min(0.55, h * 0.5);
      const ax = dirx !== 0, lw = 0.42 * (w || 1);
      list.push(bx(ax ? len : lw, 0.13, ax ? lw : len, x + dirx * len * 0.5, sh, z + dirz * len * 0.5));
      list.push(bx(ax ? 0.13 : lw, sh, ax ? lw : 0.13, x + dirx * len, sh / 2, z + dirz * len));
      list.push(bx(ax ? 0.5 : lw, 0.13, ax ? lw : 0.5, x + dirx * (len + 0.2), 0.065, z + dirz * (len + 0.2)));
    }
    function marking(lines, w, h, y, opts) {
      const t = textPlane(lines, w, h, opts);
      t.position.y = y + 0.006;
      return t;
    }
    function qfn(size, h, n, pitch, markingLines) {
      const leads = [];
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * pitch;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = dx ? (dx * size) / 2 : o, z = dz ? (dz * size) / 2 : o;
          leads.push(bx(dx ? 0.06 : 0.22, 0.2, dz ? 0.06 : 0.22, x, 0.1, z));
        }
      }
      const g = group(mesh(bx(size, h, size, 0, h / 2, 0), M.epoxy), mesh(merge(leads), M.tin));
      if (markingLines) g.add(marking(markingLines, size * 0.8, size * 0.42, h, { color: "#7f858a" }));
      g.add(mesh(cy(size * 0.035, 0.02, -size * 0.36, h + 0.01, -size * 0.36, 12), M.tin));
      return g;
    }
    function soic(bodyU, bodyV, h, n, pitch, leadsAlong, markingLines) {
      // leads leave the two long sides; leadsAlong 'v' means they point along v
      const leads = [];
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * pitch;
        if (leadsAlong === "v") {
          gull(leads, o, -bodyV / 2, 0, -1, 1, h);
          gull(leads, o, bodyV / 2, 0, 1, 1, h);
        } else {
          gull(leads, -bodyU / 2, o, -1, 0, 1, h);
          gull(leads, bodyU / 2, o, 1, 0, 1, h);
        }
      }
      const g = group(mesh(bx(bodyU, h - 0.1, bodyV, 0, (h - 0.1) / 2 + 0.1, 0), M.epoxy), mesh(merge(leads), M.tin));
      if (markingLines) g.add(marking(markingLines, bodyU * 0.84, bodyV * 0.5, h, { color: "#7d8287" }));
      return g;
    }
    function sot(bodyU, bodyV, h, pinsA, pinsB, along, pitch) {
      // pinsA on the negative side, pinsB on the positive; along: the axis the leads point along
      const leads = [];
      const place = (count, side) => {
        for (let i = 0; i < count; i++) {
          const o = count === 1 ? 0 : (i - (count - 1) / 2) * (count === 2 ? pitch * 2 : pitch);
          if (along === "v") gull(leads, o, (side * bodyV) / 2, 0, side, 0.95, h);
          else gull(leads, (side * bodyU) / 2, o, side, 0, 0.95, h);
        }
      };
      place(pinsA, -1);
      place(pinsB, 1);
      return group(mesh(bx(bodyU, h - 0.1, bodyV, 0, (h - 0.1) / 2 + 0.1, 0), M.epoxy), mesh(merge(leads), M.tin));
    }
    function chip(len, wid, h, bodyMat, endMat = M.tin) {
      const cap = 0.3;
      return group(
        mesh(bx(len - 2 * cap, h, wid, 0, h / 2, 0), bodyMat),
        mesh(merge([bx(cap, h, wid, -(len - cap) / 2, h / 2, 0), bx(cap, h, wid, (len - cap) / 2, h / 2, 0)]), endMat),
      );
    }
    function place(g, u, v, rotY = 0) {
      g.position.set(u, 0, v);
      g.rotation.y = rotY;
      return g;
    }

    // ---------- the component side, where Waveshare's numbered photo puts each part ----------
    const comp = [];
    function compPart(id, g, u, v, h, footprint, lift, anchor) {
      place(g, u, v);
      addPart(id, g, anchor || V(0, h, 0));
      compSide.add(g);
      footprint();
      comp.push({ g, lift });
      return g;
    }
    function qfnPads(u, v, size, n, pitch, ep) {
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * pitch;
        padRect("comp", u + o, v - size / 2 + 0.2, 0.22, 0.7);
        padRect("comp", u + o, v + size / 2 - 0.2, 0.22, 0.7);
        padRect("comp", u - size / 2 + 0.2, v + o, 0.7, 0.22);
        padRect("comp", u + size / 2 - 0.2, v + o, 0.7, 0.22);
      }
      if (ep) padRect("comp", u, v, ep, ep);
    }
    function rowPads(u, v, n, pitch, along, off, w, h) {
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * pitch;
        if (along === "v") {
          padRect("comp", u + o, v - off, w, h);
          padRect("comp", u + o, v + off, w, h);
        } else {
          padRect("comp", u - off, v + o, h, w);
          padRect("comp", u + off, v + o, h, w);
        }
      }
    }
    function sotPads(u, v, a, b, along, pitch, off) {
      const put = (count, side) => {
        for (let i = 0; i < count; i++) {
          const o = count === 1 ? 0 : (i - (count - 1) / 2) * (count === 2 ? pitch * 2 : pitch);
          if (along === "v") padRect("comp", u + o, v + side * off, 0.6, 1.0);
          else padRect("comp", u + side * off, v + o, 1.0, 0.6);
        }
      };
      put(a, -1);
      put(b, 1);
    }

    compPart("esp32", qfn(7, 0.9, 14, 0.4, ["ESP32-S3", "R8"]), -1.03, 4.89, 0.9, () => qfnPads(-1.03, 4.89, 7, 14, 0.4, 4.2), 11);
    compPart("flash", soic(5.23, 5.28, 1.85, 4, 1.27, "v", ["W25Q128JV"]), 6.7, 6.39, 1.85, () => rowPads(6.7, 6.39, 4, 1.27, "v", 3.55, 0.6, 1.4), 9);
    {
      const g = group(mesh(bx(11.5, 1.55, 5.9, 0, 0.775, 0), M.steel));
      const contacts = [];
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) contacts.push(bx(0.6, 0.04, 1.3, s * (1.4 + 0.3 + i * 1.07), 1.57, 0.1));
      g.add(mesh(merge(contacts), M.gold));
      g.add(mesh(bx(0.5, 0.25, 1.6, 5.85, 0.9, 0.2), M.steel));
      compPart("tf", g, 0.26, -2.59, 1.55, () => {
        for (let i = 0; i < 8; i++) padRect("comp", 0.26 - 3.9 + i * 1.1, -2.59 + 3.25, 0.6, 0.9);
        for (const s of [-1, 1]) padRect("comp", 0.26 + s * 6.0, -2.59 - 1.8, 1.2, 1.6);
      }, 7);
    }
    {
      const g = group(mesh(bx(4.2, 1.0, 2.0, 0, 0.5, 0), M.redCeramic), mesh(merge([bx(0.45, 1.0, 2.0, -2.32, 0.5, 0), bx(0.45, 1.0, 2.0, 2.32, 0.5, 0)]), M.tin));
      g.add(marking(["C3"], 1.6, 1.0, 1.0, { color: "#f4f2ee", weight: 700 }));
      compPart("antenna", g, -0.32, 13.33, 1.0, () => {
        padRect("comp", -0.32 - 2.9, 13.33, 1.2, 2.1);
        padRect("comp", -0.32 + 2.9, 13.33, 1.2, 2.1);
      }, 8, V(0, 1.0, 0));
    }
    compPart("crystal", group(mesh(bx(2.5, 0.35, 2.0, 0, 0.175, 0), M.darkCeramic), mesh(bx(2.1, 0.25, 1.6, 0, 0.47, 0), M.tin)), -8.22, 9.83, 0.6, () => {
      for (const su of [-1, 1]) for (const sv of [-1, 1]) padRect("comp", -8.22 + su * 0.85, 9.83 + sv * 0.65, 0.8, 0.7);
    }, 9);
    compPart("regulator", sot(2.9, 1.6, 1.15, 3, 2, "v", 0.95), -8.05, -0.05, 1.15, () => sotPads(-8.05, -0.05, 3, 2, "v", 0.95, 1.25), 10);
    compPart("charger", sot(2.9, 1.6, 1.15, 2, 3, "v", 0.95), 7.84, -2.63, 1.15, () => sotPads(7.84, -2.63, 2, 3, "v", 0.95, 1.25), 10);
    {
      const g = group(
        mesh(bx(5.8, 3.4, 3.8, 0, 1.7, 0), M.nylon),
        mesh(bx(4.2, 2.2, 0.9, 0, 1.6, -1.5), M.epoxy),
        mesh(merge([bx(0.6, 0.15, 2.0, -3.15, 0.08, -0.6), bx(0.6, 0.15, 2.0, 3.15, 0.08, -0.6), bx(0.15, 1.4, 1.6, -2.97, 0.7, -0.6), bx(0.15, 1.4, 1.6, 2.97, 0.7, -0.6)]), M.tin),
        mesh(merge([bx(0.3, 0.2, 1.1, -0.625, 0.1, 2.35), bx(0.3, 0.2, 1.1, 0.625, 0.1, 2.35)]), M.tin),
      );
      compPart("battery", g, 0.15, -12.85, 3.4, () => {
        padRect("comp", 0.15 - 0.625, -12.85 + 2.6, 0.6, 1.3);
        padRect("comp", 0.15 + 0.625, -12.85 + 2.6, 0.6, 1.3);
        padRect("comp", 0.15 - 3.2, -12.85 - 0.6, 1.0, 2.2);
        padRect("comp", 0.15 + 3.2, -12.85 - 0.6, 1.0, 2.2);
      }, 6);
    }
    {
      const g = chip(1.6, 0.8, 0.55, M.ledBody);
      g.add(mesh(bx(0.3, 0.02, 0.3, 0, 0.56, 0), M.gold));
      compPart("led", g, 7.2, -13.48, 0.55, () => {
        padRect("comp", 7.2 - 0.75, -13.48, 0.7, 0.9);
        padRect("comp", 7.2 + 0.75, -13.48, 0.7, 0.9);
      }, 12);
    }
    compPart("sot363", sot(1.25, 2.0, 0.95, 3, 3, "u", 0.65), -7.46, -12.57, 0.95, () => sotPads(-7.46, -12.57, 3, 3, "u", 0.65, 0.95), 13);
    compPart("sot23", sot(1.3, 2.9, 1.05, 2, 1, "u", 0.95), -7.3, -9.93, 1.05, () => sotPads(-7.3, -9.93, 2, 1, "u", 0.95, 1.05), 12);
    compPart("unknown8", soic(3.0, 3.0, 0.95, 4, 0.65, "v", ["21357"]), -7.84, -5.9, 0.95, () => rowPads(-7.84, -5.9, 4, 0.65, "v", 2.1, 0.4, 1.0), 12);
    {
      const where = [[-7.69, -2.69], [-9.08, 2.37], [-6.72, 2.37], [8.44, -5.21], [8.38, 0.27]];
      const g = new THREE.Group();
      where.forEach(([u, v], i) => {
        const c = chip(1.6, 0.8, 0.8, i % 2 ? M.tan : M.darkCeramic);
        c.position.set(u, 0, v);
        g.add(c);
        padRect("comp", u - 0.75, v, 0.7, 0.9);
        padRect("comp", u + 0.75, v, 0.7, 0.9);
      });
      addPart("passives", g, V(where[3][0], 0.8, where[3][1]));
      compSide.add(g);
      comp.push({ g, lift: 7 });
    }
    // standoffs: brass, threaded at the free end, a short stud into the board
    {
      const g = new THREE.Group();
      for (const su of [-1, 1])
        for (const v of [M2.zTop, M2.zBot]) {
          const s = group(
            mesh(cy(1.75, 5, 0, 2.5, 0, 28), M.brass),
            mesh(cy(0.95, 1.2, 0, -0.6, 0, 16), M.brass),
            mesh(cy(0.82, 0.05, 0, 5.01, 0, 18), M.hole),
          );
          s.position.set(su * M2.dx, 0, v);
          g.add(s);
        }
      addPart("standoffs", g, V(M2.dx, 5, M2.zBot));
      compSide.add(g);
    }

    // silkscreen and pads of the component side
    function drawFace(face, cnv, rm) {
      const g = cnv.getContext("2d"), r = rm.getContext("2d");
      g.fillStyle = "#0d0f0e";
      g.fillRect(0, 0, TW, TH);
      // a little life in the mask
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${0.025 + Math.random() * 0.03})`;
        g.fillRect(Math.random() * TW, Math.random() * TH, 2 + Math.random() * 3, 2 + Math.random() * 3);
      }
      r.fillStyle = "rgb(0,135,0)";
      r.fillRect(0, 0, TW, TH);
      const P = (u, v) => [(u + PCB.w / 2) * S, (v + PCB.h / 2) * S];
      const goldFill = (draw) => {
        g.fillStyle = "#d8b25e";
        r.fillStyle = "rgb(0,60,255)";
        draw(g);
        draw(r);
      };
      pads[face].forEach(([u, v, w, h, round]) => {
        const [x, y] = P(u, v);
        goldFill((c) => {
          c.beginPath();
          if (round) c.arc(x, y, (w / 2) * S, 0, Math.PI * 2);
          else c.rect(x - (w / 2) * S, y - (h / 2) * S, w * S, h * S);
          c.fill();
        });
      });
      // the M2 holes' and the headers' rings show on both faces, in each face's frame
      const flip = face === "disp" ? -1 : 1;
      for (const sx of [-1, 1])
        for (let i = 0; i < 8; i++) {
          const [x, y] = P(sx * HDR.dx, HDR.z0 + i * HDR.pitch);
          goldFill((c) => {
            c.beginPath();
            c.arc(x, y, HDR.pad * S, 0, Math.PI * 2);
            c.fill();
          });
        }
      // the USB-C's shell, through the board in four plated slots
      for (const s of [-1, 1])
        for (const v of USB_SLOTS.v) {
          const [x, y] = P(flip * (USB_SLOTS.u + s * USB_SLOTS.du), v);
          goldFill((c) => {
            c.beginPath();
            c.ellipse(x, y, 0.62 * S, 1.05 * S, 0, 0, Math.PI * 2);
            c.fill();
          });
          g.fillStyle = "#050505";
          g.beginPath();
          g.ellipse(x, y, 0.32 * S, 0.72 * S, 0, 0, Math.PI * 2);
          g.fill();
        }
      g.fillStyle = "#050505";
      for (const sx of [-1, 1]) {
        for (const z of [M2.zTop, M2.zBot]) {
          const [x, y] = P(sx * M2.dx, z);
          g.beginPath();
          g.arc(x, y, M2.drill * S, 0, Math.PI * 2);
          g.fill();
        }
        for (let i = 0; i < 8; i++) {
          const [x, y] = P(sx * HDR.dx, HDR.z0 + i * HDR.pitch);
          g.beginPath();
          g.arc(x, y, HDR.drill * S, 0, Math.PI * 2);
          g.fill();
        }
      }
      // silkscreen
      g.strokeStyle = g.fillStyle = "#e6e9e3";
      r.fillStyle = r.strokeStyle = "rgb(0,210,0)";
      const silk = (fn) => {
        fn(g);
        fn(r);
      };
      if (face === "comp") {
        silk((c) => {
          c.lineWidth = 0.13 * S;
          for (const s of [-1, 1]) {
            const [x0, y0] = P(s * HDR.dx - 1.25, HDR.z0 - 1.5);
            const [x1, y1] = P(s * HDR.dx + 1.25, HDR.z0 + 7 * HDR.pitch + 1.5);
            c.strokeRect(x0, y0, x1 - x0, y1 - y0);
          }
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.font = `700 ${0.78 * S}px Arial, Helvetica, sans-serif`;
          const label = (t, u, v) => {
            const [x, y] = P(u, v);
            c.save();
            c.translate(x, y);
            c.rotate(Math.PI / 2);
            c.fillText(t, 0, 0);
            c.restore();
          };
          LEFT_PINS.forEach((t, i) => label(t, -HDR.dx + 1.75, HDR.z0 + i * HDR.pitch));
          RIGHT_PINS.forEach((t, i) => label(t, HDR.dx - 1.75, HDR.z0 + i * HDR.pitch));
          c.font = `700 ${0.72 * S}px Arial, Helvetica, sans-serif`;
          let [x, y] = P(7.2, -12.2);
          c.fillText("Charge", x, y);
          c.font = `700 ${1.1 * S}px Arial, Helvetica, sans-serif`;
          [x, y] = P(-1.9, -9.55);
          c.fillText("-", x, y);
          [x, y] = P(2.3, -9.55);
          c.fillText("+", x, y);
          c.font = `700 ${0.86 * S}px Arial, Helvetica, sans-serif`;
          [x, y] = P(0.3, -6.7);
          c.fillText("ESP32-S3-LCD-1.3", x, y);
        });
      }
    }

    // ---------- the display side: the USB-C, and the parts whose places are not published ----------
    const disp = [];
    {
      // a standard receptacle, its mouth at the board's top edge; place inferred from its shell's slots
      const ring = new THREE.Shape();
      const w = 8.94, h = 3.26, r = h / 2;
      ring.moveTo(-w / 2 + r, -r);
      ring.lineTo(w / 2 - r, -r);
      ring.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ring.lineTo(-w / 2 + r, r);
      ring.absarc(-w / 2 + r, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
      ring.holes.push(stadiumPath(0, 0, 8.34, 2.56));
      const shell = new THREE.ExtrudeGeometry(ring, { depth: 7.35, bevelEnabled: false, curveSegments: 14 });
      const g = group(
        mesh(shell, M.steel),
        mesh(bx(8.3, 2.5, 0.2, 0, 0, 6.2), M.darkSteel),
        mesh(bx(6.6, 0.7, 4.6, 0, 0, 3.8), M.epoxy),
        mesh(merge([...Array(12)].map((_, i) => bx(0.25, 0.72, 3.4, -2.75 + i * 0.5, 0, 3.0))), M.gold),
        mesh(merge([[-1, 2.98], [1, 2.98], [-1, 6.95], [1, 6.95]].map(([s, z]) => bx(0.5, 1.4, 1.2, s * 4.35, -2.0, z))), M.steel),
      );
      g.children.forEach((c) => c.position.set(0, h / 2, -14.9));
      addPart("usbc", g, V(4.47, h, -12.5));
      dispSide.add(g);
      disp.push({ g, keys: [[4.5, {}], [5, { p: [0, 3, -14] }]] });
    }
    {
      const zone = new THREE.Group();
      const ghostPart = (id, g, x, z, h) => {
        g.position.set(x, 0, z);
        addPart(id, g, V(0, h, 0));
        zone.add(g);
      };
      const ch = M.ghost(0x2b2d30), imu = M.ghost(0x2b2d30), led = M.ghost(0xf1efe6);
      const chGeo = bx(3, 0.75, 3, 0, 0.375, 0), imuGeo = bx(2.5, 0.86, 3.0, 0, 0.43, 0), ledGeo = bx(5, 1.6, 5, 0, 0.8, 0);
      ghostPart("ch343", group(mesh(chGeo, ch), dashed(chGeo)), -6.2, 2.4, 0.75);
      ghostPart("imu", group(mesh(imuGeo, imu), dashed(imuGeo)), -1.6, 2.4, 0.86);
      const ledG = group(mesh(ledGeo, led), dashed(ledGeo), mesh(cy(1.6, 0.02, 0, 1.61, 0, 24), M.ghost(0xfff7d6)));
      ghostPart("rgb", ledG, 4.6, 2.5, 1.6);
      const rect = new THREE.BufferGeometry().setFromPoints([V(-9.6, 0.02, -1.1), V(8.6, 0.02, -1.1), V(8.6, 0.02, 7.3), V(-9.6, 0.02, 7.3), V(-9.6, 0.02, -1.1)]);
      const outlineLine = new THREE.Line(rect, DASH);
      outlineLine.computeLineDistances();
      outlineLine.userData.isEdge = true;
      zone.add(outlineLine);
      const label = textPlane(["POSITIONS NOT PUBLISHED"], 12, 0.9, { color: "#a0e299", px: 80, size: 0.7 });
      label.position.set(-0.5, 0.03, 6.3);
      zone.add(label);
      dispSide.add(zone);
      disp.push({ g: zone, keys: [[4.5, {}], [5, { p: [0, 11, 19] }]] });
    }

    drawFace("comp", compCanvas, compRM);
    drawFace("disp", dispCanvas, dispRM);

    // lifts: each part off its pads in turn, the side facing up once the board is turned over
    // one lift for all, so they float in the photo's layout and no part lands over another on screen
    comp.forEach(({ g }, i) => {
      const t0 = 4.45 + (i / comp.length) * 0.3;
      keyed(g, [[t0, {}], [t0 + 0.25, { p: [0, 7, 0] }]]);
      nodes.push(g);
    });
    {
      const st = parts.get("standoffs").group;
      keyed(st, [[3.45, {}], [4, { p: [0, 11, 0] }]]);
      nodes.push(st);
    }
    disp.forEach(({ g, keys }) => {
      keyed(g, keys);
      nodes.push(g);
    });

    // ---------- the display: layers from the board up (the node's origin is the board's top face) ----------
    const displayNode = new THREE.Group();
    const layers = [];
    function layer(id, g, explode, anchor) {
      addPart(id, g, anchor);
      displayNode.add(g);
      layers.push({ g, explode });
      return g;
    }
    {
      // metal back: an open frame, notched at the back for the USB-C
      const zb = -14.1, zf = 11.3, w = 21.8, t = 0.3, cz = (zb + zf) / 2, len = zf - zb;
      const pieces = [
        bx(w, t, len, 0, GAP - t / 2, cz),
        bx(t, GAP - t, len, -w / 2 + t / 2, (GAP - t) / 2, cz),
        bx(t, GAP - t, len, w / 2 - t / 2, (GAP - t) / 2, cz),
        bx(w - 2 * t, GAP - t, t, 0, (GAP - t) / 2, zf - t / 2),
        bx((w - 9.8) / 2 - t, GAP - t, t, -(9.8 / 2 + ((w - 9.8) / 2 - t) / 2), (GAP - t) / 2, zb + t / 2),
        bx((w - 9.8) / 2 - t, GAP - t, t, 9.8 / 2 + ((w - 9.8) / 2 - t) / 2, (GAP - t) / 2, zb + t / 2),
      ];
      const geo = merge(pieces);
      layer("display-back", group(mesh(geo, M.steel)), [0, 0, 0], V(w / 2, GAP * 0.6, -10));
    }
    {
      const geo = bx(DISP.w, 0.5, DISP.zFront - DISP.zBack, 0, GAP + 0.25, DISP_CZ);
      const mats = [M.steel, M.steel, M.diffuser, M.steel, M.steel, M.steel];
      layer("display-backlight", group(mesh(geo, mats)), [0, 8, 0], V(-DISP.w / 2, GAP + 0.5, DISP.zFront - 2));
    }
    let imagePlane;
    {
      const zb = DISP.zBack, zf = 11.8, y0 = GAP + 0.5, t = 0.35;
      const g = group(mesh(bx(DISP.w, t, zf - zb, 0, y0 + t / 2, (zb + zf) / 2), [M.panelEdge, M.panelEdge, M.panelTop, M.panelEdge, M.panelEdge, M.panelEdge]));
      imagePlane = mesh(new THREE.PlaneGeometry(DISP.active, DISP.active).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sageTex, toneMapped: false }));
      imagePlane.position.set(0, y0 + t + 0.004, DISP_CZ);
      imagePlane.userData.noFade = false;
      g.add(imagePlane);
      layer("display-panel", g, [0, 16, 0], V(-DISP.w / 2, y0 + t, DISP.zFront - 1));
    }
    {
      const g = group(mesh(bx(15, 0.25, 0.8, 0, GAP + 0.85 + 0.125, 10.4), M.silicon));
      layer("display-driver", g, [0, 20, 0], V(7.5, GAP + 1.1, 10.4));
    }
    {
      const y0 = GAP + 0.85, t = 0.6, d = DISP.zFront - DISP.zBack;
      const g = group(mesh(bx(DISP.w, t, d, 0, y0 + t / 2, DISP_CZ), M.frontGlass));
      const b = 0.42, yb = y0 + t + 0.003;
      g.add(mesh(merge([
        bx(DISP.w, 0.004, b, 0, yb, DISP.zBack + b / 2),
        bx(DISP.w, 0.004, b, 0, yb, DISP.zFront - b / 2),
        bx(b, 0.004, d - 2 * b, -DISP.w / 2 + b / 2, yb, DISP_CZ),
        bx(b, 0.004, d - 2 * b, DISP.w / 2 - b / 2, yb, DISP_CZ),
      ]), M.tape));
      g.children[0].renderOrder = 4;
      layer("display-glass", g, [0, 24, 0], V(-DISP.w / 2, y0 + t, DISP.zBack + 1));
    }
    {
      const top = GAP + 1.45, zf = 14.52;
      const g = group(mesh(merge([bx(DISP.w, 0.13, zf - DISP.zFront, 0, top + 0.065, (zf + DISP.zFront) / 2), bx(DISP.w, top + 0.13, 0.14, 0, (top + 0.13) / 2, zf + 0.07)]), M.tape));
      layer("display-tape", g, [0, 30, 1.5], V(DISP.w / 2, top + 0.13, 11));
    }
    {
      // the flex's side profile: off the panel's ledge, round the front edge, onto the board
      const pts = [];
      const yTop = GAP + 0.85 + 0.06, r = yTop / 2, cz0 = 11.8;
      pts.push([10.9, yTop]);
      for (let i = 0; i <= 18; i++) {
        const a = Math.PI / 2 - (i / 18) * Math.PI;
        pts.push([cz0 + Math.cos(a) * r, r + Math.sin(a) * r]);
      }
      pts.push([11.5, 0]);
      const th = 0.12, outer = [], inner = [];
      for (let i = 0; i < pts.length; i++) {
        const [z, y] = pts[i];
        const [za, ya] = pts[Math.max(0, i - 1)], [zb, yb] = pts[Math.min(pts.length - 1, i + 1)];
        let nz = -(yb - ya), ny = zb - za;
        const l = Math.hypot(nz, ny) || 1;
        nz /= l;
        ny /= l;
        outer.push([z + (nz * th) / 2, y + (ny * th) / 2]);
        inner.push([z - (nz * th) / 2, y - (ny * th) / 2]);
      }
      const prof = outer.concat(inner.reverse());
      const geo = slabZY(prof, 12).translate(-6, 0.06, 0);
      layer("display-flex", group(mesh(geo, M.amber)), [0, -2, 9], V(-6, yTop * 0.5, 13.9));
    }
    layers.forEach(({ g, explode }) => {
      keyed(g, [[0, {}], [1, { p: explode }]]);
      splitNodes.display.push(g);
    });

    // ---------- the prism: two right-angle prisms, the diagonal from the bottom back edge to the top front ----------
    const prismNode = new THREE.Group();
    let lowerHalf;
    {
      const { x: hx, y: hy, z: hz } = PRISM;
      const lowerGeo = slabZY([[-hz, -hy], [hz, -hy], [hz, hy]], 2 * hx).translate(-hx, 0, 0);
      const upperGeo = slabZY([[-hz, -hy], [hz, hy], [-hz, hy]], 2 * hx).translate(-hx, 0, 0);
      const diag = Math.hypot(2 * hz, 2 * hy);
      const coat = mesh(new THREE.PlaneGeometry(2 * hx, diag), M.coating);
      coat.rotation.x = Math.atan2(hz, hy);
      const lo = group(mesh(lowerGeo, M.prismGlass), edges(lowerGeo, GLASS_EDGE, 20), coat);
      const up = group(mesh(upperGeo, M.prismGlass), edges(upperGeo, GLASS_EDGE, 20));
      lo.children[0].renderOrder = up.children[0].renderOrder = 10;
      coat.renderOrder = 11;
      addPart("prism-lower", lo, V(hx, -hy, hz));
      addPart("prism-upper", up, V(-hx, hy, -hz));
      prismNode.add(lo, up);
      keyed(lo, [[0, {}], [1, { p: [0, -3.2, 3.2] }]]);
      keyed(up, [[0, {}], [1, { p: [0, 3.2, -3.2] }]]);
      splitNodes.prism.push(lo, up);
      lowerHalf = lo;
    }

    // ---------- the -B case: a box, the board in it, slotted for the USB-C ----------
    const caseNode = new THREE.Group();
    {
      const { w, d, h, floor, side, end } = CASE;
      const iw = w - 2 * side, wallH = h - floor;
      const usbY = floor + 5 + PCB.t + 3.26 / 2 - floor; // the USB-C's middle, from the wall's foot
      const back = wall([[-iw / 2, 0], [iw / 2, 0], [iw / 2, wallH], [-iw / 2, wallH]], [stadiumPath(0, usbY, 10, 4.3)], end);
      back.rotateY(Math.PI).translate(0, floor, -d / 2);
      const geo = merge([
        bx(w, floor, d, 0, floor / 2, 0),
        bx(side, wallH, d, -w / 2 + side / 2, floor + wallH / 2, 0),
        bx(side, wallH, d, w / 2 - side / 2, floor + wallH / 2, 0),
        bx(iw, wallH, end, 0, floor + wallH / 2, d / 2 - end / 2),
        back,
        bx(0.6, 0.45, d, -w / 2 + 0.3, h + 0.225, 0),
        bx(0.6, 0.45, d, w / 2 - 0.3, h + 0.225, 0),
      ].map((g) => (g.index ? g.toNonIndexed() : g)));
      const g = group(mesh(geo, M.caseBlack), edges(geo));
      addPart("case", g, V(w / 2 - 0.3, h + 0.45, -6));
      caseNode.add(g);
    }

    // ---------- the -C stand: sloping sides, open at the back for the cable, the case set in its top ----------
    const standNode = new THREE.Group();
    {
      const { w, d, h, deck, wall: tw } = STAND;
      const zf0 = d / 2, zb0 = -d / 2, zfTop = 20.775, zbTop = -15.175;
      const fz = (y) => zf0 + ((zfTop - zf0) * y) / h; // front face at height y
      const bz = (y) => zb0 + ((zbTop - zb0) * y) / h;
      const inner = w / 2 - tw;
      const sides = [-1, 1].map((s) => slabZY([[zb0, 0], [zf0, 0], [zfTop, h], [zbTop, h]], tw).translate(s > 0 ? inner : -w / 2, 0, 0));
      const alpha = Math.atan((zf0 - zfTop) / h), beta = Math.atan((zbTop - zb0) / h);
      const fl = deck / Math.cos(alpha);
      const front = wall([[-inner, 0], [-11, 0], [-11, 5.03], [11, 5.03], [11, 0], [inner, 0], [inner, fl], [-inner, fl]], null, 2.0);
      front.rotateX(-alpha).translate(0, 0, zf0);
      const y0 = 21.6, bl0 = y0 / Math.cos(beta), bl1 = deck / Math.cos(beta);
      const usbY = 22.85 + CASE.floor + 5 + PCB.t + 1.63;
      const backW = wall([[-inner, bl0], [inner, bl0], [inner, bl1], [-inner, bl1]], [stadiumPath(0, usbY / Math.cos(beta), 12, 6)], 2.0);
      backW.rotateY(Math.PI).rotateX(beta).translate(0, 0, zb0);
      const floorZ0 = bz(y0) + 2.1, floorZ1 = fz(y0) - 2.05;
      const shelf = bx(2 * inner, 1.25, floorZ1 - floorZ0, 0, y0 + 0.625, (floorZ0 + floorZ1) / 2);
      const geo = merge([...sides, front, backW, shelf].map((g) => (g.index ? g.toNonIndexed() : g)));
      const g = group(mesh(geo, M.plastic), edges(geo));
      addPart("stand", g, V(w / 2, h * 0.45, 10));
      standNode.add(g);
    }

    // ---------- the loose pin headers ----------
    const headerNodes = [];
    {
      const pins = [];
      for (let i = 0; i < 8; i++) pins.push(bx(0.64, 11.0, 0.64, (i - 3.5) * 2.54, 1.25 + 3.1 - 5.5, 0));
      const plast = [];
      for (let i = 0; i < 8; i++) plast.push(bx(2.4, 2.5, 2.5, (i - 3.5) * 2.54, 0, 0));
      const pg = merge(pins), bg = merge(plast);
      const hg = new THREE.Group();
      for (let k = 0; k < 2; k++) {
        const one = group(mesh(bg, M.epoxy), mesh(pg, M.gold));
        hg.add(one);
        headerNodes.push(one);
      }
      addPart("headers", hg, null);
      parts.get("headers").anchorObj = headerNodes[0];
      parts.get("headers").anchor = V(-8.9, 1.25, 0);
    }

    // ---------- where each node is at each level ----------
    const board0 = [0, 22.85 + CASE.floor + 5 + PCB.t / 2, -DISP_CZ]; // the cube centred over the picture
    const up = (p, dy, dx = 0, dz = 0) => [p[0] + dx, p[1] + dy, p[2] + dz];
    const deckY = 22.85;
    keyed(standNode, [[0, {}], [3.5, {}], [4, { p: [64, 0, -45] }]]);
    keyed(caseNode, [[0, { p: [0, deckY, board0[2]] }], [1.05, { p: [0, deckY, board0[2]] }], [2, { p: [0, deckY + 18, board0[2]] }], [3.5, { p: [0, deckY + 18, board0[2]] }], [4, { p: [64, 44, -45] }]]);
    keyed(pcbNode, [
      [0, { p: board0 }],
      [1.05, { p: board0 }],
      [2, { p: up(board0, 18) }],
      [3, { p: up(board0, 34) }],
      [3.45, { p: up(board0, 34) }],
      [4, { p: [0, 40, 0] }],
      [4.15, { p: [0, 40, 0] }],
      [4.6, { p: [0, 40, 0], r: [0, 0, Math.PI] }],
    ]);
    const disp0 = up(board0, PCB.t / 2);
    keyed(displayNode, [
      [0, { p: disp0 }],
      [1.05, { p: disp0 }],
      [2, { p: up(disp0, 18) }],
      [3, { p: up(disp0, 34) }],
      [3.45, { p: up(disp0, 48) }],
      [4, { p: [-46, 30, 0] }],
    ]);
    const prism0 = [0, disp0[1] + GAP + 1.45 + PRISM.y, 0];
    keyed(prismNode, [
      [0, { p: prism0 }],
      [1, { p: up(prism0, 22) }],
      [2, { p: up(prism0, 40) }],
      [3, { p: up(prism0, 56) }],
      [3.45, { p: up(prism0, 56) }],
      [4, { p: [-46, 30 + GAP + 1.45 + 22 + PRISM.y, DISP_CZ] }],
      [5, { p: [-46, 30 + GAP + 1.45 + 22 + PRISM.y, DISP_CZ] }],
      [6, { p: [-46, 90, DISP_CZ] }],
    ]);
    const lying = [Math.PI / 2, 0, 0], standing = [0, Math.PI / 2, 0];
    keyed(headerNodes[0], [[0, { p: [-20, 1.25, 30], r: lying }], [4.4, { p: [-20, 1.25, 30], r: lying }], [5, { p: [HDR.dx, 40 - 0.8 - 14, 0], r: standing }]]);
    keyed(headerNodes[1], [[0, { p: [-20, 1.25, 37], r: lying }], [4.45, { p: [-20, 1.25, 37], r: lying }], [5, { p: [-HDR.dx, 40 - 0.8 - 14, 0], r: standing }]]);

    root.add(standNode, caseNode, pcbNode, displayNode, prismNode, parts.get("headers").group);
    nodes.unshift(standNode, caseNode, pcbNode, displayNode, prismNode, headerNodes[0], headerNodes[1]);

    // each part its own materials; every mesh knows its part
    parts.forEach((p) => {
      p.materials = [];
      p.lines = [];
      p.group.traverse((o) => {
        o.userData.partId = p.id;
        if (o.isMesh) {
          o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            m.userData.baseOpacity = m.opacity;
            m.userData.baseTransparent = m.transparent;
            m.userData.baseDepthWrite = m.depthWrite;
            if (m.emissive) m.userData.baseEmissive = m.emissive.clone();
            if (m.emissiveIntensity !== undefined) m.userData.baseEmissiveIntensity = m.emissiveIntensity;
            p.materials.push(m);
          });
        }
        if (o.isLine) {
          o.material = o.material.clone();
          o.material.userData.baseOpacity = o.material.opacity;
          p.lines.push(o.material);
        }
      });
    });

    // ---------- the reflection: the picture's mirror image in the lower prism's diagonal ----------
    const reflMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: sageTex }, uInv: { value: new THREE.Matrix4() }, uCam: { value: V(0, 0, 0) }, uHalf: { value: V(PRISM.x, PRISM.y, PRISM.z) }, uGain: { value: REFLECT } },
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D map; uniform mat4 uInv; uniform vec3 uCam; uniform vec3 uHalf; uniform float uGain;
        varying vec2 vUv; varying vec3 vW;
        void main(){
          // seen only where the line of sight crosses the diagonal inside the cube
          vec3 c = (uInv * vec4(uCam, 1.0)).xyz, p = (uInv * vec4(vW, 1.0)).xyz;
          float fc = c.y / uHalf.y - c.z / uHalf.z, fp = p.y / uHalf.y - p.z / uHalf.z;
          if (fc * fp >= 0.0) discard;
          vec3 q = c + (fc / (fc - fp)) * (p - c);
          if (any(greaterThan(abs(q), uHalf + 0.01))) discard;
          gl_FragColor = vec4(texture2D(map, vUv).rgb * uGain, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // its local matrix is the whole transform: the root sits at the origin, and a parent's forced update
    // would overwrite a matrixWorld set by hand
    const reflection = mesh(imagePlane.geometry, reflMat);
    reflection.matrixAutoUpdate = false;
    reflection.frustumCulled = false;
    reflection.renderOrder = 12;
    root.add(reflection);
    function setReflection(k) {
      reflMat.uniforms.uGain.value = REFLECT * k;
      reflection.visible = k > 0.01;
    }
    const R = new THREE.Matrix4(), n = V(0, 0, 0), p0 = V(0, 0, 0), nm = new THREE.Matrix3();
    function updateReflection(camera) {
      lowerHalf.updateMatrixWorld(true);
      imagePlane.updateMatrixWorld(true);
      nm.getNormalMatrix(lowerHalf.matrixWorld);
      n.set(0, 1 / PRISM.y, -1 / PRISM.z).applyMatrix3(nm).normalize();
      p0.setFromMatrixPosition(lowerHalf.matrixWorld);
      const d = n.dot(p0);
      R.set(
        1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 2 * d * n.x,
        -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 2 * d * n.y,
        -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 2 * d * n.z,
        0, 0, 0, 1,
      );
      reflection.matrix.multiplyMatrices(R, imagePlane.matrixWorld);
      reflection.matrixWorld.copy(reflection.matrix);
      reflMat.uniforms.uInv.value.copy(lowerHalf.matrixWorld).invert();
      reflMat.uniforms.uCam.value.copy(camera.position);
    }
    function reflectionCentre(out) {
      return out.set(0, 0, 0).applyMatrix4(reflection.matrix);
    }

    // ---------- the levels ----------
    function poseAt(obj, d) {
      const K = obj.userData.keys;
      if (!K || !K.length) return;
      let a = K[0], b = K[0];
      if (d >= K[K.length - 1].d) a = b = K[K.length - 1];
      else if (d > K[0].d) {
        let i = 0;
        while (d > K[i + 1].d) i++;
        a = K[i];
        b = K[i + 1];
      }
      let t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
      t = t * t * (3 - 2 * t);
      obj.position.lerpVectors(a.p, b.p, t);
      obj.quaternion.slerpQuaternions(a.q, b.q, t);
    }
    // a child's keys are offsets from where it rests on its parent; {} is the rest itself
    [...nodes.filter((o) => o.parent !== root && !headerNodes.includes(o)), ...splitNodes.display, ...splitNodes.prism].forEach((o) => {
      const base = o.position.clone(), baseQ = o.quaternion.clone();
      o.userData.keys.forEach((k) => {
        k.p.add(base);
        k.q.premultiply(baseQ);
      });
    });

    function update(d, split) {
      nodes.forEach((o) => poseAt(o, d));
      const sp = Math.max(Math.min(1, Math.max(0, d - 5)), split.prism || 0);
      const sd = Math.max(Math.min(1, Math.max(0, d - 5)), split.display || 0);
      splitNodes.prism.forEach((o) => poseAt(o, sp));
      splitNodes.display.forEach((o) => poseAt(o, sd));
      // the loose headers are in the box, not the device: they come in when the board's parts come off
      const hs = Math.max(0.001, Math.min(1, (d - 4.3) / 0.25));
      headerNodes.forEach((h) => {
        h.scale.setScalar(hs);
        h.visible = d > 4.3;
      });
      root.updateMatrixWorld(true);
    }

    const tops = { stand: standNode, case: caseNode, pcb: pcbNode, display: displayNode, prism: prismNode, headers: parts.get("headers").group };
    return { root, parts, update, updateReflection, setReflection, reflectionCentre, tops, ready: sageReady, sageTex, headerNodes, imagePlane };
  };
})();
