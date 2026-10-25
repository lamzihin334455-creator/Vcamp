// One bounded task/attempt owns one disposable host. Never a source-player lock.
export interface MediaLeasePort<T> {
  create(): Promise<number>; ready(tabId: number): Promise<void>;
  capture(tabId: number, time: number): Promise<T>; close(tabId: number): Promise<void>;
}
export class MediaLease<T> {
  private cancelled = false;
  private usable = false;
  private tabId?: number;
  private acquiring?: Promise<void>;
  private closing?: Promise<void>;
  private busy = false;
  constructor(private port: MediaLeasePort<T>) {}
  acquire() {
    if (this.cancelled || this.acquiring) return Promise.reject(new Error('lease-unavailable'));
    this.acquiring = (async () => {
      this.tabId = await this.port.create();
      if (this.cancelled) throw new Error('cancelled');
      await this.port.ready(this.tabId);
      if (this.cancelled) throw new Error('cancelled');
      this.usable = true;
    })();
    return this.acquiring.catch(async error => { await this.release(); throw error; });
  }
  async capture(time: number) {
    if (!this.usable || this.cancelled || this.busy || this.tabId === undefined) throw new Error('lease-unavailable');
    this.busy = true;
    try {
      const frame = await this.port.capture(this.tabId, time);
      if (this.cancelled) throw new Error('cancelled');
      return frame;
    } finally { this.busy = false; }
  }
  release() {
    this.cancelled = true; this.usable = false;
    return this.closing ??= (async () => {
      await this.acquiring?.catch(() => {});
      if (this.tabId !== undefined) await this.port.close(this.tabId);
    })();
  }
}
