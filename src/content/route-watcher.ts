export interface RouteWatcherOptions {
  getUrl(): string;
  isRelevant(url: string): boolean;
  timeoutMs: number;
  /** Un payload arrivato fino a graceMs prima del cambio URL vale per la nuova pagina. */
  graceMs: number;
  onMissing(url: string): void;
}

export class RouteWatcher {
  private lastUrl = '';
  private lastPayloadAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: RouteWatcherOptions) {}

  notifyPayload(): void {
    this.lastPayloadAt = Date.now();
  }

  check(): void {
    const url = this.opts.getUrl();
    if (url === this.lastUrl) return;
    this.lastUrl = url;
    if (this.timer) clearTimeout(this.timer);
    if (!this.opts.isRelevant(url)) return;
    const since = Date.now();
    this.timer = setTimeout(() => {
      if (this.lastPayloadAt < since - this.opts.graceMs && this.opts.getUrl() === url) this.opts.onMissing(url);
    }, this.opts.timeoutMs);
  }
}
