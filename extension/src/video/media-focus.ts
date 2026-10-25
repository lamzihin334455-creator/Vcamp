// Memory only: a Worker restart can clean a host but can never regain focus rights.
export class MediaFocus {
  private valid = true;
  private activatedOnce = false;
  constructor(readonly windowId: number, readonly returnTabId: number, readonly hostId: number) {}
  invalidate() { this.valid = false; }
  activated(tabId: number, windowId: number) {
    if (windowId !== this.windowId) return;
    if (!this.activatedOnce && tabId === this.hostId) this.activatedOnce = true;
    else this.invalidate();
  }
  windowChanged(windowId: number) { if (windowId !== this.windowId) this.invalidate(); }
  takeReturn(activeId: number, windowId: number, focused: boolean) {
    const allowed = this.valid && this.activatedOnce && activeId === this.hostId && windowId === this.windowId && focused;
    this.invalidate();
    return allowed ? this.returnTabId : undefined;
  }
}
