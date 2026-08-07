# Note technique d'export (générée par scripts/export_zanatomy.py)

Ce fichier accompagne le `CREDITS.md` rédigé à la main — il ne le remplace pas.

Transformations appliquées aux maillages Z-Anatomy : filtrage des étiquettes
(suffixes `.j` et `.g`), regroupement par région corporelle, fusion des
transformations d'objet, décimation « collapse » vers un budget de triangles,
export glTF binaire (Draco optionnel, désactivé par défaut).

Le détail par système — triangles avant/après, poids, régions — est dans
`manifest.json`. Ces fichiers dérivés restent sous **CC-BY-SA 4.0** : toute
redistribution doit conserver l'attribution et la licence.
