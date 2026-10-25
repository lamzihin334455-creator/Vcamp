import { providerBaseUrl, type ProviderConnection } from '../contracts/provider-config';
import type { ProviderView } from '../contracts/provider';

// SenseNova documents V4.1 Flash as deepseek-flash, while /models may advertise
// deepseek-v4.1-flash. V4 Flash is a different version and must retain its ID.
export function providerModelId(connection: ProviderConnection, id: string) {
  return providerBaseUrl(connection).replace(/\/+$/, '') === 'https://token.sensenova.cn/v1' && id === 'deepseek-v4.1-flash' ? 'deepseek-flash' : id;
}

export function normalizeProviderModels(connection: ProviderConnection, models: ProviderView['models']) {
  const normalized = new Map<string, ProviderView['models'][number]>();
  for (const model of models) {
    const id = providerModelId(connection, model.id);
    const canonical = providerBaseUrl(connection).replace(/\/+$/, '') === 'https://token.sensenova.cn/v1' && id === 'deepseek-flash';
    normalized.set(id, { ...normalized.get(id), ...model, id, ...(canonical ? { name: 'DeepSeek V4.1 Flash' } : {}) });
  }
  return [...normalized.values()];
}
