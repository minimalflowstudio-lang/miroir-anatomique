/* =========================================================================
   PHOTOREAL — intégration photographique du rendu 3D (module livré par Ada)
   Ce qui trahit une image de synthèse posée sur une photo : sa lumière ne
   vient pas du même endroit, ses bords sont trop nets, sa peau trop lisse et
   son grain absent. Ce module mesure l'éclairage réel dans l'image caméra et
   fournit de quoi y accorder le rendu — plus les termes de compositing
   (Fresnel, grain, netteté, exposition) partagés par xray3d et xray_hand.
   ========================================================================= */

(function () {

/* ------------------------------------------------ Analyse de l'éclairage
   La vidéo est réduite à une vignette minuscule : on y mesure la couleur
   moyenne, la luminance, et la DIRECTION du gradient lumineux (barycentre
   des zones claires par rapport au centre). Coût négligeable, et c'est ce
   qui permet d'orienter la lumière de la scène comme celle de la pièce. */

const SIZE = 24;                       // vignette d'analyse
const INTERVAL_MS = 400;               // la lumière d'une pièce bouge lentement

function createAnalyzer() {
  const cv = document.createElement("canvas");
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  let last = -1e9;

  /* État lissé : sans lissage, la moindre variation d'exposition de la
     caméra ferait vaciller l'éclairage de l'anatomie. */
  const state = {
    color: { r: 1, g: 1, b: 1 },       // teinte dominante, normalisée
    luma: 0.5,                          // luminance moyenne 0..1
    dir: { x: -0.4, y: 0.8 },           // direction d'où vient la lumière
    contrast: 0.5,                      // écart clair/sombre, 0..1
    ready: false,
  };

  function sample(video, tMs) {
    if (!video || video.readyState < 2 || video.videoWidth === 0) return state;
    if (tMs - last < INTERVAL_MS) return state;
    last = tMs;

    try { ctx.drawImage(video, 0, 0, SIZE, SIZE); }
    catch (e) { return state; }

    let px;
    try { px = ctx.getImageData(0, 0, SIZE, SIZE).data; }
    catch (e) { return state; }        // vidéo d'une autre origine : on renonce

    let sr = 0, sg = 0, sb = 0, sl = 0, n = 0;
    let wx = 0, wy = 0, wsum = 0, lmin = 1, lmax = 0;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        sr += r; sg += g; sb += b; sl += l; n++;
        if (l < lmin) lmin = l;
        if (l > lmax) lmax = l;
        /* Barycentre pondéré par la luminance au carré : les hautes lumières
           pèsent davantage, ce sont elles qui indiquent la source. */
        const w = l * l;
        wx += (x / (SIZE - 1) - 0.5) * w;
        wy += (0.5 - y / (SIZE - 1)) * w;
        wsum += w;
      }
    }
    if (!n) return state;

    const mr = sr / n, mg = sg / n, mb = sb / n, ml = sl / n;
    /* Teinte normalisée : on garde la dominante de couleur sans la
       luminosité, sinon une pièce sombre éteindrait l'anatomie. */
    const norm = Math.max(mr, mg, mb) || 1;
    const A = 0.12;                     // lissage temporel
    state.color.r += A * (mr / norm - state.color.r);
    state.color.g += A * (mg / norm - state.color.g);
    state.color.b += A * (mb / norm - state.color.b);
    state.luma += A * (ml - state.luma);
    state.contrast += A * ((lmax - lmin) - state.contrast);

    if (wsum > 1e-6) {
      let dx = wx / wsum, dy = wy / wsum;
      const len = Math.hypot(dx, dy);
      if (len > 0.02) { dx /= len; dy /= len; }
      else { dx = -0.4; dy = 0.8; }     // image uniforme : lumière de face
      state.dir.x += A * (dx - state.dir.x);
      state.dir.y += A * (dy - state.dir.y);
    }
    state.ready = true;
    return state;
  }

  return { sample, state };
}

/* Applique l'éclairage mesuré aux lumières de la scène. La directionnelle
   pointe d'où vient la lumière de la pièce ; l'ambiante prend sa teinte. */
function applyLighting(THREE, dirLight, hemiLight, st, strength = 1) {
  if (!st || !st.ready) return;
  const k = strength;
  dirLight.position.set(st.dir.x, st.dir.y, 0.85).normalize();
  dirLight.color.setRGB(
    1 - k * (1 - st.color.r), 1 - k * (1 - st.color.g), 1 - k * (1 - st.color.b));
  /* Une pièce sombre donne une anatomie sombre : sans cela, elle brille
     comme un autocollant sur une photo sous-exposée. */
  dirLight.intensity = 0.6 + 1.5 * Math.min(st.luma * 1.6, 1) * (0.4 + 0.6 * st.contrast);
  if (hemiLight) {
    hemiLight.color.setRGB(st.color.r, st.color.g, st.color.b);
    hemiLight.intensity = 0.35 + 0.9 * Math.min(st.luma * 1.4, 1);
  }
}

/* ------------------------------------------- Termes de compositing GLSL
   Repris à l'identique par les deux modules, pour que le corps et la main
   aient exactement le même rendu. */
const GLSL = `
/* Bruit stable, sans texture. */
float pr_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/* Grain de capteur : une image de synthèse trop propre se détache
   immédiatement d'une vidéo de téléphone, qui est toujours bruitée. */
vec3 pr_grain(vec3 c, vec2 frag, float t, float amount) {
  float n = pr_hash(floor(frag / 1.5) + floor(t * 24.0) * 17.0) - 0.5;
  return c + n * amount;
}

/* Fresnel approché à partir du gradient de profondeur : là où la surface
   fuit sous un angle rasant, on estompe. C'est ce qui fait que l'anatomie
   se fond sous la peau au lieu de s'y découper. */
float pr_grazing(sampler2D depthTex, vec2 uv, vec2 texel) {
  float d  = texture2D(depthTex, uv).r;
  float dx = texture2D(depthTex, uv + vec2(texel.x, 0.0)).r - d;
  float dy = texture2D(depthTex, uv + vec2(0.0, texel.y)).r - d;
  return clamp(length(vec2(dx, dy)) * 220.0, 0.0, 1.0);
}

/* Occlusion de contact : les creux entre structures s'assombrissent.
   Sans elle, tout paraît également éclairé, donc plat. */
float pr_occlusion(sampler2D depthTex, vec2 uv, vec2 texel) {
  float d = texture2D(depthTex, uv).r;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : 0.0,
                  i == 2 ? 1.0 : i == 3 ? -1.0 : 0.0) * texel * 2.5;
    sum += step(texture2D(depthTex, uv + o).r, d - 0.00012);
  }
  return sum * 0.25;
}

/* La scène est rendue dans une cible hors écran, donc en LUMIÈRE LINÉAIRE.
   Une passe de composition maison ne reçoit pas la conversion que three.js
   applique d'ordinaire au rendu final : sans cet encodage, tout s'affiche
   nettement trop sombre et terne. */
vec3 pr_toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92,
             1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

/* Fusion « vu à travers la peau ».
   Poser l'anatomie en opaque par-dessus l'image donne un autocollant : c'est
   la raison profonde de l'effet « dessin ». Un tissu réel vu par transparence
   garde la LUMINOSITÉ de la peau devant lui et n'en change que le contenu.
   On recompose donc l'os en conservant l'ombrage local de la peau, avec un
   voile de diffusion d'autant plus fort que la structure est profonde. */
vec3 pr_seeThrough(vec3 bone, vec3 skin, float depth01, float amount) {
  float skinL = dot(skin, vec3(0.299, 0.587, 0.114));
  /* l'os reprend l'éclairage de la peau : c'est ce qui l'ancre dans l'image */
  vec3 lit = bone * (0.55 + 0.85 * skinL);
  /* diffusion : plus c'est profond, plus la peau brouille et rougit */
  vec3 haze = mix(skin, skin * vec3(1.12, 0.86, 0.80), 0.5);
  vec3 seen = mix(lit, haze, clamp(depth01 * 0.55, 0.0, 0.55));
  return mix(bone, seen, amount);
}

/* Variation de matière : un os réel n'a pas une teinte parfaitement uniforme.
   Sans ce grain de surface, la couleur unie lit comme un aplat de dessin. */
vec3 pr_matter(vec3 c, vec2 uv, float amount) {
  float n = pr_hash(floor(uv * 420.0)) * 0.6
          + pr_hash(floor(uv * 130.0)) * 0.4;
  return c * (1.0 - amount * 0.5 + amount * n);
}

/* Accorde le rendu à la teinte et à l'exposition de l'image filmée. */
vec3 pr_grade(vec3 c, vec3 tint, float exposure) {
  /* On teinte à 45 % seulement : au-delà, une lumière chaude virait l'os à
     l'orange franc et on perdait la lecture « matière osseuse ». */
  c *= mix(vec3(1.0), tint, 0.45);
  c *= exposure;
  /* léger roll-off des hautes lumières : le blanc pur n'existe pas en photo */
  return c / (1.0 + c * 0.12);
}
`;

window.MIROIR_PHOTOREAL = { createAnalyzer, applyLighting, GLSL };

})();
