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

/* Version affichée à l'écran. Sans elle, impossible de savoir ce que le
   téléphone du chef exécute réellement — et « c'est pareil qu'avant » devient
   indiagnosticable. Lue depuis le ?v= de ce script même, donc jamais périmée. */
const VERSION = (() => {
  const s = document.querySelector('script[src*="mirror.js"]');
  const m = s && s.src.match(/[?&]v=(\d+)/);
  return m ? "v" + m[1] : "v?";
})();

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

/* La version s'affiche dès le chargement de la page, avant même la caméra :
   c'est la première chose à pouvoir vérifier quand un écran « ne change pas ». */
{
  const g = document.getElementById("versionBig");
  if (g) g.textContent = VERSION;
}

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
      numPoses: 1,
      // Landmarks en mètres, origine au centre des hanches : c'est ce qui
      // permet au moteur 3D de poser une anatomie à la bonne échelle et à la
      // bonne profondeur, au lieu de l'estimer depuis la largeur d'épaules.
      outputWorldLandmarks: true
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
  lentilleSuitLaMain = false;   // dès qu'on la déplace à la main, on reprend la main
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
  /* La distance propose, les boutons décident : toucher une couche à la main
     coupe l'automatisme. Sans ça on retirerait le contrôle à l'utilisateur. */
  if (PROF && PROF.isEnabled()) {
    PROF.setEnabled(false);
    profTool.classList.remove("on");
    detectEl.textContent = "Navigation par distance arrêtée — tu reprends la main.";
  }
  applyDepthOpacity();
  if (xrayOn && XRAY && COUVERTURE_3D[key]) XRAY.setLayer(key, active[key]);
  if (xrayOn) appliquerVisibiliteSVG();
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

/* Affiche où l'on en est dans la descente : « muscles → nerfs 40 % » se lit
   bien mieux qu'un simple nom de couche pendant un fondu. */
function etatProfondeur() {
  if (!PROF || !PROF.isEnabled()) return "";
  const e = PROF.etat();
  if (!e || !e.sortante) return " · distance ON";
  const nom = k => (LAYER_META.find(m => m.key === k) || {}).label || k;
  if (e.t <= 0.01) return " · " + nom(e.sortante);
  if (e.t >= 0.99) return " · " + nom(e.entrante);
  return " · " + nom(e.sortante) + " → " + nom(e.entrante) + " " + Math.round(e.t * 100) + " %";
}

function updateHud() {
  const on = LAYER_META.filter(m => active[m.key]).map(m => m.label);
  document.getElementById("layersOn").textContent = on.length ? on.join(" + ") : "aucune";
  const v = document.getElementById("version");
  if (v) v.textContent = VERSION;
  const g = document.getElementById("versionBig");
  if (g) g.textContent = VERSION;

  /* Diagnostic lisible à l'écran. Sans lui, quand le chef dit « c'est pareil
     qu'avant », personne ne peut savoir si le moteur 3D tourne, s'il a chargé
     ses modèles, ou s'il est retombé sur le schéma. On devinait. */
  const d = document.getElementById("diag");
  if (d) {
    const moteur = !XRAY ? "absent"
                 : xrayLoading ? "chargement…"
                 : XRAY.isReady() ? (xrayOn ? "3D ACTIVE" : "prêt mais éteint")
                 : "non initialisé";
    const os = XRAY && XRAY.hasAssets ? (XRAY.hasAssets("bones") ? "oui" : "non") : "?";

    /* Combien de points du corps sont réellement exploitables, et quels
       repères ont pu être construits. C'est ce qui manque pour comprendre
       « je ne vois rien quand je m'approche » : si les hanches sortent du
       cadre, le repère du tronc peut ne plus se construire. */
    let pts = "—", reperes = "—";
    if (PTS) {
      pts = PTS.filter(p => vis(p)).length + "/33";
      const r = [];
      if (FRAMES.head) r.push("tête");
      if (FRAMES.torso) r.push("tronc");
      if (FRAMES.pelvis) r.push("bassin");
      reperes = r.length ? r.join("+") : "AUCUN";
    }
    const cam = facing === "user" ? "avant" : "arrière";
    if (handOn || handLoading) {
      /* En mode main, l'état du corps n'apprend rien. Ce qu'il faut savoir,
         c'est si le détecteur est chargé et s'il voit une main. */
      const det = handLoading ? "TÉLÉCHARGEMENT…" : (handLandmarker ? "PRÊT" : "absent");

      /* Ce qui est POSÉ à l'écran, et pas seulement ce qui est détecté :
         c'est ce qui départage « le détecteur ne voit rien » de « il voit mais
         rien ne s'affiche », donc l'amont de l'aval. */
      let posees = "";
      try {
        const dh = HAND && HAND.debugHands ? HAND.debugHands() : null;
        if (dh && dh.length) {
          posees = " · posées " + dh.map(h => h.side.toUpperCase() + (h.visible ? "✓" : "✗")).join(" ");
        }
      } catch { /* diagnostic : ne doit jamais casser l'app */ }

      d.textContent = "MAIN · cam " + cam + " · détecteur " + det
                    + " · mains vues " + mainsVues + posees;
    } else {
      d.textContent = "corps · cam " + cam + " · " + moteur
                    + " · os " + os + " · points " + pts + " · repères " + reperes;
    }
  }
  const hybride = xrayOn && LAYER_META.some(m => active[m.key] && !COUVERTURE_3D[m.key]);
  document.getElementById("lensState").textContent =
    (xrayOn ? (hybride ? "3D réelle + schéma" : "3D réelle") : "schéma") +
    (handOn ? " · MAIN" + (lentilleSuitLaMain ? " (lentille auto)" : "") : "") +
    (GROS_PLAN.head.visible ? " · tête détaillée" : "") +
    (GROS_PLAN.arm.visible ? " · bras détaillé" : "") +
    etatProfondeur() +
    (LENS.isEnabled() ? " · lentille ON" : " · lentille OFF") +
    (SEG.isEnabled() ? " · silhouette ON" : "");
}

/* ---------------------------------------------------------- Outils (haut) */
document.getElementById("opacity").addEventListener("input", e => {
  layerRoot.style.opacity = e.target.value / 100;
});
document.getElementById("mirrorTool").addEventListener("click", () => appliquerMiroir(!mirrored));

/* ------------------------------------------------- Moteur 3D (Ada) ------
   Chargé à la demande : three.js + les modèles pèsent ~14 Mo, inutile de les
   imposer à qui veut juste le schéma. Quand la 3D est active, les couches SVG
   s'effacent — les deux représentent la même chose. */
const XRAY = window.MIROIR_XRAY;
const xrayCanvas = document.getElementById("xrayCanvas");
let xrayOn = false, xrayLoading = false;

/* Toutes les couches n'existent pas en 3D. Z-Anatomy ne contient ni nerfs ni
   vaisseaux des membres : sa collection « cardiovasculaire » est le cœur seul,
   et sa collection « nerveuse » le cerveau. Plutôt que d'amputer ces deux
   couches, on garde leur tracé SVG même en mode 3D — mieux vaut un schéma
   juste qu'un vide. Les autres couches basculent en géométrie réelle. */
const COUVERTURE_3D = { bones: true, muscles: true, organs: true,
                        nerves: false, vessels: false };

function appliquerVisibiliteSVG() {
  for (const key of LAYER_ORDER) {
    const cacheParLa3D = xrayOn && COUVERTURE_3D[key];
    groups[key].root.style.display = cacheParLa3D ? "none" : "";
  }
}

/* Allumage automatique au démarrage, sans bloquer l'affichage : la caméra doit
   apparaître tout de suite, l'anatomie arrive quand elle est prête. */
async function demarrerAnatomieReelle() {
  if (!XRAY || xrayOn || xrayLoading) return;
  detectEl.textContent = "Chargement de l'anatomie réelle…";
  try {
    await toggle3D();
    if (xrayOn) detectEl.textContent = "Anatomie réelle active ✓";
  } catch {
    // WebGL absent, hors ligne au premier lancement, GPU refusé : le schéma
    // vectoriel reste affiché, l'app fonctionne quand même.
    detectEl.textContent = "Anatomie réelle indisponible — affichage schématique.";
  }
}

async function toggle3D() {
  if (xrayLoading) return;
  if (xrayOn) {                       // extinction
    xrayOn = false;
    xrayCanvas.classList.remove("on");
    appliquerVisibiliteSVG();
    SEG.setBesoinPng(true);            // le SVG redevient visible : masque CSS requis
    d3Tool.classList.remove("on");
    updateHud();
    return;
  }
  if (!XRAY) { detectEl.textContent = "Moteur 3D absent (modules/xray3d.js)."; return; }
  xrayLoading = true;
  d3Tool.textContent = "…";
  try {
    // Le canvas doit être VISIBLE avant d'être dimensionné : tant qu'il est en
    // display:none, sa largeur mesurée vaut 0 et le rendu sort vide.
    xrayCanvas.classList.add("on");
    if (!XRAY.isReady()) await XRAY.init({ canvas: xrayCanvas, videoEl: video });
    XRAY.setDims(dims);
    XRAY.setMirrored(mirrored);
    // On n'allume que les couches déjà cochées, en commençant par les os :
    // c'est le seul système entièrement articulé à ce jour.
    for (const { key } of LAYER_META) {
      if (COUVERTURE_3D[key]) await XRAY.setLayer(key, active[key]);
    }
    xrayOn = true;
    appliquerVisibiliteSVG();          // le SVG ne cède que là où la 3D existe
    SEG.setBesoinPng(false);           // plus de SVG masqué en CSS : on économise l'encodage
    d3Tool.classList.add("on");
  } catch (e) {
    xrayCanvas.classList.remove("on");
    detectEl.textContent = "Moteur 3D : " + e.message;
  } finally {
    xrayLoading = false;
    d3Tool.textContent = "3D";
    updateHud();
  }
}

/* ------------------------------------------------------ Mode MAIN -------
   Un second détecteur, spécialisé : 21 points par main en mètres réels, contre
   4 points inexploitables dans le modèle de posture. C'est lui qui permet
   d'approcher la caméra d'une main et d'en voir les os tourner. */
const HAND = window.MIROIR_HAND;
const handCanvas = document.getElementById("handCanvas");
const MODELE_MAIN = "https://storage.googleapis.com/mediapipe-models/" +
                    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let handLandmarker = null, handOn = false, handLoading = false;

async function toggleHand() {
  if (handLoading) return;

  if (handOn) {
    handOn = false;
    handCanvas.classList.remove("on");
    handTool.classList.remove("on");
    appliquerVisibiliteSVG();     // le schéma du corps revient
    updateHud();
    return;
  }
  if (!HAND) { detectEl.textContent = "Module main absent (modules/xray_hand.js)."; return; }
  if (demoMode) { detectEl.textContent = "Mode main : il faut la caméra."; return; }

  handLoading = true;
  handTool.textContent = "…";
  try {
    if (!handLandmarker) {
      /* 7,5 Mo à télécharger. Sur un téléphone ça prend plusieurs dizaines de
         secondes, et je ne l'annonçais que par des points de suspension sur un
         bouton de quarante pixels. Le chef a donc conclu, à raison, que « la
         main n'est pas reconnue du tout » — alors que le modèle n'était pas
         encore arrivé. On le dit maintenant en clair. */
      detectEl.textContent = "Téléchargement du détecteur de main (7,5 Mo)… patiente.";
      updateHud();
      const { HandLandmarker, FilesetResolver } = await import(MEDIAPIPE_CDN);
      const files = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN + "/wasm");
      handLandmarker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODELE_MAIN, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        // Seuils abaissés : le défaut (0,5) rate les mains de profil et sous
        // éclairage faible, exactement les cas d'usage réels.
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3
      });
    }
    handCanvas.classList.add("on");
    if (!HAND.isReady()) await HAND.init({ canvas: handCanvas, videoEl: video });
    HAND.setDims(dims);
    HAND.setMirrored(mirrored);
    HAND.setDepthOcclusion(true);
    handOn = true;
    lentilleSuitLaMain = true;
    lentilleCible = null;
    // En gros plan sur la main, la lentille a du sens : elle suit la main.
    LENS.setEnabled(true);
    lensTool.classList.add("on");
    handTool.classList.add("on");
    // Le mode main est un gros plan : on éteint la 3D du corps entier, qui
    // n'apporte rien à cette distance et coûte cher sur téléphone.
    if (xrayOn) await toggle3D();
    layerRoot.style.display = "none";
    detectEl.textContent = "Détecteur prêt — montre ta main, paume ou dos, à 20–40 cm.";
  } catch (e) {
    handCanvas.classList.remove("on");
    detectEl.textContent = "Mode main : " + e.message;
  } finally {
    handLoading = false;
    handTool.textContent = "✋";
    updateHud();
  }
}

/* La lentille suit la main détectée tant que l'utilisateur n'y a pas touché.
   Sans ça, elle reste un petit disque au centre de l'écran : la main devait
   entrer dedans pour que les os apparaissent, ce qui obligeait à coller le
   téléphone. C'est exactement le défaut remonté par le chef. */
let lentilleSuitLaMain = true;

/* Alimente le module main : pose des 21 points, lentille, silhouette. */
function feedHand(now) {
  if (!handOn || !handLandmarker || !HAND) return;
  let res;
  try { res = handLandmarker.detectForVideo(video, now); }
  catch { return; }

  /* ⚠️ Ne JAMAIS filtrer les points de main sur `visibility` : MediaPipe ne
     remplit ce champ que pour la posture, il vaut 0 sur tous les points de
     main. Un filtre comme celui du corps (`vis()`) jetterait absolument tout.
     Vérifié par Ada sur image réelle. */
  const mains = res.landmarks || [];
  mainsVues = mains.length;

  if (mains.length && lentilleSuitLaMain) cadrerSurLaMain(mains[0]);

  HAND.setLens(LENS.getState());
  HAND.update({
    landmarks:        mains,
    worldLandmarks:   res.worldLandmarks || [],
    handedness:       res.handedness || res.handednesses || [],
    segmentationMask: SEG.isEnabled() ? SEG.getCanvas() : null
  });
}
let mainsVues = 0;

/* Centre et dimensionne la lentille sur la main, avec un lissage : un
   recadrage instantané à chaque image donnerait une lentille qui tremble. */
let lentilleCible = null;
function cadrerSurLaMain(pts) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2 * dims.W;
  const cy = (minY + maxY) / 2 * dims.H;
  // rayon englobant la main, avec de la marge pour le poignet
  const demiDiag = Math.hypot((maxX - minX) * dims.W, (maxY - minY) * dims.H) / 2;
  const frac = Math.min(Math.max(demiDiag * 1.45 / Math.min(dims.W, dims.H), 0.14), 0.6);

  if (!lentilleCible) lentilleCible = { x: cx, y: cy, f: frac };
  const A = 0.25;                       // lissage exponentiel
  lentilleCible.x += A * (cx - lentilleCible.x);
  lentilleCible.y += A * (cy - lentilleCible.y);
  lentilleCible.f += A * (frac - lentilleCible.f);

  LENS.centerOnVideoPoint(lentilleCible.x, lentilleCible.y);
  LENS.setRadiusFrac(lentilleCible.f);
}

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

const d3Tool = document.getElementById("d3Tool");
d3Tool.addEventListener("click", toggle3D);

const handTool = document.getElementById("handTool");
handTool.addEventListener("click", toggleHand);

/* Navigation par distance : approcher le téléphone descend plus profond.
   Éteinte par défaut — c'est un mode qu'on choisit, pas un comportement subi. */
const PROF = window.MIROIR_PROF;
const profTool = document.getElementById("profTool");
profTool.addEventListener("click", () => {
  if (!PROF) return;
  if (!xrayOn) { detectEl.textContent = "Navigation par distance : allume d'abord la 3D."; return; }
  const on = !PROF.isEnabled();
  PROF.setEnabled(on);
  profTool.classList.toggle("on", on);
  detectEl.textContent = on
    ? "Approche ou éloigne le téléphone pour changer de profondeur."
    : "Navigation par distance arrêtée.";
  updateHud();
});

/* Étiquettes anatomiques : le nom de la structure regardée, quelques secondes.
   Ne sert à rien tant qu'aucun moteur 3D ne tourne — c'est lui qui sait
   nommer ce qu'il y a sous le point observé. */
const ETIQ = window.MIROIR_ETIQ;
if (ETIQ) ETIQ.init({ frameEl: frame });

const nomTool = document.getElementById("nomTool");
nomTool.addEventListener("click", () => {
  if (!ETIQ) return;
  const on = !ETIQ.isEnabled();
  if (on && !xrayOn && !handOn) {
    detectEl.textContent = "Nommage : allume d'abord la 3D ou le mode main.";
    return;
  }
  ETIQ.setEnabled(on);
  nomTool.classList.toggle("on", on);
  updateHud();
});

/* Le module qui sait nommer : la main prime quand elle est active, c'est
   qu'on regarde de près. */
function sourceNommage() {
  if (handOn && HAND && HAND.isReady()) return HAND;
  if (xrayOn && XRAY && XRAY.isReady()) return XRAY;
  return null;
}

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
/* Un seul endroit pour propager le mode miroir, sinon on en oublie un.
   C'est précisément ce qui s'est passé : changer de caméra basculait `mirrored`
   pour la vidéo et le SVG, mais ne le disait NI au moteur 3D NI au module main.
   Les os étaient donc calculés dans un repère inversé par rapport à l'image —
   d'où « en caméra arrière les mains sont complètement perdues ». */
function appliquerMiroir(m) {
  mirrored = m;
  video.classList.toggle("mirrored", mirrored);
  overlay.classList.toggle("mirrored", mirrored);
  document.getElementById("mirrorTool").classList.toggle("on", mirrored);
  LENS.setMirrored(mirrored);
  if (XRAY && XRAY.isReady()) XRAY.setMirrored(mirrored);
  if (HAND && HAND.isReady()) HAND.setMirrored(mirrored);
}

async function switchCamera() {
  if (demoMode) return;
  facing = facing === "user" ? "environment" : "user";
  // Caméra avant = miroir (on se regarde) ; caméra arrière = vue directe.
  appliquerMiroir(facing === "user");
  await startCamera();

  /* La caméra arrière ne sert jamais à se regarder en entier : on la pointe
     sur sa propre main, sur le bras de quelqu'un. Or en mode corps, MediaPipe
     ne dit jamais « je ne vois pas de corps » — il en invente un à partir
     d'une main, et l'app pose alors un squelette entier sur quelques doigts.
     C'est ce que le chef décrit : « en caméra arrière les mains sont
     complètement perdues », avec un diagnostic qui annonce pourtant
     tête + tronc + bassin. */
  if (facing === "environment" && !handOn && HAND) {
    // On ne se contente plus de suggérer : passer en caméra arrière EST la
    // demande de voir une main. On lance donc le téléchargement et la bascule.
    await toggleHand();
  } else if (facing === "user" && handOn) {
    await toggleHand();                      // retour au corps entier
  }
}

document.getElementById("startBtn").addEventListener("click", startCamera);

/* Purge complète : désinscrit le service worker et vide tous les caches, puis
   recharge. Le seul moyen sûr de sortir d'une version bloquée sur un
   téléphone, sans avoir à fouiller les réglages du navigateur. */
document.getElementById("purgeBtn")?.addEventListener("click", async e => {
  const b = e.currentTarget;
  b.textContent = "Purge en cours…";
  try {
    if ("serviceWorker" in navigator) {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map(r => r.unregister()));
    }
    if (window.caches) {
      const noms = await caches.keys();
      await Promise.all(noms.map(n => caches.delete(n)));
    }
  } catch { /* rien à faire de plus : on recharge quand même */ }
  location.replace(location.pathname + "?purge=" + Date.now());
});
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

  /* L'anatomie réelle s'allume SEULE. Elle était derrière un bouton, éteinte
     par défaut : le chef a donc jugé l'app sur le schéma vectoriel pendant
     toute une journée, sans jamais voir ce qu'on avait construit. Le schéma
     redevient ce qu'il aurait toujours dû être — un repli. */
  demarrerAnatomieReelle();
  /* Lentille ÉTEINTE au démarrage. Elle était allumée par défaut, en petit
     disque de 26 % au centre : sur un corps entier vu à deux mètres, elle ne
     révélait qu'une pastille d'anatomie et masquait tout le reste. C'est la
     même cause que le « il faut trop rapprocher le téléphone » du mode main,
     que je n'avais corrigée que pour la main. Par défaut, on montre TOUT ;
     la lentille devient un effet qu'on choisit. */
  LENS.setMirrored(mirrored);
  LENS.setEnabled(false);
  lensTool.classList.remove("on");
  updateHud();
  if (!running) { running = true; requestAnimationFrame(loop); }
}

/* Le mannequin de démo prend le format de l'écran, pour remplir la page
   aussi bien sur un téléphone en portrait que sur un écran de PC. */
/* Un onglet en arrière-plan ou une rotation en cours peut renvoyer un viewport
   de 0×0 : sans garde, le rapport devient NaN et tout le rendu part en vrille. */
function viewport() {
  return { w: Math.max(window.innerWidth || 0, 1), h: Math.max(window.innerHeight || 0, 1) };
}

function setDemoDims() {
  const { w, h } = viewport();
  // 0.62 minimum : en dessous, le mannequin bras écartés sortirait du cadre.
  const ratio = Math.min(Math.max(w / h, 0.62), 1.9);
  dims = { W: Math.round(900 * ratio), H: 900 };
}

function fitFrame() {
  const { w: ww, h: wh } = viewport();

  /* « contain » dans tous les cas. J'avais mis « cover » pour la caméra, pour
     remplir l'écran sans bandes noires — mauvaise idée sur deux plans :
       — ça ROGNE les côtés, donc il faut reculer davantage pour tenir dans le
         cadre, ce qui aggravait le « il faut tenir le téléphone trop loin » ;
       — dès que le cadre et l'image ne partagent plus exactement le même
         rapport, l'anatomie s'étire, et le chef l'a vu : « tout est compressé
         sur l'axe vertical ».
     Des bandes noires valent mieux qu'une image fausse. */
  const scale = Math.min(ww / dims.W, wh / dims.H);
  frame.style.width  = (dims.W * scale) + "px";
  frame.style.height = (dims.H * scale) + "px";
  overlay.setAttribute("viewBox", `0 0 ${dims.W} ${dims.H}`);
  LENS.setDims(dims);

  /* Les moteurs 3D se dimensionnent sur la taille RENDUE du canvas. Il faut
     donc les prévenir APRÈS que le navigateur a appliqué la nouvelle taille du
     cadre, sinon ils mesurent l'ancienne — ou zéro — et l'image sort déformée. */
  requestAnimationFrame(() => {
    if (XRAY && XRAY.isReady()) XRAY.setDims(dims);
    if (HAND && HAND.isReady()) HAND.setDims(dims);
  });
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
    const lm = demoLandmarks(now);
    update(lm);
    // Le mannequin pilote aussi la 3D : sans world landmarks, le moteur
    // retombe sur une échelle estimée depuis la largeur d'épaules.
    feed3D({ landmarks: [lm], worldLandmarks: null });
    tickFps(now, " (démo)");
  } else if (video.currentTime !== lastT && video.videoWidth > 0) {
    lastT = video.currentTime;

    if (handOn) {
      // Gros plan sur la main : la détection du corps entier ne sert à rien
      // ici et coûte cher sur téléphone. On ne fait tourner que la main.
      feedHand(now);
      detectEl.textContent = mainsVues
        ? (mainsVues > 1 ? "Deux mains détectées ✓" : "Main détectée ✓")
        : "Aucune main dans le cadre — montre ta paume ou le dos de ta main.";
    } else if (landmarker) {
      const res = landmarker.detectForVideo(video, now);
      update(res.landmarks?.[0] || null);
      SEG.process(video, now);
      feed3D(res);
    }
    if (ETIQ) ETIQ.tick(now, sourceNommage());
    tickFps(now, "");
  }
  requestAnimationFrame(loop);
}
/* ------------------------------------------------- Surcouches gros plan --
   La tête et le bras existent en pleine définition, mais pèsent lourd (6,6 Mo
   pour la tête). On ne les charge donc que lorsqu'on s'en approche vraiment.

   Deux seuils par structure, et non un seul : on PRÉCHARGE bien avant
   d'AFFICHER, pour que le téléchargement soit fini quand l'utilisateur arrive.
   Et le seuil de sortie est plus bas que celui d'entrée, sinon la surcouche
   clignoterait à la moindre oscillation. */
const GROS_PLAN = {
  head: { precharge: 0.15, entre: 0.21, sort: 0.17, chargee: false, visible: false },
  arm:  { precharge: 0.26, entre: 0.36, sort: 0.30, chargee: false, visible: false }
};

function tailleRelative(a, b) {
  const pa = PTS[a], pb = PTS[b];
  if (!vis(pa) || !vis(pb)) return null;
  return Math.hypot(pb.x - pa.x, pb.y - pa.y) / Math.min(dims.W, dims.H);
}

function gererGrosPlan() {
  if (!xrayOn || !XRAY || !PTS) return;

  // La tête se mesure à l'écart des oreilles, l'avant-bras du coude au poignet.
  evaluer("head", tailleRelative(7, 8));
  evaluer("arm", Math.max(tailleRelative(14, 16) ?? 0, tailleRelative(13, 15) ?? 0) || null);

  // Navigation par distance : la largeur d'épaules apparente dit la proximité.
  if (PROF && PROF.isEnabled()) PROF.update(tailleRelative(11, 12));
}

function evaluer(cle, taille) {
  const g = GROS_PLAN[cle];
  if (taille === null) return;

  if (!g.chargee && taille > g.precharge) {
    g.chargee = true;                       // une seule fois
    XRAY.loadLayer?.(cle);
    detectEl.textContent = "Préparation du détail…";
  }
  if (!g.visible && taille > g.entre) {
    g.visible = true;
    XRAY.setLayer(cle, true);
    updateHud();
  } else if (g.visible && taille < g.sort) {
    g.visible = false;
    XRAY.setLayer(cle, false);
    updateHud();
  }
}

/* Transmet au moteur 3D la pose, la lentille et la silhouette. */
function feed3D(res) {
  if (!xrayOn || !XRAY) return;
  const L = LENS.getState();
  XRAY.setLens({ enabled: L.enabled, cx: L.cx, cy: L.cy, radius: L.radius, feather: L.feather });
  XRAY.update({
    landmarks:        res.landmarks?.[0] || null,
    worldLandmarks:   res.worldLandmarks?.[0] || null,
    segmentationMask: SEG.isEnabled() ? SEG.getCanvas() : null
  });
}

function tickFps(now, suffix) {
  frames++;
  if (now - fpsT > 1000) {
    fpsEl.textContent = frames + " i/s" + suffix;
    frames = 0; fpsT = now;
  }
}

/* Le diagnostic tourne sur son PROPRE minuteur, pas sur la boucle de rendu :
   si celle-ci se bloque — onglet en arrière-plan, GPU perdu, moteur planté —
   c'est exactement le moment où l'on a besoin de lire l'état, et un diagnostic
   figé sur la dernière image utile ne sert à rien. */
setInterval(() => { try { updateHud(); } catch {} }, 1000);

function hideAll() {
  for (const key of LAYER_ORDER)
    for (const p of groups[key].pieces) p.node.setAttribute("visibility", "hidden");
}

/* Quand le corps disparaît du cadre, c'est le plus souvent qu'on s'est
   approché — donc exactement le moment où le mode main sert. On le signale au
   lieu de laisser l'écran vide, mais on ne le déclenche PAS tout seul : le
   modèle de main pèse plusieurs mégaoctets, on ne l'impose pas sans un geste. */
let sansCorpsDepuis = 0;

function update(raw) {
  if (!raw) {
    hideAll(); smooth = null; PTS = null;
    if (!sansCorpsDepuis) sansCorpsDepuis = performance.now();
    const perdu = performance.now() - sansCorpsDepuis;
    detectEl.textContent = (perdu > 2500 && !handOn && HAND)
      ? "Trop près pour le corps entier — touche ✋ pour voir les os de ta main."
      : "Personne non détectée — recule pour être vu en entier.";
    return;
  }
  sansCorpsDepuis = 0;
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
  gererGrosPlan();
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
  onFrame() { if (window.MIROIR_AID?.onFrame) window.MIROIR_AID.onFrame(); },
  get dims() { return dims; }
};

})();
