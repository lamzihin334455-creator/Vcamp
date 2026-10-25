import { describe, it, expect } from 'vitest';
import { parseVisionPlan, validateVisionPlan } from '../../src/contracts/vision';
import { MediaLease } from '../../src/video/media-lease';
import { visionPlanningTask } from '../../src/generation/run-vision';
import type { ChatRequestSnapshot } from '../../src/contracts/generation';

describe('original-media lease', () => {
  it('releases a host created after cancellation and never captures it', async () => {
    let finish!: (id: number) => void;
    const closed: number[] = [];
    const lease = new MediaLease({ create: () => new Promise(r => { finish = r; }), ready: async () => {}, capture: async () => { throw new Error('must not capture'); }, close: async id => { closed.push(id); } });
    const acquired = lease.acquire(); const released = lease.release(); finish(7);
    await expect(acquired).rejects.toThrow(); await released;
    expect(closed).toEqual([7]); await expect(lease.capture(1)).rejects.toThrow();
  });
  it('can only capture after decoder readiness and cannot rebind after release', async () => {
    const times: number[] = []; let ready!: () => void;
    const lease = new MediaLease({ create: async () => 8, ready: () => new Promise<void>(r => { ready = r; }), capture: async (_id, time) => { times.push(time); return time; }, close: async () => {} });
    const acquire = lease.acquire(); await Promise.resolve(); await Promise.resolve();
    await expect(lease.capture(2)).rejects.toThrow(); ready(); await acquire;
    expect(await lease.capture(2)).toBe(2); await lease.release();
    await expect(lease.acquire()).rejects.toThrow(); expect(times).toEqual([2]);
  });
});
describe('bounded frame plans', () => {
  it('rejects URLs, duplicate/out-of-range times and budget loss instead of dropping frames', () => {
    for (const plan of [{ times: [1, 1], reason: 'x' }, { times: [10], reason: 'x' }, { times: [1, 2], reason: 'x' }, { times: [1], reason: 'x', url: 'https://evil.invalid' }]) expect(() => validateVisionPlan(plan, 10, 1)).toThrow();
    expect(validateVisionPlan({ times: [], reason: '字幕足够' }, 10, 0).times).toEqual([]);
    expect(parseVisionPlan('```json\n{"times":[2],"reason":"核对画面"}\n```',10,1).times).toEqual([2]);
    expect(()=>parseVisionPlan('说明文字\n{"times":[2],"reason":"核对画面"}',10,1)).toThrow();
  });

  it('uses frozen template and interpreted requirements when a built-in template has no free-text input', () => {
    const task=visionPlanningTask({
      input:'',outputType:'markdown',templateSnapshot:{id:'builtin-note',revisionId:'builtin-note:v1',revision:1,builtin:true,name:'知识笔记',description:'',requirements:'整理章节、结论和关键时间点',outputType:'markdown',defaultModelId:null},
      evidence:{version:1,planningMode:'planned',plan:{version:1,interpretedIntent:'生成带关键时间点的知识笔记',additionalSources:[],outputRequirements:['Markdown 笔记']},includedSources:[],unavailableSources:[]}
    } as unknown as ChatRequestSnapshot);
    expect(task).toMatchObject({outputType:'markdown',template:{name:'知识笔记',requirements:'整理章节、结论和关键时间点'},interpretedIntent:'生成带关键时间点的知识笔记'});
    expect(task).not.toHaveProperty('request');
  });
});
