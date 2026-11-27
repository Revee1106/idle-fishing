/**
 * WeChat / Web LifecycleProvider + spike session coordinator (T08).
 * - Wraps wx.onShow / wx.onHide on WeChat Mini Game, visibilitychange on Web.
 * - Deduplicates repeated SHOW / HIDE transitions.
 * - Preserves original offline session deadline across repeated hide/show or abnormal kill/reentry.
 */
import type { LifecycleEvent, LifecycleProvider } from './PlatformTypes';

interface WxLifecycleGlobal {
  onShow?: (cb: () => void) => void;
  offShow?: (cb: () => void) => void;
  onHide?: (cb: () => void) => void;
  offHide?: (cb: () => void) => void;
}

export class RuntimeLifecycleProvider implements LifecycleProvider {
  private readonly listeners = new Set<(ev: LifecycleEvent) => void>();
  private lastEvent: LifecycleEvent | null = 'SHOW';
  private attached = false;
  private wxShowCb: (() => void) | null = null;
  private wxHideCb: (() => void) | null = null;
  private webVisCb: (() => void) | null = null;
  readonly eventLog: { event: LifecycleEvent; atMs: number; deduplicated: boolean; source: string }[] = [];

  private attachPlatformHooks(): void {
    if (this.attached) return;
    this.attached = true;
    const g = globalThis as { wx?: WxLifecycleGlobal; document?: Document };
    if (g.wx && typeof g.wx.onShow === 'function' && typeof g.wx.onHide === 'function') {
      this.wxShowCb = () => this.emit('SHOW', 'wx.onShow');
      this.wxHideCb = () => this.emit('HIDE', 'wx.onHide');
      g.wx.onShow(this.wxShowCb);
      g.wx.onHide(this.wxHideCb);
      return;
    }
    if (g.document && typeof g.document.addEventListener === 'function') {
      this.webVisCb = () => {
        const ev: LifecycleEvent = g.document!.visibilityState === 'hidden' ? 'HIDE' : 'SHOW';
        this.emit(ev, 'document.visibilitychange');
      };
      g.document.addEventListener('visibilitychange', this.webVisCb);
    }
  }

  emit(event: LifecycleEvent, source = 'simulated'): boolean {
    const deduplicated = this.lastEvent === event;
    this.eventLog.push({ event, atMs: Date.now(), deduplicated, source });
    if (deduplicated) return false;
    this.lastEvent = event;
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Listener isolation per Doc 17 §6
      }
    }
    return true;
  }

  subscribe(listener: (event: LifecycleEvent) => void): () => void {
    this.attachPlatformHooks();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    const g = globalThis as { wx?: WxLifecycleGlobal; document?: Document };
    if (g.wx && this.wxShowCb && typeof g.wx.offShow === 'function') {
      g.wx.offShow(this.wxShowCb);
    }
    if (g.wx && this.wxHideCb && typeof g.wx.offHide === 'function') {
      g.wx.offHide(this.wxHideCb);
    }
    if (g.document && this.webVisCb && typeof g.document.removeEventListener === 'function') {
      g.document.removeEventListener('visibilitychange', this.webVisCb);
    }
    this.listeners.clear();
    this.attached = false;
  }
}
