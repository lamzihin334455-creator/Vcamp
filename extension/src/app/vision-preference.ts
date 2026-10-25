export type VisionTarget = { workspaceId: string; chatId: string };
// The baseline has no draft vision field. Scope its existing local config adapter
// without adding a DB field, backup version, or generation message property.
export const visionPreferenceKey = (target: VisionTarget) => `vcamp.autoVision.${JSON.stringify([target.workspaceId, target.chatId])}`;
