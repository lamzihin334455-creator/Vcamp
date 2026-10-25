// Backend only. Never expose this adapter or its persisted record through application messages.
export interface CredentialStorage {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}
export interface CredentialStore { read(): Promise<unknown>; write(value: unknown): Promise<void> }
export function createCredentialStore(area: CredentialStorage): CredentialStore {
  // Fail closed: no credential read or write until the platform access boundary is set.
  const restricted = area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void restricted.catch(() => {});
  const name = 'vcamp.provider.v1';
  return {
    async read() { await restricted; return (await area.get(name))[name]; },
    async write(value) { await restricted; await area.set({ [name]: value }); }
  };
}
