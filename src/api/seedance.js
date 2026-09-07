import { apiBase, KieError } from './kie.js';

// Client Seedance 2.5 (kie.ai).
//
// Enchainement : createTask renvoie un taskId, puis on interroge l'etat jusqu'a
// obtenir la video. Le callBackUrl de l'API est prefere en production, mais une
// app front n'a pas d'endpoint public : on interroge donc.

export const SEEDANCE_MODEL = 'bytedance/seedance-2-5';

export const RESOLUTIONS = ['480p', '720p', '1080p'];
export const ASPECT_RATIOS = ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

/**
 * Assemble le corps de requete. Les trois scenarios d'entree sont exclusifs :
 * premiere image seule, premiere + derniere image, ou references multimodales.
 * On refuse le melange ici plutot que de laisser l'API le rejeter.
 */
export function buildSeedancePayload({
  prompt,
  referenceVideos = [],
  referenceImages = [],
  referenceAudio = [],
  firstFrame = null,
  lastFrame = null,
  duration = 5,
  resolution = '720p',
  aspectRatio = '16:9',
  generateAudio = false,
  outputFormat = 'mp4',
  callBackUrl = null,
}) {
  const clean = (arr) => arr.map((s) => String(s).trim()).filter(Boolean);
  const videos = clean(referenceVideos);
  const images = clean(referenceImages);
  const audio = clean(referenceAudio);
  const hasReferences = videos.length || images.length || audio.length;

  if (firstFrame && hasReferences) {
    throw new KieError(
      "Seedance n'accepte pas a la fois une image de depart et des references multimodales : choisis l'un ou l'autre."
    );
  }
  if (lastFrame && !firstFrame) {
    throw new KieError("Une derniere image ne peut pas etre envoyee sans premiere image.");
  }
  if (!prompt || !prompt.trim()) {
    throw new KieError('Le prompt est vide.');
  }
  if (prompt.length > 30000) {
    throw new KieError(`Prompt trop long : ${prompt.length} caracteres pour 30000 autorises.`);
  }

  const input = {
    prompt: prompt.trim(),
    duration: Math.round(duration),
    resolution,
    aspect_ratio: aspectRatio,
    generate_audio: Boolean(generateAudio),
    output_format: outputFormat,
  };

  if (firstFrame) {
    input.first_frame_url = firstFrame;
    if (lastFrame) input.last_frame_url = lastFrame;
  } else {
    if (videos.length) input.reference_video_urls = videos;
    if (images.length) input.reference_image_urls = images;
    if (audio.length) input.reference_audio_urls = audio;
  }

  const body = { model: SEEDANCE_MODEL, input };
  if (callBackUrl && callBackUrl.trim()) body.callBackUrl = callBackUrl.trim();
  return body;
}

async function kieJson(path, { apiKey, method = 'GET', body, signal }) {
  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new KieError(
      "Impossible de joindre api.kie.ai. En build de production l'appel direct peut etre bloque par CORS : utilise `npm run dev`.",
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
    const detail = (json && (json.msg || json.message)) || String(json).slice(0, 300);
    throw new KieError(`Seedance ${res.status} : ${detail}`, { status: res.status, body: json });
  }
  // L'API renvoie 200 HTTP avec un code applicatif dans le corps.
  if (json && typeof json === 'object' && json.code && json.code !== 200) {
    throw new KieError(`Seedance ${json.code} : ${json.msg || 'erreur inconnue'}`, { body: json });
  }
  return json;
}

/** @returns {Promise<string>} taskId */
export async function createSeedanceTask({ apiKey, payload, signal }) {
  const json = await kieJson('/api/v1/jobs/createTask', { apiKey, method: 'POST', body: payload, signal });
  const taskId = json?.data?.taskId;
  if (!taskId) throw new KieError('Reponse sans taskId.', { body: json });
  return taskId;
}

/**
 * Etat d'une tache. `resultJson` est une chaine JSON : on la deplie ici pour que
 * l'appelant n'ait pas a connaitre ce detail de l'API.
 */
export async function getTaskDetail({ apiKey, taskId, signal }) {
  const json = await kieJson(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    apiKey,
    signal,
  });
  const data = json?.data || {};
  let result = null;
  if (data.resultJson) {
    try {
      result = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
    } catch {
      result = null;
    }
  }
  const urls = result?.resultUrls || result?.result_urls || [];
  return {
    state: data.state || data.status || 'unknown',
    failCode: data.failCode ?? null,
    failMsg: data.failMsg ?? null,
    urls: Array.isArray(urls) ? urls : [urls].filter(Boolean),
    raw: json,
  };
}

/**
 * Interroge jusqu'a l'etat terminal. Intervalle volontairement large : un rendu
 * Seedance se compte en minutes, pas en secondes.
 */
export async function pollTask({ apiKey, taskId, onTick, intervalMs = 6000, timeoutMs = 20 * 60 * 1000, shouldStop }) {
  const startedAt = Date.now();
  for (;;) {
    if (shouldStop && shouldStop()) throw new KieError('Suivi interrompu.');
    const detail = await getTaskDetail({ apiKey, taskId });
    if (onTick) onTick(detail, Date.now() - startedAt);

    const state = String(detail.state).toLowerCase();
    if (state === 'success' || state === 'succeeded') return detail;
    if (state === 'fail' || state === 'failed' || state === 'error') {
      throw new KieError(`Rendu echoue (${detail.failCode ?? '?'}) : ${detail.failMsg || 'sans detail'}`, {
        body: detail.raw,
      });
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new KieError("Delai depasse. La tache continue peut-etre : conserve le taskId pour la reinterroger.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
