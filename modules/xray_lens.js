/* =========================================================================
   XRAY_LENS — lentille « rayons X » (Palier 1) — module livré par Ada
   L'anatomie n'apparaît que dans une lentille circulaire qui suit le doigt
   ou la souris : masque radial (feather ~30 px) sur le calque #overlay,
   plus un canvas WebGL pour le vignettage, le liseré et le grain animé.
   Branchement : window.MIROIR_LENS.enable() ou .mountButton() — voir brief.
   ========================================================================= */

(function () {

/* ------------------------------------------------------------ Réglages */
const DEFAULTS = {
  mode: "follow",      // "follow" : suit le pointeur ; "fixed" : centre du cadre
  radius: 0,           // 0 = auto (34 % du petit côté du cadre)
  feather: 30,         // fondu du bord du masque, en px CSS
  strength: 1,         // intensité globale des effets (0..1)
  grain: 0.12,         // amplitude du grain
  vignette: 0.34,      // assombrissement vers le bord intérieur
};

const cfg = { ...DEFAULTS };

let frame = null, overlay = null, canvas = null, cssFx = null;
let gl = null, prog = null, uni = null;
let enabled = false, suspended = false, rafId = 0;
let center = { x: 0, y: 0 };          // en px CSS, espace écran du cadre
let dpr = 1;

/* --------------------------------------------------------------- Init */
function init() {
  if (frame) return true;
  frame   = document.getElementById("frame");
  overlay = document.getElementById("overlay");
  if (!frame || !overlay) return false;

  canvas = document.createElement("canvas");
  canvas.id = "lensFx";
  Object.assign(canvas.style, {
    position: "absolute", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", display: "none",
  });
  frame.appendChild(canvas);

  gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (gl) {
    try { buildProgram(); } catch (e) { gl = null; }
  }
  if (!gl) buildCssFallback();

  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault();
    gl = null; canvas.style.display = "none";
    buildCssFallback();
    if (enabled) cssFx.style.display = "block";
  });

  frame.addEventListener("pointermove", onPointer, { passive: true });
  frame.addEventListener("pointerdown", onPointer, { passive: true });
  frame.addEventListener("wheel", onWheel, { passive: false });

  if (window.ResizeObserver) new ResizeObserver(onResize).observe(frame);
  else window.addEventListener("resize", onResize);

  /* Le repérage tactile du module PLAIE a besoin de voir tout le corps :
     la lentille se suspend d'elle-même pendant qu'il est actif. */
  const hint = document.getElementById("pickHint");
  if (hint && window.MutationObserver) {
    new MutationObserver(() => {
      const picking = !hint.classList.contains("hidden");
      if (picking !== suspended) { suspended = picking; suspended ? clearFx() : refresh(); }
    }).observe(hint, { attributes: true, attributeFilter: ["class"] });
  }
  return true;
}

/* ----------------------------------------------------- Shader WebGL */
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2  u_center;    // px device, y vers le haut
uniform float u_radius, u_feather, u_time, u_strength, u_grain, u_vignette;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float d = distance(gl_FragCoord.xy, u_center);
  float inside = 1.0 - smoothstep(u_radius - u_feather, u_radius, d);

  // grain animé (bruit neutre, seulement dans la lentille)
  float n = hash(floor(gl_FragCoord.xy / 2.0) + floor(u_time * 24.0) * 17.0);
  float grain = (n - 0.5) * u_grain * inside;

  // vignettage : assombrit près du bord intérieur
  float vin = smoothstep(u_radius * 0.55, u_radius, d) * u_vignette * inside;

  // liseré clair sur le verre + fin halo sombre juste dehors
  float rim  = exp(-pow((d - (u_radius - u_feather * 0.5)) / (u_feather * 0.55), 2.0)) * 0.10;
  float halo = smoothstep(u_radius - 2.0, u_radius, d)
             * (1.0 - smoothstep(u_radius, u_radius + 20.0, d)) * 0.22;

  float dark  = clamp(vin + halo + max(-grain, 0.0), 0.0, 1.0) * u_strength;
  float light = clamp(rim + max(grain, 0.0), 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(vec3(light), clamp(dark + light, 0.0, 1.0));  // alpha prémultiplié
}`;

function buildProgram() {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
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
  for (const n of ["u_center", "u_radius", "u_feather", "u_time", "u_strength", "u_grain", "u_vignette"])
    uni[n] = gl.getUniformLocation(prog, n);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

/* Repli sans WebGL : vignettage + liseré en dégradé CSS (pas de grain) */
function buildCssFallback() {
  if (cssFx) return;
  cssFx = document.createElement("div");
  cssFx.id = "lensFxCss";
  Object.assign(cssFx.style, {
    position: "absolute", inset: "0", pointerEvents: "none", display: "none",
  });
  frame.appendChild(cssFx);
}

/* ------------------------------------------------------- Interactions */
function onPointer(e) {
  if (!enabled || cfg.mode !== "follow") return;
  const r = frame.getBoundingClientRect();
  center.x = e.clientX - r.left;
  center.y = e.clientY - r.top;
  refresh();
}

function onWheel(e) {
  if (!enabled) return;
  e.preventDefault();
  setRadius(radiusPx() * (e.deltaY < 0 ? 1.08 : 0.93));
}

function onResize() {
  if (!frame) return;
  sizeCanvas();
  if (cfg.mode === "fixed" || !enabled) recenter();
  if (enabled) refresh();
}

function recenter() { center = { x: frame.clientWidth / 2, y: frame.clientHeight / 2 }; }

function radiusPx() {
  if (cfg.radius > 0) return cfg.radius;
  const s = Math.min(frame.clientWidth, frame.clientHeight);
  return Math.max(70, s * 0.34);
}

function setRadius(px) {
  const s = Math.min(frame.clientWidth, frame.clientHeight);
  cfg.radius = Math.max(60, Math.min(px, s * 0.48));
  refresh();
}

function sizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(frame.clientWidth * dpr));
  const h = Math.max(1, Math.round(frame.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    if (gl) gl.viewport(0, 0, w, h);
  }
}

/* --------------------------------------------------------- Compositing */
/* Masque radial sur #overlay : l'anatomie n'existe que dans la lentille.
   Le masque vit dans l'espace local de l'élément : si l'affichage est en
   miroir (scaleX(-1)), la position x doit être inversée. */
function applyMask() {
  const r = radiusPx(), f = Math.min(cfg.feather, r * 0.9);
  const w = frame.clientWidth;
  const x = overlay.classList.contains("mirrored") ? w - center.x : center.x;
  const grad = `radial-gradient(circle at ${x.toFixed(1)}px ${center.y.toFixed(1)}px,` +
               ` #000 ${(r - f).toFixed(1)}px, rgba(0,0,0,0) ${r.toFixed(1)}px)`;
  overlay.style.webkitMaskImage = grad;
  overlay.style.maskImage = grad;
}

function clearMask() {
  overlay.style.webkitMaskImage = "";
  overlay.style.maskImage = "";
}

function drawGl(timeMs) {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(uni.u_center, center.x * dpr, canvas.height - center.y * dpr);
  gl.uniform1f(uni.u_radius, radiusPx() * dpr);
  gl.uniform1f(uni.u_feather, Math.min(cfg.feather, radiusPx() * 0.9) * dpr);
  gl.uniform1f(uni.u_time, timeMs / 1000);
  gl.uniform1f(uni.u_strength, cfg.strength);
  gl.uniform1f(uni.u_grain, cfg.grain);
  gl.uniform1f(uni.u_vignette, cfg.vignette);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drawCss() {
  const r = radiusPx(), f = Math.min(cfg.feather, r * 0.9);
  const a = 0.30 * cfg.strength;
  cssFx.style.background =
    `radial-gradient(circle at ${center.x}px ${center.y}px,` +
    ` rgba(0,0,0,0) ${r * 0.55}px, rgba(0,0,0,${a.toFixed(3)}) ${r - f}px,` +
    ` rgba(255,255,255,${(0.10 * cfg.strength).toFixed(3)}) ${(r - f * 0.4).toFixed(1)}px,` +
    ` rgba(0,0,0,${(0.20 * cfg.strength).toFixed(3)}) ${r}px, rgba(0,0,0,0) ${r + 20}px)`;
}

function refresh() {
  if (!enabled || suspended) return;
  applyMask();
  if (!gl) drawCss();
}

function clearFx() {
  clearMask();
  if (canvas) canvas.style.display = "none";
  if (cssFx) cssFx.style.display = "none";
}

function loop(t) {
  if (!enabled) return;
  if (!suspended && gl) drawGl(t);
  rafId = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------- API */
function enable(opts) {
  if (!init()) return false;
  Object.assign(cfg, opts || {});
  if (!enabled) {
    enabled = true;
    recenter();
    sizeCanvas();
    if (gl) canvas.style.display = "block";
    else cssFx.style.display = "block";
    rafId = requestAnimationFrame(loop);
  }
  refresh();
  btnEl?.classList.add("on");
  return true;
}

function disable() {
  if (!enabled) return;
  enabled = false;
  cancelAnimationFrame(rafId);
  clearFx();
  btnEl?.classList.remove("on");
}

/* Bouton prêt à poser dans la barre de couches (#layerBar par défaut) */
let btnEl = null;
function mountButton(container) {
  const bar = container || document.getElementById("layerBar");
  if (!bar || btnEl) return btnEl;
  btnEl = document.createElement("button");
  btnEl.className = "layer-btn";
  btnEl.id = "lensBtn";
  btnEl.innerHTML = `<span class="dot" style="background:var(--accent)"></span>LENTILLE`;
  btnEl.addEventListener("click", () => (enabled ? disable() : enable()));
  bar.insertBefore(btnEl, document.getElementById("aidBtn") || null);
  return btnEl;
}

window.MIROIR_LENS = {
  enable, disable, mountButton,
  toggle: opts => (enabled ? disable() : enable(opts)),
  isOn: () => enabled,
  set(opts) { Object.assign(cfg, opts || {}); if (enabled) refresh(); },
  get: () => ({ ...cfg, radius: frame ? radiusPx() : cfg.radius }),
  setRadius,
};

})();
