/**
 * Model stand: ONE Bench3D model on the Workbench's own table and light, without the rest of the page.
 * Run by scripts/model-shot.mjs and scripts/model-gallery.mjs; open it by hand with
 *   npx vite src/bench3d/harness   then   http://localhost:5173/?model=wifi.router&view=front
 *
 * URL: model=<id>, view=front|back|side|low|top, state=<name of an example state, or JSON>, detail=<0..1>, t=<seconds, freezes time>.
 * Drag turns the view, the wheel zooms. `window.__model` is the script's handle.
 */
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/dm-mono/latin-400.css';
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, NeutralToneMapping, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, type Object3D } from 'three';
import { asDecal } from '../../device3d/decal';
import { makeStudioEnvironment } from '../../device3d/studio';
import { makeShadowTexture } from '../../device3d/textures';
import { TABLE_LIGHT, buildTable } from '../../workbench/table';
import { inspectModel, makeCtx, type PartModel } from '../contract';
import { instantiate, onPrintsRedrawn } from '../index';
import { MODELS, modelSource } from '../registry';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const caption = document.getElementById('caption')!;

const gl = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
gl.toneMapping = NeutralToneMapping;
gl.toneMappingExposure = 1.04;
const scene = new Scene();
const env = makeStudioEnvironment(gl);
scene.environment = env.texture;
const camera = new PerspectiveCamera(30, 1, 5, 4000);
const table = buildTable(TABLE_LIGHT);
scene.add(table.group);

const DEG = Math.PI / 180;
const VIEWS: Record<string, { az: number; pol: number; fov?: number }> = {
  front: { az: 28, pol: 56 },
  back: { az: 208, pol: 56 },
  side: { az: -68, pol: 70 },
  low: { az: 14, pol: 80 },
  top: { az: 0, pol: 0.4, fov: 12 },
};

let model: PartModel | undefined;
let object: Object3D | null = null;
let state: unknown = {};
let view = { az: 28, pol: 56, zoom: 1, fov: 30, name: 'front' };
const frozen = q.has('t') ? Number(q.get('t')) : null;
const outline = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: 0x028ac2 }));
const shadow = new Mesh(new PlaneGeometry(1, 1), asDecal(new MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, toneMapped: false, opacity: 0.55 }), 0.15));
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.02;
scene.add(shadow, outline);

function load(id: string, detail = 1): string[] {
  model = MODELS.get(id);
  if (object) scene.remove(object);
  object = null;
  if (!model) return [`no model "${id}" (have: ${[...MODELS.keys()].join(', ')})`];
  object = instantiate(model.build(makeCtx(detail)));
  // legs that plug in: the stand raises the part on them, so they can be seen
  object.position.y = model.plugMm ?? 0;
  scene.add(object);
  const { w, d } = model.footprintMm;
  outline.geometry.setAttribute('position', new Float32BufferAttribute([-w / 2, 0.06, -d / 2, w / 2, 0.06, -d / 2, w / 2, 0.06, d / 2, -w / 2, 0.06, d / 2], 3));
  shadow.scale.set(w * 1.5, d * 1.5, 1);
  setState(q.get('state') ?? '');
  return [];
}

function setState(s: string | object): void {
  if (!model) return;
  if (typeof s === 'object') state = s;
  else if (s && model.states && s in model.states) state = model.states[s];
  else if (s) {
    try {
      state = JSON.parse(s);
    } catch {
      state = {};
    }
  } else state = Object.values(model.states ?? {})[0] ?? {};
}

function setView(name: string): void {
  const v = VIEWS[name] ?? VIEWS.front;
  view = { az: v.az, pol: v.pol, zoom: 1, fov: v.fov ?? 30, name: name in VIEWS ? name : 'front' };
}

function place(): void {
  const w = window.innerWidth, h = window.innerHeight;
  gl.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = view.fov;
  const fp = model?.footprintMm ?? { w: 40, d: 40, h: 20 };
  const f = { w: fp.w, d: fp.d, h: fp.h + (model?.plugMm ?? 0) }; // raised on its legs
  const pol = view.pol * DEG, az = view.az * DEG;
  // fit what the camera sees of the footprint box: its diagonal across, its depth foreshortened plus its height
  const across = Math.hypot(f.w, f.d) / 2;
  const up = across * Math.cos(pol) + (f.h / 2) * Math.sin(pol);
  const t = Math.tan((view.fov * DEG) / 2);
  const dist = (Math.max(up / t, across / (t * camera.aspect)) * 1.32 + across * Math.sin(pol)) / view.zoom;
  camera.position.set(dist * Math.sin(pol) * Math.sin(az), f.h * 0.4 + dist * Math.cos(pol), dist * Math.sin(pol) * Math.cos(az));
  camera.near = Math.max(1, dist - 900);
  camera.far = dist + 1500;
  camera.up.set(0, 1, 0);
  camera.lookAt(0, f.h * 0.4, 0);
  camera.updateProjectionMatrix();
}

const project = (p: [number, number, number]) => {
  const v = new Vector3(p[0], p[1] + (model?.plugMm ?? 0), p[2]).project(camera);
  return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
};

/** The top view is a drawing: terminals with their ids, the footprint, a millimetre scale. */
function annotate(): void {
  overlay.textContent = '';
  outline.visible = view.name === 'top';
  if (!model || view.name !== 'top') return;
  for (const t of model.terminals ?? []) {
    const p = project(t.pos);
    const dot = document.createElement('div');
    dot.className = 'pin';
    dot.style.left = `${p.x}px`;
    dot.style.top = `${p.y}px`;
    const label = document.createElement('div');
    label.className = 'pin-label';
    label.style.left = `${p.x}px`;
    label.style.top = `${p.y}px`;
    label.textContent = t.label && t.label !== t.id ? `${t.id} ${t.label}` : t.id;
    overlay.append(dot, label);
  }
  const { w, d, h } = model.footprintMm;
  const span = [1, 2, 5, 10, 20, 50, 100].find((s) => s >= w / 3) ?? 100;
  const a = project([-w / 2, 0, d / 2]), b = project([-w / 2 + span, 0, d / 2]);
  const bar = document.createElement('div');
  bar.className = 'scale';
  bar.style.left = `${a.x}px`;
  bar.style.top = `${a.y + 26}px`;
  bar.style.width = `${b.x - a.x}px`;
  bar.innerHTML = `<span>${span} mm</span>`;
  const dims = document.createElement('div');
  dims.className = 'dims';
  dims.textContent = `footprint ${w} x ${d} x ${h} mm`;
  overlay.append(bar, dims);
}

let last = performance.now();
const t0 = last;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (model?.animate && object) model.animate(state as never, object, { time: frozen ?? (now - t0) / 1000, dt });
  place();
  gl.render(scene, camera);
  annotate();
  requestAnimationFrame(frame);
}

// ---- look around by hand
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.az -= (e.clientX - drag.x) * 0.4;
  view.pol = Math.min(88, Math.max(0.4, view.pol - (e.clientY - drag.y) * 0.3));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.min(6, Math.max(0.3, view.zoom * Math.exp(-e.deltaY * 0.0012)));
}, { passive: false });

const errors = load(q.get('model') ?? [...MODELS.keys()][0] ?? '', q.has('detail') ? Number(q.get('detail')) : 1);
setView(q.get('view') ?? 'front');
onPrintsRedrawn(() => undefined);

function describe() {
  if (!model || !object) return { id: q.get('model'), problems: errors, triangles: 0, budget: 0, drawCalls: 0 };
  const r = inspectModel(model); // a fresh build: the copy on the stand is raised on its legs
  return { ...r, title: model.title, source: modelSource(model.id), footprintMm: model.footprintMm, terminals: (model.terminals ?? []).length, states: Object.keys(model.states ?? {}), rendered: { calls: gl.info.render.calls, triangles: gl.info.render.triangles } };
}
const rep = describe();
caption.innerHTML = `<b>${model?.title ?? '?'}</b><span>${model?.id ?? ''}</span><span>${rep.triangles} triangles (budget ${rep.budget})</span>${rep.problems.map((p) => `<span class="bad">${p}</span>`).join('')}`;
if (q.has('bare')) caption.style.display = 'none';

(window as unknown as Record<string, unknown>).__model = {
  ids: () => [...MODELS.keys()],
  report: describe,
  setView: (name: string) => setView(name),
  setState: (s: string | object) => setState(s),
  views: () => Object.keys(VIEWS),
  /** Mean milliseconds per frame over `n` frames drawn back to back. */
  bench(n = 30) {
    const ctx = gl.getContext();
    const px = new Uint8Array(4);
    const t = performance.now();
    for (let i = 0; i < n; i++) {
      gl.render(scene, camera);
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t) / n;
  },
  ready: () => document.fonts.status === 'loaded',
};
requestAnimationFrame(frame);
