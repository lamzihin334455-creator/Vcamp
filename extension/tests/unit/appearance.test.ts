import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChromeClient } from '../../src/app/chrome-client';
afterEach(() => vi.unstubAllGlobals());
describe('appearance preference through the existing local configuration adapter', () => {
  function storage() {
    const values: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { storage: { local: {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (next: Record<string, unknown>) => { Object.assign(values, next); }
    } } });
    return values;
  }
  it('restores the selected accent in a newly opened client', async () => {
    const values = storage();
    expect(await createChromeClient(false).appearancePreferences!.read()).toBe('#cf6685');
    await createChromeClient(false).appearancePreferences!.write('#687fc1');
    expect(values).toEqual({ 'vcamp.accent': '#687fc1' });
    expect(await createChromeClient(false).appearancePreferences!.read()).toBe('#687fc1');
  });
  it('keeps the color family of each legacy selection without writing during reads', async () => {
    const values = storage();
    for (const [legacy, current] of [['#d96f91','#cf6685'],['#2f8f62','#4b897b'],['#5b78d6','#687fc1'],['#b9863b','#ae8a50'],['#7b67c8','#8a79ac']]) {
      values['vcamp.accent'] = legacy;
      expect(await createChromeClient(true).appearancePreferences!.read()).toBe(current);
      expect(values['vcamp.accent']).toBe(legacy);
    }
    values['vcamp.accent'] = 'invalid';
    expect(await createChromeClient(false).appearancePreferences!.read()).toBe('#cf6685');
  });
  it('rejects unknown colors and writes from readonly documents', async () => {
    const values = storage();
    await createChromeClient(false).appearancePreferences!.write('red; display:none');
    await createChromeClient(true).appearancePreferences!.write('#8a79ac');
    expect(values).toEqual({});
  });
});
