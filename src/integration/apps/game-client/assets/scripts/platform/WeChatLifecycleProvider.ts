/**
 * WeChat / Web LifecycleProvider (T08, I01, I05).
 * - Wraps wx.onShow / wx.onHide on WeChat Mini Game, document.visibilitychange on Web.
 * - Uses Set.prototype.forEach snapshot instead of `[...set]` spread so Babel loose compilation
 *   in Cocos Creator 3.8.8 never miscompiles Set iteration into `[].concat(this.listeners)`.
 * - Local unsubscribe() removes ONLY that subscriber; sibling subscribers continue receiving events.
 * - Resource owner MUST call dispose() in try/finally or onDestroy() to detach platform hooks.
 */
import type { LifecycleEvent, LifecycleProvider } from './PlatformTypes';

interface WxLifecycleGlobal {
  onShow?: (cb: () => void) => void;
  offShow?: (cb: () => void) => void;
  onHide?: (cb: () => void) => void;
  offHide?: (cb: () => void) => void;
}

export interface LifecycleLogEntry {
  readonly event: LifecycleEvent;
  readonly atMs: number;
  readonly deduplicated: boolean;
  readonly source: string;
  readonly listenerErrors: number;
}

export class RuntimeLifecycleProvider implements LifecycleProvider {
  private readonly listeners = new Set<(ev: LifecycleEvent) => void>();
  private lastEvent: LifecycleEvent | null = 'SHOW';
  private attached = false;
  private wxShowCb: (() => void) | null = null;
  private wxHideCb: (() => void) | null = null;
  private webVisCb: (() => void) | null = null;
  readonly eventLog: LifecycleLogEntry[] = [];
  lastEventSource: string | null = null;
  listenerErrorCount = 0;
  lastListenerError: string | null = null;

  private attachPlatformHooks(): void {
    if (this.attached) return;
    this.attached = true;
    const g = globalThis as unknown as { wx?: WxLifecycleGlobal; document?: Document };
    if (g.wx && typeof g.wx.onShow === 'function' && typeof g.wx.onHide === 'function') {
      this.wxShowCb = () => {
        this.emit('SHOW', 'wx.onShow');
      };
      this.wxHideCb = () => {
        this.emit('HIDE', 'wx.onHide');
      };
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
    if (deduplicated) {
      this.eventLog.push({ event, atMs: Date.now(), deduplicated: true, source, listenerErrors: 0 });
      return false;
    }
    this.lastEvent = event;
    this.lastEventSource = source;

    // Safe Set snapshot without array spread (avoids Babel loose `[].concat(set)` bug in Cocos Web)
    const snapshot: ((ev: LifecycleEvent) => void)[] = [];
    this.listeners.forEach((fn) => {
      snapshot.push(fn);
    });

    let errCount = 0;
    for (let i = 0; i < snapshot.length; i++) {
      const listener = snapshot[i];
      try {
        listener(event);
      } catch (err) {
        // Listener isolation per Doc 17 §6: record diagnostic error and continue notifying siblings
        errCount += 1;
        this.listenerErrorCount += 1;
        this.lastListenerError = err instanceof Error ? err.message : String(err);
      }
    }

    this.eventLog.push({ event, atMs: Date.now(), deduplicated: false, source, listenerErrors: errCount });
    return true;
  }

  subscribe(listener: (event: LifecycleEvent) => void): () => void {
    this.attachPlatformHooks();
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      // Local unsubscribe ONLY removes this callback; sibling subscribers remain active.
      // Underlying wx/DOM hooks are detached by the provider owner via dispose().
      this.listeners.delete(listener);
    };
  }

  getSubscriberCount(): number {
    return this.listeners.size;
  }

  isPlatformAttached(): boolean {
    return this.attached;
  }

  dispose(): void {
    const g = globalThis as unknown as { wx?: WxLifecycleGlobal; document?: Document };
    if (g.wx && this.wxShowCb && typeof g.wx.offShow === 'function') {
      g.wx.offShow(this.wxShowCb);
    }
    if (g.wx && this.wxHideCb && typeof g.wx.offHide === 'function') {
      g.wx.offHide(this.wxHideCb);
    }
    if (g.document && this.webVisCb && typeof g.document.removeEventListener === 'function') {
      g.document.removeEventListener('visibilitychange', this.webVisCb);
    }
    this.wxShowCb = null;
    this.wxHideCb = null;
    this.webVisCb = null;
    this.listeners.clear();
    this.attached = false;
  }
}
