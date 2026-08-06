# MIROIR ANATOMIQUE — v1

Miroir éducatif : la caméra détecte la posture (MediaPipe Pose Landmarker, 33 points,
100 % local dans le navigateur) et un atlas anatomique est ancré sur le corps,
**mis à l'échelle selon les proportions réellement détectées**.

**Ce n'est PAS un dispositif médical.** Bandeau permanent, et le module de premiers
secours ne pose aucun diagnostic (voir plus bas).

## Contenu

| Couche | Ce qu'elle montre |
|---|---|
| **OS** | Crâne, colonne (17 vertèbres), 10 paires de côtes, clavicules, scapulas, bassin, os longs, mains, pieds, rotules |
| **MUSCLES** | Deltoïdes, biceps/triceps, avant-bras, pectoraux, trapèzes, grand droit, obliques, fessiers, quadriceps, ischios, mollets |
| **NERFS** | Moelle épinière et racines, plexus brachial, médian/ulnaire/radial, sciatique, tibial, fémoral, nerf phrénique |
| **ORGANES** | Cerveau, poumons, cœur, trachée, diaphragme, foie, estomac, rate, reins, intestins, vessie |
| **VAISSEAUX** | Aorte et crosse, carotides, jugulaires, veine cave, brachiales, radiale/ulnaire, iliaques, fémorales, saphènes |

Les couches se combinent : la plus superficielle activée reste opaque, les autres
s'estompent automatiquement, et le squelette passe à 50 % dès qu'une autre couche
est allumée — sinon il masque tout.

## Module PLAIE (premiers secours)

⚠️ **L'app ne reconnaît PAS une plaie par l'image.** C'est un choix délibéré :
une classification automatique de blessure par caméra n'est ni fiable ni
défendable sans validation clinique. Le module fait deux choses honnêtes :

1. **Repérage anatomique** — l'utilisateur touche l'endroit blessé sur son corps
   à l'écran ; la détection de pose identifie la région et liste ce qui passe
   dessous (artères, nerfs, tendons, organes) avec le risque propre à cette zone.
   Les couches concernées s'allument automatiquement.
2. **Triage guidé** — questions fondées sur les critères d'alerte classiques des
   premiers secours (saignement artériel, signes de choc, profondeur, brûlures,
   morsures, signes d'infection, tétanos, terrain fragile) → niveau d'urgence,
   gestes concrets numérotés, erreurs à ne pas commettre, et bouton d'appel direct.

Numéros par pays : Suisse (144 / 1414 Rega / 145), France (15), Belgique (112),
Canada (911). Sélecteur dans l'en-tête, mémorisé localement.

## Lancer

**Sur PC** : double-clic sur `index.html` (le `file://` fonctionne).

**Sur téléphone** : il faut du **HTTPS** — les navigateurs mobiles refusent
l'accès caméra autrement. Voir `DEPLOIEMENT.md`.

Connexion internet nécessaire au premier lancement (modèle ~5 Mo) ; ensuite le
service worker garde tout en cache et l'app fonctionne hors ligne.

## Architecture

```
app/
├── index.html              structure + UI
├── css/style.css           thème, responsive, safe-area iOS
├── js/layers.js            les 5 couches, en repères anatomiques locaux
├── js/mirror.js            moteur : pose, matrices d'ancrage, boucle de rendu
├── js/firstaid.js          module plaie : zones anatomiques + arbre de triage
├── manifest.webmanifest    PWA installable
├── sw.js                   cache hors ligne (app + modèle MediaPipe)
└── icons/                  icônes PWA
```

**Principe d'ancrage** — quatre repères locaux recalculés à chaque image :
`torso` (milieu des épaules → hanches, largeur = écart des épaules),
`pelvis`, `head` (écart des oreilles), et `seg` (le long de chaque os).
Chaque pièce est dessinée une fois en coordonnées locales, puis plaquée par
une matrice SVG. C'est ce qui fait que l'anatomie suit la morphologie.

Les scripts sont volontairement **classiques** (pas de modules ES) avec un
`import()` dynamique pour MediaPipe : sinon le `file://` casse.

## Lentille rayons X (Palier 1 du plan réalisme)

L'anatomie n'est plus peinte sur tout le corps : elle n'apparaît que dans un
disque qui suit le doigt. Bord en fondu, peau assombrie et grain de film à
l'intérieur. C'est ce qui donne la sensation de voir *à travers* plutôt que
*par-dessus*. Bouton ◎ ; molette ou pincement à deux doigts pour le diamètre.

Réalisé en masques SVG (`js/lens.js`), pas en WebGL : ça se greffe sur
l'overlay existant sans réécrire le moteur.

## Silhouette (Palier 3)

Bouton ◐ : MediaPipe Image Segmenter découpe l'anatomie sur la silhouette
réelle, pour qu'elle ne déborde jamais du corps — sans ça, l'illusion tombe.
Cadencé à ~11 i/s pour épargner la batterie.

## Feuille de route — passage au photoréalisme

Décision chef du 07.08 : **fini les dessins**. Le SVG vectoriel actuel est une
étape, pas la cible.

- **Palier 2 (Ada)** : moteur `modules/xray3d.js` — three.js + vraies géométries
  Z-Anatomy (CC-BY-SA 4.0, à créditer), posées sur les *world landmarks* 3D de
  MediaPipe. Le choix des sprites 2D warpés a été écarté : ça fait « autocollant »
  dès que la personne tourne.
- **Palier 4** : mode photo haute qualité, sans contrainte temps réel, avec
  étiquettes anatomiques cliquables.
- **Palier 5** : photomontage par IA générative — ⚠️ la photo quitterait
  l'appareil, donc accord explicite du chef à chaque usage, jamais par défaut.

Assets Z-Anatomy : **82,7 Mo**, licence **CC-BY-SA 4.0** — nos fichiers dérivés
seront donc eux aussi CC-BY-SA, avec attribution obligatoire.

## Règles maison

- Vie privée : pas de compte, pas de télémétrie, aucune image ne sort de l'appareil.
- Ne jamais ouvrir de port/serveur local sans feu vert du chef.
- Assets anatomiques libres uniquement, avec crédits.
