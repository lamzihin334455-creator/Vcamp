// Storage/transport guard, not a writing target. Shared by the entire output
// path so a complete long response can be saved, edited, previewed and backed up.
export const outputLimits={textChars:4000000,markdownChars:4000000,htmlChars:4000000} as const;
