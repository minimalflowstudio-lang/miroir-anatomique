/* =========================================================================
   MIROIR ANATOMIQUE — LENTILLE RAYONS X, version WebGL (module livré par Ada)
   Même contrat d'interface que js/lens.js (voir l'en-tête de Marie) : ce
   fichier s'échange avec lui sans toucher à mirror.js. Le masque de
   l'anatomie reste en SVG (alignement exact dans le repère vidéo) ; la peau
   assombrie, le vignettage et le grain — animé — passent sur un canvas
   WebGL glissé sous l'anatomie. Sans WebGL : repli sur la version SVG.
   ========================================================================= */

(function () {

const SVGNS = "http://www.w3.org/2000/svg";
const el = (name, attrs, parent) => {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

let overlay = null, layerRoot = null, frameEl = null;
let dims = { W: 1280, H: 720 };
let enabled = false;
let mirrored = true;
let cx = 0.5, cy = 0.45;      // centre, en fraction du cadre (repère vidéo)
let radius = 0;               // en unités du repère vidéo
let radiusFrac = 0.26;        // rayon relatif à la plus petite dimension

/* Réglages du « verre » — ajustables via MIROIR_LENS.set({...}) */
const cfg = {
  featherPx: 30,     // fondu du bord, en px écran
  dim: 0.62,         // assombrissement de la peau dans la lentille
  grain: 0.14,       // amplitude du grain animé (WebGL seulement)
  vignette: 0.26,    // sur-assombrissement près du bord intérieur
};

let maskCircle, stopIn, stopMid, ringG, defs;
let dimG = null, dimCircle = null, grainRect = null;   // repli SVG
let canvas = null, gl = null, uni = null, rafId = 0;
let dpr = 1;

function init(ctx) {
  overlay   = ctx.overlay;
  layerRoot = ctx.layerRoot;
  frameEl   = ctx.frameEl;

  defs = el("defs", {}, overlay);

  /* Masque de révélation : plein au centre, fondu configurable au bord.
     Les offsets des stops sont recalculés quand le rayon change. */
  const grad = el("radialGradient", { id: "lensGrad" }, defs);
  el("stop", { offset: "0%", "stop-color": "#fff", "stop-opacity": "1" }, grad);
  stopIn  = el("stop", { offset: "62%",  "stop-color": "#fff", "stop-opacity": "1" }, grad);
  stopMid = el("stop", { offset: "86%",  "stop-color": "#fff", "stop-opacity": "0.5" }, grad);
  el("stop", { offset: "100%", "stop-color": "#fff", "stop-opacity": "0" }, grad);

  const mask = el("mask", { id: "lensMask", maskUnits: "userSpaceOnUse" }, defs);
  maskCircle = el("circle", { cx: 0, cy: 0, r: 0, fill: "url(#lensGrad)" }, mask);

  /* Le verre : WebGL si possible, sinon les éléments SVG de la version de Marie. */
  buildGlass();

  /* Anneau et halo, dessinés PAR-DESSUS tout. */
  ringG = el("g", { id: "lensRing" }, overlay);
  el("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: "#4fc3f7",
                 "stroke-width": 2.5, opacity: "0.85", class: "lens-ring" }, ringG);
  el("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: "#4fc3f7",
                 "stroke-width": 9, opacity: "0.14", class: "lens-halo" }, ringG);

  if (window.ResizeObserver) new ResizeObserver(sizeCanvas).observe(frameEl);
  else window.addEventListener("resize", sizeCanvas);

  setEnabled(false);
}

/* --------------------------------------------------- Verre WebGL / repli */
function buildGlass() {
  canvas = document.createElement("canvas");
  canvas.id = "lensGlass";
  Object.assign(canvas.style, {
    position: "absolute", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", display: "none",
  });
  frameEl.insertBefore(canvas, overlay);      // sous l'anatomie, sur la vidéo

  gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (gl) { try { buildProgram(); } catch (e) { gl = null; } }
  if (!gl) { canvas.remove(); canvas = null; buildSvgGlass(); return; }

  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault();
    gl = null; cancelAnimationFrame(rafId);
    canvas.remove(); canvas = null;
    buildSvgGlass();
    if (enabled) { dimG.style.display = ""; refresh(); }
  });
}

/* Repli sans WebGL : exactement le verre SVG de la version de Marie. */
function buildSvgGlass() {
  if (dimG) return;
  const grainFilter = el("filter", { id: "lensGrain", x: "0%", y: "0%", width: "100%", height: "100%" }, defs);
  el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.85", numOctaves: "2", result: "n" }, grainFilter);
  el("feColorMatrix", { type: "saturate", values: "0", in: "n", result: "g" }, grainFilter);

  dimG = el("g", { id: "lensDim", mask: "url(#lensMask)" });
  overlay.insertBefore(dimG, layerRoot);
  dimCircle = el("circle", { cx: 0, cy: 0, r: 0, fill: "#040a10", opacity: String(cfg.dim) }, dimG);
  grainRect = el("circle", { cx: 0, cy: 0, r: 0, filter: "url(#lensGrain)", opacity: "0.16" }, dimG);
}

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2  u_center;                    // px device, y vers le haut
uniform float u_radius, u_feather, u_time, u_dim, u_grain, u_vignette;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float d = distance(gl_FragCoord.xy, u_center);
  float lens = 1.0 - smoothstep(u_radius - u_feather, u_radius, d);
  if (lens <= 0.002) { gl_FragColor = vec4(0.0); return; }

  // grain de film animé (bruit neutre, ~24 images/s)
  float n = hash(floor(gl_FragCoord.xy / 2.0) + floor(u_time * 24.0) * 17.0);
  float grain = (n - 0.5) * u_grain * lens;

  // peau assombrie + vignettage vers le bord intérieur
  float dark = (u_dim + smoothstep(u_radius * 0.55, u_radius, d) * u_vignette) * lens;
  dark = clamp(dark + max(-grain, 0.0), 0.0, 1.0);
  float light = max(grain, 0.0);

  // teinte nuit du verre (#040a10), alpha prémultiplié
  vec3 tint = vec3(0.016, 0.039, 0.063);
  gl_FragColor = vec4(tint * dark + vec3(light), clamp(dark + light, 0.0, 1.0));
}`;

function buildProgram() {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  uni = {};
  for (const n of ["u_center", "u_radius", "u_feather", "u_time", "u_dim", "u_grain", "u_vignette"])
    uni[n] = gl.getUniformLocation(prog, n);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

function sizeCanvas() {
  if (!canvas || !frameEl) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(frameEl.clientWidth * dpr));
  const h = Math.max(1, Math.round(frameEl.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    if (gl) gl.viewport(0, 0, w, h);
  }
}

function draw(timeMs) {
  if (!enabled) return;
  if (gl) {
    // le canvas n'est pas en miroir : centre en fraction ÉCRAN, pas vidéo
    const fx = mirrored ? 1 - cx : cx;
    const R = radiusFrac * Math.min(canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uni.u_center, fx * canvas.width, canvas.height - cy * canvas.height);
    gl.uniform1f(uni.u_radius, R);
    gl.uniform1f(uni.u_feather, Math.min(cfg.featherPx * dpr, R * 0.9));
    gl.uniform1f(uni.u_time, timeMs / 1000);
    gl.uniform1f(uni.u_dim, cfg.dim);
    gl.uniform1f(uni.u_grain, cfg.grain);
    gl.uniform1f(uni.u_vignette, cfg.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  rafId = requestAnimationFrame(draw);
}

/* ------------------------------------------------------------ Contrat */
function setDims(d) { dims = d; sizeCanvas(); refresh(); }
function setMirrored(m) { mirrored = m; refresh(); }
function isEnabled() { return enabled; }

function setEnabled(on) {
  enabled = on;
  if (!layerRoot) return;
  layerRoot.setAttribute("mask", on ? "url(#lensMask)" : "");
  if (!on) layerRoot.removeAttribute("mask");
  if (canvas) canvas.style.display = on ? "" : "none";
  if (dimG) dimG.style.display = on ? "" : "none";
  ringG.style.display = on ? "" : "none";
  cancelAnimationFrame(rafId);
  if (on) { sizeCanvas(); rafId = requestAnimationFrame(draw); }
  refresh();
}

/* Convertit un point de l'écran vers le repère vidéo, en tenant compte du
   miroir et du recadrage « cover » (le cadre déborde du viewport). */
function setCenterFromClient(clientX, clientY) {
  if (!frameEl) return;
  const r = frameEl.getBoundingClientRect();
  if (!r.width || !r.height) return;      // cadre pas encore dimensionné
  let fx = (clientX - r.left) / r.width;
  const fy = (clientY - r.top) / r.height;
  if (mirrored) fx = 1 - fx;
  cx = Math.min(Math.max(fx, 0), 1);
  cy = Math.min(Math.max(fy, 0), 1);
  refresh();
}

function setRadiusFrac(f) {
  radiusFrac = Math.min(Math.max(f, 0.10), 0.60);
  refresh();
}
function nudgeRadius(factor) { setRadiusFrac(radiusFrac * factor); }
function getRadiusFrac() { return radiusFrac; }

function refresh() {
  if (!maskCircle) return;
  const x = cx * dims.W, y = cy * dims.H;
  radius = Math.min(dims.W, dims.H) * radiusFrac;

  maskCircle.setAttribute("cx", x);
  maskCircle.setAttribute("cy", y);
  maskCircle.setAttribute("r", radius);

  /* Fondu du bord : ~featherPx px écran, exprimé en fraction du rayon. */
  const pxScale = frameEl && frameEl.clientWidth > 0 ? dims.W / frameEl.clientWidth : 1;
  const f = Math.min(cfg.featherPx * pxScale / radius, 0.9);
  stopIn.setAttribute("offset", ((1 - f) * 100).toFixed(1) + "%");
  stopMid.setAttribute("offset", ((1 - f * 0.45) * 100).toFixed(1) + "%");

  if (dimCircle) {
    for (const n of [dimCircle, grainRect]) {
      n.setAttribute("cx", x); n.setAttribute("cy", y); n.setAttribute("r", radius);
    }
  }
  const scale = Math.min(dims.W, dims.H) / 700;   // épaisseurs constantes à l'écran
  for (const n of ringG.children) {
    n.setAttribute("cx", x); n.setAttribute("cy", y); n.setAttribute("r", radius);
    const base = n.classList.contains("lens-halo") ? 9 : 2.5;
    n.setAttribute("stroke-width", base * scale);
  }
}

/* Centre la lentille sur un point du corps détecté (repère vidéo). */
function centerOnVideoPoint(vx, vy) {
  cx = vx / dims.W; cy = vy / dims.H;
  refresh();
}

window.MIROIR_LENS = {
  init, setDims, setEnabled, isEnabled, setCenterFromClient,
  setRadiusFrac, getRadiusFrac, nudgeRadius, setMirrored, centerOnVideoPoint, refresh,
  /* extras Ada, sans impact sur mirror.js : */
  set(opts) { Object.assign(cfg, opts || {}); refresh(); },
  get: () => ({ ...cfg, radiusFrac, tech: gl ? "webgl" : "svg" }),
  tech: () => (gl ? "webgl" : "svg"),
};

})();
