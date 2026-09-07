import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTaskDetail, pollDelay, isSuccess, isFailure, isTerminal, TASK_STATES } from './seedance.js';

/** Reponse recordInfo telle que la documente kie.ai. */
const reply = (data) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ code: 200, msg: 'success', data }),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('etats de tache', () => {
  it('couvre les cinq etats documentes', () => {
    expect(TASK_STATES).toEqual(['waiting', 'queuing', 'generating', 'success', 'fail']);
  });

  it.each([
    ['waiting', false, false],
    ['queuing', false, false],
    ['generating', false, false],
    ['success', true, false],
    ['fail', false, true],
  ])('%s -> succes %s, echec %s', (state, ok, ko) => {
    expect(isSuccess(state)).toBe(ok);
    expect(isFailure(state)).toBe(ko);
    expect(isTerminal(state)).toBe(ok || ko);
  });
});

describe('lecture de recordInfo', () => {
  it('deplie resultJson et remonte les champs de suivi', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply({
          taskId: 'task_123',
          model: 'bytedance/seedance-2-5',
          state: 'success',
          resultJson: '{"resultUrls":["https://cdn/shot.mp4"]}',
          progress: 100,
          creditsConsumed: 50,
          costTime: 15000,
          createTime: 1698765400000,
          completeTime: 1698765432000,
          failCode: '',
          failMsg: '',
        })
      )
    );

    const d = await getTaskDetail({ apiKey: 'k', taskId: 'task_123' });
    expect(d.state).toBe('success');
    expect(d.urls).toEqual(['https://cdn/shot.mp4']);
    expect(d.progress).toBe(100);
    expect(d.creditsConsumed).toBe(50);
    expect(d.costTime).toBe(15000);
    expect(d.model).toBe('bytedance/seedance-2-5');
    // Les champs d'echec vides ne doivent pas se lire comme des erreurs.
    expect(d.failCode).toBeNull();
    expect(d.failMsg).toBeNull();
  });

  it("distingue un avancement absent d'un avancement nul", async () => {
    // La doc ne renseigne `progress` que pour certains modeles : 0 % et
    // "inconnu" ne veulent pas dire la meme chose a l'ecran.
    vi.stubGlobal('fetch', vi.fn(async () => reply({ taskId: 't', state: 'generating' })));
    const d = await getTaskDetail({ apiKey: 'k', taskId: 't' });
    expect(d.progress).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => reply({ taskId: 't', state: 'generating', progress: 0 })));
    expect((await getTaskDetail({ apiKey: 'k', taskId: 't' })).progress).toBe(0);
  });

  it('survit a un resultJson illisible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ taskId: 't', state: 'success', resultJson: '{oops' })));
    const d = await getTaskDetail({ apiKey: 'k', taskId: 't' });
    expect(d.urls).toEqual([]);
    expect(d.state).toBe('success');
  });

  it('remonte le motif d un echec', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ taskId: 't', state: 'fail', failCode: '501', failMsg: 'Generation failed' }))
    );
    const d = await getTaskDetail({ apiKey: 'k', taskId: 't' });
    expect(isFailure(d.state)).toBe(true);
    expect(d.failCode).toBe('501');
    expect(d.failMsg).toBe('Generation failed');
  });
});

describe('cadence de sondage', () => {
  it('demarre court puis croit', () => {
    const first = pollDelay(0);
    const later = pollDelay(4);
    expect(first).toBeGreaterThanOrEqual(2000);
    expect(first).toBeLessThanOrEqual(3000);
    expect(later).toBeGreaterThan(first);
  });

  it('plafonne pour ne pas deriver sur un rendu long', () => {
    expect(pollDelay(50)).toBe(15000);
    expect(pollDelay(200)).toBe(15000);
  });

  it('reste croissante', () => {
    const delays = Array.from({ length: 12 }, (_, i) => pollDelay(i));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });
});
