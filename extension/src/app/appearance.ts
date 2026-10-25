export const accentColors = [
  { name: '柔雾玫瑰', value: '#cf6685', text: '#a84362' },
  { name: '灰玉绿', value: '#4b897b', text: '#35695e' },
  { name: '雾蓝', value: '#687fc1', text: '#495f9d' },
  { name: '柔金', value: '#ae8a50', text: '#80612d' },
  { name: '灰鸢尾', value: '#8a79ac', text: '#695787' }
] as const;

export const defaultAccent = accentColors[0];

const legacyAccents: Record<string, string> = {
  '#d96f91': '#cf6685',
  '#2f8f62': '#4b897b',
  '#5b78d6': '#687fc1',
  '#b9863b': '#ae8a50',
  '#7b67c8': '#8a79ac'
};

/** Resolve old saved colors without changing storage during a read. */
export function resolveAccent(value: unknown) {
  const stored = typeof value === 'string' ? value.toLowerCase() : '';
  const current = legacyAccents[stored] ?? stored;
  return accentColors.find(color => color.value === current) ?? defaultAccent;
}
