/* =========================================================================
   MIROIR ANATOMIQUE — définition des couches anatomiques
   -------------------------------------------------------------------------
   Chaque « pièce » est dessinée dans un REPÈRE LOCAL, puis plaquée sur le
   corps détecté par une matrice calculée à chaque image (voir mirror.js).

   Repères disponibles :
     torso  : origine = milieu des épaules.
              x ∈ [-0.5, +0.5] = largeur d'épaules ; +x vers la GAUCHE
              anatomique (côté du cœur). y ∈ [0, 1] = épaules → hanches.
     pelvis : origine = milieu des hanches, x = largeur des hanches, y même
              échelle que x (isotrope).
     head   : origine = milieu des oreilles, échelle isotrope = largeur de tête.
     seg    : le long d'un os. x ∈ [0, 1] de l'articulation proximale à la
              distale, y = perpendiculaire (même échelle → isotrope).

   Conséquence : la taille de chaque structure suit les proportions RÉELLES
   de la personne détectée. C'est le principe du miroir.
   ========================================================================= */

(function () {

const SVGNS = "http://www.w3.org/2000/svg";

function mk(parent, name, attrs) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n);
  return n;
}

// Ventre musculaire fusiforme le long d'un segment (repère seg).
// from/to = position le long de l'os, w = épaisseur max, off = décalage latéral.
function spindle(parent, from, to, w, off, cls) {
  const mid = (from + to) / 2;
  const d = `M ${from} ${off}
             C ${mid - (to-from)*0.15} ${off - w}, ${mid + (to-from)*0.15} ${off - w}, ${to} ${off}
             C ${mid + (to-from)*0.15} ${off + w}, ${mid - (to-from)*0.15} ${off + w}, ${from} ${off} Z`;
  return mk(parent, "path", { d, class: cls || "muscle" });
}

// Os long stylisé : diaphyse + épiphyses renflées (repère seg).
function longBone(parent, w, from = 0.02, to = 0.98) {
  const e = w * 1.85;
  const d = `M ${from} ${-e/2}
             a ${e/2} ${e/2} 0 1 0 0 ${e}
             l 0 ${-(e - w)/2}
             L ${to} ${w/2}
             l 0 ${(e - w)/2}
             a ${e/2} ${e/2} 0 1 0 0 ${-e}
             l 0 ${(e - w)/2}
             L ${from} ${-w/2} Z`;
  return mk(parent, "path", { d, class: "bone" });
}

/* Chaque couche = liste de pièces { frame, args?, build(g) } */
const LAYERS = {};

/* =========================================================================
   COUCHE 1 — OS
   ========================================================================= */
LAYERS.bones = [];

// --- Os longs des membres ---
const LONG_BONES = [
  // [proximal, distal, largeur]
  [12, 14, 0.115], [11, 13, 0.115],   // humérus D / G
  [14, 16, 0.055], [13, 15, 0.055],   // avant-bras (radius, l'ulna est ajoutée)
  [24, 26, 0.125], [23, 25, 0.125],   // fémur D / G
  [26, 28, 0.055], [25, 27, 0.055],   // tibia (fibula ajoutée)
];
for (const [a, b, w] of LONG_BONES) {
  LAYERS.bones.push({ frame: "seg", a, b, build: g => longBone(g, w) });
}
// Ulna et fibula : second os parallèle, plus fin
for (const [a, b] of [[14,16],[13,15],[26,28],[25,27]]) {
  LAYERS.bones.push({
    frame: "seg", a, b,
    build: g => { longBone(g, 0.038, 0.06, 0.94).setAttribute("transform", "translate(0, 0.075)"); }
  });
}

// --- Mains : métacarpes + phalanges ---
for (const [wrist, tip] of [[16, 20], [15, 19]]) {
  LAYERS.bones.push({
    frame: "seg", a: wrist, b: tip,
    build: g => {
      // carpe
      mk(g, "ellipse", { cx: 0.13, cy: 0, rx: 0.14, ry: 0.11, class: "bone" });
      for (let i = 0; i < 4; i++) {
        const spread = (i - 1.5) * 0.075;
        mk(g, "path", { d: `M 0.26 ${spread * 0.5} L 0.68 ${spread}`, class: "bone-line", "stroke-width": 0.05 });
        mk(g, "path", { d: `M 0.72 ${spread} L 0.97 ${spread * 1.25}`, class: "bone-line", "stroke-width": 0.042 });
      }
      // pouce
      mk(g, "path", { d: "M 0.2 0.12 L 0.5 0.34", class: "bone-line", "stroke-width": 0.055 });
      mk(g, "path", { d: "M 0.53 0.36 L 0.72 0.46", class: "bone-line", "stroke-width": 0.048 });
    }
  });
}

// --- Pieds : tarse + métatarses ---
for (const [ankle, toe] of [[28, 32], [27, 31]]) {
  LAYERS.bones.push({
    frame: "seg", a: ankle, b: toe,
    build: g => {
      mk(g, "ellipse", { cx: 0.12, cy: 0.06, rx: 0.2, ry: 0.15, class: "bone" });  // talus/calcanéus
      for (let i = 0; i < 4; i++) {
        const s = (i - 1.5) * 0.09;
        mk(g, "path", { d: `M 0.3 ${0.05 + s * 0.3} L 0.9 ${s}`, class: "bone-line", "stroke-width": 0.05 });
      }
    }
  });
}

// --- Crâne ---
LAYERS.bones.push({ frame: "head", build: g => {
  mk(g, "ellipse", { cx: 0, cy: -0.14, rx: 0.5, ry: 0.56, class: "bone" });                    // voûte
  mk(g, "path", { d: "M -0.46 -0.3 Q 0 -0.52 0.46 -0.3", class: "bone-line", "stroke-width": 0.012, opacity: 0.45 }); // suture coronale
  mk(g, "path", { d: "M -0.33 0.2 L -0.27 0.5 Q 0 0.66 0.27 0.5 L 0.33 0.2 L 0.2 0.29 Q 0 0.42 -0.2 0.29 Z", class: "bone" }); // mandibule
  mk(g, "ellipse", { cx: -0.19, cy: -0.21, rx: 0.115, ry: 0.14, fill: "#0b0e12", opacity: 0.85 });  // orbites
  mk(g, "ellipse", { cx:  0.19, cy: -0.21, rx: 0.115, ry: 0.14, fill: "#0b0e12", opacity: 0.85 });
  mk(g, "path", { d: "M 0 -0.04 L -0.06 0.13 Q 0 0.18 0.06 0.13 Z", fill: "#0b0e12", opacity: 0.8 }); // ouverture nasale
  mk(g, "path", { d: "M -0.15 0.33 L 0.15 0.33", stroke: "#0b0e12", "stroke-width": 0.016,
                  "stroke-dasharray": "0.03 0.026", opacity: 0.55 });                            // arcade dentaire
  mk(g, "path", { d: "M -0.42 0.06 L -0.5 0.02 M 0.42 0.06 L 0.5 0.02", class: "bone-line", "stroke-width": 0.03 }); // arcades zygomatiques
}});

// --- Colonne cervicale (tête → épaules) ---
LAYERS.bones.push({ frame: "torso", build: g => {
  for (let i = 0; i < 4; i++) {
    mk(g, "rect", { x: -0.035, y: -0.16 + i * 0.042, width: 0.07, height: 0.03, rx: 0.012, class: "bone" });
  }
}});

// --- Cage thoracique, clavicules, scapulas, colonne, bassin (repère torse) ---
LAYERS.bones.push({ frame: "torso", build: g => {
  // clavicules
  mk(g, "path", { d: "M 0 0.03 Q 0.22 -0.04 0.46 0.005", class: "bone-line", "stroke-width": 0.038 });
  mk(g, "path", { d: "M 0 0.03 Q -0.22 -0.04 -0.46 0.005", class: "bone-line", "stroke-width": 0.038 });
  // scapulas (en arrière du thorax : simplement suggérées)
  mk(g, "path", { d: "M 0.44 0.04 L 0.26 0.1 L 0.33 0.26 Z", class: "bone", opacity: 0.3 });
  mk(g, "path", { d: "M -0.44 0.04 L -0.26 0.1 L -0.33 0.26 Z", class: "bone", opacity: 0.3 });
  // sternum
  mk(g, "path", { d: "M -0.035 0.06 L 0.035 0.06 L 0.03 0.32 L 0 0.38 L -0.03 0.32 Z", class: "bone" });
  // 10 paires de côtes
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const y = 0.075 + t * 0.40;
    const r = 0.30 + Math.sin(Math.min(t * 1.35, 1) * Math.PI) * 0.16;
    const drop = 0.055 + t * 0.075;
    const sw = 0.026 - t * 0.006;
    const op = i < 7 ? 1 : 0.6;   // fausses côtes plus discrètes
    for (const s of [1, -1]) {
      mk(g, "path", {
        d: `M ${s * 0.04} ${y} C ${s * r} ${y - 0.01}, ${s * r * 1.04} ${y + drop * 1.1}, ${s * 0.05} ${y + drop}`,
        class: "bone-line", "stroke-width": sw, opacity: op
      });
    }
  }
  // colonne thoracique + lombaire
  for (let i = 0; i < 12; i++) {
    const y = 0.045 + i * 0.076;
    const w = 0.055 + i * 0.0035;
    mk(g, "rect", { x: -w/2, y, width: w, height: 0.052, rx: 0.016, class: "bone", opacity: 0.85 });
  }
}});

// --- Bassin ---
LAYERS.bones.push({ frame: "pelvis", build: g => {
  for (const s of [1, -1]) {
    mk(g, "path", {
      d: `M ${s*0.52} -0.2 C ${s*0.66} 0.06, ${s*0.42} 0.3, ${s*0.1} 0.34
          L ${s*0.07} 0.12 C ${s*0.32} 0.08, ${s*0.36} -0.1, ${s*0.28} -0.24 Z`,
      class: "bone"
    });
  }
  mk(g, "path", { d: "M -0.075 0.06 L 0.075 0.06 L 0.045 0.4 L -0.045 0.4 Z", class: "bone" }); // sacrum + coccyx
}});

// --- Rotules ---
for (const knee of [26, 25]) {
  LAYERS.bones.push({ frame: "seg", a: knee, b: knee === 26 ? 28 : 27,
    build: g => mk(g, "ellipse", { cx: 0.03, cy: 0, rx: 0.075, ry: 0.06, class: "bone" }) });
}

/* =========================================================================
   COUCHE 2 — MUSCLES
   ========================================================================= */
LAYERS.muscles = [];

// Bras : deltoïde, biceps, triceps
for (const [sh, el_, side] of [[12, 14, -1], [11, 13, 1]]) {
  LAYERS.muscles.push({ frame: "seg", a: sh, b: el_, build: g => {
    spindle(g, 0.0, 0.34, 0.13, 0);                      // deltoïde
    spindle(g, 0.22, 0.92, 0.10, -0.055);                // biceps brachial
    spindle(g, 0.2, 0.95, 0.085, 0.075);                 // triceps
    mk(g, "path", { d: "M 0.3 -0.055 L 0.85 -0.055", class: "muscle-fiber" });
  }});
}
// Avant-bras : masse des fléchisseurs / extenseurs
for (const [el_, wr] of [[14, 16], [13, 15]]) {
  LAYERS.muscles.push({ frame: "seg", a: el_, b: wr, build: g => {
    spindle(g, 0.02, 0.75, 0.115, -0.03);
    spindle(g, 0.02, 0.68, 0.09, 0.08);
  }});
}
// Cuisse : quadriceps + ischio-jambiers
for (const [hip, kn] of [[24, 26], [23, 25]]) {
  LAYERS.muscles.push({ frame: "seg", a: hip, b: kn, build: g => {
    spindle(g, 0.02, 0.94, 0.155, -0.03);   // quadriceps
    spindle(g, 0.05, 0.9, 0.1, 0.13);       // ischio-jambiers
    mk(g, "path", { d: "M 0.15 -0.03 L 0.88 -0.03 M 0.15 -0.09 L 0.86 -0.06", class: "muscle-fiber" });
  }});
}
// Jambe : triceps sural (mollet) + tibial antérieur
for (const [kn, an] of [[26, 28], [25, 27]]) {
  LAYERS.muscles.push({ frame: "seg", a: kn, b: an, build: g => {
    spindle(g, 0.02, 0.62, 0.135, 0.06);    // gastrocnémiens
    mk(g, "path", { d: "M 0.6 0.06 L 0.95 0.02", class: "muscle", "stroke-width": 0.03,
                    stroke: "#e0d5c0", fill: "none" });   // tendon d'Achille
    spindle(g, 0.05, 0.7, 0.07, -0.07);     // tibial antérieur
  }});
}
// Trapèze + pectoraux + abdominaux + obliques (repère torse)
LAYERS.muscles.push({ frame: "torso", build: g => {
  // trapèze (haut du dos / cou)
  mk(g, "path", { d: "M 0 -0.12 L 0.46 0.02 L 0.3 0.16 L 0 0.06 Z", class: "muscle", opacity: 0.6 });
  mk(g, "path", { d: "M 0 -0.12 L -0.46 0.02 L -0.3 0.16 L 0 0.06 Z", class: "muscle", opacity: 0.6 });
  // grands pectoraux
  for (const s of [1, -1]) {
    mk(g, "path", {
      d: `M ${s*0.05} 0.08 L ${s*0.44} 0.06 C ${s*0.46} 0.2, ${s*0.34} 0.31, ${s*0.06} 0.3 Z`,
      class: "muscle"
    });
    for (let i = 1; i <= 3; i++) {
      mk(g, "path", { d: `M ${s*0.08} ${0.1 + i*0.05} L ${s*0.4} ${0.09 + i*0.04}`, class: "muscle-fiber" });
    }
  }
  // grand droit de l'abdomen (les « tablettes »)
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const y = 0.36 + i * 0.095;
      const w = 0.155 - i * 0.012;
      mk(g, "rect", { x: s > 0 ? 0.02 : -0.02 - w, y, width: w, height: 0.078, rx: 0.025, class: "muscle" });
    }
  }
  // obliques
  for (const s of [1, -1]) {
    mk(g, "path", { d: `M ${s*0.2} 0.34 L ${s*0.42} 0.4 L ${s*0.34} 0.72 L ${s*0.2} 0.74 Z`,
                    class: "muscle", opacity: 0.7 });
  }
}});
// Fessiers
LAYERS.muscles.push({ frame: "pelvis", build: g => {
  for (const s of [1, -1]) {
    mk(g, "ellipse", { cx: s * 0.34, cy: 0.16, rx: 0.3, ry: 0.26, class: "muscle", opacity: 0.75 });
  }
}});
// Muscles du cou (sterno-cléido-mastoïdiens)
LAYERS.muscles.push({ frame: "torso", build: g => {
  for (const s of [1, -1]) {
    mk(g, "path", { d: `M ${s*0.06} -0.24 L ${s*0.16} 0.03 L ${s*0.05} 0.04 L ${s*0.01} -0.22 Z`,
                    class: "muscle", opacity: 0.8 });
  }
}});

/* =========================================================================
   COUCHE 3 — NERFS
   ========================================================================= */
LAYERS.nerves = [];

function nerveLine(g, d, w, glow = true) {
  if (glow) mk(g, "path", { d, class: "nerve-glow", "stroke-width": w * 3.2 });
  return mk(g, "path", { d, class: "nerve", "stroke-width": w });
}

// Moelle épinière + racines segmentaires
LAYERS.nerves.push({ frame: "torso", build: g => {
  nerveLine(g, "M 0 -0.2 L 0 0.98", 0.022);
  for (let i = 0; i < 14; i++) {
    const y = -0.1 + i * 0.075;
    const len = 0.1 + Math.sin(i / 13 * Math.PI) * 0.16;
    nerveLine(g, `M 0 ${y} Q ${len*0.6} ${y + 0.02}, ${len} ${y + 0.06}`, 0.008, false);
    nerveLine(g, `M 0 ${y} Q ${-len*0.6} ${y + 0.02}, ${-len} ${y + 0.06}`, 0.008, false);
  }
  // plexus brachial
  for (const s of [1, -1]) {
    nerveLine(g, `M 0 -0.02 Q ${s*0.22} 0.0, ${s*0.44} 0.07`, 0.014);
  }
  // nerf phrénique (vers le diaphragme)
  nerveLine(g, "M 0.02 -0.05 Q 0.12 0.2, 0.06 0.42", 0.007, false);
}});
// Nerfs du bras : radial, médian, ulnaire
for (const [sh, el_] of [[12, 14], [11, 13]]) {
  LAYERS.nerves.push({ frame: "seg", a: sh, b: el_, build: g => {
    nerveLine(g, "M 0.04 0 Q 0.5 -0.05, 0.98 -0.03", 0.016);   // médian
    nerveLine(g, "M 0.04 0.02 Q 0.5 0.09, 0.98 0.05", 0.013);  // ulnaire
    nerveLine(g, "M 0.04 -0.02 Q 0.45 0.06, 0.98 0.02", 0.012); // radial (spirale)
  }});
}
for (const [el_, wr] of [[14, 16], [13, 15]]) {
  LAYERS.nerves.push({ frame: "seg", a: el_, b: wr, build: g => {
    nerveLine(g, "M 0.02 -0.03 Q 0.5 -0.02, 0.98 -0.02", 0.014);
    nerveLine(g, "M 0.02 0.05 Q 0.5 0.06, 0.98 0.05", 0.012);
  }});
}
// Ramification dans la main
for (const [wr, tip] of [[16, 20], [15, 19]]) {
  LAYERS.nerves.push({ frame: "seg", a: wr, b: tip, build: g => {
    for (let i = 0; i < 4; i++) {
      const s = (i - 1.5) * 0.075;
      nerveLine(g, `M 0.15 0 Q 0.5 ${s * 0.7}, 0.95 ${s * 1.2}`, 0.012, false);
    }
  }});
}
// Nerf sciatique + fémoral
for (const [hip, kn] of [[24, 26], [23, 25]]) {
  LAYERS.nerves.push({ frame: "seg", a: hip, b: kn, build: g => {
    nerveLine(g, "M 0.03 0.05 Q 0.45 0.1, 0.96 0.06", 0.022);   // sciatique
    nerveLine(g, "M 0.03 -0.04 Q 0.45 -0.06, 0.9 -0.05", 0.012); // fémoral
  }});
}
for (const [kn, an] of [[26, 28], [25, 27]]) {
  LAYERS.nerves.push({ frame: "seg", a: kn, b: an, build: g => {
    nerveLine(g, "M 0.03 0.05 Q 0.5 0.06, 0.97 0.04", 0.016);   // tibial
    nerveLine(g, "M 0.05 0.0 Q 0.5 -0.05, 0.95 -0.02", 0.011);  // fibulaire commun
  }});
}
// Nerfs crâniens (schématique)
LAYERS.nerves.push({ frame: "head", build: g => {
  nerveLine(g, "M 0 0.1 Q 0.12 -0.05, 0.3 -0.18", 0.02, false);
  nerveLine(g, "M 0 0.1 Q -0.12 -0.05, -0.3 -0.18", 0.02, false);
  nerveLine(g, "M 0 0.1 L 0 0.5", 0.022);
}});

/* =========================================================================
   COUCHE 4 — ORGANES
   ========================================================================= */
LAYERS.organs = [];

LAYERS.organs.push({ frame: "head", build: g => {
  mk(g, "ellipse", { cx: 0, cy: -0.18, rx: 0.4, ry: 0.42, fill: "var(--organ-brain)", class: "organ", opacity: 0.9 });
  // circonvolutions
  for (let i = 0; i < 5; i++) {
    const y = -0.46 + i * 0.14;
    mk(g, "path", { d: `M -0.36 ${y} q 0.12 -0.05 0.24 0 q 0.12 0.05 0.24 0`,
                    stroke: "#a8848f", fill: "none", "stroke-width": 0.02, opacity: 0.7 });
  }
  mk(g, "ellipse", { cx: 0, cy: 0.16, rx: 0.16, ry: 0.11, fill: "#c2a3b0", class: "organ" }); // cervelet
}});

LAYERS.organs.push({ frame: "torso", build: g => {
  // +x = gauche anatomique (côté du cœur) ; -x = droite anatomique (côté du foie)
  // Poumons
  mk(g, "path", {
    d: "M -0.08 0.09 C -0.34 0.08, -0.42 0.22, -0.4 0.36 C -0.38 0.48, -0.28 0.53, -0.1 0.5 Z",
    fill: "var(--organ-lung)", class: "organ", opacity: 0.78
  });
  mk(g, "path", {
    d: "M 0.08 0.09 C 0.34 0.08, 0.42 0.22, 0.4 0.36 C 0.38 0.48, 0.3 0.52, 0.16 0.5 C 0.2 0.36, 0.16 0.26, 0.1 0.22 Z",
    fill: "var(--organ-lung)", class: "organ", opacity: 0.78
  });
  // trachée + bronches
  mk(g, "path", { d: "M 0 -0.08 L 0 0.14 M 0 0.14 L -0.13 0.21 M 0 0.14 L 0.13 0.21",
                  stroke: "#c7b4bd", fill: "none", "stroke-width": 0.026, "stroke-linecap": "round" });
  // Cœur (légèrement à gauche, derrière le sternum)
  mk(g, "path", {
    d: "M 0.03 0.2 C 0.14 0.15, 0.23 0.24, 0.16 0.34 C 0.12 0.4, 0.05 0.45, 0.02 0.47 C -0.02 0.43, -0.09 0.34, -0.08 0.27 C -0.07 0.19, 0.0 0.16, 0.03 0.2 Z",
    fill: "var(--organ-heart)", class: "organ"
  });
  // Diaphragme
  mk(g, "path", { d: "M -0.42 0.5 Q 0 0.42, 0.42 0.5", stroke: "#b06a72", fill: "none",
                  "stroke-width": 0.022, opacity: 0.75 });
  // Foie (à DROITE anatomique = -x), avec les deux lobes
  mk(g, "path", {
    d: "M -0.42 0.52 C -0.1 0.5, 0.14 0.53, 0.16 0.58 C 0.14 0.66, -0.06 0.7, -0.28 0.68 C -0.39 0.66, -0.44 0.6, -0.42 0.52 Z",
    fill: "var(--organ-liver)", class: "organ"
  });
  // Estomac (à gauche, sous le diaphragme)
  mk(g, "path", {
    d: "M 0.06 0.52 C 0.24 0.5, 0.36 0.56, 0.32 0.66 C 0.28 0.74, 0.14 0.74, 0.1 0.68 C 0.08 0.62, 0.12 0.58, 0.06 0.52 Z",
    fill: "#c98a6a", class: "organ"
  });
  // Rate
  mk(g, "ellipse", { cx: 0.33, cy: 0.55, rx: 0.07, ry: 0.045, fill: "#8e5a72", class: "organ" });
  // Reins (en arrière, de part et d'autre de la colonne)
  for (const s of [1, -1]) {
    mk(g, "path", {
      d: `M ${s*0.2} 0.6 C ${s*0.3} 0.58, ${s*0.32} 0.72, ${s*0.22} 0.74 C ${s*0.16} 0.73, ${s*0.16} 0.63, ${s*0.2} 0.6 Z`,
      fill: "var(--organ-kidney)", class: "organ", opacity: 0.85
    });
    mk(g, "path", { d: `M ${s*0.2} 0.72 Q ${s*0.12} 0.85, ${s*0.05} 0.95`,
                    stroke: "#9c7b5c", fill: "none", "stroke-width": 0.014, opacity: 0.8 }); // uretères
  }
  // Intestin grêle + côlon
  mk(g, "path", {
    d: "M -0.3 0.7 L -0.3 0.9 Q -0.3 0.96, -0.1 0.96 L 0.28 0.96 Q 0.34 0.96, 0.34 0.86 L 0.34 0.7",
    stroke: "var(--organ-gut)", fill: "none", "stroke-width": 0.075, "stroke-linecap": "round",
    "stroke-linejoin": "round", opacity: 0.9
  });
  mk(g, "path", {
    d: "M -0.16 0.78 q 0.1 -0.04 0.16 0.03 q 0.06 0.07 0.16 0.02 q 0.08 -0.04 0.1 0.04 q -0.06 0.08 -0.16 0.05 q -0.12 -0.03 -0.16 0.04 q -0.06 0.06 -0.14 0.0",
    stroke: "#c08b52", fill: "none", "stroke-width": 0.05, opacity: 0.9, "stroke-linecap": "round"
  });
  // Vessie
  mk(g, "ellipse", { cx: 0, cy: 1.0, rx: 0.09, ry: 0.06, fill: "#c8b86a", class: "organ", opacity: 0.85 });
}});

/* =========================================================================
   COUCHE 5 — VAISSEAUX
   ========================================================================= */
LAYERS.vessels = [];

LAYERS.vessels.push({ frame: "torso", build: g => {
  // Aorte : ascendante, crosse, descendante
  mk(g, "path", { d: "M 0.03 0.42 C 0.03 0.3, 0.02 0.2, -0.02 0.16 C -0.07 0.13, -0.1 0.18, -0.09 0.26 L -0.07 0.5",
                  class: "vessel-a", "stroke-width": 0.035 });
  mk(g, "path", { d: "M -0.07 0.5 L -0.04 0.86", class: "vessel-a", "stroke-width": 0.03 });
  // Carotides + sous-clavières
  for (const s of [1, -1]) {
    mk(g, "path", { d: `M -0.01 0.17 Q ${s*0.04} 0.02, ${s*0.07} -0.22`, class: "vessel-a", "stroke-width": 0.021 });
    mk(g, "path", { d: `M 0 0.16 Q ${s*0.2} 0.06, ${s*0.44} 0.07`, class: "vessel-a", "stroke-width": 0.022 });
    // jugulaires + veine cave
    mk(g, "path", { d: `M ${s*0.03} 0.2 Q ${s*0.1} 0.0, ${s*0.12} -0.22`, class: "vessel-v", "stroke-width": 0.019 });
  }
  mk(g, "path", { d: "M 0.06 0.2 L 0.09 0.55 L 0.06 0.88", class: "vessel-v", "stroke-width": 0.032 }); // veine cave inf.
  // Artères iliaques
  for (const s of [1, -1]) {
    mk(g, "path", { d: `M -0.04 0.86 Q ${s*0.1} 0.92, ${s*0.17} 1.0`, class: "vessel-a", "stroke-width": 0.024 });
  }
  // Réseau capillaire pulmonaire (suggéré)
  for (const s of [1, -1]) {
    mk(g, "path", { d: `M 0 0.24 q ${s*0.14} 0.02 ${s*0.22} 0.12 q ${s*0.06} 0.08 ${s*0.06} 0.16`,
                    class: "vessel-a", "stroke-width": 0.009, opacity: 0.6 });
  }
}});
// Membres supérieurs : brachiale / radiale / ulnaire + veines
for (const [sh, el_] of [[12, 14], [11, 13]]) {
  LAYERS.vessels.push({ frame: "seg", a: sh, b: el_, build: g => {
    mk(g, "path", { d: "M 0.05 0.01 Q 0.5 -0.02, 0.97 -0.02", class: "vessel-a", "stroke-width": 0.028 });
    mk(g, "path", { d: "M 0.05 0.05 Q 0.5 0.06, 0.97 0.05", class: "vessel-v", "stroke-width": 0.024 });
  }});
}
for (const [el_, wr] of [[14, 16], [13, 15]]) {
  LAYERS.vessels.push({ frame: "seg", a: el_, b: wr, build: g => {
    mk(g, "path", { d: "M 0.02 -0.02 Q 0.5 -0.05, 0.98 -0.055", class: "vessel-a", "stroke-width": 0.021 }); // radiale (le pouls)
    mk(g, "path", { d: "M 0.02 0.03 Q 0.5 0.05, 0.98 0.055", class: "vessel-a", "stroke-width": 0.018 });    // ulnaire
    mk(g, "path", { d: "M 0.02 0.08 Q 0.5 0.1, 0.98 0.09", class: "vessel-v", "stroke-width": 0.02 });
  }});
}
for (const [wr, tip] of [[16, 20], [15, 19]]) {
  LAYERS.vessels.push({ frame: "seg", a: wr, b: tip, build: g => {
    mk(g, "path", { d: "M 0.12 0 q 0.2 0.08 0.42 0.06", class: "vessel-a", "stroke-width": 0.022 }); // arcade palmaire
    for (let i = 0; i < 4; i++) {
      const s = (i - 1.5) * 0.075;
      mk(g, "path", { d: `M 0.35 ${s*0.4} L 0.92 ${s*1.15}`, class: "vessel-a", "stroke-width": 0.011, opacity: 0.8 });
    }
  }});
}
// Membres inférieurs : fémorale / poplitée / tibiale + saphène
for (const [hip, kn] of [[24, 26], [23, 25]]) {
  LAYERS.vessels.push({ frame: "seg", a: hip, b: kn, build: g => {
    mk(g, "path", { d: "M 0.04 -0.02 Q 0.5 0.0, 0.96 0.03", class: "vessel-a", "stroke-width": 0.032 }); // fémorale
    mk(g, "path", { d: "M 0.04 0.04 Q 0.5 0.07, 0.96 0.08", class: "vessel-v", "stroke-width": 0.028 }); // saphène
  }});
}
for (const [kn, an] of [[26, 28], [25, 27]]) {
  LAYERS.vessels.push({ frame: "seg", a: kn, b: an, build: g => {
    mk(g, "path", { d: "M 0.04 0.03 Q 0.5 0.04, 0.97 0.03", class: "vessel-a", "stroke-width": 0.022 });
    mk(g, "path", { d: "M 0.04 -0.03 Q 0.5 -0.02, 0.95 -0.02", class: "vessel-a", "stroke-width": 0.015 });
    mk(g, "path", { d: "M 0.06 0.08 Q 0.5 0.09, 0.95 0.07", class: "vessel-v", "stroke-width": 0.02 });
  }});
}
LAYERS.vessels.push({ frame: "head", build: g => {
  for (const s of [1, -1]) {
    mk(g, "path", { d: `M ${s*0.14} 0.6 Q ${s*0.34} 0.2, ${s*0.3} -0.3`, class: "vessel-a", "stroke-width": 0.028 });
    mk(g, "path", { d: `M ${s*0.3} -0.3 q ${s*0.06} -0.14 ${-s*0.06} -0.24`, class: "vessel-a", "stroke-width": 0.016 });
  }
}});

/* Métadonnées d'affichage */
const LAYER_META = [
  { key: "bones",   label: "OS",       color: "var(--bone)" },
  { key: "muscles", label: "MUSCLES",  color: "#e8776a" },
  { key: "nerves",  label: "NERFS",    color: "var(--nerve)" },
  { key: "organs",  label: "ORGANES",  color: "var(--organ-lung)" },
  { key: "vessels", label: "VAISSEAUX", color: "var(--artery)" },
];

/* Ordre de rendu. Compromis entre la profondeur réelle et la lisibilité :
   les organes restent derrière la cage thoracique, mais nerfs et vaisseaux
   passent devant, car ce sont eux qu'on cherche à voir quand on les active. */
const LAYER_ORDER = ["organs", "bones", "muscles", "vessels", "nerves"];

window.MIROIR_LAYERS = { LAYERS, LAYER_META, LAYER_ORDER, mk };

})();
