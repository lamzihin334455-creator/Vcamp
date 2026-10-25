import { ApplicationError } from '../contracts/application';
import type { InstructionPort } from '../contracts/instructions';
import { IndexedGenerationStore } from '../data/generation-store';
import { IndexedAttachmentStore } from '../data/attachment-store';
import { instructionTraces } from './instruction-trace';

export function createInstructionService(store = new IndexedGenerationStore(), images = new IndexedAttachmentStore()): InstructionPort {
  return { async command(op) {
    const job = await store.get(op.jobId), target = job?.snapshot.target;
    if (!job || !target || target.workspaceId !== op.workspaceId || (target.kind === 'chat' ? target.chatId !== op.chatId : op.chatId !== undefined)) throw new ApplicationError('not-found');
    // Use the existing ownership/deletion checks before exposing any records.
    await store.view(target);
    const calls = await instructionTraces().query(job.jobId).catch(() => []);
    const snapshot = job.snapshot;
    const hashes = new Set(calls.flatMap(call => call.images.map(image => image.sha256)));
    let selected: { id: string; sha256: string; time: number }[] = [];
    if ('input' in snapshot && target.kind === 'chat' && hashes.size) {
      const ids = [...new Set([...snapshot.attachmentIds, ...snapshot.historyProjection.flatMap(h => [...h.attachmentIds]), ...job.attempts.flatMap(a => a.visual?.attachmentIds ?? [])])];
      // Each attempt respects the six-image budget; read individually across retries.
      for (const id of ids) {
        const image = await images.read(target, [id], true).then(rows => rows[0]).catch(() => undefined);
        if (image && hashes.has(image.sha256)) selected.push({ id: image.id, sha256: image.sha256, time: image.time });
      }
    }
    return {
      calls, images: selected.slice(0, 100), attempts: job.attempts.map(a => ({ attemptId: a.attemptId, state: a.state })),
      request: { input: 'input' in snapshot ? snapshot.input : snapshot.requirements, modelId: snapshot.modelId,
        ...('roleSnapshot' in snapshot && snapshot.roleSnapshot ? { role: snapshot.roleSnapshot } : {}),
        ...('templateSnapshot' in snapshot && snapshot.templateSnapshot ? { template: snapshot.templateSnapshot } : {}) },
      note: '记录来自实际交给网络层的请求体；HTTP 响应不代表生成成功。未通过校验的取帧规划另保留接收到的正文供排查。仅在本次浏览器会话保存，最长24小时、合计4MiB/60次调用，较早记录可能被清理；不含密钥、请求头或模型内部思考。图片字节以指纹代替，可查看对应原附件。'
    };
  } };
}
