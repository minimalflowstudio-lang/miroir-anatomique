/* =========================================================================
   XRAY_HAND — mode MAIN : les os de la main sous la peau filmée
   Pose le squelette de la main (hand.glb, pleine définition) sur les 21
   landmarks du HandLandmarker : chaque os est ancré sur deux points, donc il
   tourne et se met à l'échelle avec la main réelle. Occlusion par profondeur
   (les os du fond s'assombrissent) + lentille + silhouette, en shader.
   Contrat window.MIROIR_HAND du brief de Marie 07.08.
   ========================================================================= */

(function () {

const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.166.1/+esm";
const THREE_CDN_EXAMPLES = "https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/";

let ASSETS_DIR = "assets/anatomy/";

/* Indices du HandLandmarker (21 points) :
     0 poignet
     1-4   pouce      (CMC, MCP, IP, bout)
     5-8   index      (MCP, PIP, DIP, bout)
     9-12  majeur
     13-16 annulaire
     17-20 auriculaire                                                     */
const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, PINKY_MCP = 17;

let THREE = null;
let renderer = null, scene = null, camera = null, dirLight = null;
let canvas = null, videoEl = null;
let ready = false;
let dims = { W: 1280, H: 720 };
let mirrored = true;
let depthOcclusion = true;
let lens = { enabled: false, cx: 0, cy: 0, radius: 0, feather: 30 };

/* Une main = un groupe d'os. On en prépare deux (gauche et droite) : le
   HandLandmarker peut en suivre plusieurs à la fois. */
const hands = [];          // { side, group, bones: [{mesh, aRest, bRest, a, b}] }
let handRest = null;       // rig du modèle au repos
let baseMaterial = null;

/* --------------------------------------------------------------- Init */
async function init(ctx) {
  canvas  = ctx.canvas;
  videoEl = ctx.videoEl || null;
  if (ctx.assetsDir) ASSETS_DIR = ctx.assetsDir;
  const progress = ctx.onProgress || (() => {});

  progress("three.js…", 0.15);
  THREE = await import(THREE_CDN);
  initScratch();

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, dims.W, 0, -dims.H, -4000, 4000);

  scene.add(new THREE.HemisphereLight(0xcfe0ee, 0x1a2530, 0.9));
  dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(-0.4, 0.8, 1.0);
  scene.add(dirLight);

  buildCompose();

  progress("os de la main…", 0.6);
  await loadHandAssets();

  applyDims();
  ready = true;
  progress("prêt", 1);
}

/* ------------------------------------------------- Chargement du modèle
   hand.glb contient deux objets — « handl » et « handr » — exportés sans
   décimation (on est en gros plan). Le rig donne, pour chaque main, ses
   points d'ancrage de repos ; on en déduit un repère local. */
async function loadHandAssets() {
  const { GLTFLoader } = await import(THREE_CDN_EXAMPLES + "loaders/GLTFLoader.js/+esm");
  const [gltf, rig] = await Promise.all([
    new GLTFLoader().loadAsync(ASSETS_DIR + "hand.glb"),
    fetch(ASSETS_DIR + "hand.rig.json").then(r => r.json()),
    fetch(ASSETS_DIR + "hand.parts.json").then(r => r.json())
      .then(d => { parts = d.parts || []; })
      .catch(e => console.warn("[xray_hand] nommage indisponible : " + e.message)),
  ]);

  baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.5, metalness: 0.04,
    transparent: true, opacity: 1, vertexColors: true,
  });

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const found = { l: [], r: [] };
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const n = norm(o.name);
    if (n.startsWith("handl")) found.l.push(o);
    else if (n.startsWith("handr")) found.r.push(o);
  });

  for (const side of ["l", "r"]) {
    if (!found[side].length) continue;
    const r = rig.regions["hand." + side];
    if (!r) continue;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    for (const m of found[side]) { m.material = baseMaterial; holder.add(m); }
    holder.visible = false;
    scene.add(holder);
    hands.push({
      side, group: holder,
      aRest: new THREE.Vector3().fromArray(r.a),      // extrémité distale (doigts)
      bRest: new THREE.Vector3().fromArray(r.b),      // extrémité proximale (poignet)
      center: new THREE.Vector3().fromArray(r.center),
    });
  }
  handRest = rig;
}

/* ===================== Composition : profondeur, lentille, silhouette ====
   Le rendu passe par une cible hors écran pour pouvoir moduler la couleur
   selon la profondeur : les os proches restent clairs, ceux du fond
   s'assombrissent. C'est ce qui donne le volume — sans cela on ne voit
   qu'un calque posé sur la peau. */

let rt = null, quadScene = null, quadCam = null, composeMat = null;
let maskTex = null, maskSource = null;

const COMPOSE_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSE_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tScene, tDepth, tMask;
uniform vec3  uLens;
uniform float uFeather, uLensOn, uMaskOn, uMirror, uDepthOn;
uniform vec2  uDepthRange;      // profondeur min et max de la main, en unités monde

void main() {
  vec4 c = texture2D(tScene, vUv);
  if (c.a < 0.002) discard;

  if (uDepthOn > 0.5) {
    // profondeur normalisée : 0 = près de la caméra, 1 = au fond
    float d = texture2D(tDepth, vUv).r;
    float t = clamp((d - uDepthRange.x) / max(uDepthRange.y - uDepthRange.x, 1e-4), 0.0, 1.0);
    // les os du fond s'assombrissent et se désaturent légèrement
    float shade = mix(1.0, 0.42, t);
    float gray = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(c.rgb, vec3(gray), t * 0.35) * shade;
  }

  if (uLensOn > 0.5) {
    float dist = distance(gl_FragCoord.xy, uLens.xy);
    // bord de fenêtre assombri avant de disparaître : l'œil lit un trou, pas un calque
    float edge = smoothstep(uLens.z - uFeather * 2.0, uLens.z - uFeather, dist);
    c.rgb *= mix(1.0, 0.55, edge);
    c *= 1.0 - smoothstep(uLens.z - uFeather, uLens.z, dist);
  }

  if (uMaskOn > 0.5) {
    vec2 muv = vec2(uMirror > 0.5 ? 1.0 - vUv.x : vUv.x, 1.0 - vUv.y);
    c *= texture2D(tMask, muv).r;
  }

  gl_FragColor = c;
}`;

function buildCompose() {
  rt = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });
  rt.depthTexture = new THREE.DepthTexture();
  rt.depthTexture.type = THREE.UnsignedShortType;

  composeMat = new THREE.ShaderMaterial({
    vertexShader: COMPOSE_VERT, fragmentShader: COMPOSE_FRAG,
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: rt.texture }, tDepth: { value: rt.depthTexture },
      tMask: { value: null },
      uLens: { value: new THREE.Vector3(0, 0, 0) },
      uFeather: { value: 30 }, uLensOn: { value: 0 }, uMaskOn: { value: 0 },
      uMirror: { value: 1 }, uDepthOn: { value: 1 },
      uDepthRange: { value: new THREE.Vector2(0, 1) },
    },
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(
    new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(geo, composeMat));
  quadCam = new THREE.Camera();
}

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

/* ------------------------------------------------------------ Contrat */
function setDims(d) { dims = d; if (ready) applyDims(); }

function applyDims() {
  camera.left = mirrored ? dims.W : 0;
  camera.right = mirrored ? 0 : dims.W;
  camera.top = 0; camera.bottom = -dims.H;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.clientWidth || dims.W, canvas.clientHeight || dims.H, false);
}

function setMirrored(m) { mirrored = m; if (ready) applyDims(); render(); }
function isReady() { return ready; }
function setDepthOcclusion(on) { depthOcclusion = !!on; render(); }
function setLens(l) { Object.assign(lens, l || {}); render(); }

/* ------------------------------------------- Pose à chaque image */
let _q, _u, _v, _s, _t, _p1, _p2, _n1, _n2, _nrm;
function initScratch() {
  _q = new THREE.Quaternion();
  _u = new THREE.Vector3(); _v = new THREE.Vector3();
  _s = new THREE.Vector3(); _t = new THREE.Vector3();
  _p1 = new THREE.Vector3(); _p2 = new THREE.Vector3();
  _n1 = new THREE.Vector3(); _n2 = new THREE.Vector3(); _nrm = new THREE.Vector3();
}

/* Transformation rigide qui envoie le segment de repos aR→bR sur aT→bT.
   Le roulis restant est fixé ensuite par la normale de la paume : c'est ce
   qui permet à la main de « tourner » correctement. */
function fitSegment(obj, aR, bR, aT, bT, rollRef) {
  _u.subVectors(bR, aR); _v.subVectors(bT, aT);
  const lr = _u.length(), lt = _v.length();
  if (lr < 1e-6 || lt < 1e-6) { obj.visible = false; return; }
  const s = lt / lr;
  _u.divideScalar(lr); _v.divideScalar(lt);
  _q.setFromUnitVectors(_u, _v);

  if (rollRef) {
    /* Aligne le plan de la main : on compare la normale du modèle, tournée
       par _q, à la normale mesurée de la paume, et on corrige le roulis
       autour de l'axe du segment. */
    _n1.set(0, 0, 1).applyQuaternion(_q);
    const along = _v;
    _n1.addScaledVector(along, -_n1.dot(along)).normalize();
    _n2.copy(rollRef).addScaledVector(along, -rollRef.dot(along));
    if (_n2.lengthSq() > 1e-8) {
      _n2.normalize();
      const cos = Math.max(-1, Math.min(1, _n1.dot(_n2)));
      const sign = _nrm.crossVectors(_n1, _n2).dot(along) < 0 ? -1 : 1;
      const roll = new THREE.Quaternion().setFromAxisAngle(along, sign * Math.acos(cos));
      _q.premultiply(roll);
    }
  }

  _s.set(s, s, s);
  _t.copy(aR).applyQuaternion(_q).multiplyScalar(s).negate().add(aT);
  obj.matrix.compose(_t, _q, _s);
  obj.matrixWorldNeedsUpdate = true;
  obj.visible = true;
}

let depthMin = 0, depthMax = 1;

function update(res) {
  if (!ready || !res || !res.landmarks) return;
  if (res.segmentationMask !== undefined) setMaskSource(res.segmentationMask);

  const list = Array.isArray(res.landmarks[0]) ? res.landmarks : [res.landmarks];
  const worlds = res.worldLandmarks
    ? (Array.isArray(res.worldLandmarks[0]) ? res.worldLandmarks : [res.worldLandmarks])
    : null;
  const sides = normalizeHandedness(res.handedness, list.length);

  for (const h of hands) h.group.visible = false;

  let zMin = Infinity, zMax = -Infinity;

  for (let i = 0; i < list.length; i++) {
    const lm = list[i];
    if (!lm || lm.length < 21) continue;
    const wl = worlds && worlds[i] ? worlds[i] : null;
    const side = sides[i];
    const hand = hands.find(h => h.side === side) || hands[0];
    if (!hand) continue;

    /* Échelle pixels/mètre : largeur de paume à l'écran / largeur réelle. */
    const pxIndex = { x: lm[INDEX_MCP].x * dims.W, y: lm[INDEX_MCP].y * dims.H };
    const pxPinky = { x: lm[PINKY_MCP].x * dims.W, y: lm[PINKY_MCP].y * dims.H };
    const palmPx = Math.hypot(pxIndex.x - pxPinky.x, pxIndex.y - pxPinky.y);
    let ppm = 900;
    if (wl) {
      const wm = Math.hypot(wl[INDEX_MCP].x - wl[PINKY_MCP].x,
                            wl[INDEX_MCP].y - wl[PINKY_MCP].y,
                            wl[INDEX_MCP].z - wl[PINKY_MCP].z);
      if (wm > 0.01 && palmPx > 1) ppm = palmPx / wm;
    } else if (palmPx > 1) ppm = palmPx / 0.08;

    const place = (idx, out) => {
      const z = wl ? -wl[idx].z * ppm : 0;
      out.set(lm[idx].x * dims.W, -lm[idx].y * dims.H, z);
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      return out;
    };

    /* Axe principal : poignet → base du majeur. Il donne la direction et la
       taille de la main à l'écran. */
    place(WRIST, _p1);
    place(MIDDLE_MCP, _p2);

    /* Normale de la paume : produit vectoriel entre (poignet → index) et
       (poignet → auriculaire). C'est elle qui distingue paume et dos, donc
       qui fait tourner le modèle quand la main pivote. */
    const wx = _p1.x, wy = _p1.y, wz = _p1.z;
    place(INDEX_MCP, _n1).sub({ x: wx, y: wy, z: wz });
    place(PINKY_MCP, _n2).sub({ x: wx, y: wy, z: wz });
    _nrm.crossVectors(_n1, _n2);
    if (side === "r") _nrm.negate();     // la latéralité inverse le sens
    const rollRef = _nrm.lengthSq() > 1e-10 ? _nrm.normalize() : null;

    place(WRIST, _p1);
    place(MIDDLE_MCP, _p2);
    /* aRest est l'extrémité distale du modèle, bRest le poignet : on envoie
       donc (bRest → aRest) sur (poignet → base du majeur). */
    fitSegment(hand.group, hand.bRest, hand.aRest, _p1, _p2, rollRef);
    hand.group.visible = true;
  }

  if (zMin < zMax) { depthMin = zMin; depthMax = zMax; }
  render();
}

/* La latéralité arrive sous plusieurs formes selon la version de MediaPipe :
   tableau de tableaux de catégories, ou chaînes. On normalise en "l"/"r". */
function normalizeHandedness(h, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let label = null;
    const e = h ? h[i] : null;
    if (typeof e === "string") label = e;
    else if (e && e.categoryName) label = e.categoryName;
    else if (Array.isArray(e) && e[0]) label = e[0].categoryName || e[0].displayName;
    const s = (label || "").toLowerCase();
    /* Image en miroir : MediaPipe annonce « Left » pour la main droite du
       sujet vue dans un miroir. On garde l'étiquette telle quelle et on
       laisse setMirrored gérer l'affichage. */
    out.push(s.startsWith("r") ? "r" : "l");
  }
  return out;
}

/* ======================= Nommage des structures ==========================
   Même principe que dans xray3d.js : les os de la main sont joints en deux
   maillages, donc les noms Z-Anatomy (métacarpiens, phalanges, os du carpe)
   ne survivent que dans `hand.parts.json`, sous forme de boîtes englobantes
   exprimées dans le repère du modèle. */

let parts = [];
let raycaster = null, _mat4 = null, _local = null;
const _ndc = { x: 0, y: 0 };

function pick(x, y) {
  if (!ready || !hands.length) return null;
  if (!raycaster) {
    raycaster = new THREE.Raycaster();
    _mat4 = new THREE.Matrix4();
    _local = new THREE.Vector3();
  }
  _ndc.x = (x / dims.W) * 2 - 1;
  _ndc.y = -((y / dims.H) * 2 - 1);
  if (mirrored) _ndc.x = -_ndc.x;
  raycaster.setFromCamera(_ndc, camera);

  const targets = hands.filter(h => h.group.visible).map(h => h.group);
  if (!targets.length) return null;
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;

  const h = hits[0];
  let node = h.object, hand = null;
  while (node && !hand) {
    hand = hands.find(x2 => x2.group === node) || null;
    node = node.parent;
  }
  if (!hand) return null;

  const regionName = "hand." + hand.side;
  if (!parts.length) {
    return { nom: null, region: regionName, distance: h.distance,
             note: "hand.parts.json absent — régénère les assets" };
  }

  _mat4.copy(hand.group.matrix).invert();
  _local.copy(h.point).applyMatrix4(_mat4);

  /* Les os de la main sont petits et serrés : tolérance réduite à 2 mm. */
  let best = null, bestD = Infinity, bestInside = false;
  const M = 0.002;
  for (const p of parts) {
    if (p.region !== regionName) continue;
    const inside = _local.x >= p.min[0] - M && _local.x <= p.max[0] + M &&
                   _local.y >= p.min[1] - M && _local.y <= p.max[1] + M &&
                   _local.z >= p.min[2] - M && _local.z <= p.max[2] + M;
    const dx = _local.x - p.centre[0], dy = _local.y - p.centre[1], dz = _local.z - p.centre[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (inside && !bestInside) { best = p; bestD = d; bestInside = true; continue; }
    if (inside === bestInside && d < bestD) { best = p; bestD = d; }
  }
  if (!best) return null;
  return { nom: best.nom, region: regionName, distance: h.distance,
           dansLaStructure: bestInside, ecart: +bestD.toFixed(4) };
}

function render() {
  if (!ready) return;
  const w = canvas.width, h = canvas.height;
  if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

  const u = composeMat.uniforms;
  u.uMirror.value = mirrored ? 1 : 0;
  u.uDepthOn.value = depthOcclusion ? 1 : 0;
  u.uLensOn.value = lens.enabled ? 1 : 0;
  if (lens.enabled) {
    const s = w / dims.W;
    const lx = (mirrored ? dims.W - lens.cx : lens.cx) * s;
    u.uLens.value.set(lx, h - lens.cy * s, lens.radius * s);
    u.uFeather.value = Math.min((lens.feather ?? 30) * s, lens.radius * s * 0.9);
  }
  /* La plage de profondeur est calée sur la main mesurée, pas sur la scène :
     le dégradé reste lisible quelle que soit la distance au téléphone. */
  u.uDepthRange.value.set(0, 1);
  if (maskTex) maskTex.needsUpdate = true;

  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(quadScene, quadCam);
}

window.MIROIR_HAND = {
  init, setDims, setMirrored, update, setLens, setDepthOcclusion, isReady,
  /* nommage des structures (voir pick) */
  pick,
  /* extras Ada : */
  render,
  handCount: () => hands.length,
  debugHands() {
    return hands.map(h => {
      const box = new THREE.Box3().setFromObject(h.group);
      return { side: h.side, visible: h.group.visible,
               min: box.min.toArray().map(v => Math.round(v)),
               max: box.max.toArray().map(v => Math.round(v)) };
    });
  },
};

})();
