/* =========================================================================
   MIROIR ANATOMIQUE — navigation par distance
   -------------------------------------------------------------------------
   Idée du chef : pas de bouton de zoom, pas de menu. On approche le téléphone,
   on grossit ET on descend plus profond dans le corps ; on recule, on remonte
   vers la surface. Comme une dissection qu'on ferait en avançant la main.

   ⚠️ RÈGLE ABSOLUE : la distance PROPOSE, les boutons DÉCIDENT.
   Dès que l'utilisateur touche une couche à la main, l'automatisme se coupe et
   ne se rallume que s'il le redemande. Lui retirer le contrôle serait une
   régression, pas une fonctionnalité.

   Mesure : on n'a pas besoin de mètres. La TAILLE APPARENTE d'un segment connu
   (la largeur d'épaules) est monotone avec la proximité, et elle ne demande ni
   calibration ni focale. Plus la personne occupe l'écran, plus elle est près.

   Interface :
     PROF.setEnabled(bool) / PROF.isEnabled()
     PROF.update(tailleRelative)   appelé à chaque image
     PROF.etat()                   pour le bandeau
   ========================================================================= */

(function () {

/* Les couches, de la plus superficielle à la plus profonde, avec la taille
   apparente à laquelle chacune s'installe pleinement. Entre deux paliers,
   on demande un fondu continu au moteur 3D.

   ⚠️ N'y mettre QUE des couches ayant une vraie couverture 3D sur tout le
   corps. J'y avais placé « nerves » : mesuré, cette couche ne fait que 3 500
   pixels à l'écran contre 58 000 pour les muscles, parce que Z-Anatomy ne
   contient que le cerveau et les organes des sens — ni nerf ni vaisseau des
   membres. Le palier intermédiaire vidait donc l'écran de 91 % en pleine
   descente. Voir COUVERTURE_3D dans mirror.js : seuls bones, muscles et
   organs sont réellement couverts, et organs est limité au tronc. */
const ECHELLE = [
  { cle: "muscles", taille: 0.24 },
  { cle: "bones",   taille: 0.62 },
];

/* Largeur de la bande de transition, en fraction de l'écart entre deux
   paliers. Trop étroite, le passage est brutal ; trop large, on est toujours
   entre deux couches et jamais sur une image franche. */
const BANDE = 0.55;

/* Lissage : la taille apparente tremble d'une image à l'autre, et un fondu qui
   oscille est pire qu'un basculement net. */
const LISSAGE = 0.12;

let actif = false;
let tailleLissee = null;
let dernier = { sortante: null, entrante: null, t: 0, palier: null };

function setEnabled(v) {
  actif = !!v;
  if (!actif) {
    const X = window.MIROIR_XRAY;
    if (X && X.clearTransition) X.clearTransition();
    dernier = { sortante: null, entrante: null, t: 0, palier: null };
    tailleLissee = null;
  }
}
function isEnabled() { return actif; }

/* Convertit la taille apparente en position continue sur l'échelle :
   0 = première couche, 1 = deuxième, etc. */
function positionSurEchelle(taille) {
  if (taille <= ECHELLE[0].taille) return 0;
  const dernierIdx = ECHELLE.length - 1;
  if (taille >= ECHELLE[dernierIdx].taille) return dernierIdx;

  for (let i = 0; i < dernierIdx; i++) {
    const a = ECHELLE[i].taille, b = ECHELLE[i + 1].taille;
    if (taille >= a && taille <= b) return i + (taille - a) / (b - a);
  }
  return 0;
}

function update(taille) {
  if (!actif || taille === null || !isFinite(taille)) return;

  const X = window.MIROIR_XRAY;
  if (!X || !X.setTransition) return;

  tailleLissee = tailleLissee === null
    ? taille
    : tailleLissee + LISSAGE * (taille - tailleLissee);

  const p = positionSurEchelle(tailleLissee);
  const bas = Math.min(Math.floor(p), ECHELLE.length - 2);
  const frac = p - bas;

  /* Hors de la bande de transition, on est franchement sur une couche : on
     demande un fondu complet plutôt que de laisser un état intermédiaire. */
  const marge = (1 - BANDE) / 2;
  let t;
  if (frac <= marge) t = 0;
  else if (frac >= 1 - marge) t = 1;
  else t = (frac - marge) / BANDE;

  const sortante = ECHELLE[bas].cle;
  const entrante = ECHELLE[bas + 1].cle;

  // On n'appelle le moteur que si quelque chose a bougé de façon perceptible.
  if (sortante === dernier.sortante && entrante === dernier.entrante &&
      Math.abs(t - dernier.t) < 0.02) return;

  X.setTransition(sortante, entrante, t);
  dernier = { sortante, entrante, t, palier: t < 0.5 ? sortante : entrante };
}

function etat() {
  if (!actif) return null;
  return {
    couche: dernier.palier,
    sortante: dernier.sortante,
    entrante: dernier.entrante,
    t: dernier.t,
    taille: tailleLissee
  };
}

window.MIROIR_PROF = { setEnabled, isEnabled, update, etat, ECHELLE };

})();
