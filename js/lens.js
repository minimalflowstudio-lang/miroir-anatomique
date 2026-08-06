/* =========================================================================
   MIROIR ANATOMIQUE — LENTILLE RAYONS X  (Palier 1 du brief réalisme)
   -------------------------------------------------------------------------
   L'anatomie n'est plus peinte sur tout le corps : elle n'apparaît QUE dans
   un disque qui suit le doigt (ou la souris). Au bord, un fondu doux ; à
   l'intérieur, la peau est assombrie et désaturée, avec un grain de film.
   C'est ce qui donne la sensation de « voir à travers ».

   Réalisé en masques SVG plutôt qu'en WebGL : ça se greffe directement sur
   l'overlay existant, sans réécrire le moteur, et ça reste fluide (le GPU
   compose les masques). Si Ada livre une version WebGL avec de vraies
   textures, l'interface ci-dessous reste la même.

   Contrat d'interface (utilisé par mirror.js) :
     LENS.init({ overlay, layerRoot, frameEl })
     LENS.setDims({ W, H })       dimensions du repère vidéo
     LENS.setEnabled(bool)        allumer / éteindre la lentille
     LENS.isEnabled()
     LENS.setCenterFromClient(x, y)   déplacer via un point écran
     LENS.setRadius(px) / LENS.nudgeRadius(facteur)
     LENS.setMirrored(bool)       pour convertir les coordonnées écran
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
let cx = 0.5, cy = 0.45;      // centre, en fraction du cadre (suit le doigt)
let radius = 0;               // en unités du repère vidéo
let radiusFrac = 0.26;        // rayon relatif à la plus petite dimension

let maskCircle, dimCircle, ringG, grainRect, defs;

function init(ctx) {
  overlay   = ctx.overlay;
  layerRoot = ctx.layerRoot;
  frameEl   = ctx.frameEl;

  defs = el("defs", {}, overlay);

  /* Dégradé radial : plein au centre, transparent au bord.
     Le palier à 62 % garde un cœur net, puis le fondu s'étale. */
  const grad = el("radialGradient", { id: "lensGrad" }, defs);
  el("stop", { offset: "0%",   "stop-color": "#fff", "stop-opacity": "1" }, grad);
  el("stop", { offset: "62%",  "stop-color": "#fff", "stop-opacity": "1" }, grad);
  el("stop", { offset: "86%",  "stop-color": "#fff", "stop-opacity": "0.55" }, grad);
  el("stop", { offset: "100%", "stop-color": "#fff", "stop-opacity": "0" }, grad);

  const mask = el("mask", { id: "lensMask", maskUnits: "userSpaceOnUse" }, defs);
  maskCircle = el("circle", { cx: 0, cy: 0, r: 0, fill: "url(#lensGrad)" }, mask);

  /* Grain de film : léger bruit, seulement dans la lentille. */
  const grainFilter = el("filter", { id: "lensGrain", x: "0%", y: "0%", width: "100%", height: "100%" }, defs);
  el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.85", numOctaves: "2", result: "n" }, grainFilter);
  el("feColorMatrix", { type: "saturate", values: "0", in: "n", result: "g" }, grainFilter);

  /* Assombrissement de la peau sous la lentille (dessiné SOUS l'anatomie). */
  const dimG = el("g", { id: "lensDim", mask: "url(#lensMask)" });
  overlay.insertBefore(dimG, layerRoot);
  dimCircle = el("circle", { cx: 0, cy: 0, r: 0, fill: "#040a10", opacity: "0.62" }, dimG);
  grainRect = el("circle", { cx: 0, cy: 0, r: 0, filter: "url(#lensGrain)", opacity: "0.16" }, dimG);

  /* Anneau et halo, dessinés PAR-DESSUS tout. */
  ringG = el("g", { id: "lensRing" }, overlay);
  el("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: "#4fc3f7",
                 "stroke-width": 2.5, opacity: "0.85", class: "lens-ring" }, ringG);
  el("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: "#4fc3f7",
                 "stroke-width": 9, opacity: "0.14", class: "lens-halo" }, ringG);

  setEnabled(false);
}

function setDims(d) { dims = d; refresh(); }
function setMirrored(m) { mirrored = m; }
function isEnabled() { return enabled; }

function setEnabled(on) {
  enabled = on;
  if (!layerRoot) return;
  layerRoot.setAttribute("mask", on ? "url(#lensMask)" : "");
  if (!on) layerRoot.removeAttribute("mask");
  document.getElementById("lensDim").style.display = on ? "" : "none";
  ringG.style.display = on ? "" : "none";
  refresh();
}

/* Convertit un point de l'écran vers le repère vidéo, en tenant compte du
   miroir et du recadrage « cover » (le cadre déborde du viewport). */
function setCenterFromClient(clientX, clientY) {
  if (!frameEl) return;
  const r = frameEl.getBoundingClientRect();
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

  for (const n of [dimCircle, grainRect]) {
    n.setAttribute("cx", x); n.setAttribute("cy", y); n.setAttribute("r", radius);
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
  setRadiusFrac, getRadiusFrac, nudgeRadius, setMirrored, centerOnVideoPoint, refresh
};

})();
