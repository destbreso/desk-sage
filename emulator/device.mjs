// Realistic: the device in 3D (hardware/model.js, at its real size) with the board's own picture on its display.
// It never draws Sage: each frame the board pushes is copied from the page's 240 by 240 canvas onto the display,
// mirrored as the firmware draws it for the prism, and the model's diagonal reflects it the right way round.
// Loaded only when Realistic is chosen, since three.js comes from a CDN (the import map in index.html).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAP_SLOP = 6, TAP_MS = 600;           // a press that moves less and lifts sooner is a tap, not a turn
const HOME = { az: 20, el: 12, D: 140 };    // a little from the side and above: the cube, Sage whole in it, and the stand
const TARGET = new THREE.Vector3(0, 37, -1);

function loadScript(src) {                  // model.js is a classic script, so hardware/index.html also opens from a file
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error('could not load ' + src)) });
    document.head.append(s);
  });
}

export async function createDevice(host, { source, onTap, capture = false }) {
  const NS = window.DeskSageHardware;
  if (!NS || !NS.buildModel) await loadScript(new URL('../hardware/model.js', import.meta.url).href);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: capture });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  host.prepend(canvas);

  // the hardware page's light, on the emulator's background
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f12);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  const key = new THREE.DirectionalLight(0xffffff, 1.5), fill = new THREE.DirectionalLight(0xe8f0ff, 0.45), rim = new THREE.DirectionalLight(0xf2fff0, 0.9);
  key.position.set(70, 130, 90); fill.position.set(-90, 40, 50); rim.position.set(-30, 90, -130);
  scene.add(key, fill, rim);

  const model = window.DeskSageHardware.buildModel(THREE, { mergeGeometries });
  await model.ready;
  model.update(0, { prism: 0, display: 0 });             // level 0: the whole device, put together
  scene.add(model.root);

  // the desk: a faint grid fading out, and a soft shadow under the stand
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x4dd4e0) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uColor; varying vec3 vW;
      float line(float c){ float d = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - min(d, 1.0); }
      void main(){
        float minor = max(line(vW.x / 10.0), line(vW.z / 10.0)), major = max(line(vW.x / 50.0), line(vW.z / 50.0));
        float fade = 1.0 - smoothstep(50.0, 200.0, length(vW.xz));
        gl_FragColor = vec4(uColor, (minor * 0.03 + major * 0.05) * fade);
      }`,
    transparent: true, depthWrite: false,
  }));
  desk.renderOrder = -1;
  const shade = document.createElement('canvas');
  shade.width = shade.height = 128;
  const sg = shade.getContext('2d'), gr = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(52, 66).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shade), transparent: true, depthWrite: false, opacity: 0.75 }));
  shadow.position.y = 0.05;
  shadow.renderOrder = -1;
  desk.visible = !capture;                               // a GIF's frames: its lines change with every turn and cost too many bytes
  scene.add(desk, shadow);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 4000);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.75, zoomSpeed: 0.9, enablePan: false, minDistance: 55, maxDistance: 600 });
  controls.maxPolarAngle = THREE.MathUtils.degToRad(88);   // never under the desk
  function view({ az = HOME.az, el = HOME.el, D = HOME.D, target = TARGET } = {}) {
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    controls.target.copy(target);
    camera.position.set(target.x + D * Math.sin(a) * Math.cos(e), target.y + D * Math.sin(e), target.z + D * Math.cos(a) * Math.cos(e));
    camera.lookAt(controls.target);
    controls.update();
  }
  view();

  // the picture: copied from the page's canvas only when the board has pushed a new one
  let dirty = true, uploads = 0;
  function upload() {
    model.showPicture(source);
    dirty = false; uploads++;
  }

  // a tap: a press on the device that neither moves nor lingers (a drag turns it)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), meshes = [];
  model.root.traverse(o => { if (o.isMesh && o.userData.partId) meshes.push(o); });
  function onDevice(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(meshes, false).some(h => h.object.visible);
  }
  let down = null, hoverAt = null;
  canvas.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    const d = down;
    down = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_SLOP && performance.now() - d.t < TAP_MS && onDevice(e.clientX, e.clientY)) onTap();
  });
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !down) hoverAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerleave', () => { hoverAt = null; });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  function render() {
    if (dirty) upload();
    model.updateReflection(camera);
    renderer.render(scene, camera);
  }

  // the loop: only while the view is shown; a slow GPU draws fewer pixels rather than fewer frames
  let running = false, raf = 0, frames = 0, fpsT = performance.now(), fps = 0, slow = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    controls.update();
    if (hoverAt) { canvas.style.cursor = onDevice(...hoverAt) ? 'pointer' : 'grab'; hoverAt = null; }
    render();
    frames++;
    if (now - fpsT >= 1000) {
      fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now;
      slow = fps < 40 ? slow + 1 : 0;
      if (slow >= 2 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.5)); resize(); slow = 0; }
    }
  }

  return {
    show() { if (running || capture) return; running = true; dirty = true; resize(); fpsT = performance.now(); frames = 0; raf = requestAnimationFrame(loop); },
    hide() { running = false; cancelAnimationFrame(raf); },
    pushed() { dirty = true; },                          // the board pushed a frame
    backlight(level) { model.setBacklight(level / 255); },
    view,
    home: () => view(),
    orbit() {                                            // where the camera is, as view() takes it
      const v = camera.position.clone().sub(controls.target), D = v.length();
      return { az: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)), el: THREE.MathUtils.radToDeg(Math.asin(v.y / D)), D };
    },
    still(v) { if (v) view(v); controls.update(); render(); },    // one frame, for the captures (?capture)
    // where a point of the device is on the page, for the checks: the prism's middle by default
    screenOf(p = new THREE.Vector3(0, 48, 0)) {
      const r = canvas.getBoundingClientRect(), q = p.clone().project(camera);
      return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height };
    },
    stats: () => ({ fps, uploads, pixelRatio: renderer.getPixelRatio(), renderer: renderer.getContext().getParameter(renderer.getContext().VERSION) }),
    // the display's picture turned back the right way round, for the checks: it must be the board's own pixels
    picture() {
      const c = document.createElement('canvas');
      c.width = c.height = 240;
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, -1, 0, 240);
      g.drawImage(model.sageTex.image, 0, 0);
      return g.getImageData(0, 0, 240, 240).data;
    },
  };
}
