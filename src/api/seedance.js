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

// Etats documentes par l'API. On les nomme plutot que de deviner la phase en
// cherchant des sous-chaines dans un message, ce qui cassait au moindre
// changement de formulation cote kie.ai.
export const TASK_STATES = ['waiting', 'queuing', 'generating', 'success', 'fail'];
const TERMINAL_OK = new Set(['success', 'succeeded']);
const TERMINAL_FAIL = new Set(['fail', 'failed', 'error']);

export const isTerminal = (state) => TERMINAL_OK.has(state) || TERMINAL_FAIL.has(state);
export const isSuccess = (state) => TERMINAL_OK.has(state);
export const isFailure = (state) => TERMINAL_FAIL.has(state);

/**
 * Etat d'une tache.
 *
 * `resultJson` est une chaine JSON : on la deplie ici pour que l'appelant
 * n'ait pas a connaitre ce detail de l'API. On remonte aussi les champs que
 * la documentation expose et qui renseignent l'attente — avancement, credits
 * consommes, temps de calcul — plutot que le seul etat.
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
    taskId: data.taskId || taskId,
    model: data.model || null,
    state: String(data.state || data.status || 'unknown').toLowerCase(),
    // 0-100, renseigne par certains modeles seulement : `null` veut dire
    // "inconnu", ce qui n'est pas la meme chose que zero.
    progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : null,
    creditsConsumed: Number.isFinite(Number(data.creditsConsumed)) ? Number(data.creditsConsumed) : null,
    costTime: Number.isFinite(Number(data.costTime)) ? Number(data.costTime) : null,
    createTime: data.createTime || null,
    completeTime: data.completeTime || null,
    failCode: data.failCode || null,
    failMsg: data.failMsg || null,
    urls: Array.isArray(urls) ? urls : [urls].filter(Boolean),
    raw: json,
  };
}

/**
 * Cadence de sondage.
 *
 * La documentation recommande un depart a 2-3 s puis une croissance
 * progressive : un rendu long ne merite pas une requete toutes les six
 * secondes, un rendu court ne merite pas d'attendre six secondes pour rien.
 */
export function pollDelay(attempt, { start = 3000, max = 15000, factor = 1.35 } = {}) {
  return Math.min(max, Math.round(start * factor ** attempt));
}

/**
 * Interroge jusqu'a l'etat terminal.
 *
 * Delai d'abandon a 15 minutes, comme le recommande la documentation. Passe ce
 * point la tache continue peut-etre cote kie.ai : le taskId reste exploitable
 * pour reprendre le suivi.
 */
export async function pollTask({
  apiKey,
  taskId,
  onTick,
  timeoutMs = 15 * 60 * 1000,
  shouldStop,
}) {
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    if (shouldStop && shouldStop()) throw new KieError('Suivi interrompu.');

    const detail = await getTaskDetail({ apiKey, taskId });
    if (onTick) onTick(detail, Date.now() - startedAt);

    if (isSuccess(detail.state)) return detail;
    if (isFailure(detail.state)) {
      throw new KieError(
        `Rendu echoue (${detail.failCode ?? '?'}) : ${detail.failMsg || 'sans detail'}`,
        { body: detail.raw }
      );
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new KieError(
        "Delai depasse. La tache continue peut-etre cote kie.ai : reprends le suivi avec son identifiant.",
        { body: { taskId } }
      );
    }
    await new Promise((r) => setTimeout(r, pollDelay(attempt)));
  }
}
