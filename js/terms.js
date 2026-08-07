/* =========================================================================
   MIROIR ANATOMIQUE — dictionnaire anatomique
   -------------------------------------------------------------------------
   Donne le nom français, le nom latin et l'identifiant officiel de n'importe
   quelle structure, à partir du nom d'objet porté par les modèles 3D.

   Source : Terminologia Anatomica 2 (TA2), la nomenclature anatomique
   internationale officielle, livrée avec Z-Anatomy. 8 887 entrées.
   Construit par `scripts/build_terms.py` → `assets/anatomy/termes.json`.

   Chargé À LA DEMANDE (770 Ko) : seulement quand l'utilisateur allume la
   couche d'informations. Inutile d'imposer ça à qui veut juste regarder.

   Interface :
     TERMES.charger()            -> Promise, idempotent
     TERMES.pret()
     TERMES.chercher(nom)        -> { fr, la, id, en } ou null
     TERMES.rechercher(texte, n) -> liste de résultats (recherche libre)
   ========================================================================= */

(function () {

const URL_DICO = "assets/anatomy/termes.json";

let dico = null;
let chargement = null;

/* Même normalisation que le script Python : sans accents, sans ponctuation,
   en minuscules. L'exportateur glTF supprime les points (`foot.l` → `footl`),
   d'où le retrait de toute ponctuation. */
function cle(nom) {
  return (nom || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function charger() {
  if (chargement) return chargement;
  chargement = fetch(URL_DICO)
    .then(r => {
      if (!r.ok) throw new Error("dictionnaire introuvable (" + r.status + ")");
      return r.json();
    })
    .then(j => { dico = j; return true; })
    .catch(e => { console.warn("Dictionnaire anatomique :", e.message); chargement = null; return false; });
  return chargement;
}

function pret() { return dico !== null; }

function decouper(valeur, k) {
  const [fr, la, id] = valeur.split("|");
  return { fr, la, id, cle: k };
}

/* Cherche une structure. Tolérant : essaie le nom entier, puis retire les
   suffixes de côté que Z-Anatomy ajoute (`.l`, `.r`, `_L`…), puis tente un
   préfixe — un objet nommé « Biceps brachii long head » retombe ainsi sur
   « Biceps brachii ». */
function chercher(nom) {
  if (!dico || !nom) return null;

  /* Le suffixe de côté se retire AVANT la normalisation, tant que le point est
     encore là. Sinon « Tibia.l » devient « tibial » — qui est un autre mot du
     dictionnaire (l'adjectif tibial), et on afficherait une absurdité. */
  const sansCote = String(nom).replace(/\.(l|r)$/i, "");

  let k = cle(sansCote);
  if (dico[k]) return decouper(dico[k], k);

  // nom complet, au cas où le point ferait partie du nom
  k = cle(nom);
  if (dico[k]) return decouper(dico[k], k);

  // singulier / pluriel : TA2 stocke « Lungs », les objets disent « Lung »
  const base0 = cle(sansCote);
  if (dico[base0 + "s"]) return decouper(dico[base0 + "s"], base0 + "s");
  if (base0.endsWith("s") && dico[base0.slice(0, -1)]) {
    const sing = base0.slice(0, -1);
    return decouper(dico[sing], sing);
  }

  // repli par préfixe décroissant, en s'arrêtant avant les clés trop courtes
  const base = cle(sansCote);
  for (let n = base.length - 1; n >= 6; n--) {
    const p = base.slice(0, n);
    if (dico[p]) return decouper(dico[p], p);
  }
  return null;
}

/* Recherche libre, pour laisser l'utilisateur explorer ce qu'il veut. */
function rechercher(texte, limite = 25) {
  if (!dico || !texte) return [];
  const q = texte.trim().toLowerCase();
  if (q.length < 2) return [];
  const qk = cle(texte);
  const exacts = [], partiels = [];

  for (const k in dico) {
    const v = dico[k];
    const bas = v.toLowerCase();
    if (k.startsWith(qk) || bas.startsWith(q)) {
      exacts.push(decouper(v, k));
      if (exacts.length >= limite) break;
    } else if (partiels.length < limite && (k.includes(qk) || bas.includes(q))) {
      partiels.push(decouper(v, k));
    }
  }
  return exacts.concat(partiels).slice(0, limite);
}

window.MIROIR_TERMES = { charger, pret, chercher, rechercher };

})();
