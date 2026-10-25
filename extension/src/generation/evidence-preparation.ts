import { tracedTransport } from './instruction-trace';
import { z } from 'zod';
import type { VideoKey } from '../contracts/application';
import {
  frozenEvidenceSchema,
  requestRequirementsSchema,
  configurableDataSourceSchema,
  type ConfigurableDataSource,
  type FrozenEvidence,
  type RequestPlanningContext
} from '../contracts/evidence';
import type { CredentialStore } from './credential-store';
import { baseUrlSchema, providerBaseUrl, providerIdSchema, sameProviderConnection, type ProviderConnection } from '../contracts/provider-config';
import { createProviderPort, providerCompletionEndpoint } from './provider-port';
import { fixedPrompt } from '../prompts/fixed-rules';

export interface EvidencePreparationPort {
  prepare(input: { source: VideoKey; context: RequestPlanningContext; traceId?: string; providerConnection?: ProviderConnection }): Promise<FrozenEvidence>;
}

const credentialSchema = z.object({ key: z.string().regex(/^[\x21-\x7e]{1,256}$/).nullable(), providerId: providerIdSchema.default('deepseek'), baseUrl: baseUrlSchema.optional(), profileId: z.string().uuid().optional() });
const viewSchema = z.object({
  code: z.literal(0),
  data: z.object({ aid: z.number().int().positive(), desc: z.string() }).passthrough()
}).passthrough();
const playerSchema = z.object({
  code: z.literal(0),
  data: z.object({ view_points: z.array(z.object({ content: z.string(), from: z.number(), to: z.number().optional() }).passthrough()).optional() }).passthrough()
}).passthrough();
const repliesSchema = z.object({
  code: z.literal(0),
  data: z.object({ replies: z.array(z.object({ like: z.number().int().nonnegative(), content: z.object({ message: z.string() }).passthrough() }).passthrough()).nullable().optional() }).passthrough()
}).passthrough();

const allSources = configurableDataSourceSchema.options;
const fallbackPlan = (input: RequestPlanningContext) => {
  const required=input.requiredSources??[],explicit=input.explicitSources??[];
  return requestRequirementsSchema.parse({
    version: 1,
    interpretedIntent: input.request.trim().slice(0, 1000) || '根据完整主字幕完成用户请求',
    additionalSources: [...new Set([...required, ...explicit, ...(input.hasConversationHistory?['conversation_history' as const]:[])])].map(source => ({ source, reason: required.includes(source) ? '任务模板要求使用' : explicit.includes(source) ? '用户在本次请求中明确启用' : '保留连续问答所需的上下文' })),
    outputRequirements: []
  });
};

async function json(transport: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await transport(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok) throw new Error('source unavailable');
  return response.json();
}

export function createEvidencePreparation(credentials: CredentialStore, transport: typeof fetch = fetch): EvidencePreparationPort {
  return { async prepare(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const requiredSources=input.context.requiredSources??[],explicitSources=input.context.explicitSources??[];
      const bvid = encodeURIComponent(input.source.videoId), cid = encodeURIComponent(input.source.partId);
      const [rawView, rawPlayer] = await Promise.all([
        json(transport, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, controller.signal).catch(() => null),
        json(transport, `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, controller.signal).catch(() => null)
      ]);
      const view = viewSchema.safeParse(rawView), player = playerSchema.safeParse(rawPlayer);
      const description = view.success ? view.data.data.desc.trim().slice(0, 12_000) : '';
      const chapters = player.success ? (player.data.data.view_points ?? []).flatMap(point => {
        const title = point.content.trim().slice(0, 300);
        if (!title || !Number.isFinite(point.from) || point.from < 0 || point.to !== undefined && (!Number.isFinite(point.to) || point.to <= point.from)) return [];
        return [{ title, from: point.from, ...(point.to === undefined ? {} : { to: point.to }) }];
      }).slice(0, 100) : [];
      const available: ConfigurableDataSource[] = [
        ...(input.context.hasFullSubtitles ? ['full_subtitles' as const] : []),
        ...(chapters.length ? ['video_chapters' as const] : []),
        ...(description ? ['video_description' as const] : []),
        ...(view.success ? ['hot_comments' as const] : []),
        ...(input.context.hasConversationHistory ? ['conversation_history' as const] : []),
        ...(input.context.canUseVideoFrames ? ['video_frames' as const] : []),
        ...(input.context.canUseWeb && explicitSources.includes('web') ? ['web' as const] : [])
      ];

      let planningMode: FrozenEvidence['planningMode'] = 'planned';
      let plan = fallbackPlan(input.context);
      try {
        const credential = credentialSchema.parse(await credentials.read());
        if (!sameProviderConnection(input.providerConnection, credential) || !credential.key) throw new Error('missing credential');
        // SenseNova's model-specific quotas should go to the user's answer,
        // not an extra source-planning call immediately before it. Template
        // requirements, explicit sources, subtitles and history stay local.
        const local = credential.providerId === 'sensenova' || ['https://token.sensenova.cn/v1', 'https://token.sensenova.ai/v1'].includes(providerBaseUrl(credential));
        if (local) planningMode = 'local';
        else {
          const provider = createProviderPort(credential.key, input.traceId ? tracedTransport({ traceId: input.traceId }, credential.key, transport) : transport, providerCompletionEndpoint(credential), undefined, credential);
          let output = '';
          await provider.stream(input.context.modelId, [{
            role: 'system',
            content: fixedPrompt({ kind: 'requirements-plan' })
          }, {
            role: 'user',
            content: JSON.stringify({
              alwaysProvidedContext: ['video_title'],
              pluginDataCapabilities: allSources,
              availableDataSources: available,
              requiredDataSources: requiredSources,
              explicitlyEnabledDataSources: explicitSources,
              request: input.context.request,
              outputType: input.context.outputType,
              ...(input.context.templateRequirements ? { templateRequirements: input.context.templateRequirements } : {})
            })
          }], controller.signal, async delta => { output += delta; }, 'requirements-plan');
          plan = requestRequirementsSchema.parse(JSON.parse(output));
        }
      } catch {
        planningMode = 'fallback';
      }

      const requested = new Set<ConfigurableDataSource>([
        ...plan.additionalSources.map(item => item.source),
        ...requiredSources,
        ...explicitSources,
        ...(input.context.hasFullSubtitles ? ['full_subtitles' as const] : [])
      ]);
      const included: ConfigurableDataSource[] = [];
      const unavailable: ConfigurableDataSource[] = [];
      let hotComments: { content: string; likes: number }[] | undefined;
      for (const source of requested) {
        if (!available.includes(source)) { unavailable.push(source); continue; }
        if (source === 'full_subtitles' || source === 'video_frames' || source === 'web') { included.push(source); continue; }
        if (source === 'video_description') { included.push(source); continue; }
        if (source === 'video_chapters') { included.push(source); continue; }
        if (source === 'conversation_history') { included.push(source); continue; }
        try {
          const aid = view.success ? view.data.data.aid : 0;
          const raw = await json(transport, `https://api.bilibili.com/x/v2/reply?type=1&oid=${encodeURIComponent(String(aid))}&sort=2&pn=1&ps=20`, controller.signal);
          const parsed = repliesSchema.parse(raw);
          const seen = new Set<string>();
          hotComments = (parsed.data.replies ?? []).flatMap(reply => {
            const content = reply.content.message.replace(/\s+/g, ' ').trim().slice(0, 1000);
            if (!content || seen.has(content)) return [];
            seen.add(content); return [{ content, likes: reply.like }];
          }).sort((a, b) => b.likes - a.likes).slice(0, 20);
          if (hotComments.length) included.push(source); else unavailable.push(source);
        } catch { unavailable.push(source); }
      }
      const sourceManifest = allSources.map(source => {
        const required = requiredSources.includes(source), explicit = explicitSources.includes(source);
        const selected = requested.has(source), isAvailable = available.includes(source);
        const planReason = plan.additionalSources.find(item => item.source === source)?.reason;
        return {
          source,
          policy: source === 'full_subtitles' ? 'core' as const : required ? 'required' as const : explicit ? 'explicit' as const : 'auto' as const,
          availability: isAvailable ? 'available' as const : 'unavailable' as const,
          selection: included.includes(source) ? 'included' as const : selected && !isAvailable || unavailable.includes(source) ? 'unavailable' as const : 'omitted' as const,
          reason: included.includes(source) ? planReason ?? (required ? '任务模板要求使用' : explicit ? '用户在本次请求中明确启用' : source === 'full_subtitles' ? '视频理解的核心资料' : '资料规划选择使用') : selected ? '当前请求无法取得该资料' : '本次资料规划未选择'
        };
      });
      return frozenEvidenceSchema.parse({
        version: 1,
        planningMode,
        plan,
        includedSources: included,
        unavailableSources: unavailable,
        sourceManifest,
        ...(included.includes('video_description') ? { videoDescription: description } : {}),
        ...(included.includes('video_chapters') ? { chapters } : {}),
        ...(included.includes('hot_comments') ? { hotComments } : {})
      });
    } finally { clearTimeout(timer); }
  } };
}

export const fallbackEvidencePreparation: EvidencePreparationPort = {
  async prepare(input) {
    const plan = fallbackPlan(input.context);
    const requiredSources=input.context.requiredSources??[],explicitSources=input.context.explicitSources??[];
    const available = new Set<ConfigurableDataSource>([
      ...(input.context.hasFullSubtitles ? ['full_subtitles' as const] : []),
      ...(input.context.hasConversationHistory ? ['conversation_history' as const] : []),
      ...(input.context.canUseVideoFrames ? ['video_frames' as const] : []),
      ...(input.context.canUseWeb && explicitSources.includes('web') ? ['web' as const] : [])
    ]);
    const selected = new Set<ConfigurableDataSource>([...plan.additionalSources.map(item=>item.source),...requiredSources, ...explicitSources, ...(input.context.hasFullSubtitles ? ['full_subtitles' as const] : [])]);
    const included = [...selected].filter(source => available.has(source));
    const unavailable = [...selected].filter(source => !available.has(source));
    return frozenEvidenceSchema.parse({
      version: 1,
      planningMode: 'fallback',
      plan,
      includedSources: included,
      unavailableSources: unavailable,
      sourceManifest: allSources.map(source => ({ source, policy: source === 'full_subtitles' ? 'core' : requiredSources.includes(source) ? 'required' : explicitSources.includes(source) ? 'explicit' : 'auto', availability: available.has(source) ? 'available' : 'unavailable', selection: included.includes(source) ? 'included' : unavailable.includes(source) ? 'unavailable' : 'omitted', reason: included.includes(source) ? '按稳定回退策略提供' : unavailable.includes(source) ? '当前请求无法取得该资料' : '回退规划未选择' }))
    });
  }
};
