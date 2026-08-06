# Mettre le Miroir Anatomique sur ton téléphone

## Pourquoi un hébergement est obligatoire

Les navigateurs mobiles (Chrome Android comme Safari iOS) **refusent l'accès à la
caméra** si la page n'est pas servie en **HTTPS**. Ni un fichier envoyé par mail,
ni une clé USB, ni un partage Wi-Fi en `http://` ne fonctionneront : c'est une
règle du navigateur, pas un réglage à contourner.

Il faut donc une adresse `https://…`. Rien ne change pour la vie privée :
le code est téléchargé une fois, puis **tout tourne dans ton téléphone** —
aucune image, aucune donnée ne repart vers le serveur.

## Le plus rapide : Netlify Drop (~30 secondes, gratuit)

1. Ouvre **https://app.netlify.com/drop** sur le PC.
2. Glisse le fichier **`D:\Bureau\MARIE\miroir-anatomique.zip`** dans la page
   (ou glisse directement le dossier `D:\Bureau\MARIE\app`).
3. Netlify affiche une adresse du type
   `https://un-nom-aleatoire.netlify.app` — c'est ton lien.
4. Ouvre ce lien sur le téléphone, autorise la caméra.

Sans compte, le site est temporaire ; crée un compte gratuit (bouton affiché
après le dépôt) pour le garder et pouvoir renommer l'adresse.

## Alternative : GitHub Pages

Si tu as un compte GitHub : crée un dépôt, dépose le contenu du dossier `app`
à la racine, puis *Settings → Pages → Source: main / root*. L'adresse est
`https://<ton-pseudo>.github.io/<depot>/`.

## Installer comme une vraie app

Une fois le lien ouvert sur le téléphone :

- **Android / Chrome** : menu ⋮ → « Installer l'application » (ou « Ajouter à
  l'écran d'accueil »).
- **iPhone / Safari** : bouton Partager → « Sur l'écran d'accueil ».

L'icône du squelette apparaît, l'app s'ouvre en plein écran sans barre de
navigateur, et **fonctionne ensuite hors ligne** (le service worker garde le
modèle en cache après le premier lancement).

## Avant de publier — à savoir

Un lien Netlify est **public** : n'importe qui connaissant l'adresse peut
l'ouvrir. Il n'y a aucune donnée personnelle dedans (tout le traitement est
local), donc le risque est nul de ce côté. Le seul point à garder en tête est
que l'app donne des conseils de premiers secours : le bandeau d'avertissement
et les rappels du module PLAIE doivent rester en place.

## Conseils d'usage sur téléphone

- Tiens le téléphone en **portrait**, calé contre quelque chose, à 2–2,5 m :
  il faut que le corps entier entre dans le cadre.
- Le bouton **⟲** bascule entre caméra avant et arrière (utile pour filmer
  quelqu'un d'autre).
- Le bouton **⛶** passe en plein écran.
- Le curseur **OPAC** règle la transparence de l'anatomie sur l'image.
