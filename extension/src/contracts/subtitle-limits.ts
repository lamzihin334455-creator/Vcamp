// Input limits are independent of generated-text and saved AI subtitle limits.
// Shared by source validation, executor boot, checkpoints and web preparation.
export const subtitleInputLimits={cueCount:100000,segments:128,segmentChars:12000,requestChars:1000000} as const;
export const subtitleProcessingLimits={cueCount:100000,batchCues:160,batchChars:12000,segments:4096,savedChars:4000000} as const;
