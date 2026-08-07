/* =========================================================================
   XRAY3D — moteur anatomique 3D photoréaliste (module livré par Ada)
   three.js par-dessus la vidéo : géométrie réelle éclairée, posée sur les
   landmarks MediaPipe (2D pour l'ancrage écran, world 3D pour l'orientation
   et la profondeur). Contrat window.MIROIR_XRAY du brief de Marie 07.08.
   v0 : squelette en volumes primitifs — les GLB Z-Anatomy (feu vert chef
   requis) se brancheront dans loadLayerAssets() sans changer le contrat.
   ========================================================================= */

(function () {

/* three.js en import() dynamique (+esm résout les imports internes) : le
   fichier reste un script classique et l'app continue de marcher en file://.
   GLTFLoader (pour les GLB Z-Anatomy) se chargera par le même canal. */
const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.166.1/+esm";
const THREE_CDN_EXAMPLES = "https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/";

const LAYER_KEYS = ["bones", "muscles", "nerves", "organs", "vessels"];

let THREE = null;
let renderer = null, scene = null, camera = null, dirLight = null;
let canvas = null, videoEl = null;
let ready = false;
let dims = { W: 1280, H: 720 };
let mirrored = true;
let opacity = 1;
let lens = { enabled: false, cx: 0, cy: 0, radius: 0, feather: 30 };

const groups = {};               // key → THREE.Group
const pieces = [];               // { kind, a, b, r, mesh } — posés à chaque update

/* --------------------------------------------------------------- Init */
async function init(ctx) {
  canvas  = ctx.canvas;
  videoEl = ctx.videoEl || null;
  if (ctx.assetsDir) ASSETS_DIR = ctx.assetsDir;
  const progress = ctx.onProgress || (() => {});

  progress("three.js…", 0.1);
  THREE = await import(THREE_CDN);
  initScratch();

  progress("scène…", 0.5);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  /* Caméra orthographique dans le repère vidéo : x ∈ [0,W], y ∈ [0,-H]
     (y écran vers le bas = y monde négatif), z vers la caméra. */
  camera = new THREE.OrthographicCamera(0, dims.W, 0, -dims.H, -4000, 4000);

  /* Éclairage : ciel doux + directionnelle haut-gauche. (v1 : orienter la
     directionnelle sur la dominante lumineuse de l'image vidéo.) */
  scene.add(new THREE.HemisphereLight(0xcfe0ee, 0x1a2530, 0.85));
  dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
  dirLight.position.set(-0.4, 0.8, 1.0);
  scene.add(dirLight);

  for (const key of LAYER_KEYS) {
    groups[key] = new THREE.Group();
    groups[key].visible = key === "bones";
    scene.add(groups[key]);
  }

  buildCompose();

  progress("squelette…", 0.8);
  buildSkeletonPlaceholder();

  applyDims();
  ready = true;
  progress("prêt", 1);
}

/* ============================ Assets Z-Anatomy (GLB + rig) ================
   Un GLB par système, découpé en RÉGIONS corporelles par le pipeline
   scripts/export_zanatomy.py, accompagné d'un <clé>.rig.json qui donne pour
   chaque région ses points d'ancrage (a = extrémité proximale, b = distale)
   dans le repère du modèle (Y-up, mètres, échelle humaine réelle : 1,70 m).

   Chaque région est posée par une transformation rigide qui envoie son
   segment de repos (a→b) sur le segment correspondant des landmarks. Les
   régions du tronc (tête, cou, torse, bassin) partagent une seule
   transformation « corps », ce qui les garde solidaires entre elles. */

let ASSETS_DIR = "assets/anatomy/";     // surchargeable via init({ assetsDir })

/* région → ancrage. "seg" : deux landmarks. "body" : suit la transformation
   globale du tronc (mi-épaules → mi-hanches). */
const BINDINGS = {
  head:  { type: "body" }, neck: { type: "body" },
  torso: { type: "body" }, pelvis: { type: "body" },
  "upperarm.l": { type: "seg", a: 11, b: 13 }, "upperarm.r": { type: "seg", a: 12, b: 14 },
  "forearm.l":  { type: "seg", a: 13, b: 15 }, "forearm.r":  { type: "seg", a: 14, b: 16 },
  "hand.l":     { type: "seg", a: 15, b: 19 }, "hand.r":     { type: "seg", a: 16, b: 20 },
  "thigh.l":    { type: "seg", a: 23, b: 25 }, "thigh.r":    { type: "seg", a: 24, b: 26 },
  "shank.l":    { type: "seg", a: 25, b: 27 }, "shank.r":    { type: "seg", a: 26, b: 28 },
  // pied : a = orteils (axe +Z du modèle), b = cheville → landmarks inversés
  "foot.l":     { type: "seg", a: 31, b: 27 }, "foot.r":     { type: "seg", a: 32, b: 28 },
};

const regions = [];        // { name, mesh, bind, aRest, bRest, layer }
let bodyRest = null;       // { top, bottom } du modèle au repos (mi-épaules / mi-hanches)

/* Charge un système : <clé>.glb + <clé>.rig.json. Rien n'est téléchargé
   depuis le réseau : les fichiers viennent de app/assets/anatomy/. */
async function loadLayer(key, onProgress) {
  if (groups[key] && groups[key].userData.loaded) return true;
  const { GLTFLoader } = await import(THREE_CDN_EXAMPLES + "loaders/GLTFLoader.js/+esm");
  onProgress && onProgress(key + " : géométrie…", 0.3);

  const [gltf, rig] = await Promise.all([
    new GLTFLoader().loadAsync(ASSETS_DIR + key + ".glb"),
    fetch(ASSETS_DIR + key + ".rig.json").then(r => r.json()),
    loadParts(key),          // table de nommage, en parallèle (échec toléré)
  ]);

  /* Les couleurs de tissu sont peintes par sommet à l'export (COLOR_0) : un
     seul matériau suffit pour toute une région, et les organes restent
     distinguables. `color` blanc pour ne pas teinter l'attribut. */
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.55, metalness: 0.05,
    transparent: true, opacity, vertexColors: true,
  });

  /* Une région jointe ressort en plusieurs primitives glTF (une par matériau),
     nommées « région », « région_1 », « région_2 »… et l'exportateur RETIRE
     les points : « foot.l » devient « footl ». On compare donc des noms
     réduits aux seuls caractères alphanumériques, par préfixe. */
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const buckets = new Map();
  for (const rk of Object.keys(rig.regions)) buckets.set(norm(rk), { key: rk, meshes: [] });

  const orphans = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const n = norm(o.name);
    let hit = null;
    for (const [pfx, b] of buckets) {
      if (n === pfx || n.startsWith(pfx)) {
        if (!hit || pfx.length > norm(hit.key).length) hit = b;   // préfixe le plus long
      }
    }
    if (hit) hit.meshes.push(o); else orphans.push(o.name);
  });
  if (orphans.length) console.warn("[xray3d] " + orphans.length + " maillage(s) hors région :", orphans.slice(0, 5));

  for (const [, b] of buckets) {
    if (!b.meshes.length) continue;
    const r = rig.regions[b.key];
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    for (const m of b.meshes) { m.material = mat; holder.add(m); }
    groups[key].add(holder);
    regions.push({
      name: b.key, mesh: holder, layer: key,
      bind: BINDINGS[b.key] || { type: "body" },
      aRest: new THREE.Vector3().fromArray(r.a),
      bRest: new THREE.Vector3().fromArray(r.b),
      center: new THREE.Vector3().fromArray(r.center),
    });
  }

  /* Repère de repos du corps : haut du thorax → centre du bassin.
     Le pipeline l'écrit dans chaque rig sous `body`, car seuls `bones` et
     `muscles` possèdent une région `pelvis` — sans ce repère commun, les
     couches organes / nerfs / vaisseaux n'auraient rien sur quoi se poser. */
  if (!bodyRest) {
    if (rig.body) {
      bodyRest = {
        top: new THREE.Vector3().fromArray(rig.body.top),
        bottom: new THREE.Vector3().fromArray(rig.body.bottom),
      };
    } else {
      const t = rig.regions.torso, p = rig.regions.pelvis;   // rigs d'avant
      if (t && p) {
        bodyRest = {
          top: new THREE.Vector3().fromArray(t.a),
          bottom: new THREE.Vector3().fromArray(p.center),
        };
      } else {
        console.warn("[xray3d] rig " + key + " sans repère `body` : régénère "
                     + "les assets avec scripts/export_zanatomy.py");
      }
    }
  }
  groups[key].userData.loaded = true;
  onProgress && onProgress(key + " : prêt", 1);
  return true;
}

/* ------------------------------------------ Squelette de repli (primitives)
   Utilisé tant que les GLB ne sont pas exportés : volumes simples mais vraie
   3D éclairée, pour valider ancrage, orientation et perfs. */
const BONE_MAT = () => new THREE.MeshStandardMaterial({
  color: 0xece4d4, roughness: 0.55, metalness: 0.05,
  transparent: true, side: THREE.DoubleSide,
});

/* [proximal, distal, rayon en mètres] — mêmes paires que layers.js */
const SEG_BONES = [
  [12, 14, 0.034], [11, 13, 0.034],   // humérus
  [14, 16, 0.024], [13, 15, 0.024],   // avant-bras
  [24, 26, 0.044], [23, 25, 0.044],   // fémur
  [26, 28, 0.030], [25, 27, 0.030],   // tibia
  [28, 32, 0.022], [27, 31, 0.022],   // pied
];

function buildSkeletonPlaceholder() {
  const g = groups.bones;

  for (const [a, b, r] of SEG_BONES) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 4, 10), BONE_MAT());
    g.add(mesh);
    pieces.push({ kind: "seg", a, b, r, mesh });
  }
  // crâne : ellipsoïde ancré sur les oreilles (7, 8)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), BONE_MAT());
  g.add(skull);
  pieces.push({ kind: "skull", mesh: skull });
  // cage thoracique : ellipsoïde aplati épaules → mi-tronc
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), BONE_MAT());
  g.add(thorax);
  pieces.push({ kind: "thorax", mesh: thorax });
  // bassin : ellipsoïde aplati sur les hanches (23, 24)
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), BONE_MAT());
  g.add(pelvis);
  pieces.push({ kind: "pelvis", mesh: pelvis });
  // colonne : capsule fine mi-épaules → mi-hanches
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 4, 8), BONE_MAT());
  g.add(spine);
  pieces.push({ kind: "spine", mesh: spine });
}

/* Point d'entrée des futurs assets réels (après feu vert chef) :
   GLTFLoader via +esm, un .glb par système depuis app/assets/anatomy/. */
async function loadLayerAssets(/* key */) { /* Palier suivant */ }

/* ------------------------------------------------------------ Contrat */
function setDims(d) { dims = d; if (ready) applyDims(); }

function applyDims() {
  camera.left = mirrored ? dims.W : 0;
  camera.right = mirrored ? 0 : dims.W;
  camera.top = 0; camera.bottom = -dims.H;
  camera.updateProjectionMatrix();
  const cw = canvas.clientWidth || dims.W, ch = canvas.clientHeight || dims.H;
  renderer.setSize(cw, ch, false);
}

function setMirrored(m) { mirrored = m; if (ready) applyDims(); render(); }
function isReady() { return ready; }

/* Allume une couche. Les assets se chargent à la demande : le premier appel
   déclenche le chargement du GLB, la couche apparaît quand il est prêt. */
function setLayer(key, visible, onProgress) {
  if (!groups[key]) return;
  groups[key].visible = !!visible;
  if (visible && !groups[key].userData.loaded && !groups[key].userData.loading) {
    groups[key].userData.loading = true;
    loadLayer(key, onProgress)
      .catch(e => console.warn("[xray3d] assets " + key + " indisponibles :", e.message))
      .finally(() => { groups[key].userData.loading = false; render(); });
  }
  render();
}

function setOpacity(o) {
  opacity = Math.min(Math.max(o, 0), 1);
  for (const p of pieces) p.mesh.material.opacity = opacity;
  // une région est un groupe de primitives : on descend jusqu'aux matériaux
  for (const r of regions) r.mesh.traverse(o => { if (o.isMesh) o.material.opacity = opacity; });
  render();
}

/* Lentille : traitée dans la passe de composition (voir COMPOSE_FRAG), pas en
   masque CSS — ainsi le fondu se calcule en pixels écran et se combine
   proprement avec le masque de silhouette. */
function setLens(l) {
  Object.assign(lens, l || {});
  render();
}

/* ===================== Composition : lentille × silhouette ================
   La scène 3D est rendue dans une cible hors écran, puis recomposée par un
   triangle plein écran qui applique deux masques :
     — la lentille (disque adouci, fondu en pixels écran) ;
     — la silhouette fournie par le module de segmentation (blanc = personne),
       pour que l'anatomie ne déborde jamais du corps.
   Sans silhouette disponible, seule la lentille s'applique. */

let rt = null, quadScene = null, quadCam = null, composeMat = null;
let maskTex = null, maskSource = null;

const COMPOSE_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSE_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tScene, tMask;
uniform vec2  uRes;
uniform vec3  uLens;        // centre x, y (px device) et rayon
uniform float uFeather, uLensOn, uMaskOn, uMirror;

void main() {
  vec4 c = texture2D(tScene, vUv);

  if (uLensOn > 0.5) {
    float d = distance(gl_FragCoord.xy, uLens.xy);
    c *= 1.0 - smoothstep(uLens.z - uFeather, uLens.z, d);
  }

  if (uMaskOn > 0.5) {
    // le masque suit l'image caméra : en mode miroir, on inverse son abscisse
    vec2 muv = vec2(uMirror > 0.5 ? 1.0 - vUv.x : vUv.x, 1.0 - vUv.y);
    c *= texture2D(tMask, muv).r;
  }

  gl_FragColor = c;   // alpha prémultiplié : la multiplication reste correcte
}`;

function buildCompose() {
  rt = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, depthBuffer: true,
  });
  composeMat = new THREE.ShaderMaterial({
    vertexShader: COMPOSE_VERT, fragmentShader: COMPOSE_FRAG,
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: rt.texture }, tMask: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uLens: { value: new THREE.Vector3(0, 0, 0) },
      uFeather: { value: 30 }, uLensOn: { value: 0 },
      uMaskOn: { value: 0 }, uMirror: { value: 1 },
    },
  });
  // triangle plein écran (moins de fragments qu'un quad, et pas de couture)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(
    new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(geo, composeMat));
  quadCam = new THREE.Camera();
}

/* Le masque de silhouette est un <canvas> tenu à jour par le module de
   segmentation : on l'enveloppe une fois en texture, puis on signale
   simplement qu'elle a changé à chaque image. */
function setMaskSource(cv) {
  if (cv === maskSource) return;
  maskSource = cv || null;
  if (maskTex) { maskTex.dispose(); maskTex = null; }
  if (maskSource) {
    maskTex = new THREE.CanvasTexture(maskSource);
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.magFilter = THREE.LinearFilter;
  }
  if (composeMat) {
    composeMat.uniforms.tMask.value = maskTex;
    composeMat.uniforms.uMaskOn.value = maskTex ? 1 : 0;
  }
}

/* ------------------------------------------------- Pose à chaque image */
const visOk = (p, t = 0.45) => p && (p.visibility ?? 1) > t;

function update(res) {
  if (!ready || !res || !res.landmarks) return;
  const lm = res.landmarks, wl = res.worldLandmarks || null;
  // segmentationMask : le <canvas> de MIROIR_SEG.getCanvas(), ou null
  if (res.segmentationMask !== undefined) setMaskSource(res.segmentationMask);

  const px = i => ({ x: lm[i].x * dims.W, y: lm[i].y * dims.H, v: lm[i].visibility ?? 1 });

  /* Échelle px/mètre : largeur d'épaules à l'écran / largeur d'épaules monde. */
  const shL = px(11), shR = px(12);
  const shPx = Math.hypot(shL.x - shR.x, shL.y - shR.y);
  let ppm = 500;
  if (wl && shPx > 1) {
    const wm = Math.hypot(wl[11].x - wl[12].x, wl[11].y - wl[12].y, wl[11].z - wl[12].z);
    if (wm > 0.05) ppm = shPx / wm;
  } else if (shPx > 1) ppm = shPx / 0.36;

  const P = new THREE.Vector3(), Q = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), DIR = new THREE.Vector3();

  const place3 = (i, out) => {
    const p = px(i);
    const z = wl ? -wl[i].z * ppm : 0;         // z MediaPipe négatif vers la caméra
    out.set(p.x, -p.y, z);
    return p.v;
  };

  /* ---- Régions Z-Anatomy : transformation rigide segment→segment ---- */
  if (regions.length) {
    poseRegions(place3, ppm);
    // les primitives de repli s'effacent dès que la vraie géométrie est là
    for (const pc of pieces) pc.mesh.visible = false;
    render();
    return;
  }

  for (const pc of pieces) {
    const mesh = pc.mesh;
    if (pc.kind === "seg") {
      const va = place3(pc.a, P), vb = place3(pc.b, Q);
      if (!visOk({ visibility: va }) || !visOk({ visibility: vb })) { mesh.visible = false; continue; }
      mesh.visible = groups.bones.visible;
      DIR.subVectors(Q, P);
      const len = DIR.length();
      mesh.position.copy(P).addScaledVector(DIR, 0.5);
      mesh.quaternion.setFromUnitVectors(UP, DIR.normalize());
      const r = pc.r * ppm;
      mesh.scale.set(r, Math.max(len - r, 1) / 3, r);   // capsule(1,1) ≈ hauteur 3
    } else if (pc.kind === "skull") {
      const ve = place3(7, P), vf = place3(8, Q);
      if (!visOk({ visibility: ve }) || !visOk({ visibility: vf })) { mesh.visible = false; continue; }
      mesh.visible = groups.bones.visible;
      mesh.position.copy(P).add(Q).multiplyScalar(0.5);
      const rr = Math.max(P.distanceTo(Q) * 0.72, shPx * 0.2);
      mesh.scale.set(rr, rr * 1.18, rr * 0.85);
    } else if (pc.kind === "thorax") {
      const v1 = place3(11, P), v2 = place3(12, Q);
      const hL = px(23), hR = px(24);
      if (!visOk({ visibility: v1 }) || !visOk({ visibility: v2 })) { mesh.visible = false; continue; }
      mesh.visible = groups.bones.visible;
      const cx = (P.x + Q.x) / 2, cy = (P.y + Q.y) / 2, cz = (P.z + Q.z) / 2;
      const hipY = -(hL.y + hR.y) / 2;
      const trunk = Math.abs(hipY - cy);
      mesh.position.set(cx, cy + (hipY - cy) * 0.28, cz);
      mesh.scale.set(shPx * 0.52, trunk * 0.34, shPx * 0.30);
    } else if (pc.kind === "pelvis") {
      const v1 = place3(23, P), v2 = place3(24, Q);
      if (!visOk({ visibility: v1 }) || !visOk({ visibility: v2 })) { mesh.visible = false; continue; }
      mesh.visible = groups.bones.visible;
      mesh.position.copy(P).add(Q).multiplyScalar(0.5);
      const w = Math.max(P.distanceTo(Q), 1);
      mesh.scale.set(w * 0.75, w * 0.5, w * 0.45);
    } else if (pc.kind === "spine") {
      const v1 = place3(11, P), v2 = place3(12, Q);
      const v3 = place3(23, DIR), v4 = place3(24, UP);   // réutilise les vecteurs
      if (!visOk({ visibility: v1 }) || !visOk({ visibility: v3 })) { mesh.visible = false; UP.set(0, 1, 0); continue; }
      mesh.visible = groups.bones.visible;
      const top = P.add(Q).multiplyScalar(0.5), bot = DIR.add(UP).multiplyScalar(0.5);
      UP.set(0, 1, 0);
      const d = new THREE.Vector3().subVectors(bot, top);
      const len = d.length();
      mesh.position.copy(top).addScaledVector(d, 0.5);
      mesh.quaternion.setFromUnitVectors(UP, d.normalize());
      const r = 0.018 * ppm;
      mesh.scale.set(r, Math.max(len - r, 1) / 3, r);
    }
  }

  render();
}

/* Transformation rigide (échelle uniforme + rotation + translation) qui
   envoie le segment de repos aR→bR sur le segment cible aT→bT, écrite dans
   la matrice de l'objet. La rotation retenue est la plus courte : le roulis
   autour de l'axe reste libre, ce qui suffit tant qu'on n'a pas les repères
   de torsion des membres. */
/* Objets de travail réutilisés à chaque image (zéro allocation dans la
   boucle). Créés après l'import de three.js — d'où l'initialisation tardive. */
let _q, _u, _v, _s, _t, _aT, _bT, _p1, _p2;
function initScratch() {
  _q = new THREE.Quaternion();
  _u = new THREE.Vector3(); _v = new THREE.Vector3();
  _s = new THREE.Vector3(); _t = new THREE.Vector3();
  _aT = new THREE.Vector3(); _bT = new THREE.Vector3();
  _p1 = new THREE.Vector3(); _p2 = new THREE.Vector3();
}

function fitSegment(mesh, aR, bR, aT, bT) {
  _u.subVectors(bR, aR); _v.subVectors(bT, aT);
  const lr = _u.length(), lt = _v.length();
  if (lr < 1e-6 || lt < 1e-6) { mesh.visible = false; return; }
  const s = lt / lr;
  _q.setFromUnitVectors(_u.divideScalar(lr), _v.divideScalar(lt));
  _s.set(s, s, s);
  // t = aT − s·R·aR
  _t.copy(aR).applyQuaternion(_q).multiplyScalar(s).negate().add(aT);
  mesh.matrix.compose(_t, _q, _s);
  mesh.matrixWorldNeedsUpdate = true;
}

function poseRegions(place3, ppm) {
  /* Transformation « corps » : haut du torse → centre du bassin, d'après les
     landmarks. Sert aux régions solidaires du tronc (tête, cou, torse, bassin). */
  let bodyOk = false;
  if (bodyRest) {
    const v11 = place3(11, _p1), v12 = place3(12, _p2);
    _aT.addVectors(_p1, _p2).multiplyScalar(0.5);
    const v23 = place3(23, _p1), v24 = place3(24, _p2);
    _bT.addVectors(_p1, _p2).multiplyScalar(0.5);
    bodyOk = v11 > 0.45 && v12 > 0.45 && v23 > 0.45 && v24 > 0.45;
  }

  for (const r of regions) {
    const g = groups[r.layer];
    if (!g.visible) { r.mesh.visible = false; continue; }

    if (r.bind.type === "body") {
      if (!bodyOk) { r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      fitSegment(r.mesh, bodyRest.top, bodyRest.bottom, _aT, _bT);
    } else {
      const va = place3(r.bind.a, _p1);
      const vb = place3(r.bind.b, _p2);
      if (va < 0.45 || vb < 0.45) { r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      fitSegment(r.mesh, r.aRest, r.bRest, _p1, _p2);
    }
  }
}

/* ======================= Nommage des structures ==========================
   La jointure par région et la décimation effacent l'identité de chaque os ou
   muscle : le GLB ne contient plus qu'un maillage par région. Le pipeline
   écrit donc à côté un `<clé>.parts.json` — la boîte englobante de chaque
   structure d'origine, dans le repère du modèle.

   `pick(x, y)` lance un rayon sur la scène, ramène le point touché dans le
   repère du modèle (via l'inverse de la transformation de la région), puis
   cherche quelle structure occupe ce point. */

const partsByLayer = {};        // clé de couche → [{nom, region, min, max, centre}]
let raycaster = null;
const _ndc = { x: 0, y: 0 };

async function loadParts(key) {
  if (partsByLayer[key]) return partsByLayer[key];
  try {
    const data = await fetch(ASSETS_DIR + key + ".parts.json").then(r => r.json());
    partsByLayer[key] = data.parts || [];
  } catch (e) {
    partsByLayer[key] = [];
    console.warn("[xray3d] nommage indisponible pour " + key + " : " + e.message);
  }
  return partsByLayer[key];
}

let _mat4 = null, _local = null;

function pick(x, y) {
  if (!ready || !regions.length) return null;
  if (!raycaster) {
    raycaster = new THREE.Raycaster();
    _mat4 = new THREE.Matrix4();
    _local = new THREE.Vector3();
  }

  /* Repère vidéo → coordonnées normalisées de la caméra orthographique.
     La caméra est déjà inversée en mode miroir (voir applyDims), donc on
     passe le point tel quel. */
  _ndc.x = (x / dims.W) * 2 - 1;
  _ndc.y = -((y / dims.H) * 2 - 1);
  if (mirrored) _ndc.x = -_ndc.x;
  raycaster.setFromCamera(_ndc, camera);

  const targets = regions.filter(r => r.mesh.visible).map(r => r.mesh);
  if (!targets.length) return null;
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;

  const h = hits[0];
  /* Retrouver la région touchée : le mesh touché est un enfant du groupe. */
  let node = h.object, reg = null;
  while (node && !reg) {
    reg = regions.find(r => r.mesh === node) || null;
    node = node.parent;
  }
  if (!reg) return null;

  const parts = partsByLayer[reg.layer];
  if (!parts || !parts.length) {
    return { nom: null, region: reg.name, distance: h.distance,
             note: "nommage non chargé — appelle loadParts()" };
  }

  /* Point d'impact ramené dans le repère du modèle. */
  _mat4.copy(reg.mesh.matrix).invert();
  _local.copy(h.point).applyMatrix4(_mat4);

  /* Parmi les structures de cette région, celles dont la boîte contient le
     point ; la plus proche du centre l'emporte (les boîtes se chevauchent
     entre structures voisines). Sinon, la plus proche tout court. */
  let best = null, bestD = Infinity, bestInside = false;
  const M = 0.004;                      // 4 mm de tolérance
  for (const p of parts) {
    if (p.region !== reg.name) continue;
    const inside = _local.x >= p.min[0] - M && _local.x <= p.max[0] + M &&
                   _local.y >= p.min[1] - M && _local.y <= p.max[1] + M &&
                   _local.z >= p.min[2] - M && _local.z <= p.max[2] + M;
    const dx = _local.x - p.centre[0], dy = _local.y - p.centre[1], dz = _local.z - p.centre[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (inside && !bestInside) { best = p; bestD = d; bestInside = true; continue; }
    if (inside === bestInside && d < bestD) { best = p; bestD = d; }
  }
  if (!best) return null;

  return { nom: best.nom, region: reg.name, distance: h.distance,
           dansLaStructure: bestInside, ecart: +bestD.toFixed(4) };
}

function render() {
  if (!ready) return;
  const w = canvas.width, h = canvas.height;
  if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

  const u = composeMat.uniforms;
  u.uRes.value.set(w, h);
  u.uMirror.value = mirrored ? 1 : 0;
  u.uLensOn.value = lens.enabled ? 1 : 0;
  if (lens.enabled) {
    // repère vidéo → pixels du canvas ; l'origine WebGL est en bas
    const s = w / dims.W;
    const lx = (mirrored ? dims.W - lens.cx : lens.cx) * s;
    u.uLens.value.set(lx, h - lens.cy * s, lens.radius * s);
    u.uFeather.value = Math.min((lens.feather ?? 30) * s, lens.radius * s * 0.9);
  }
  if (maskTex) maskTex.needsUpdate = true;      // le canvas de silhouette a bougé

  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(quadScene, quadCam);
}

window.MIROIR_XRAY = {
  init, setDims, setMirrored, update, setLayer, setOpacity, setLens, isReady,
  /* nommage des structures (voir pick) */
  pick, loadParts,
  /* extras Ada : */
  loadLayer, render,
  hasAssets: key => !!(groups[key] && groups[key].userData.loaded),
  regionCount: () => regions.length,
  /* Diagnostic : où chaque région atterrit réellement à l'écran. */
  debugRegions() {
    return regions.map(r => {
      const box = new THREE.Box3().setFromObject(r.mesh);
      return {
        name: r.name, visible: r.mesh.visible,
        aRest: r.aRest.toArray().map(v => +v.toFixed(3)),
        min: box.min.toArray().map(v => Math.round(v)),
        max: box.max.toArray().map(v => Math.round(v)),
      };
    });
  },
};

})();
