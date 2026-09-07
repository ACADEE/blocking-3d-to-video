// Client de l'endpoint unifie kie.ai /codex/v1/responses (modele gpt-6-astra).
//
// En developpement on passe par le proxy Vite (/api/kie -> api.kie.ai) pour
// neutraliser le CORS : le navigateur ne parle qu'a Vite. En build on tape
// l'API en direct, ce qui suppose que kie.ai autorise l'origine.

const DIRECT_BASE = 'https://api.kie.ai';
const PROXY_BASE = '/api/kie';

export const MODEL = 'gpt-6-astra';

export function apiBase() {
  return import.meta.env && import.meta.env.DEV ? PROXY_BASE : DIRECT_BASE;
}

export class KieError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'KieError';
    this.status = status;
    this.body = body;
  }
}

function explain(status, body) {
  const detail =
    (body && (body.error?.message || body.message || body.msg)) ||
    (typeof body === 'string' ? body.slice(0, 300) : '');
  switch (status) {
    case 401:
    case 403:
      return `Cle API refusee (${status}). Verifie la cle kie.ai. ${detail}`;
    case 402:
      return `Credits insuffisants sur le compte kie.ai (402). ${detail}`;
    case 429:
      return `Quota depasse (429). Reessaie dans un instant. ${detail}`;
    default:
      if (status >= 500) return `Erreur serveur kie.ai (${status}). ${detail}`;
      return `Requete refusee (${status}). ${detail}`;
  }
}

/**
 * Appelle GPT-6 Astra et renvoie { text, credits, raw }.
 * @param {{ apiKey: string, prompt: string, effort?: 'low'|'medium'|'high'|'xhigh', signal?: AbortSignal }} opts
 */
export async function callAstra({ apiKey, prompt, effort = 'low', signal }) {
  if (!apiKey || !apiKey.trim()) {
    throw new KieError("Aucune cle API. Saisis ta cle kie.ai sur l'ecran d'accueil.", { status: 0 });
  }

  let res;
  try {
    res = await fetch(`${apiBase()}/codex/v1/responses`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        reasoning: { effort },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new KieError(
      "Impossible de joindre api.kie.ai. En build de production, l'appel direct depuis le navigateur peut etre bloque par CORS : utilise `npm run dev` (proxy Vite) ou un backend.",
      { status: 0 }
    );
  }

  const rawText = await res.text();
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }

  if (!res.ok) throw new KieError(explain(res.status, body), { status: res.status, body });

  const text = extractOutputText(body);
  if (text == null) {
    throw new KieError("Reponse kie.ai sans texte exploitable (aucun bloc output_text).", {
      status: res.status,
      body,
    });
  }

  return { text, credits: extractCredits(body), raw: body };
}

/**
 * Extrait le premier bloc `output_text`.
 * Gere l'enveloppe directe de l'API { output: [...] } comme l'enveloppe des logs
 * Kie-Market { result_list: [ {...}, ... ] }, ce qui permet de rejouer un
 * fichier tempfile tel quel.
 */
export function extractOutputText(body) {
  if (!body || typeof body !== 'object') return null;

  const envelopes = Array.isArray(body.result_list) ? body.result_list : [body];
  for (const env of envelopes) {
    const output = env && Array.isArray(env.output) ? env.output : null;
    if (!output) continue;
    for (const item of output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part && part.type === 'output_text' && typeof part.text === 'string') {
          return part.text;
        }
      }
    }
  }
  return null;
}

export function extractCredits(body) {
  if (!body || typeof body !== 'object') return 0;
  if (typeof body.credits_consumed === 'number') return body.credits_consumed;
  if (Array.isArray(body.result_list)) {
    for (const env of body.result_list) {
      if (env && typeof env.credits_consumed === 'number') return env.credits_consumed;
    }
  }
  return 0;
}

/**
 * Le modele a pour consigne de ne pas emettre de fences markdown, mais il derive
 * parfois. On nettoie avant de parser plutot que de faire echouer la generation.
 */
export function parseJsonLoose(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  try {
    return JSON.parse(t);
  } catch {
    // Dernier recours : isoler le plus grand objet accolade a accolade.
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(t.slice(start, end + 1));
    }
    throw new KieError('Le modele a renvoye un JSON invalide.', { body: text });
  }
}

/** Ping minimal pour valider une cle sans generer de scene. */
export async function testConnection(apiKey) {
  const started = performance.now();
  const { text, credits } = await callAstra({
    apiKey,
    prompt: 'Reply with the single word: ok',
    effort: 'low',
  });
  return { ok: true, latency: Math.round(performance.now() - started), reply: text.trim().slice(0, 40), credits };
}
