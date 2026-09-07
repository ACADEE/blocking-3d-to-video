import { KieError } from './kie.js';

// Mise en ligne des clips de blocking.
//
// Seedance ne lit pas un fichier local : il lui faut une URL publique (ou un
// asset://). kie.ai expose un service de fichiers, mais c'est un service
// distinct de l'API de generation et il n'est pas garanti d'etre joignable
// depuis un navigateur (CORS). On tente donc l'envoi, et en cas d'echec on
// renvoie une erreur explicite : l'utilisateur telecharge le clip et colle
// l'URL de son propre hebergement. Ce chemin manuel marche toujours.

const UPLOAD_ENDPOINT = 'https://kieai.redpandaai.co/api/file-stream-upload';

/**
 * @param {{ apiKey: string, blob: Blob, fileName: string, uploadPath?: string, signal?: AbortSignal }} opts
 * @returns {Promise<string>} URL publique du fichier
 */
export async function uploadBlob({ apiKey, blob, fileName, uploadPath = 'blocking3d', signal }) {
  if (!apiKey || !apiKey.trim()) throw new KieError('Cle kie.ai requise pour la mise en ligne.');

  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('uploadPath', uploadPath);
  form.append('fileName', fileName);

  let res;
  try {
    res = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: form,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new KieError(
      "Service de fichiers kie.ai injoignable depuis le navigateur (CORS ou reseau). Telecharge le clip et colle son URL publique a la place.",
      { status: 0 }
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    throw new KieError(
      `Mise en ligne refusee (${res.status}) : ${(json && (json.msg || json.message)) || String(json).slice(0, 200)}`,
      { status: res.status, body: json }
    );
  }

  const url = json?.data?.downloadUrl || json?.data?.fileUrl || json?.data?.url;
  if (!url) {
    throw new KieError("Reponse de mise en ligne sans URL exploitable.", { body: json });
  }
  return url;
}

/** Une URL utilisable par Seedance : http(s) public, ou reference d'asset. */
export function isUsableAssetUrl(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (v.startsWith('asset://')) return true;
  if (!/^https?:\/\//i.test(v)) return false;
  // Seedance telecharge le fichier depuis ses serveurs : une URL locale ou une
  // blob: du navigateur ne lui sert a rien, autant le dire avant l'envoi.
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(v);
}
