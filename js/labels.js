/* =========================================================================
   MIROIR ANATOMIQUE — étiquettes anatomiques et fiche d'apprentissage
   -------------------------------------------------------------------------
   Quand on s'attarde sur une zone, le nom de la structure apparaît quelques
   secondes puis s'efface — pour ne pas encombrer l'image en permanence.
   En touchant l'étiquette, on ouvre la fiche complète : nom français, nom
   latin, identifiant officiel, et une recherche libre pour explorer.

   Le nom vient de `pick()` (modules d'Ada, qui rendent le nom d'objet
   Z-Anatomy d'origine), traduit par le dictionnaire TA2 de `terms.js`.

   Interface :
     ETIQ.init({ frameEl })
     ETIQ.setEnabled(bool) / ETIQ.isEnabled()
     ETIQ.tick(now, source)   source = objet exposant pick(x, y)
     ETIQ.ouvrirFiche()
   ========================================================================= */

(function () {

const TERMES = window.MIROIR_TERMES;

/* On n'interroge pas la géométrie à chaque image : le nom ne change que
   lorsqu'on bouge, et un lancer de rayon coûte plus cher qu'un affichage. */
const PERIODE_MS = 280;
const DUREE_AFFICHAGE_MS = 4200;

let frameEl = null;
let actif = false;
let dernierTick = 0;
let structureCourante = null;   // clé de la structure affichée
let masquerA = 0;

let elEtiquette = null, elFiche = null;

function init(ctx) {
  frameEl = ctx.frameEl;

  elEtiquette = document.createElement("button");
  elEtiquette.id = "etiquette";
  elEtiquette.className = "hidden";
  elEtiquette.addEventListener("click", ouvrirFiche);
  document.body.appendChild(elEtiquette);

  elFiche = document.createElement("div");
  elFiche.id = "fiche";
  elFiche.className = "hidden";
  document.body.appendChild(elFiche);
}

function setEnabled(v) {
  actif = !!v;
  if (!actif) cacher();
  else if (TERMES) TERMES.charger();   // dictionnaire chargé à la demande
}
function isEnabled() { return actif; }

function cacher() {
  if (elEtiquette) elEtiquette.classList.add("hidden");
  structureCourante = null;
}

/* Appelé à chaque image ; ne fait un vrai travail que toutes les PERIODE_MS.
   `source` est le module qui sait nommer : MIROIR_HAND en mode main,
   MIROIR_XRAY en mode corps. */
function tick(now, source) {
  if (!actif || !elEtiquette) return;

  if (masquerA && now > masquerA) {
    elEtiquette.classList.add("hidden");
    masquerA = 0;
  }
  if (!source || typeof source.pick !== "function") return;
  if (now - dernierTick < PERIODE_MS) return;
  dernierTick = now;

  // Le point observé est le centre de la lentille si elle est allumée,
  // sinon le centre de l'écran — c'est là que regarde l'utilisateur.
  const L = window.MIROIR_LENS && window.MIROIR_LENS.getState();
  let x, y;
  if (L && L.enabled) { x = L.cx; y = L.cy; }
  else {
    const d = window.MIROIR_ENGINE && window.MIROIR_ENGINE.dims;
    if (!d) return;
    x = d.W / 2; y = d.H / 2;
  }

  let r = null;
  try { r = source.pick(x, y); } catch { return; }

  // On n'affiche que si le point tombe vraiment dans la structure : sinon on
  // annoncerait le voisin, ce qui est pire que de se taire.
  if (!r || !r.nom || (r.dansLaStructure === false)) return;
  if (r.nom === structureCourante) { masquerA = performance.now() + DUREE_AFFICHAGE_MS; return; }

  structureCourante = r.nom;
  afficher(r);
}

function traduire(nom) {
  if (TERMES && TERMES.pret()) {
    const t = TERMES.chercher(nom);
    if (t) return t;
  }
  return null;
}

/* Le suffixe Z-Anatomy `.l` / `.r` porte le côté : on le rend lisible. */
function cote(nom) {
  if (/\.l$/i.test(nom)) return " gauche";
  if (/\.r$/i.test(nom)) return " droit";
  return "";
}

function afficher(r) {
  const t = traduire(r.nom);
  const libelle = t ? t.fr + cote(r.nom) : r.nom;
  elEtiquette.innerHTML =
    `<span class="etiq-nom">${libelle}</span>` +
    (t ? `<span class="etiq-lat">${t.la}</span>` : "") +
    `<span class="etiq-plus">en savoir plus</span>`;
  elEtiquette.dataset.nom = r.nom;
  elEtiquette.classList.remove("hidden");
  masquerA = performance.now() + DUREE_AFFICHAGE_MS;
}

/* ---------------------------------------------------------------- Fiche */
function ouvrirFiche() {
  const nom = elEtiquette.dataset.nom || structureCourante;
  const t = traduire(nom);
  elFiche.innerHTML = `
    <div class="fiche-tete">
      <h2>${t ? t.fr + cote(nom) : nom}</h2>
      <button class="fiche-fermer" aria-label="Fermer">×</button>
    </div>
    <div class="fiche-corps">
      ${t ? `
        <div class="fiche-ligne"><span>Nom latin</span><b>${t.la}</b></div>
        <div class="fiche-ligne"><span>Nom anglais</span><b>${t.en || "—"}</b></div>
        <div class="fiche-ligne"><span>Référence</span><b>TA2 ${t.id}</b></div>
      ` : `<p class="fiche-note">Structure « ${nom} » — pas encore de fiche
           traduite. Le nom affiché est celui du modèle anatomique.</p>`}
      <p class="fiche-note">Nomenclature : Terminologia Anatomica 2, référence
        internationale. 8 887 structures consultables ci-dessous.</p>
      <input type="search" id="fiche-rech" placeholder="Chercher une structure (ex. fémur, nerf, poumon)…">
      <div id="fiche-res"></div>
    </div>`;
  elFiche.classList.remove("hidden");
  elFiche.querySelector(".fiche-fermer").onclick = () => elFiche.classList.add("hidden");

  const rech = elFiche.querySelector("#fiche-rech");
  const res = elFiche.querySelector("#fiche-res");
  rech.addEventListener("input", () => {
    if (!TERMES || !TERMES.pret()) { res.innerHTML = "<p class='fiche-note'>Dictionnaire en cours de chargement…</p>"; return; }
    const liste = TERMES.rechercher(rech.value, 30);
    res.innerHTML = liste.length
      ? liste.map(x => `<div class="fiche-res-item"><b>${x.fr}</b><span>${x.la}</span></div>`).join("")
      : "<p class='fiche-note'>Aucun résultat.</p>";
  });
}

window.MIROIR_ETIQ = { init, setEnabled, isEnabled, tick, ouvrirFiche, cacher };

})();
