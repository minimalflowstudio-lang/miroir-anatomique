/* =========================================================================
   MIROIR ANATOMIQUE — module PLAIE (aide aux premiers secours)
   -------------------------------------------------------------------------
   ⚠️ CE MODULE NE POSE AUCUN DIAGNOSTIC ET NE RECONNAÎT PAS UNE PLAIE
      AUTOMATIQUEMENT PAR L'IMAGE. Il fait deux choses honnêtes :

      1. REPÉRAGE ANATOMIQUE — tu touches l'endroit sur ton corps à l'écran ;
         l'app utilise la détection de pose pour nommer la région et lister
         les structures qui passent dessous (artères, nerfs, tendons, organes).
         C'est de l'information anatomique, pas une lecture de la blessure.

      2. TRIAGE GUIDÉ — une suite de questions fondées sur les critères
         d'alerte classiques des premiers secours, qui aboutit à un niveau
         d'urgence, des gestes concrets et le bon numéro à appeler.

   Sources des critères : recommandations générales de premiers secours
   (contrôle du saignement, signes de choc, critères de suture, signes
   d'infection, prophylaxie tétanos). En cas de doute → appeler.
   ========================================================================= */

(function () {

/* ------------------------------------------------------ Numéros d'urgence */
const REGIONS = {
  ch: { label: "Suisse", urgence: "144", secours: "112", tox: "145", extra: { label: "Rega (hélicoptère)", num: "1414" } },
  fr: { label: "France", urgence: "15",  secours: "112", tox: "0145425959", extra: null },
  be: { label: "Belgique", urgence: "112", secours: "112", tox: "070245245", extra: null },
  ca: { label: "Canada", urgence: "911", secours: "911", tox: "18004639009", extra: null },
};
let region = REGIONS[localStorage.getItem("miroir.region") || "ch"] || REGIONS.ch;

/* ------------------------------------------------ Anatomie par région ---- */
/* struct : ce qui passe sous la peau à cet endroit
   risque : le danger spécifique à connaître
   compression : où comprimer en amont si ça saigne fort              */
const ZONES = {
  tete: {
    nom: "Tête / cuir chevelu",
    struct: "Os du crâne, artères temporales (très superficielles), cerveau en dessous.",
    risque: "Le cuir chevelu saigne énormément même pour une plaie bénigne. Mais toute plaie à la tête avec perte de connaissance, vomissements, confusion ou somnolence = urgence.",
    compression: "Comprimer directement sur la plaie avec un linge propre. Ne jamais appuyer sur une zone enfoncée du crâne.",
    layers: { bones: true, vessels: true }
  },
  cou: {
    nom: "Cou",
    struct: "Artères carotides, veines jugulaires, trachée, œsophage, colonne cervicale, nerfs.",
    risque: "ZONE CRITIQUE. Une plaie profonde au cou peut toucher une carotide (hémorragie foudroyante) ou les voies respiratoires. Toute plaie du cou autre qu'une éraflure superficielle = appel immédiat.",
    compression: "Comprimer directement, JAMAIS des deux côtés du cou à la fois, ne jamais faire de garrot.",
    layers: { vessels: true, nerves: true }
  },
  epaules: {
    nom: "Épaule / clavicule",
    struct: "Clavicule, articulation de l'épaule, plexus brachial (nerfs du bras), artère sous-clavière.",
    risque: "Le plexus brachial passe juste sous la clavicule : une plaie profonde peut entraîner une perte de force ou de sensibilité du bras.",
    compression: "Comprimer directement au-dessus de la clavicule.",
    layers: { bones: true, nerves: true }
  },
  thorax: {
    nom: "Thorax (cage thoracique)",
    struct: "Côtes, sternum, poumons, cœur, aorte, artères entre les côtes.",
    risque: "ZONE CRITIQUE. Une plaie qui traverse la paroi peut faire entrer de l'air autour du poumon (pneumothorax) — difficulté à respirer croissante. Toute plaie pénétrante du thorax = appel immédiat.",
    compression: "Ne pas retirer un objet planté. Si la plaie « aspire » l'air, la couvrir sans la sceller complètement, et appeler.",
    layers: { bones: true, organs: true }
  },
  abdo_d: {
    nom: "Abdomen — côté droit",
    struct: "Foie (juste sous les côtes à droite), vésicule biliaire, côlon ascendant, appendice plus bas, rein droit en arrière.",
    risque: "ZONE CRITIQUE. Le foie saigne beaucoup et l'hémorragie peut être interne, donc invisible. Plaie pénétrante ou choc violent = appel.",
    compression: "Ne rien donner à boire ni à manger. Ne pas remettre en place ce qui sort. Allonger, jambes fléchies.",
    layers: { organs: true }
  },
  abdo_g: {
    nom: "Abdomen — côté gauche",
    struct: "Estomac, rate (fragile, sous les côtes gauches), côlon descendant, rein gauche en arrière.",
    risque: "ZONE CRITIQUE. La rate se rompt facilement lors d'un choc et saigne en interne, parfois avec plusieurs heures de retard. Plaie pénétrante ou choc violent = appel.",
    compression: "Ne rien donner à boire ni à manger. Ne pas remettre en place ce qui sort. Allonger, jambes fléchies.",
    layers: { organs: true }
  },
  bassin: {
    nom: "Bassin / aine",
    struct: "Os iliaques, artère et veine fémorales (à l'aine, très gros calibre), nerf fémoral, vessie.",
    risque: "ZONE CRITIQUE. L'artère fémorale à l'aine est l'un des saignements les plus rapidement mortels du corps. Un garrot n'y est pas posable : seule la compression très forte fonctionne.",
    compression: "Enfoncer le poing ou le talon de la main dans le pli de l'aine, de tout son poids, sans relâcher jusqu'aux secours.",
    layers: { vessels: true, bones: true }
  },
  bras_d: { nom: "Bras droit (épaule → coude)", ...brasInfo() },
  bras_g: { nom: "Bras gauche (épaule → coude)", ...brasInfo() },
  avbras_d: { nom: "Avant-bras droit", ...avbrasInfo() },
  avbras_g: { nom: "Avant-bras gauche", ...avbrasInfo() },
  main_d: { nom: "Main droite", ...mainInfo() },
  main_g: { nom: "Main gauche", ...mainInfo() },
  cuisse_d: { nom: "Cuisse droite", ...cuisseInfo() },
  cuisse_g: { nom: "Cuisse gauche", ...cuisseInfo() },
  jambe_d: { nom: "Jambe droite (genou → cheville)", ...jambeInfo() },
  jambe_g: { nom: "Jambe gauche (genou → cheville)", ...jambeInfo() },
  pied_d: { nom: "Pied droit", ...piedInfo() },
  pied_g: { nom: "Pied gauche", ...piedInfo() },
};

function brasInfo() { return {
  struct: "Humérus, artère brachiale (face interne), nerfs médian, ulnaire et radial, biceps et triceps.",
  risque: "L'artère brachiale longe la face interne du bras : une plaie profonde de ce côté peut saigner très fort. Le nerf radial passe en spirale autour de l'os — une atteinte donne une main qui « tombe ».",
  compression: "Comprimer la plaie. Si le saignement ne cède pas, garrot possible à la racine du bras (noter l'heure).",
  layers: { vessels: true, nerves: true } }; }

function avbrasInfo() { return {
  struct: "Radius et ulna, artères radiale (côté pouce, le pouls) et ulnaire, tendons fléchisseurs et extenseurs, nerfs médian et ulnaire.",
  risque: "Beaucoup de tendons et de nerfs juste sous une peau fine. Si un doigt ne bouge plus ou ne sent plus après la coupure, un tendon ou un nerf est probablement sectionné → chirurgie.",
  compression: "Comprimer la plaie et surélever. Garrot possible plus haut si hémorragie non contrôlable.",
  layers: { vessels: true, nerves: true } }; }

function mainInfo() { return {
  struct: "Métacarpes et phalanges, arcades artérielles palmaires, tendons fléchisseurs, nerfs digitaux (sur les côtés des doigts).",
  risque: "Une coupure à la main paraît bénigne mais peut sectionner un tendon ou un nerf digital. Test simple : plier chaque doigt un par un, et vérifier la sensibilité de la pulpe.",
  compression: "Comprimer et lever la main au-dessus du cœur. Un doigt sectionné : envelopper le fragment dans un linge propre, dans un sac, posé sur de la glace (jamais au contact direct).",
  layers: { bones: true, nerves: true } }; }

function cuisseInfo() { return {
  struct: "Fémur (le plus gros os du corps), artère fémorale, veine saphène, nerf sciatique en arrière, quadriceps.",
  risque: "ZONE À RISQUE. L'artère fémorale traverse toute la cuisse : une plaie profonde peut faire perdre un litre de sang en quelques minutes. Une fracture du fémur saigne aussi énormément à l'intérieur.",
  compression: "Compression très forte, à deux mains si besoin. Garrot posable à la racine de la cuisse si le sang continue de couler.",
  layers: { vessels: true, bones: true } }; }

function jambeInfo() { return {
  struct: "Tibia (juste sous la peau en avant), fibula, artère tibiale, nerf tibial, mollet et tendon d'Achille.",
  risque: "Le tibia est directement sous la peau : les plaies exposent facilement l'os. Une plaie avec os visible = urgence chirurgicale (risque d'infection osseuse).",
  compression: "Comprimer et surélever la jambe. Garrot posable au-dessus du genou si nécessaire.",
  layers: { bones: true, vessels: true } }; }

function piedInfo() { return {
  struct: "Tarse, métatarses, artère du dos du pied, tendons extenseurs, aponévrose plantaire.",
  risque: "Les plaies plantaires par objet perforant (clou, verre) s'infectent facilement et cachent souvent un corps étranger. Statut tétanos à vérifier systématiquement.",
  compression: "Comprimer, surélever, ne pas marcher dessus. Ne pas retirer un objet profondément planté.",
  layers: { bones: true, vessels: true } }; }

/* ---------------------------------------------------- Questions de triage */
const Q = [
  { id: "type", q: "De quoi s'agit-il ?", sub: "Choisis ce qui décrit le mieux la blessure.",
    opts: [
      { v: "coupure", l: "Coupure / plaie ouverte", h: "Couteau, verre, tôle, chute…" },
      { v: "brulure", l: "Brûlure", h: "Chaleur, liquide bouillant, produit chimique, électricité" },
      { v: "morsure", l: "Morsure ou griffure", h: "Animal ou humain" },
      { v: "ecrase", l: "Écrasement, choc, objet planté", h: "Coincement, impact violent, corps étranger" },
    ]},

  { id: "saignement", q: "Comment saigne-t-elle ?", sub: "Regarde pendant quelques secondes, sans retirer la compresse.",
    when: a => a.type !== "brulure",
    opts: [
      { v: "gicle", l: "Le sang gicle ou pulse", h: "Par jets, au rythme du cœur — artère touchée", danger: true },
      { v: "continu", l: "Ça coule sans s'arrêter", h: "Malgré 10 minutes de compression ferme", danger: true },
      { v: "suinte", l: "Ça suinte ou saigne peu", h: "S'arrête ou ralentit avec une compression" },
      { v: "arrete", l: "Ça ne saigne plus", h: "Le saignement est déjà arrêté" },
    ]},

  { id: "profondeur", q: "Quelle est l'allure de la plaie ?", sub: "Sans frotter ni écarter la plaie.",
    when: a => a.type === "coupure" || a.type === "ecrase" || a.type === "morsure",
    opts: [
      { v: "grave", l: "On voit de la graisse, du muscle, un tendon ou l'os", h: "Ou un objet est resté planté dedans", danger: true },
      { v: "baille", l: "Les bords s'écartent, la plaie bâille", h: "Plus longue que 1–2 cm, bords qui ne se rejoignent pas" },
      { v: "nette", l: "Coupure nette, bords qui se rejoignent", h: "Type coupure de papier ou de couteau fine" },
      { v: "eraflure", l: "Éraflure superficielle", h: "La peau est râpée mais pas traversée" },
    ]},

  { id: "brulureGrade", q: "Quelle est l'étendue et l'aspect de la brûlure ?", sub: "La paume de ta main = environ 1 % de la surface du corps.",
    when: a => a.type === "brulure",
    opts: [
      { v: "grave", l: "Plus grande que ta paume, OU peau blanche / brune / cartonnée, OU indolore", h: "Ou brûlure électrique, chimique, ou par inhalation", danger: true },
      { v: "zone", l: "Sur le visage, les mains, les pieds, une articulation ou les parties génitales", h: "Même si elle est petite", danger: true },
      { v: "cloques", l: "Cloques, rouge et très douloureuse, plus petite que la paume", h: "Deuxième degré limité" },
      { v: "rouge", l: "Rouge, douloureuse, sans cloque", h: "Type coup de soleil" },
    ]},

  { id: "etat", q: "Comment se sent la personne blessée ?", sub: "Ce sont les signes qui comptent le plus. Coche le pire qui s'applique.",
    opts: [
      { v: "choc", l: "Pâle, moite, froide, cœur qui s'emballe, confuse ou somnolente", h: "Signes de choc — le corps manque de sang", danger: true },
      { v: "respire", l: "Du mal à respirer, ou douleur qui augmente vite", h: "", danger: true },
      { v: "engourdi", l: "Zone insensible, fourmillements, un doigt ou un membre ne bouge plus", h: "Nerf ou tendon possiblement touché" },
      { v: "ok", l: "Consciente, normale, seulement la douleur de la plaie", h: "" },
    ]},

  { id: "terrain", q: "Un de ces éléments est-il vrai ?", sub: "Ils changent la conduite à tenir.",
    opts: [
      { v: "infection", l: "Rougeur qui s'étend, chaleur, pus, fièvre, ou traînée rouge qui remonte", h: "Signes d'infection — la traînée rouge est urgente", danger: true },
      { v: "sale", l: "Plaie sale, terre, rouille, morsure, ou vaccin tétanos vieux de plus de 10 ans", h: "" },
      { v: "fragile", l: "Diabète, anticoagulants, immunodéprimé, très jeune enfant ou personne âgée", h: "Cicatrisation et saignement plus à risque" },
      { v: "rien", l: "Rien de tout ça", h: "" },
    ]},
];

/* ------------------------------------------------------------ Décision --- */
const CRITICAL_ZONES = ["cou", "thorax", "abdo_d", "abdo_g", "bassin"];

function decide(a, zoneKey) {
  const R = [];   // raisons
  let level = 0;  // 0 = maison, 1 = consultation, 2 = urgence, 3 = appel immédiat

  const bump = (l, why) => { if (l > level) level = l; R.push(why); };

  if (a.saignement === "gicle") bump(3, "Un saignement qui gicle ou pulse signe une artère touchée : c'est une urgence vitale, chaque minute compte.");
  if (a.saignement === "continu") bump(3, "Un saignement qui ne cède pas après 10 minutes de compression ferme ne s'arrêtera pas seul.");
  if (a.etat === "choc") bump(3, "Les signes de choc (pâleur, sueurs froides, confusion) veulent dire que le corps manque déjà de sang. C'est une urgence vitale, même si la plaie paraît petite.");
  if (a.etat === "respire") bump(3, "Une gêne respiratoire ou une douleur qui augmente vite peut signer une atteinte interne.");
  if (a.profondeur === "grave") bump(3, "Voir du muscle, un tendon, de l'os, ou un objet resté planté, impose une prise en charge chirurgicale immédiate.");
  if (a.brulureGrade === "grave") bump(3, "Une brûlure étendue, blanche/cartonnée ou indolore est une brûlure profonde : les terminaisons nerveuses sont détruites. Les brûlures chimiques et électriques sont toujours à évaluer en urgence.");
  if (zoneKey && CRITICAL_ZONES.includes(zoneKey) && a.profondeur !== "eraflure" && a.type !== "brulure")
    bump(3, `La zone touchée (${ZONES[zoneKey].nom}) contient des organes ou de gros vaisseaux : une plaie autre que superficielle s'y évalue toujours en urgence, car l'hémorragie peut être interne et invisible.`);
  if (a.terrain === "infection" ) bump(2, "Une rougeur qui s'étend, du pus, de la fièvre ou surtout une traînée rouge qui remonte le membre signent une infection qui progresse. À voir aujourd'hui.");
  if (a.etat === "engourdi") bump(2, "Une perte de sensibilité ou de mouvement oriente vers un nerf ou un tendon sectionné : réparable, mais dans un délai court.");
  if (a.brulureGrade === "zone") bump(2, "Une brûlure du visage, des mains, des pieds, d'une articulation ou des parties génitales se soigne en milieu médical, même petite : le risque fonctionnel et cicatriciel est élevé.");
  if (a.profondeur === "baille") bump(2, "Une plaie dont les bords s'écartent a besoin d'être refermée (points, colle ou bandes) — idéalement dans les 6 heures pour limiter l'infection et la cicatrice.");
  if (a.type === "morsure") bump(2, "Toute morsure est considérée comme infectée d'emblée (bouche = bactéries), et pose la question de la rage et du tétanos. Une morsure ne se recoud généralement pas.");
  if (a.brulureGrade === "cloques") bump(1, "Une brûlure avec cloques est un deuxième degré : un avis médical est conseillé, et il ne faut pas percer les cloques.");
  if (a.terrain === "sale") bump(1, "Plaie souillée ou vaccin tétanos de plus de 10 ans : un rappel est à discuter, idéalement dans les 24–48 h.");
  if (a.terrain === "fragile") bump(1, "Diabète, anticoagulants ou immunodépression ralentissent la cicatrisation et augmentent le risque d'infection ou de saignement : un avis est prudent.");

  return { level, reasons: R };
}

/* Gestes : liste par situation. Les entrées « no » sont les erreurs à éviter. */
function gestes(a, zoneKey, level) {
  const g = [];
  const z = zoneKey ? ZONES[zoneKey] : null;

  if (level >= 3) g.push({ t: `Appelle le ${region.urgence} MAINTENANT, ou fais appeler quelqu'un pendant que tu t'occupes de la personne. Mets le téléphone sur haut-parleur.` });

  if (a.type === "brulure") {
    g.push({ t: "Refroidis à l'eau tempérée (15–25 °C), sans pression, pendant 15 à 20 minutes. Ni glace, ni eau glacée." });
    g.push({ t: "Retire bagues, montre et vêtements autour de la zone AVANT que ça gonfle — sauf ce qui colle à la peau." });
    g.push({ t: "Couvre avec un linge propre, sec et non pelucheux (pas de coton)." });
    g.push({ t: "Ne perce pas les cloques, n'applique ni beurre, ni huile, ni dentifrice, ni glaçon.", no: true });
    if (a.brulureGrade === "grave") g.push({ t: "Brûlure chimique : rince abondamment à l'eau courante 20 minutes. Brûlure électrique : ne touche pas la personne avant d'avoir coupé le courant." });
  } else {
    g.push({ t: "Comprime directement la plaie avec un linge propre (ou ta main gantée), fort et sans relâcher pour regarder." });
    if (a.saignement === "gicle" || a.saignement === "continu") {
      g.push({ t: "Ne retire pas le linge imbibé : ajoute une compresse par-dessus et continue d'appuyer." });
      g.push({ t: "Allonge la personne et surélève ses jambes (sauf plaie du thorax, du bassin ou fracture) — ça garde le sang au cœur et au cerveau." });
      if (z?.compression) g.push({ t: z.compression });
      g.push({ t: "Couvre-la pour éviter qu'elle se refroidisse : le froid aggrave le saignement." });
    } else {
      g.push({ t: "Rince la plaie à l'eau courante propre pendant 5 minutes pour enlever terre et débris." });
      g.push({ t: "Sèche autour, désinfecte, puis couvre avec un pansement propre." });
    }
    g.push({ t: "Ne retire jamais un objet planté dans une plaie : il fait barrage. Stabilise-le autour et laisse les secours l'ôter.", no: true });
  }

  if (level >= 3) {
    g.push({ t: "Ne donne rien à boire, à manger ni de médicament : une opération est peut-être nécessaire." , no: true });
    g.push({ t: "Reste avec elle, parle-lui, surveille qu'elle reste consciente et respire." });
  }
  if (level === 2) g.push({ t: "Prends une photo de la plaie maintenant : elle servira de référence pour juger de l'évolution." });
  if (level <= 1) {
    g.push({ t: "Surveille pendant 48 h : si la rougeur s'étend, si ça chauffe, si du pus apparaît, si la fièvre monte ou si une traînée rouge remonte le membre — consulte sans attendre." });
    g.push({ t: "Change le pansement chaque jour et garde la plaie propre et sèche." });
  }
  return g;
}

const VERDICTS = {
  3: { cls: "red", titre: "Urgence — appelle tout de suite",
       txt: `Les éléments que tu as décrits correspondent à une situation où l'on n'attend pas. Appelle le ${region.urgence} et suis les gestes ci-dessous en attendant.` },
  2: { cls: "orange", titre: "À faire voir aujourd'hui",
       txt: "Ce n'est pas une urgence vitale, mais cela doit être examiné par un médecin dans les heures qui viennent — pas demain." },
  1: { cls: "orange", titre: "Avis médical conseillé",
       txt: "Tu peux faire les premiers soins toi-même, mais un passage chez le médecin ou en pharmacie est recommandé dans les 24 à 48 heures." },
  0: { cls: "green", titre: "Soin à domicile, puis surveillance",
       txt: "D'après ce que tu as décrit, cela peut se soigner à la maison. La surveillance des 48 prochaines heures est la partie importante." },
};

/* ============================================================== INTERFACE */
const panel   = document.getElementById("aidPanel");
const bodyEl  = document.getElementById("aidBody");
const footEl  = document.getElementById("aidFoot");
const pickHint = document.getElementById("pickHint");

let answers = {};
let zoneKey = null;
let step = -1;          // -1 = repérage de zone
let picking = false;

function open() {
  answers = {}; zoneKey = null; step = -1;
  panel.classList.remove("hidden");
  renderZoneStep();
}
function close() {
  panel.classList.add("hidden");
  stopPicking();
  window.MIROIR_ENGINE.hideMark();
}
document.getElementById("aidClose").addEventListener("click", close);

/* --- Étape de repérage anatomique --- */
function renderZoneStep() {
  const canPick = window.MIROIR_ENGINE.hasBody();
  bodyEl.innerHTML = `
    <div class="aid-step">
      <h3>Où est la blessure ?</h3>
      <div class="sub">Touche l'endroit sur ton corps à l'écran. L'app te dira quelle région c'est et ce qui passe juste dessous — utile pour savoir à quoi faire attention.</div>
      ${canPick ? "" : `<div class="sub" style="color:#ffa726">Personne détectée : place-toi devant la caméra, ou passe cette étape.</div>`}
      <div id="zoneResult"></div>
    </div>`;
  footEl.innerHTML = `
    <button class="ghost" id="skipZone">Passer cette étape</button>
    <button class="primary" id="pickZone" ${canPick ? "" : "disabled"}>Toucher la zone</button>`;
  document.getElementById("skipZone").onclick = () => { stopPicking(); step = 0; renderQuestion(); };
  document.getElementById("pickZone").onclick = startPicking;
  if (canPick) startPicking();
}

function startPicking() {
  picking = true;
  panel.classList.add("hidden");
  pickHint.classList.remove("hidden");
  pickHint.textContent = "Touche l'endroit de la blessure sur ton corps";
  const el = window.MIROIR_ENGINE.frameEl;
  el.style.pointerEvents = "auto";
  el.addEventListener("pointerdown", onPick);
}
function stopPicking() {
  picking = false;
  pickHint.classList.add("hidden");
  const el = window.MIROIR_ENGINE.frameEl;
  el.style.pointerEvents = "";
  el.removeEventListener("pointerdown", onPick);
}
function onPick(e) {
  if (!picking) return;
  const hit = window.MIROIR_ENGINE.locate(e.clientX, e.clientY);
  window.MIROIR_ENGINE.showMark(e.clientX, e.clientY);
  stopPicking();
  panel.classList.remove("hidden");
  if (!hit || !ZONES[hit.zone]) {
    zoneKey = null;
    showZoneResult(null);
  } else {
    zoneKey = hit.zone;
    showZoneResult(ZONES[hit.zone]);
    if (ZONES[hit.zone].layers) window.MIROIR_ENGINE.setLayers(ZONES[hit.zone].layers);
  }
}
function showZoneResult(z) {
  const box = document.getElementById("zoneResult");
  if (!box) return;
  if (!z) {
    box.innerHTML = `<div class="zone-box"><div class="label">Zone</div>
      <div class="name">Non reconnue</div>
      <div class="under">Le point touché n'est pas sur le corps détecté. Réessaie, ou passe l'étape — le triage fonctionne quand même.</div></div>`;
  } else {
    box.innerHTML = `<div class="zone-box">
      <div class="label">Zone touchée</div>
      <div class="name">${z.nom}</div>
      <div class="under"><b>Sous la peau à cet endroit :</b> ${z.struct}<br><br><b>À savoir :</b> ${z.risque}</div>
    </div>`;
  }
  footEl.innerHTML = `
    <button class="ghost" id="rePick">Reprendre</button>
    <button class="primary" id="toQ">Continuer</button>`;
  document.getElementById("rePick").onclick = startPicking;
  document.getElementById("toQ").onclick = () => { step = 0; renderQuestion(); };
}

/* --- Questions --- */
function visibleQuestions() { return Q.filter(q => !q.when || q.when(answers)); }

function renderQuestion() {
  const list = visibleQuestions();
  if (step >= list.length) { renderResult(); return; }
  const q = list[step];
  bodyEl.innerHTML = `
    <div class="aid-step">
      <div class="sub" style="margin-bottom:10px;font-size:11px;letter-spacing:1px;text-transform:uppercase">
        Question ${step + 1} / ${list.length}</div>
      <h3>${q.q}</h3>
      <div class="sub">${q.sub}</div>
      ${q.opts.map((o, i) => `
        <button class="choice ${o.danger ? "danger" : ""}" data-i="${i}">
          ${o.l}${o.h ? `<span class="hint">${o.h}</span>` : ""}
        </button>`).join("")}
    </div>`;
  bodyEl.querySelectorAll(".choice").forEach(b => {
    b.onclick = () => {
      answers[q.id] = q.opts[+b.dataset.i].v;
      step++;
      bodyEl.scrollTop = 0;
      renderQuestion();
    };
  });
  footEl.innerHTML = `<button class="ghost" id="back">Retour</button>`;
  document.getElementById("back").onclick = () => {
    if (step === 0) renderZoneStep(); else { step--; renderQuestion(); }
  };
}

/* --- Résultat --- */
function renderResult() {
  const { level, reasons } = decide(answers, zoneKey);
  const v = VERDICTS[level];
  const g = gestes(answers, zoneKey, level);
  const z = zoneKey ? ZONES[zoneKey] : null;

  const calls = [];
  if (level >= 3) {
    calls.push(`<a class="call" href="tel:${region.urgence}">Appeler les secours <span class="num">${region.urgence}</span></a>`);
    if (region.extra) calls.push(`<a class="call soft" href="tel:${region.extra.num}">${region.extra.label} <span class="num">${region.extra.num}</span></a>`);
  } else if (level === 2) {
    calls.push(`<a class="call soft" href="tel:${region.urgence}">Aggravation ou doute → secours <span class="num">${region.urgence}</span></a>`);
  }
  if (answers.type === "brulure" || answers.terrain === "sale") {
    calls.push(`<a class="call soft" href="tel:${region.tox}">Intoxication / produit chimique <span class="num">${region.tox}</span></a>`);
  }

  bodyEl.innerHTML = `
    <div class="verdict ${v.cls}">
      <h3>${v.titre}</h3>
      <p>${v.txt}</p>
    </div>
    ${calls.length ? `<div class="call-row">${calls.join("")}</div>` : ""}
    <h3 style="font-size:15px;margin-bottom:8px">Ce que tu fais maintenant</h3>
    <ul class="gestes">${g.map(x => `<li class="${x.no ? "no" : ""}">${x.t}</li>`).join("")}</ul>
    ${reasons.length ? `
      <h3 style="font-size:15px;margin-bottom:8px">Pourquoi ce niveau</h3>
      <ul class="gestes" style="counter-reset:none">
        ${reasons.map(r => `<li style="padding-left:14px">${r}</li>`).join("")}
      </ul>` : ""}
    ${z ? `<div class="zone-box"><div class="label">Rappel anatomique</div>
      <div class="name">${z.nom}</div><div class="under">${z.struct}</div></div>` : ""}
    <div id="aidDisclaimer" style="margin:0 0 8px">
      Ce résultat vient d'un simple arbre de questions, pas d'un examen. Il ne remplace ni un médecin
      ni les secours, et il ne peut pas voir ce que tu ne lui as pas dit. En cas de doute, appelle :
      c'est exactement pour ça que le ${region.urgence} existe, et personne ne te reprochera d'appeler pour rien.
    </div>`;
  bodyEl.scrollTop = 0;
  footEl.innerHTML = `
    <button class="ghost" id="restart">Recommencer</button>
    <button class="primary" id="done">Fermer</button>`;
  document.getElementById("restart").onclick = open;
  document.getElementById("done").onclick = close;

  // Style de la liste des raisons : pas de numéros
  bodyEl.querySelectorAll(".gestes").forEach((ul, i) => {
    if (i === 1) ul.querySelectorAll("li").forEach(li => li.style.setProperty("--none", "1"));
  });
}

/* Sélecteur de pays (dans l'en-tête du panneau) */
const sel = document.getElementById("regionSel");
for (const k in REGIONS) {
  const o = document.createElement("option");
  o.value = k; o.textContent = REGIONS[k].label + " · " + REGIONS[k].urgence;
  if (REGIONS[k] === region) o.selected = true;
  sel.appendChild(o);
}
sel.addEventListener("change", e => {
  region = REGIONS[e.target.value];
  localStorage.setItem("miroir.region", e.target.value);
  VERDICTS[3].txt = `Les éléments que tu as décrits correspondent à une situation où l'on n'attend pas. Appelle le ${region.urgence} et suis les gestes ci-dessous en attendant.`;
});

window.MIROIR_AID = { open, close, isPicking: () => picking };

})();
