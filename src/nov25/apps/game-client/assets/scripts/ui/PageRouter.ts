/**
 * FE-000 Code-controlled PageRouter (Section 7 item #8).
 * Switches cleanly between Page 1 (overview) and Page 2 (platform) with Tween transitions.
 */
import type { Node } from 'cc';
import { playPageEnterTween } from './CodeFirstFactory';

export type SpikePageId = 'overview' | 'platform';

export interface SpikePage {
  readonly id: SpikePageId;
  readonly node: Node;
  onEnter?: () => void;
  onExit?: () => void;
}

export class PageRouter {
  private readonly pages = new Map<SpikePageId, SpikePage>();
  private currentId: SpikePageId | null = null;
  readonly switchHistory: SpikePageId[] = [];

  register(page: SpikePage): void {
    this.pages.set(page.id, page);
    page.node.active = false;
  }

  getCurrentId(): SpikePageId | null {
    return this.currentId;
  }

  switchTo(targetId: SpikePageId): boolean {
    const next = this.pages.get(targetId);
    if (!next) return false;
    if (this.currentId === targetId) return true;

    if (this.currentId !== null) {
      const prev = this.pages.get(this.currentId);
      if (prev) {
        prev.onExit?.();
        prev.node.active = false;
      }
    }

    next.node.active = true;
    playPageEnterTween(next.node);
    next.onEnter?.();
    this.currentId = targetId;
    this.switchHistory.push(targetId);
    return true;
  }
}
