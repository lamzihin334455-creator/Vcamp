import { z } from 'zod';

export const providerDirectory = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'bailian', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'siliconflow', name: '硅基流动（SiliconFlow）', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'zhipu', name: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'sensenova', name: '商汤日日新', baseUrl: 'https://token.sensenova.cn/v1' },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '' }
] as const;
// Keep legacy provider identities readable for saved connections and history.
export const providerPresets = providerDirectory.filter(item => ['deepseek', 'bailian', 'sensenova', 'custom'].includes(item.id));
export const providerIdSchema = z.enum(['deepseek', 'bailian', 'siliconflow', 'zhipu', 'sensenova', 'custom']);
export type ProviderId = z.infer<typeof providerIdSchema>;
export const baseUrlSchema = z.string().trim().min(1).max(500).refine(value => {
  try {
    const url = new URL(value);
    return /^https:\/\//i.test(value) && url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash
      && !/[\\\s]/.test(value) && !/\/(chat\/completions|models)\/?$/.test(url.pathname);
  } catch { return false; }
}, '请填写 HTTPS Base URL，不包含 /chat/completions、密钥或查询参数').transform(value => new URL(value).href.replace(/\/+$/, ''));
export interface ProviderConnection { providerId: ProviderId; baseUrl?: string; profileId?: string }
export function providerBaseUrl(connection: ProviderConnection) {
  return connection.baseUrl ?? providerDirectory.find(provider => provider.id === connection.providerId)!.baseUrl;
}
export function nativeDeepSeek(connection: ProviderConnection | undefined) {
  return !!connection && connection.providerId === 'deepseek' && providerBaseUrl(connection) === providerDirectory[0].baseUrl;
}
export function connectionIdentity(connection: ProviderConnection) {
  return `${connection.providerId}:${providerBaseUrl(connection)}`;
}
export function sameProviderConnection(frozen: ProviderConnection | undefined, current: ProviderConnection) {
  // Historical requests predate configurable endpoints and belong to DeepSeek.
  return connectionIdentity(frozen ?? { providerId: 'deepseek' }) === connectionIdentity(current)
    && (!frozen?.profileId || frozen.profileId === current.profileId);
}
