/* =========================================================================
   MIROIR ANATOMIQUE — moteur de rendu
   Ancre les couches anatomiques sur le corps détecté par MediaPipe Pose.
   ========================================================================= */

/* MediaPipe est chargé par import() dynamique : ainsi ce fichier reste un
   script classique et l'app s'ouvre aussi par double-clic (file://), où les
   modules ES sont bloqués par la politique CORS des navigateurs. */
(function () {

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const { LAYERS, LAYER_META, LAYER_ORDER } = window.MIROIR_LAYERS;

const video    = document.getElementById("video");
const overlay  = document.getElementById("overlay");
const frame    = document.getElementById("frame");
const statusEl = document.getElementById("status");
const splash   = document.getElementById("splash");
const hud      = document.getElementById("hud");
const layerBar = document.getElementById("layerBar");
const tools    = document.getElementById("tools");
const fpsEl    = document.getElementById("fps");
const detectEl = document.getElementById("detect");

const SVGNS = "http://www.w3.org/2000/svg";

let landmarker = null;
let running    = false;
let demoMode   = false;
let dims       = { W: 1280, H: 720 };
let mirrored   = true;

/* Couches actives : « os » seule au départ */
const active = { bones: true, muscles: false, nerves: false, organs: false, vessels: false };

/* ---------------------------------------------------------------- Modèle */
async function loadModel() {
  try {
    const { PoseLandmarker, FilesetResolver } = await import(MEDIAPIPE_CDN);
    const files = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN + "/wasm");
    landmarker = await PoseLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });
    statusEl.textContent = "Modèle prêt. Autorise la caméra pour commencer.";
    document.getElementById("startBtn").disabled = false;
  } catch (e) {
    statusEl.textContent = "Modèle indisponible (" + e.message + "). Le mode démo reste utilisable.";
  }
}

/* ------------------------------------------------- Construction du SVG */
const groups = {};   // key → { root, pieces: [{node, def}] }
const layerRoot = document.createElementNS(SVGNS, "g");
layerRoot.setAttribute("id", "layerGroups");
overlay.appendChild(layerRoot);

for (const key of LAYER_ORDER) {
  const root = document.createElementNS(SVGNS, "g");
  root.setAttribute("id", "layer-" + key);
  root.style.opacity = active[key] ? 1 : 0;
  root.setAttribute("visibility", active[key] ? "visible" : "hidden");
  layerRoot.appendChild(root);

  const pieces = LAYERS[key].map(def => {
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("visibility", "hidden");
    def.build(g);
    root.appendChild(g);
    return { node: g, def };
  });
  groups[key] = { root, pieces };
}

/* Marqueur de zone touchée (module premiers secours) */
const pickMark = document.createElementNS(SVGNS, "g");
pickMark.setAttribute("id", "pickMark");
pickMark.setAttribute("visibility", "hidden");
{
  const c1 = document.createElementNS(SVGNS, "circle");
  c1.setAttribute("r", 26); c1.setAttribute("fill", "none");
  c1.setAttribute("stroke", "#4fc3f7"); c1.setAttribute("stroke-width", 4);
  const c2 = document.createElementNS(SVGNS, "circle");
  c2.setAttribute("r", 6); c2.setAttribute("fill", "#4fc3f7");
  pickMark.appendChild(c1); pickMark.appendChild(c2);
}
overlay.appendChild(pickMark);

/* ------------------------------------------------ Lentille rayons X ----- */
const LENS = window.MIROIR_LENS;
LENS.init({ overlay, layerRoot, frameEl: frame });

const stage = document.getElementById("stage");

function moveLens(e) {
  if (!LENS.isEnabled()) return;
  if (window.MIROIR_AID?.isPicking?.()) return;   // le repérage de plaie a la priorité
  LENS.setCenterFromClient(e.clientX, e.clientY);
}
stage.addEventListener("pointermove", moveLens);
stage.addEventListener("pointerdown", moveLens);

stage.addEventListener("wheel", e => {
  if (!LENS.isEnabled()) return;
  e.preventDefault();
  LENS.nudgeRadius(e.deltaY > 0 ? 1.09 : 0.92);
}, { passive: false });

/* Pincement à deux doigts pour régler le diamètre */
const touches = new Map();
let pinchStart = 0, pinchRadius = 0;
stage.addEventListener("pointerdown", e => {
  if (e.pointerType !== "touch") return;
  touches.set(e.pointerId, e);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchRadius = LENS.getRadiusFrac();
  }
});
stage.addEventListener("pointermove", e => {
  if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId, e);
  if (touches.size === 2 && pinchStart > 0) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    LENS.setRadiusFrac(pinchRadius * (d / pinchStart));
  }
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
  stage.addEventListener(ev, e => { touches.delete(e.pointerId); pinchStart = 0; });
}

/* ------------------------------------------------------- Barre de couches */
for (const { key, label, color } of LAYER_META) {
  const b = document.createElement("button");
  b.className = "layer-btn" + (active[key] ? " on" : "");
  b.dataset.layer = key;
  b.innerHTML = `<span class="dot" style="background:${color}"></span>${label}`;
  b.addEventListener("click", () => toggleLayer(key, b));
  layerBar.appendChild(b);
}
const aidBtn = document.createElement("button");
aidBtn.id = "aidBtn";
aidBtn.innerHTML = `<span class="dot"></span>PLAIE`;
aidBtn.addEventListener("click", () => window.MIROIR_AID.open());
layerBar.appendChild(aidBtn);

function toggleLayer(key, btn) {
  active[key] = !active[key];
  const g = groups[key].root;
  if (active[key]) g.setAttribute("visibility", "visible");
  else setTimeout(() => { if (!active[key]) g.setAttribute("visibility", "hidden"); }, 260);
  btn.classList.toggle("on", active[key]);
  applyDepthOpacity();
  updateHud();
}

/* Le squelette s'efface quand on regarde plus profond ou plus superficiel,
   et seule la couche la plus superficielle activée reste pleinement opaque. */
function applyDepthOpacity() {
  const onKeys = LAYER_ORDER.filter(k => active[k]);
  const top = onKeys[onKeys.length - 1];
  for (const key of LAYER_ORDER) {
    let o = 0;
    if (active[key]) {
      if (key === "bones") o = onKeys.length > 1 ? 0.5 : 1;
      else o = key === top ? 1 : 0.7;
    }
    groups[key].root.style.opacity = o;
  }
}

function updateHud() {
  const on = LAYER_META.filter(m => active[m.key]).map(m => m.label);
  document.getElementById("layersOn").textContent = on.length ? on.join(" + ") : "aucune";
  document.getElementById("lensState").textContent =
    (LENS.isEnabled() ? "lentille ON — déplace le doigt" : "lentille OFF") +
    (SEG.isEnabled() ? " · silhouette ON" : "");
}

/* ---------------------------------------------------------- Outils (haut) */
document.getElementById("opacity").addEventListener("input", e => {
  layerRoot.style.opacity = e.target.value / 100;
});
document.getElementById("mirrorTool").addEventListener("click", e => {
  mirrored = !mirrored;
  video.classList.toggle("mirrored", mirrored);
  overlay.classList.toggle("mirrored", mirrored);
  e.currentTarget.classList.toggle("on", mirrored);
  LENS.setMirrored(mirrored);
});

const SEG = window.MIROIR_SEG;
SEG.attach(overlay);

const segTool = document.getElementById("segTool");
segTool.addEventListener("click", () => {
  if (demoMode) { detectEl.textContent = "Silhouette : sans caméra, il n'y a rien à découper."; return; }
  if (!SEG.isReady()) { detectEl.textContent = "Silhouette : modèle en cours de chargement…"; SEG.load(); return; }
  const on = !SEG.isEnabled();
  SEG.setEnabled(on);
  segTool.classList.toggle("on", on);
  updateHud();
});

const lensTool = document.getElementById("lensTool");
lensTool.addEventListener("click", () => {
  const on = !LENS.isEnabled();
  LENS.setEnabled(on);
  lensTool.classList.toggle("on", on);
  updateHud();
});
document.getElementById("fsTool").addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
document.getElementById("camTool").addEventListener("click", () => switchCamera());

/* ------------------------------------------------------------- Démarrage */
document.getElementById("startBtn").disabled = true;
loadModel();

let facing = "user";
let stream = null;

async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    // En portrait (téléphone), on demande un flux portrait : sinon l'image
    // 16:9 couchée ne remplit qu'une bande au milieu de l'écran.
    const portrait = window.innerHeight > window.innerWidth;
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:  { ideal: portrait ? 720 : 1280 },
        height: { ideal: portrait ? 1280 : 720 },
        facingMode: facing
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    dims = { W: video.videoWidth || 1280, H: video.videoHeight || 720 };
    fitFrame();
    enterMirror();
    SEG.load();   // en tâche de fond : la silhouette devient disponible peu après
  } catch (e) {
    statusEl.textContent = "Caméra indisponible (" + e.name + ") — sur téléphone, l'accès caméra exige HTTPS. Essaie le mode démo.";
  }
}
async function switchCamera() {
  if (demoMode) return;
  facing = facing === "user" ? "environment" : "user";
  mirrored = facing === "user";
  video.classList.toggle("mirrored", mirrored);
  overlay.classList.toggle("mirrored", mirrored);
  document.getElementById("mirrorTool").classList.toggle("on", mirrored);
  await startCamera();
}

document.getElementById("startBtn").addEventListener("click", startCamera);
document.getElementById("demoBtn").addEventListener("click", () => {
  demoMode = true;
  video.style.display = "none";
  frame.style.background = "radial-gradient(ellipse at 50% 38%, #1a2530 0%, #0b0e12 75%)";
  setDemoDims();
  fitFrame();
  enterMirror();
});

function enterMirror() {
  splash.classList.add("hidden");
  hud.classList.remove("hidden");
  layerBar.classList.remove("hidden");
  tools.classList.remove("hidden");
  applyDepthOpacity();
  // Lentille allumée d'emblée : c'est l'effet qui donne le sens de l'app.
  LENS.setMirrored(mirrored);
  LENS.setEnabled(true);
  lensTool.classList.add("on");
  updateHud();
  if (!running) { running = true; requestAnimationFrame(loop); }
}

/* Le mannequin de démo prend le format de l'écran, pour remplir la page
   aussi bien sur un téléphone en portrait que sur un écran de PC. */
function setDemoDims() {
  const ww = window.innerWidth, wh = window.innerHeight;
  // 0.62 minimum : en dessous, le mannequin bras écartés sortirait du cadre.
  const ratio = Math.min(Math.max(ww / wh, 0.62), 1.9);
  dims = { W: Math.round(900 * ratio), H: 900 };
}

function fitFrame() {
  const ww = window.innerWidth, wh = window.innerHeight;
  // Caméra : « cover » — l'image remplit l'écran (un miroir ne laisse pas de
  // bandes noires). Démo : « contain » — le mannequin reste entier.
  const scale = demoMode
    ? Math.min(ww / dims.W, wh / dims.H)
    : Math.max(ww / dims.W, wh / dims.H);
  frame.style.width  = (dims.W * scale) + "px";
  frame.style.height = (dims.H * scale) + "px";
  overlay.setAttribute("viewBox", `0 0 ${dims.W} ${dims.H}`);
  LENS.setDims(dims);
}
function onResize() {
  if (demoMode) setDemoDims();
  fitFrame();
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", () => setTimeout(onResize, 300));

/* ------------------------------------------------- Mannequin de démo */
/* Les écarts horizontaux sont exprimés en unités de HAUTEUR d'image, puis
   convertis : sans cela le mannequin s'étire dès que le format change. */
function demoLandmarks(t) {
  const s = Math.sin(t / 800);
  const bob = Math.sin(t / 470) * 0.005;
  const k = dims.H / dims.W;                 // hauteur → largeur normalisée
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const set = (i, dx, y) => { lm[i] = { x: 0.5 + dx * k, y: y + bob, visibility: 1 }; };

  set(0,  s * 0.007, 0.155);
  set(7,  0.057 + s * 0.007, 0.150);  set(8, -0.057 + s * 0.007, 0.150);
  set(11, 0.146, 0.295);              set(12, -0.146, 0.295);
  set(13, 0.203 + s * 0.016, 0.435);  set(14, -0.203 - s * 0.016, 0.435);
  set(15, 0.228 + s * 0.036, 0.565);  set(16, -0.228 - s * 0.036, 0.565);
  set(19, 0.242 + s * 0.046, 0.618);  set(20, -0.242 - s * 0.046, 0.618);
  set(23, 0.085, 0.555);              set(24, -0.085, 0.555);
  set(25, 0.096, 0.722);              set(26, -0.096, 0.722);
  set(27, 0.103, 0.882);              set(28, -0.103, 0.882);
  set(31, 0.156, 0.922);              set(32, -0.156, 0.922);
  return lm;
}

/* ------------------------------------------------------------- Lissage */
let smooth = null;
function smoothLandmarks(lm) {
  const A = 0.5;
  if (!smooth || smooth.length !== lm.length) { smooth = lm.map(p => ({ ...p })); return smooth; }
  for (let i = 0; i < lm.length; i++) {
    smooth[i].x += A * (lm[i].x - smooth[i].x);
    smooth[i].y += A * (lm[i].y - smooth[i].y);
    smooth[i].visibility = lm[i].visibility;
  }
  return smooth;
}

const vis = (p, t = 0.45) => p && (p.visibility ?? 1) > t;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/* --------------------------------------------------- Repères anatomiques
   Chaque repère fournit une matrice SVG [a b c d e f].
   Le signe de l'axe x est choisi pour que +x = GAUCHE anatomique. */

let FRAMES = { torso: null, pelvis: null, head: null };
let PTS = null;   // points en pixels, ou null

function buildFrames() {
  FRAMES = { torso: null, pelvis: null, head: null };
  if (!PTS) return;
  const shL = PTS[11], shR = PTS[12], hpL = PTS[23], hpR = PTS[24];

  if (vis(shL) && vis(shR)) {
    const c = mid(shL, shR);
    // axe x du repère = de la droite anatomique vers la gauche anatomique
    const ax = { x: shL.x - shR.x, y: shL.y - shR.y };
    const w = Math.hypot(ax.x, ax.y);
    let len = w * 1.55, uy;
    if (vis(hpL) && vis(hpR)) {
      const h = mid(hpL, hpR);
      uy = { x: h.x - c.x, y: h.y - c.y };
      len = Math.hypot(uy.x, uy.y);
    } else {
      uy = { x: -ax.y, y: ax.x };            // perpendiculaire, vers le bas
      const n = Math.hypot(uy.x, uy.y);
      uy = { x: uy.x / n * len, y: uy.y / n * len };
    }
    // matrice : (1,0)→ax normalisé * w ; (0,1)→uy
    FRAMES.torso = [ax.x / w * w, ax.y / w * w, uy.x, uy.y, c.x, c.y];
  }

  if (vis(hpL) && vis(hpR)) {
    const c = mid(hpL, hpR);
    const ax = { x: hpL.x - hpR.x, y: hpL.y - hpR.y };
    const w = Math.hypot(ax.x, ax.y) * 1.15;
    const ux = { x: ax.x / Math.hypot(ax.x, ax.y) * w, y: ax.y / Math.hypot(ax.x, ax.y) * w };
    FRAMES.pelvis = [ux.x, ux.y, -ux.y, ux.x, c.x, c.y];   // isotrope
  }

  const earL = PTS[7], earR = PTS[8], nose = PTS[0];
  if (vis(earL) && vis(earR)) {
    const c = mid(earL, earR);
    const ax = { x: earL.x - earR.x, y: earL.y - earR.y };
    const raw = Math.hypot(ax.x, ax.y);
    const shW = FRAMES.torso ? Math.hypot(FRAMES.torso[0], FRAMES.torso[1]) : raw * 2.4;
    const size = Math.max(raw * 1.2, shW * 0.44);
    const ux = { x: ax.x / raw * size, y: ax.y / raw * size };
    FRAMES.head = [ux.x, ux.y, -ux.y, ux.x, c.x, c.y];
  } else if (vis(nose) && FRAMES.torso) {
    const shW = Math.hypot(FRAMES.torso[0], FRAMES.torso[1]);
    FRAMES.head = [shW * 0.44, 0, 0, shW * 0.44, nose.x, nose.y - shW * 0.03];
  }
}

function applyMatrix(node, m) {
  node.setAttribute("transform", `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})`);
  node.setAttribute("visibility", "visible");
}

/* ---------------------------------------------------------- Boucle vidéo */
let lastT = -1, frames = 0, fpsT = performance.now();

function loop() {
  if (!running) return;
  const now = performance.now();

  if (demoMode) {
    update(demoLandmarks(now));
    tickFps(now, " (démo)");
  } else if (landmarker && video.currentTime !== lastT && video.videoWidth > 0) {
    lastT = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    update(res.landmarks?.[0] || null);
    SEG.process(video, now);
    tickFps(now, "");
  }
  requestAnimationFrame(loop);
}
function tickFps(now, suffix) {
  frames++;
  if (now - fpsT > 1000) { fpsEl.textContent = frames + " i/s" + suffix; frames = 0; fpsT = now; }
}

function hideAll() {
  for (const key of LAYER_ORDER)
    for (const p of groups[key].pieces) p.node.setAttribute("visibility", "hidden");
}

function update(raw) {
  if (!raw) {
    hideAll(); smooth = null; PTS = null;
    detectEl.textContent = "Personne non détectée — recule pour être vu en entier.";
    return;
  }
  const lm = smoothLandmarks(raw);
  PTS = lm.map(p => ({ x: p.x * dims.W, y: p.y * dims.H, visibility: p.visibility }));
  detectEl.textContent = "Détection active ✓";
  buildFrames();

  for (const key of LAYER_ORDER) {
    const on = active[key];
    for (const { node, def } of groups[key].pieces) {
      if (!on) { node.setAttribute("visibility", "hidden"); continue; }
      if (def.frame === "seg") {
        const pa = PTS[def.a], pb = PTS[def.b];
        if (vis(pa) && vis(pb)) {
          const dx = pb.x - pa.x, dy = pb.y - pa.y;
          applyMatrix(node, [dx, dy, -dy, dx, pa.x, pa.y]);
        } else node.setAttribute("visibility", "hidden");
      } else {
        const m = FRAMES[def.frame];
        if (m) applyMatrix(node, m);
        else node.setAttribute("visibility", "hidden");
      }
    }
  }
  window.MIROIR_ENGINE.onFrame();
}

/* =========================================================================
   Repérage anatomique d'un point touché à l'écran
   -> convertit le point écran en coordonnées vidéo, trouve le segment ou la
      région la plus proche, et renvoie la zone anatomique correspondante.
   ========================================================================= */

const SEGMENTS = [
  { a: 12, b: 14, zone: "bras_d" },   { a: 11, b: 13, zone: "bras_g" },
  { a: 14, b: 16, zone: "avbras_d" }, { a: 13, b: 15, zone: "avbras_g" },
  { a: 16, b: 20, zone: "main_d" },   { a: 15, b: 19, zone: "main_g" },
  { a: 24, b: 26, zone: "cuisse_d" }, { a: 23, b: 25, zone: "cuisse_g" },
  { a: 26, b: 28, zone: "jambe_d" },  { a: 25, b: 27, zone: "jambe_g" },
  { a: 28, b: 32, zone: "pied_d" },   { a: 27, b: 31, zone: "pied_g" },
  { a: 11, b: 12, zone: "epaules" },
];

function screenToVideo(clientX, clientY) {
  const r = frame.getBoundingClientRect();
  let x = (clientX - r.left) / r.width;
  const y = (clientY - r.top) / r.height;
  if (mirrored) x = 1 - x;                 // l'affichage est en miroir
  return { x: x * dims.W, y: y * dims.H, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx*vx + vy*vy;
  if (L2 === 0) return { d: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - (a.x + t*vx), p.y - (a.y + t*vy)), t };
}

/* Renvoie { zone, t, dist, scale } ou null */
function locate(clientX, clientY) {
  if (!PTS) return null;
  const p = screenToVideo(clientX, clientY);
  if (!p.inside) return null;

  const shL = PTS[11], shR = PTS[12];
  const scale = (vis(shL) && vis(shR)) ? Math.hypot(shL.x - shR.x, shL.y - shR.y) : dims.W * 0.2;

  let best = null;
  for (const s of SEGMENTS) {
    const a = PTS[s.a], b = PTS[s.b];
    if (!vis(a) || !vis(b)) continue;
    const { d, t } = distToSeg(p, a, b);
    if (!best || d < best.d) best = { d, t, zone: s.zone };
  }

  // Tronc : rectangle épaules→hanches, dans le repère du torse
  if (FRAMES.torso) {
    const m = FRAMES.torso;
    const det = m[0]*m[3] - m[1]*m[2];
    if (Math.abs(det) > 1e-6) {
      const dx = p.x - m[4], dy = p.y - m[5];
      const u = ( m[3]*dx - m[2]*dy) / det;   // -0.5..0.5 largeur d'épaules
      const v = (-m[1]*dx + m[0]*dy) / det;   // 0..1 épaules→hanches
      if (u > -0.55 && u < 0.55 && v > -0.05 && v < 1.05) {
        let zone;
        if (v < 0.5) zone = "thorax";
        else if (v < 0.82) zone = u < 0 ? "abdo_d" : "abdo_g";
        else zone = "bassin";
        // le tronc gagne s'il est plus « intérieur » qu'un membre proche
        const dTrunk = Math.max(0, (Math.abs(u) - 0.42)) * scale;
        if (!best || dTrunk <= best.d) best = { d: dTrunk, t: v, zone };
      }
    }
  }

  // Tête / cou
  if (FRAMES.head) {
    const hx = FRAMES.head[4], hy = FRAMES.head[5];
    const size = Math.hypot(FRAMES.head[0], FRAMES.head[1]);
    const d = Math.hypot(p.x - hx, p.y - hy);
    if (d < size * 0.85 && (!best || d < best.d)) best = { d, t: 0, zone: "tete" };
    if (FRAMES.torso) {
      const nx = (hx + FRAMES.torso[4]) / 2, ny = (hy + FRAMES.torso[5]) / 2;
      const dn = Math.hypot(p.x - nx, p.y - ny);
      if (dn < size * 0.45 && (!best || dn < best.d)) best = { d: dn, t: 0, zone: "cou" };
    }
  }

  if (!best || best.d > scale * 0.55) return null;
  return { zone: best.zone, t: best.t, dist: best.d, scale, video: p };
}

function showMark(clientX, clientY) {
  const p = screenToVideo(clientX, clientY);
  pickMark.setAttribute("transform", `translate(${p.x} ${p.y})`);
  pickMark.setAttribute("visibility", "visible");
}
function hideMark() { pickMark.setAttribute("visibility", "hidden"); }

/* API exposée aux autres modules */
window.MIROIR_ENGINE = {
  locate, showMark, hideMark,
  isRunning: () => running,
  hasBody: () => !!PTS,
  frameEl: frame,
  setLayers(spec) {                       // ex. { vessels: true, nerves: true }
    for (const { key } of LAYER_META) {
      const want = !!spec[key];
      if (active[key] !== want) {
        const btn = layerBar.querySelector(`[data-layer="${key}"]`);
        toggleLayer(key, btn);
      }
    }
  },
  onFrame() { if (window.MIROIR_AID?.onFrame) window.MIROIR_AID.onFrame(); }
};

})();
