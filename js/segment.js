/* =========================================================================
   MIROIR ANATOMIQUE — SEGMENTATION DE SILHOUETTE  (Palier 3 du brief réalisme)
   -------------------------------------------------------------------------
   Sans ça, l'anatomie déborde du corps et l'illusion tombe immédiatement :
   on voit un squelette posé PAR-DESSUS l'image, pas DEDANS. Ici, MediaPipe
   Image Segmenter produit un masque de la personne à chaque image, et
   l'anatomie est découpée dessus — elle ne dépasse jamais de la peau.

   Le masque est peint dans un <canvas> hors écran, puis appliqué à l'overlay
   SVG via un masque CSS. Coût : une inférence légère (~5 Mo, modèle local
   après le premier chargement) et un blit de canvas par image.

   Interface :
     SEG.load()                    charge le modèle (asynchrone, non bloquant)
     SEG.isReady()
     SEG.setEnabled(bool)
     SEG.isEnabled()
     SEG.process(video, tMs)       met à jour le masque depuis l'image courante
     SEG.getCanvas()               le canvas du masque (pour Ada / le module 3D)
     SEG.attach(overlayEl)         branche le masque sur l'overlay SVG
   ========================================================================= */

(function () {

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
                  "selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenter = null;
let ready = false;
let enabled = false;
let loading = false;
let overlayEl = null;

/* Canvas du masque : blanc = corps, noir = fond. Petite résolution suffit,
   le flou de bord fait le reste. */
const canvas = document.createElement("canvas");
canvas.width = 256; canvas.height = 256;
const ctx = canvas.getContext("2d", { willReadFrequently: false });

/* Canvas de travail pour convertir le masque en niveaux de gris opaques */
const tmp = document.createElement("canvas");
tmp.width = 256; tmp.height = 256;
const tctx = tmp.getContext("2d");

let maskUrl = null;
let lastUrl = null;

async function load() {
  if (segmenter || loading) return;
  loading = true;
  try {
    const { ImageSegmenter, FilesetResolver } = await import(MEDIAPIPE_CDN);
    const files = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN + "/wasm");
    segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });
    ready = true;
  } catch (e) {
    console.warn("Segmentation indisponible :", e.message);
    ready = false;
  } finally {
    loading = false;
  }
}

function isReady() { return ready; }
function isEnabled() { return enabled && ready; }

function setEnabled(on) {
  enabled = on;
  if (!overlayEl) return;
  if (on && ready) applyMask();
  else {
    overlayEl.style.webkitMaskImage = "";
    overlayEl.style.maskImage = "";
  }
}

function attach(el) { overlayEl = el; }

function applyMask() {
  if (!overlayEl) return;
  // Le masque suit exactement le cadre vidéo, qui a la taille de l'overlay.
  const css = `url(${maskUrl})`;
  overlayEl.style.webkitMaskImage = css;
  overlayEl.style.maskImage = css;
  overlayEl.style.webkitMaskSize = "100% 100%";
  overlayEl.style.maskSize = "100% 100%";
  overlayEl.style.webkitMaskRepeat = "no-repeat";
  overlayEl.style.maskRepeat = "no-repeat";
}

/* Cadence réduite : la silhouette bouge lentement, inutile de segmenter à
   chaque image — on économise la batterie du téléphone. */
let lastRun = 0;
const INTERVAL_MS = 90;

function process(video, tMs) {
  if (!isEnabled() || !segmenter) return;
  if (tMs - lastRun < INTERVAL_MS) return;
  lastRun = tMs;

  let res;
  try { res = segmenter.segmentForVideo(video, tMs); }
  catch { return; }

  const cat = res?.categoryMask;
  if (!cat) return;

  const w = cat.width, h = cat.height;
  if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  const data = cat.getAsUint8Array();
  const img = tctx.createImageData(w, h);
  const px = img.data;
  // Catégorie 0 = fond, tout le reste = personne.
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const v = data[i] === 0 ? 0 : 255;
    px[j] = px[j + 1] = px[j + 2] = v;
    px[j + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  cat.close();

  // Léger flou : le bord net de la segmentation trahit le découpage.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "blur(2px)";
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = "none";

  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = maskUrl;
    maskUrl = url;
    if (isEnabled()) applyMask();
  }, "image/png");
}

function getCanvas() { return canvas; }

window.MIROIR_SEG = { load, isReady, isEnabled, setEnabled, attach, process, getCanvas };

})();
