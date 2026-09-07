import { create } from 'zustand';
import { normalizeSceneGraph } from '../scene/normalize.js';
import { solveScene } from '../scene/build.js';
import { evaluateWaypoints, resolveCollisions } from '../scene/autocorrect.js';
import { waypointsToKeys } from '../scene/camera.js';
import { callAstra, parseJsonLoose, testConnection, KieError } from '../api/kie.js';
import { buildScenePrompt, buildCorrectionPrompt, buildModelPrompt, buildEditPrompt } from '../api/prompts.js';
import { propBounds, inferActorType, PROXY_BOUNDS } from '../proxies/registry.js';
import { compileModel } from '../proxies/AIModel.jsx';
import { buildSeedancePrompt } from '../export/seedance.js';
import { CAPTURE_SIZES } from '../export/recorder.js';
import { buildSeedancePayload, createSeedanceTask, pollTask, getTaskDetail, isSuccess, isFailure } from '../api/seedance.js';
import { uploadBlob, isUsableAssetUrl } from '../api/upload.js';

const KEY_STORAGE = 'blocking3d.apiKey';
const LANG_STORAGE = 'blocking3d.lang';

/**
 * Langue de l'interface.
 *
 * L'anglais est la langue par defaut, sans exception : suivre la langue du
 * navigateur faisait s'ouvrir l'application en francais chez la moitie des
 * visiteurs, alors que le depot et sa documentation sont en anglais. Seul un
 * choix explicite, conserve dans le navigateur, deroge a ce defaut.
 */
export const readLang = () => {
  try {
    const saved = localStorage.getItem(LANG_STORAGE);
    return saved === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
};

const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
};

const DEFAULT_DESCRIPTION =
  'A woman enters a luxury restaurant, crosses the main dining room and walks into the kitchen. A waiter crosses behind her. The camera follows her continuously from approximately two meters behind using a 35mm Steadicam. One uninterrupted take.';

export const useStore = create((set, get) => ({
  // --- Navigation ---------------------------------------------------------
  // Le pipeline en trois etapes est un modele d'ecrans, pas un etat implicite :
  // 1 blocking -> 2 prompt -> 3 render. C'est ce qui permet au rail du header de
  // dire ou l'on est, ce qui est fait, et pourquoi une etape est bloquee.
  lang: readLang(), // 'en' | 'fr'
  screen: 'home', // 'home' | 'blocking' | 'prompt' | 'render'
  viewMode: 'director',
  editMode: 'select', // 'select' | 'translate' | 'rotate'

  // --- Connexion ----------------------------------------------------------
  apiKey: readKey(),
  apiStatus: 'idle', // 'idle' | 'testing' | 'ok' | 'error'
  apiMessage: '',
  creditsSpent: 0,

  // --- Brief --------------------------------------------------------------
  description: DEFAULT_DESCRIPTION,
  duration: 12,
  fps: 24,
  aspectRatio: '16:9',
  generating: false,
  generationError: null,

  // --- Scene --------------------------------------------------------------
  scene: null,
  solve: null,
  warnings: [],
  rawResponse: null,
  sceneOrigin: null, // 'api' | 'fixture' | 'import'
  dirty: false,

  // --- Lecture ------------------------------------------------------------
  time: 0,
  playing: false,
  rate: 1,
  loop: true,

  // --- Selection / alerte -------------------------------------------------
  selection: null,
  correcting: false,
  correction: null, // { note, source, before, after, previousCamera }

  // Modelisation IA : id d'entite -> 'three' | 'blender' en cours, ou message d'erreur.
  modeling: null,
  modelError: null,

  // Images de reference : envoi en cours et derniere erreur.
  uploadingRef: null,
  refError: null,

  // Edition de scene par prompt.
  sceneEditing: false,
  sceneEditError: null,
  sceneEditNote: null,

  // --- Capture des passes de blocking --------------------------------------
  capture: null, // { passId, view, width, height }
  clips: {}, // view -> { blob, url, duration, width, height, size, problems, mime, remoteUrl }
  captureQueue: [],
  captureError: null,

  // --- Rendu Seedance ------------------------------------------------------
  render: {
    status: 'idle', // idle | uploading | submitting | polling | done | error
    message: '',
    taskId: null,
    urls: [],
    elapsed: 0,
  },

  // Ping de tache : confirmation que kie.ai a bien pris la tache, et
  // verification manuelle d'un identifiant colle a la main.
  taskPing: null, // { state, progress, credits, createTime, model, checking, error }

  // Reglages de rendu et prompt edite : dans le store, pas dans le composant.
  // La capture demontait l'ecran de rendu et emportait tout avec elle.
  renderSettings: {
    captureSize: '720p',
    resolution: '720p',
    aspectRatio: null, // null => suit le format de la scene
    generateAudio: false,
    audioUrls: '',
    imageUrls: '',
    callBackUrl: '',
  },
  promptDraft: null, // null => derive du blocking

  // ========================================================================
  setApiKey: (apiKey) => {
    try {
      if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* mode prive : la cle ne survivra pas au rechargement, sans consequence */
    }
    set({ apiKey, apiStatus: 'idle', apiMessage: '' });
  },

  testApiKey: async () => {
    const { apiKey } = get();
    set({ apiStatus: 'testing', apiMessage: '' });
    try {
      const res = await testConnection(apiKey);
      set((s) => ({
        apiStatus: 'ok',
        apiMessage: `Connecte a gpt-6-astra (${res.latency} ms)`,
        creditsSpent: s.creditsSpent + (res.credits || 0),
      }));
    } catch (err) {
      set({ apiStatus: 'error', apiMessage: err.message });
    }
  },

  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_STORAGE, lang);
    } catch {
      /* mode prive : la preference ne survivra pas, sans consequence */
    }
    set({ lang });
  },

  setBrief: (patch) => set(patch),

  // --- Chargement de scene -------------------------------------------------
  applyScene: (rawScene, { origin, raw = null, resetTime = true } = {}) => {
    const { scene, warnings } = normalizeSceneGraph(rawScene);
    const solve = solveScene(scene);
    set({
      scene,
      solve,
      warnings: [...warnings, ...solve.warnings],
      rawResponse: raw,
      sceneOrigin: origin,
      screen: 'blocking',
      selection: null,
      correction: null,
      dirty: false,
      ...(resetTime ? { time: 0, playing: false } : {}),
    });
  },

  /** Recalcule la scene apres une edition (camera, duree...). */
  patchScene: (patch) => {
    const { scene } = get();
    if (!scene) return;
    const next = { ...scene, ...patch };
    const { scene: normalized, warnings } = normalizeSceneGraph(next);
    const solve = solveScene(normalized);
    set((s) => ({
      scene: normalized,
      solve,
      warnings: [...warnings, ...solve.warnings],
      dirty: true,
      time: Math.min(s.time, normalized.project.duration),
    }));
  },

  patchCamera: (patch) => {
    const { scene, patchScene } = get();
    if (!scene) return;
    // Regler le rig invalide une trajectoire imposee : la conserver donnerait
    // une camera qui ignore le reglage qu'on vient de changer. Poser des cles
    // est en revanche une edition de trajectoire, pas de rig.
    const dropKeys = Object.keys(patch).some((k) => k !== 'keys');
    patchScene({
      camera: { ...scene.camera, ...patch, ...(dropKeys && !('keys' in patch) ? { keys: null } : {}) },
    });
    if (dropKeys) set({ correction: null });
  },

  /** Remplace la trajectoire d'un acteur par des waypoints explicites. */
  setActorPath: (actorId, waypoints) => {
    const { scene, patchScene } = get();
    if (!scene) return;
    patchScene({
      actors: scene.actors.map((a) => (a.id === actorId ? { ...a, waypoints } : a)),
    });
  },

  /**
   * Fige l'itineraire calcule en waypoints editables. C'est le point d'entree
   * de l'edition : tant qu'un acteur suit le graphe de zones, il n'a pas de
   * points a deplacer.
   */
  detachActorPath: (actorId) => {
    const { scene, solve, setActorPath } = get();
    const entry = solve?.actorPaths.get(actorId);
    if (!scene || !entry) return;
    const source = entry.path.waypoints?.length >= 2 ? entry.path.waypoints : entry.path.samples;
    const count = Math.min(12, Math.max(3, source.length));
    const pts = [];
    for (let i = 0; i < count; i += 1) {
      const p = source[Math.round((i / (count - 1)) * (source.length - 1))];
      pts.push([Number(p.x.toFixed(3)), 0, Number(p.z.toFixed(3))]);
    }
    setActorPath(actorId, pts);
  },

  resetActorPath: (actorId) => get().setActorPath(actorId, null),

  /** Insere un point sur la trajectoire, a l'index donne. */
  insertActorWaypoint: (actorId, index, point) => {
    const { scene, setActorPath } = get();
    const actor = scene?.actors.find((a) => a.id === actorId);
    if (!actor?.waypoints) return;
    const next = [...actor.waypoints];
    next.splice(index, 0, point.map((n) => Number(n.toFixed(3))));
    setActorPath(actorId, next);
  },

  removeActorWaypoint: (actorId, index) => {
    const { scene, setActorPath } = get();
    const actor = scene?.actors.find((a) => a.id === actorId);
    // Deux points au minimum : en dessous il n'y a plus de trajectoire.
    if (!actor?.waypoints || actor.waypoints.length <= 2) return;
    setActorPath(actorId, actor.waypoints.filter((_, i) => i !== index));
  },

  /** Deplace un objet ou une zone. Le graphe de portes est recalcule derriere. */
  moveEntity: (kind, id, position, rotation) => {
    const { scene, patchScene } = get();
    if (!scene) return;
    const round = (v) => Number(v.toFixed(3));
    if (kind === 'prop') {
      patchScene({
        props: scene.props.map((p) =>
          p.id === id
            ? {
                ...p,
                position: [round(position[0]), 0, round(position[2])],
                ...(rotation != null ? { rotation: Number(rotation.toFixed(4)) } : {}),
              }
            : p
        ),
      });
    } else if (kind === 'zone') {
      patchScene({
        zones: scene.zones.map((z) =>
          z.id === id ? { ...z, position: [round(position[0]), z.position[1], round(position[2])] } : z
        ),
      });
    }
  },

  /**
   * Pose ou remplace une cle camera a l'instant courant. C'est le geste 3D
   * standard : on place la camera, on enregistre ou elle est.
   */
  setCameraKeyAtTime: (position, target) => {
    const { scene, time, patchScene } = get();
    if (!scene) return;
    const round = (v) => Number(v.toFixed(3));
    const key = {
      t: Number(time.toFixed(3)),
      position: position.map(round),
      ...(target ? { target: target.map(round) } : {}),
    };
    const existing = (scene.camera.keys || []).filter((k) => Math.abs(k.t - key.t) > 1e-3);
    const keys = [...existing, key].sort((a, b) => a.t - b.t);

    // Une cle seule ne definit pas de trajectoire : on ancre l'autre extremite
    // sur la position actuelle du rig, sinon poser la premiere cle ne ferait rien.
    if (keys.length === 1) {
      const { cameraAtTime } = get();
      const other = key.t > scene.project.duration / 2 ? 0 : scene.project.duration;
      const p = cameraAtTime(other);
      keys.push({ t: other, position: [round(p.position.x), round(p.position.y), round(p.position.z)] });
      keys.sort((a, b) => a.t - b.t);
    }
    patchScene({ camera: { ...scene.camera, keys } });
  },

  removeCameraKey: (t) => {
    const { scene, patchScene } = get();
    if (!scene?.camera.keys) return;
    const keys = scene.camera.keys.filter((k) => Math.abs(k.t - t) > 1e-3);
    patchScene({ camera: { ...scene.camera, keys: keys.length >= 2 ? keys : null } });
  },

  clearCameraKeys: () => {
    const { scene, patchScene } = get();
    if (!scene) return;
    patchScene({ camera: { ...scene.camera, keys: null } });
  },

  /** Position camera resolue a un instant, pour amorcer une pose de cle. */
  cameraAtTime: (t) => {
    const { solve } = get();
    const frames = solve?.track.frames || [];
    if (!frames.length) return { position: { x: 0, y: 1.6, z: 0 }, lookAt: { x: 0, y: 1.5, z: -1 } };
    const u = solve.track.duration > 0 ? Math.min(1, Math.max(0, t / solve.track.duration)) : 0;
    return frames[Math.round(u * (frames.length - 1))];
  },

  loadFixture: async (name) => {
    const modules = {
      restaurant: () => import('../fixtures/restaurant.json'),
      apartment: () => import('../fixtures/apartment.json'),
      street: () => import('../fixtures/street.json'),
    };
    const mod = await modules[name]();
    get().applyScene(mod.default, { origin: 'fixture', raw: mod.default });
  },

  importScene: (json) => {
    const parsed = typeof json === 'string' ? parseJsonLoose(json) : json;
    get().applyScene(parsed, { origin: 'import', raw: parsed });
  },

  generate: async () => {
    const { apiKey, description, duration, fps, aspectRatio, applyScene } = get();
    if (!description.trim()) {
      set({ generationError: 'Decris la scene avant de generer.' });
      return;
    }
    set({ generating: true, generationError: null });
    try {
      const prompt = buildScenePrompt({ description: description.trim(), duration, fps, aspectRatio });
      const { text, credits, raw } = await callAstra({ apiKey, prompt, effort: 'low' });
      const parsed = parseJsonLoose(text);
      set((s) => ({ creditsSpent: s.creditsSpent + (credits || 0), apiStatus: 'ok' }));
      applyScene(parsed, { origin: 'api', raw });
    } catch (err) {
      set({
        generationError: err instanceof KieError ? err.message : `Echec de la generation : ${err.message}`,
        apiStatus: 'error',
      });
    } finally {
      set({ generating: false });
    }
  },

  // --- Lecture -------------------------------------------------------------
  setTime: (time) => {
    const { scene } = get();
    const max = scene ? scene.project.duration : 0;
    set({ time: Math.min(max, Math.max(0, time)) });
  },

  /** Appele par la boucle de rendu : une seule horloge pour la 3D et la timeline. */
  advance: (delta) => {
    const { playing, time, rate, loop, scene } = get();
    if (!playing || !scene) return;
    const duration = scene.project.duration;
    let next = time + delta * rate;
    if (next >= duration) {
      if (loop) next %= duration;
      else {
        set({ time: duration, playing: false });
        return;
      }
    }
    set({ time: next });
  },

  togglePlay: () => {
    const { playing, time, scene } = get();
    if (!scene) return;
    // Relancer depuis la fin repart du debut plutot que de rester bloque.
    const atEnd = time >= scene.project.duration - 1e-4;
    set({ playing: !playing, ...(!playing && atEnd ? { time: 0 } : {}) });
  },

  stepFrames: (n) => {
    const { scene, time, setTime } = get();
    if (!scene) return;
    set({ playing: false });
    setTime(time + n / scene.project.fps);
  },

  setRate: (rate) => set({ rate }),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  setViewMode: (viewMode) => set({ viewMode }),
  setEditMode: (editMode) => set({ editMode }),
  select: (selection) => set({ selection }),

  goTo: (screen) =>
    set((s) => {
      if (screen === 'home') return { screen: 'home', playing: false };
      if (!s.scene) return {};
      // Quitter le blocking arrete la lecture : rien ne doit tourner hors ecran.
      return { screen, ...(screen === 'blocking' ? {} : { playing: false }) };
    }),

  setRenderSettings: (patch) =>
    set((s) => ({ renderSettings: { ...s.renderSettings, ...patch } })),

  setPromptDraft: (promptDraft) => set({ promptDraft }),
  resetPromptDraft: () => set({ promptDraft: null }),

  /**
   * Etat reel de chaque etape du pipeline. Derive, jamais stocke : une etape ne
   * peut donc pas mentir sur sa disponibilite.
   */
  /**
   * Etat reel de chaque etape du pipeline. Derive, jamais stocke : une etape ne
   * peut donc pas mentir sur sa disponibilite. Renvoie des cles de traduction,
   * pas des libelles : le store ne connait pas la langue de l'interface.
   */
  pipeline: () => {
    const { scene, solve, clips, apiKey, render, promptDraft } = get();
    const clipCount = Object.keys(clips).length;
    const missing = [];
    if (clipCount < 2) missing.push({ key: 'pipeline.render.missing.passes', vars: { n: 2 - clipCount } });
    if (!apiKey?.trim()) missing.push({ key: 'pipeline.render.missing.key', vars: {} });

    return [
      {
        id: 'blocking',
        n: 1,
        label: 'pipeline.blocking',
        state: scene && solve ? 'done' : 'todo',
        hint: scene
          ? { key: 'pipeline.blocking.hint', vars: { actors: scene.actors.length, zones: scene.zones.length } }
          : null,
      },
      {
        id: 'prompt',
        n: 2,
        label: 'pipeline.prompt',
        state: promptDraft != null ? 'done' : scene ? 'ready' : 'todo',
        hint: {
          key: promptDraft != null ? 'pipeline.prompt.hint.edited' : 'pipeline.prompt.hint.generated',
          vars: {},
        },
      },
      {
        id: 'render',
        n: 3,
        label: 'pipeline.render',
        state:
          render.status === 'done'
            ? 'done'
            : ['uploading', 'submitting', 'polling'].includes(render.status)
              ? 'running'
              : missing.length
                ? 'blocked'
                : 'ready',
        hint: missing.length
          ? { key: 'pipeline.render.hint.blocked', missing }
          : { key: 'pipeline.render.hint.ready', vars: { count: clipCount } },
      },
    ];
  },

  autoCorrect: async () => {
    const { scene, solve, apiKey } = get();
    if (!scene || !solve || !solve.collision.first) return;

    set({ correcting: true, playing: false });
    const before = {
      hits: solve.collision.hits.length,
      worst: solve.collision.worst,
      obstacles: solve.collision.obstacles,
    };
    const previous = { camera: { ...scene.camera }, duration: scene.project.duration };

    const apply = (nextScene, { note, source, change = null, resolved }) => {
      const { scene: normalized } = normalizeSceneGraph(nextScene);
      const nextSolve = solveScene(normalized);
      set({
        scene: normalized,
        solve: nextSolve,
        dirty: true,
        correction: {
          note,
          source,
          change,
          resolved,
          before,
          after: { hits: nextSolve.collision.hits.length, worst: nextSolve.collision.worst },
          previous,
        },
      });
    };

    try {
      // 1. Voie API : le modele propose une trajectoire tenant compte de la
      //    geometrie reelle. Effort 'medium', la tache est geometrique.
      if (apiKey && apiKey.trim()) {
        try {
          const targetPath = solve.actorPaths.get(scene.camera.target)?.path;
          const samples = targetPath
            ? Array.from({ length: 8 }, (_, i) => {
                const p = targetPath.pointAt((i / 7) * targetPath.length);
                return [p.x, p.y, p.z];
              })
            : [];

          const prompt = buildCorrectionPrompt({
            camera: { ...scene.camera, fps: scene.project.fps },
            collision: solve.collision.worst || solve.collision.first,
            obstacles: solve.colliders
              .filter((c) => solve.collision.obstacles.some((o) => o.name === c.name))
              .slice(0, 12),
            doorways: solve.graph.doorways,
            targetPath: samples,
            duration: scene.project.duration,
          });

          const { text, credits } = await callAstra({ apiKey, prompt, effort: 'medium' });
          set((s) => ({ creditsSpent: s.creditsSpent + (credits || 0) }));
          const proposal = parseJsonLoose(text);

          if (Array.isArray(proposal?.waypoints) && proposal.waypoints.length >= 2) {
            const waypoints = proposal.waypoints
              .filter((w) => Array.isArray(w) && w.length >= 3)
              .map((w) => w.slice(0, 3).map(Number));

            // On ne fait pas confiance a la proposition : on la rebalaie.
            const { sweep } = evaluateWaypoints({
              scene,
              actorPaths: solve.actorPaths,
              colliders: solve.colliders,
              waypoints,
            });

            if (!sweep.first) {
              apply(
                {
                  ...scene,
                  camera: {
                    ...scene.camera,
                    keys: waypointsToKeys(waypoints, scene.project.duration),
                  },
                },
                {
                  note: proposal.note || 'Trajectoire corrigee par gpt-6-astra et validee par rebalayage.',
                  source: 'api',
                  resolved: true,
                }
              );
              return;
            }
            // Proposition encore en collision : on bascule sur le solveur local
            // plutot que d'appliquer une correction qui ne corrige rien.
          }
        } catch (err) {
          set({ apiMessage: `Auto-correction API indisponible : ${err.message}` });
        }
      }

      // 2 et 3. Relachement local, puis variantes de rig si le decor resiste.
      const result = resolveCollisions({ scene, solve });

      if (!result.applied) {
        // Rien de mieux que l'existant : on ne touche pas a la scene, et on le
        // dit. Appliquer un resultat egal ou pire donnait l'impression que le
        // bouton ne faisait rien.
        set({
          correction: {
            note: result.note,
            source: apiKey ? 'local-fallback' : 'local',
            change: null,
            resolved: false,
            before,
            after: { hits: before.hits, worst: before.worst },
            previous,
          },
        });
        return;
      }

      apply(result.scene, {
        note: result.note,
        source: apiKey ? 'local-fallback' : 'local',
        change: result.change,
        resolved: result.resolved,
      });
    } finally {
      // Sans ce filet, une exception laissait `correcting` a true et le bouton
      // desactive pour de bon : au clic suivant, plus rien ne se passait.
      set({ correcting: false });
    }
  },

  // --- Modelisation 3D par GPT-6 Astra -------------------------------------
  /**
   * Demande au modele d'ecrire la geometrie d'une entite. `target` vaut 'three'
   * (rendu immediat dans le navigateur) ou 'blender' (injecte dans l'export).
   * Le gabarit deja calcule est impose dans le prompt, puis re-verifie a la
   * compilation : un modele detaille ne doit deplacer ni le cadrage ni les
   * volumes de collision.
   */
  generateModel: async (entityId, target = 'three') => {
    const { scene, apiKey } = get();
    if (!scene) return;
    if (!apiKey || !apiKey.trim()) {
      set({ modelError: "Saisis ta cle kie.ai sur l'accueil pour modeliser avec l'IA." });
      return;
    }

    const actor = scene.actors.find((a) => a.id === entityId);
    const prop = (scene.props || []).find((p) => p.id === entityId);
    const entity = actor || prop;
    if (!entity) return;

    const bounds = actor
      ? { ...PROXY_BOUNDS[inferActorType(actor)], height: actor.height }
      : propBounds(prop);

    set({ modeling: `${entityId}:${target}`, modelError: null });
    try {
      const prompt = buildModelPrompt({
        entity: { ...entity, type: actor ? inferActorType(actor) : propBounds(prop).type },
        bounds,
        target,
        context: `${scene.project.name}, ${scene.environment.type}.`,
      });
      const { text, credits } = await callAstra({ apiKey, prompt, effort: 'medium' });
      set((s) => ({ creditsSpent: s.creditsSpent + (credits || 0), apiStatus: 'ok' }));

      // Le modele glisse parfois des clotures markdown malgre la consigne.
      const code = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

      if (target === 'three') {
        const compiled = compileModel(code);
        if (!compiled.ok) {
          set({ modeling: null, modelError: `${entity.name} : ${compiled.error}` });
          return;
        }
      } else if (!/def\s+build\s*\(/.test(code)) {
        set({ modeling: null, modelError: `${entity.name} : le code ne definit pas de build().` });
        return;
      }

      const models = { ...(scene.models || {}) };
      models[entityId] = { ...(models[entityId] || {}), [target]: code };
      set({ scene: { ...scene, models }, modeling: null, dirty: true });
    } catch (err) {
      set({ modeling: null, modelError: err.message });
    }
  },

  clearModel: (entityId, target) => {
    const { scene } = get();
    if (!scene?.models?.[entityId]) return;
    const models = { ...scene.models };
    const entry = { ...models[entityId], [target]: null };
    if (!entry.three && !entry.blender) delete models[entityId];
    else models[entityId] = entry;
    set({ scene: { ...scene, models }, dirty: true });
  },

  dismissModelError: () => set({ modelError: null }),

  // --- Images de reference par element -------------------------------------
  /**
   * Attache une image a un acteur, un objet ou une zone. Seedance ne recoit
   * qu'une liste plate : c'est le prompt qui dira a quoi chaque image
   * correspond, dans l'ordre exact du tableau envoye.
   */
  setEntityRef: (entityId, url, name) => {
    const { scene } = get();
    if (!scene || !url?.trim()) return;
    const refs = { ...(scene.refs || {}), [entityId]: { url: url.trim(), name: name || '' } };
    set({ scene: { ...scene, refs }, dirty: true });
  },

  clearEntityRef: (entityId) => {
    const { scene } = get();
    if (!scene?.refs?.[entityId]) return;
    const refs = { ...scene.refs };
    delete refs[entityId];
    set({ scene: { ...scene, refs }, dirty: true });
  },

  /** Met en ligne un fichier local puis l'attache. Repli manuel si le service refuse. */
  uploadEntityRef: async (entityId, file, name) => {
    const { apiKey } = get();
    set({ uploadingRef: entityId, refError: null });
    try {
      const url = await uploadBlob({ apiKey, blob: file, fileName: file.name || `${entityId}.png` });
      get().setEntityRef(entityId, url, name);
    } catch (err) {
      set({ refError: err.message });
    } finally {
      set({ uploadingRef: null });
    }
  },

  dismissRefError: () => set({ refError: null }),

  // --- Edition de scene par prompt -----------------------------------------
  /**
   * Applique une instruction en langage courant a la scene courante.
   *
   * Le modele renvoie un patch, pas un graphe complet : c'est ce qui preserve
   * les trajectoires et les positions reglees a la main. Un graphe entier les
   * ecraserait a chaque ajout.
   */
  editScene: async (instruction) => {
    const { scene, apiKey } = get();
    if (!scene || !instruction.trim()) return;
    if (!apiKey?.trim()) {
      set({ sceneEditError: 'scenePrompt.needKey' });
      return;
    }

    set({ sceneEditing: true, sceneEditError: null, sceneEditNote: null });
    try {
      const { text, credits } = await callAstra({
        apiKey,
        prompt: buildEditPrompt({ scene, instruction: instruction.trim() }),
        effort: 'low',
      });
      set((s) => ({ creditsSpent: s.creditsSpent + (credits || 0), apiStatus: 'ok' }));
      const patch = parseJsonLoose(text);

      const add = patch?.add || {};
      const removals = new Set(Array.isArray(patch?.remove) ? patch.remove : []);
      const updates = new Map(
        (Array.isArray(patch?.update) ? patch.update : []).filter((u) => u?.id).map((u) => [u.id, u])
      );

      const merge = (list, incoming) => [
        ...list.filter((e) => !removals.has(e.id)).map((e) => (updates.has(e.id) ? { ...e, ...updates.get(e.id) } : e)),
        ...(Array.isArray(incoming) ? incoming : []),
      ];

      const next = {
        ...scene,
        zones: merge(scene.zones, add.zones),
        actors: merge(scene.actors, add.actors),
        props: merge(scene.props || [], add.props),
      };

      const counts = {
        added: (add.zones?.length || 0) + (add.actors?.length || 0) + (add.props?.length || 0),
        updated: updates.size,
        removed: removals.size,
      };

      if (!counts.added && !counts.updated && !counts.removed) {
        set({ sceneEditNote: 'scenePrompt.nothing', sceneEditing: false });
        return;
      }

      const { scene: normalized, warnings } = normalizeSceneGraph(next);
      set({
        scene: normalized,
        solve: solveScene(normalized),
        warnings,
        dirty: true,
        sceneEditNote: counts,
        sceneEditing: false,
      });
    } catch (err) {
      set({ sceneEditError: err.message, sceneEditing: false });
    }
  },

  dismissSceneEdit: () => set({ sceneEditError: null, sceneEditNote: null }),

  /**
   * References d'images ordonnees, telles qu'elles partiront a Seedance.
   * L'ordre fait foi : le prompt les numerote dans cet ordre exact.
   */
  orderedRefs: () => {
    const { scene } = get();
    if (!scene?.refs) return [];
    const out = [];
    const push = (id, label, kind) => {
      const r = scene.refs[id];
      if (r) out.push({ id, url: r.url, label: r.name || label, kind });
    };
    scene.actors.forEach((a) => push(a.id, a.name, 'actor'));
    (scene.props || []).forEach((p2) => push(p2.id, p2.name, 'prop'));
    scene.zones.forEach((z) => push(z.id, z.name, 'zone'));
    return out;
  },

  // --- Capture des passes de blocking --------------------------------------
  /**
   * Enchaine les passes demandees. Chaque passe monte un viewport dedie a la
   * taille exacte exigee par Seedance, joue la prise et enregistre le canvas.
   */
  startCapture: (views = ['orbit', 'director'], sizeKey = '720p') => {
    const { scene } = get();
    if (!scene || !views.length) return;
    const size = CAPTURE_SIZES[sizeKey] || CAPTURE_SIZES['720p'];
    const [first, ...rest] = views;
    set({
      captureError: null,
      captureQueue: rest.map((v) => ({ view: v, ...size })),
      capture: { passId: `${Date.now()}-${first}`, view: first, ...size },
    });
  },

  finishCapturePass: (clip) => {
    const { clips, captureQueue } = get();
    const previous = clips[clip.view];
    if (previous?.url) URL.revokeObjectURL(previous.url);

    const nextClips = { ...clips, [clip.view]: clip };
    if (captureQueue.length) {
      const [next, ...rest] = captureQueue;
      set({
        clips: nextClips,
        captureQueue: rest,
        capture: { passId: `${Date.now()}-${next.view}`, ...next },
      });
    } else {
      set({ clips: nextClips, capture: null, captureQueue: [] });
    }
  },

  failCapture: (message) => set({ capture: null, captureQueue: [], captureError: message }),
  cancelCapture: () => set({ capture: null, captureQueue: [] }),
  dismissCaptureError: () => set({ captureError: null }),

  clearClip: (view) => {
    const { clips } = get();
    if (clips[view]?.url) URL.revokeObjectURL(clips[view].url);
    const next = { ...clips };
    delete next[view];
    set({ clips: next });
  },

  /** Renseigne l'URL publique d'un clip, saisie a la main ou obtenue a l'envoi. */
  setClipRemoteUrl: (view, remoteUrl) => {
    const { clips } = get();
    if (!clips[view]) return;
    set({ clips: { ...clips, [view]: { ...clips[view], remoteUrl } } });
  },

  /** Prompt Seedance courant, tenant compte des passes jointes. */
  seedancePrompt: () => {
    const { scene, solve, description, clips, promptDraft, orderedRefs } = get();
    if (!scene || !solve) return '';
    if (promptDraft != null) return promptDraft;
    const count = Object.keys(clips).length;
    return buildSeedancePrompt(scene, solve, description, {
      withReferenceVideos: count > 0,
      referenceCount: count,
      referenceImages: orderedRefs().map((r) => ({ label: r.label, kind: r.kind })),
    });
  },

  // --- Rendu Seedance ------------------------------------------------------
  /**
   * Met en ligne ce qui doit l'etre, soumet la tache, puis suit son etat.
   * La mise en ligne est faite au mieux : si le service de fichiers kie.ai n'est
   * pas joignable depuis le navigateur, on s'arrete avec un message clair
   * plutot que d'envoyer a Seedance des URL qu'il ne pourra pas telecharger.
   */
  submitRender: async () => {
    const { apiKey, clips, scene, renderSettings, seedancePrompt } = get();
    const prompt = seedancePrompt();
    const split = (v) =>
      String(v || '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
    // Les images d'elements ouvrent la liste : le prompt les numerote dans cet
    // ordre, il ne doit donc pas y avoir de decalage.
    const extraImages = [...get().orderedRefs().map((r) => r.url), ...split(renderSettings.imageUrls)];
    const audioUrls = split(renderSettings.audioUrls);
    const { resolution, generateAudio, callBackUrl } = renderSettings;
    // Le format suit la scene tant que l'utilisateur ne l'a pas force : sinon un
    // blocking compose en 2.39:1 se rendait silencieusement en 16:9.
    const aspectRatio = renderSettings.aspectRatio || scene?.project.aspectRatio || '16:9';

    if (!apiKey?.trim()) {
      set({ render: { status: 'error', message: 'Cle kie.ai requise.', taskId: null, urls: [], elapsed: 0 } });
      return;
    }

    const setRender = (patch) => set((s) => ({ render: { ...s.render, ...patch } }));

    try {
      // 1. Chaque passe doit etre accessible par une URL publique.
      const videoUrls = [];
      for (const [view, clip] of Object.entries(clips)) {
        if (clip.remoteUrl && isUsableAssetUrl(clip.remoteUrl)) {
          videoUrls.push(clip.remoteUrl);
          continue;
        }
        setRender({ status: 'uploading', message: `Mise en ligne de la passe "${view}"...` });
        const url = await uploadBlob({
          apiKey,
          blob: clip.blob,
          fileName: `blocking-${view}-${Date.now()}.${clip.mime.ext}`,
        });
        get().setClipRemoteUrl(view, url);
        videoUrls.push(url);
      }

      // 2. Soumission.
      setRender({ status: 'submitting', message: 'Soumission a Seedance 2.5...' });
      const payload = buildSeedancePayload({
        prompt,
        referenceVideos: videoUrls,
        referenceImages: extraImages,
        referenceAudio: audioUrls,
        duration: scene.project.duration,
        resolution,
        aspectRatio,
        generateAudio,
        callBackUrl,
      });
      const taskId = await createSeedanceTask({ apiKey, payload });
      setRender({ status: 'polling', message: '', taskId });

      // Confirmation immediate : sans elle, rien ne dit entre la soumission et
      // le premier tick que kie.ai a bien enregistre la tache.
      try {
        const first = await getTaskDetail({ apiKey, taskId });
        set({
          taskPing: {
            taskId,
            state: first.state,
            progress: first.progress,
            credits: first.creditsConsumed,
            createTime: first.createTime,
            model: first.model,
            accepted: true,
            checking: false,
            error: null,
          },
        });
      } catch {
        // Un ping rate ne condamne pas la tache : le sondage prend le relais.
      }

      // 3. Suivi.
      const detail = await pollTask({
        apiKey,
        taskId,
        onTick: (d, elapsed) => {
          setRender({ message: '', elapsed, state: d.state, progress: d.progress });
          set((st) => ({
            taskPing: { ...(st.taskPing || {}), state: d.state, progress: d.progress, checking: false },
          }));
        },
      });
      setRender({
        status: 'done',
        message: '',
        urls: detail.urls,
        credits: detail.creditsConsumed,
        costTime: detail.costTime,
      });
    } catch (err) {
      setRender({ status: 'error', message: err.message });
    }
  },

  /**
   * Interroge un identifiant de tache. Sert a deux choses reelles : verifier
   * qu'un rendu tourne, et reprendre le suivi apres une expiration ou un onglet
   * ferme — jusqu'ici une impasse apres un rendu paye.
   */
  checkTask: async (taskId) => {
    const { apiKey } = get();
    const id = String(taskId || '').trim();
    if (!id) return;
    if (!apiKey?.trim()) {
      set({ taskPing: { taskId: id, checking: false, error: 'render.block.key' } });
      return;
    }

    set({ taskPing: { taskId: id, checking: true, error: null } });
    try {
      const d = await getTaskDetail({ apiKey, taskId: id });
      set({
        taskPing: {
          taskId: id,
          state: d.state,
          progress: d.progress,
          credits: d.creditsConsumed,
          costTime: d.costTime,
          createTime: d.createTime,
          model: d.model,
          urls: d.urls,
          accepted: true,
          checking: false,
          error: null,
        },
      });

      // Une tache deja terminee : on recupere son resultat plutot que de le
      // laisser dans un message.
      if (isSuccess(d.state) && d.urls.length) {
        set({
          render: {
            status: 'done',
            message: '',
            taskId: id,
            urls: d.urls,
            elapsed: d.costTime || 0,
            credits: d.creditsConsumed,
          },
        });
      } else if (isFailure(d.state)) {
        set((st) => ({
          render: { ...st.render, status: 'error', taskId: id, message: d.failMsg || `${d.failCode || 'fail'}` },
        }));
      }
    } catch (err) {
      set({ taskPing: { taskId: id, checking: false, error: err.message } });
    }
  },

  /** Reprend le suivi d'une tache encore en cours. */
  resumeTask: async (taskId) => {
    const { apiKey } = get();
    const id = String(taskId || '').trim();
    if (!id || !apiKey?.trim()) return;
    const setRender = (patch) => set((st) => ({ render: { ...st.render, ...patch } }));
    setRender({ status: 'polling', taskId: id, message: '', urls: [] });
    try {
      const detail = await pollTask({
        apiKey,
        taskId: id,
        onTick: (d, elapsed) => {
          setRender({ elapsed, state: d.state, progress: d.progress });
          set((st) => ({ taskPing: { ...(st.taskPing || {}), state: d.state, progress: d.progress } }));
        },
      });
      setRender({ status: 'done', urls: detail.urls, credits: detail.creditsConsumed });
    } catch (err) {
      setRender({ status: 'error', message: err.message });
    }
  },

  dismissTaskPing: () => set({ taskPing: null }),

  resetRender: () => set({ taskPing: null, render: { status: 'idle', message: '', taskId: null, urls: [], elapsed: 0 } }),

  undoCorrection: () => {
    const { scene, correction } = get();
    if (!scene || !correction?.previous) return;
    // Une variante de rig peut avoir change la duree : on restaure les deux.
    const restored = {
      ...scene,
      project: { ...scene.project, duration: correction.previous.duration },
      camera: correction.previous.camera,
    };
    const { scene: normalized } = normalizeSceneGraph(restored);
    set({ scene: normalized, solve: solveScene(normalized), correction: null });
  },

  dismissCorrection: () => set({ correction: null }),
}));

export const selectDuration = (s) => (s.scene ? s.scene.project.duration : 0);
export const selectFps = (s) => (s.scene ? s.scene.project.fps : 24);
