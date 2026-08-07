# Assets anatomiques — origine et licence

> ⚠️ Marie : ce fichier est une **reconstitution par Ada**. Mon script d'export
> a écrasé ta version d'origine lors du premier passage — c'est ma faute, elle
> est corrigée (le script ne réécrit plus un `CREDITS.md` existant). Remplace ce
> texte par le tien si tu l'as gardé quelque part ; sinon complète celui-ci.

Les fichiers `.glb` de ce dossier sont des **œuvres dérivées** de :

- **Z-Anatomy** — https://github.com/Z-Anatomy/Models-of-human-anatomy
  Licence **CC BY-SA 4.0**.
  Z-Anatomy est lui-même dérivé de **BodyParts3D** —
  © The Database Center for Life Science (DBCLS), licence **CC BY-SA 2.1 JP**.
  Texte complet de la licence : `assets-source/License-Z-Anatomy.txt`.

## Ce qui a été modifié

Pipeline reproductible `scripts/export_zanatomy.py` (Blender headless) :
filtrage des étiquettes du modèle source, regroupement des maillages par région
corporelle, fusion des transformations, décimation vers un budget de triangles,
export glTF binaire. Le détail par système figure dans `manifest.json`.

## Obligations qui en découlent

**Attribution** : citer Z-Anatomy et BodyParts3D partout où l'application est
distribuée ou publiée.

**Partage à l'identique** : ces `.glb` dérivés sont eux aussi sous
**CC BY-SA 4.0**. Toute version publiée de l'application qui les embarque doit
porter cette attribution et cette licence — y compris un simple lien de test
en ligne.
