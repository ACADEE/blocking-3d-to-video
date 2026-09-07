// Capture video des passes de blocking.
//
// Seedance recoit ces clips comme references : ils lui donnent la mise en place
// et le mouvement camera, et il n'a plus qu'a rendre l'image photorealiste.
//
// Contraintes imposees par l'API Seedance 2.5, verifiees ici avant envoi :
//   - format mp4 ou mov
//   - resolution 480p ou 720p
//   - rapport largeur/hauteur dans [0.4, 2.5]
//   - largeur x hauteur dans [409600, 927408] pixels
//   - duree d'un clip dans [2, 30] s, total des references <= 30 s
//   - taille d'un clip <= 200 Mo

export const SEEDANCE_VIDEO = {
  minPixels: 409600,
  maxPixels: 927408,
  minRatio: 0.4,
  maxRatio: 2.5,
  minDuration: 2,
  maxDuration: 30,
  totalDuration: 30,
  maxBytes: 200 * 1024 * 1024,
};

/**
 * Tailles de capture compatibles. 1280x720 = 921 600 px et 854x480 = 409 920 px
 * tiennent tous deux dans la fenetre imposee ; au-dela Seedance refuse le clip.
 */
export const CAPTURE_SIZES = {
  '720p': { width: 1280, height: 720, label: '1280 x 720' },
  '480p': { width: 854, height: 480, label: '854 x 480' },
};

const MIME_CANDIDATES = [
  { type: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', accepted: true },
  { type: 'video/mp4', ext: 'mp4', accepted: true },
  { type: 'video/webm;codecs=vp9', ext: 'webm', accepted: false },
  { type: 'video/webm', ext: 'webm', accepted: false },
];

/**
 * Choisit le meilleur conteneur disponible dans ce navigateur.
 * `accepted` dit si Seedance saura le lire : le webm passe l'enregistrement
 * mais sera refuse a l'envoi, on prefere le signaler tot.
 */
export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(c.type)) return c;
  }
  return null;
}

export function validateClipSize(width, height) {
  const pixels = width * height;
  const ratio = width / height;
  const problems = [];
  if (pixels < SEEDANCE_VIDEO.minPixels || pixels > SEEDANCE_VIDEO.maxPixels) {
    problems.push(
      `${width}x${height} = ${pixels} px, hors de la plage Seedance [${SEEDANCE_VIDEO.minPixels}, ${SEEDANCE_VIDEO.maxPixels}]`
    );
  }
  if (ratio < SEEDANCE_VIDEO.minRatio || ratio > SEEDANCE_VIDEO.maxRatio) {
    problems.push(`rapport ${ratio.toFixed(2)} hors de [${SEEDANCE_VIDEO.minRatio}, ${SEEDANCE_VIDEO.maxRatio}]`);
  }
  return problems;
}

export function validateClip({ width, height, duration, size }) {
  const problems = validateClipSize(width, height);
  if (duration < SEEDANCE_VIDEO.minDuration || duration > SEEDANCE_VIDEO.maxDuration) {
    problems.push(
      `duree ${duration.toFixed(1)}s hors de [${SEEDANCE_VIDEO.minDuration}, ${SEEDANCE_VIDEO.maxDuration}]s`
    );
  }
  if (size > SEEDANCE_VIDEO.maxBytes) {
    problems.push(`${(size / 1024 / 1024).toFixed(0)} Mo, au-dela des 200 Mo autorises`);
  }
  return problems;
}

/**
 * Enregistre un canvas en temps reel.
 *
 * La lecture est deja deterministe (la scene est une fonction pure du temps),
 * mais MediaRecorder travaille sur l'horloge murale : on capture donc pendant
 * la duree de la prise, puis on verifie ce qu'on a obtenu plutot que de le
 * supposer.
 *
 * @param {{canvas: HTMLCanvasElement, fps: number, durationMs: number,
 *          onProgress?: (ratio:number)=>void, shouldStop?: ()=>boolean}} opts
 * @returns {Promise<{blob: Blob, mime: object, duration: number}>}
 */
export async function recordCanvas({ canvas, fps, durationMs, onProgress, shouldStop }) {
  const mime = pickVideoMime();
  if (!mime) throw new Error("Ce navigateur ne sait pas enregistrer de video (MediaRecorder indisponible).");
  if (typeof canvas.captureStream !== 'function') {
    throw new Error("Ce navigateur ne sait pas capturer le canvas (captureStream indisponible).");
  }

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.type,
    videoBitsPerSecond: 12_000_000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(e.error || new Error("Enregistrement interrompu."));
  });

  const startedAt = performance.now();
  recorder.start(200);

  await new Promise((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      if (onProgress) onProgress(Math.min(1, elapsed / durationMs));
      if (elapsed >= durationMs || (shouldStop && shouldStop())) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const elapsed = (performance.now() - startedAt) / 1000;
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: mime.type });
  if (!blob.size) throw new Error("L'enregistrement est vide : le canvas n'a produit aucune image.");

  return { blob, mime, duration: elapsed };
}
