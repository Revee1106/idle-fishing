/**
 * FE-000 Basic screen size adaptation helper (Section 7 item #10).
 * Reacts to viewport resize events and adjusts the Code First root container cleanly.
 */
import { Node, Size, UITransform, Vec3, view } from 'cc';

export interface ViewportMetrics {
  readonly visibleWidth: number;
  readonly visibleHeight: number;
  readonly scale: number;
  readonly orientation: 'PORTRAIT' | 'LANDSCAPE';
}

export class ResponsiveCanvasAdapter {
  private readonly root: Node;
  private readonly designW: number;
  private readonly designH: number;
  private readonly onResizeCallbacks: ((m: ViewportMetrics) => void)[] = [];
  private boundApply: () => void;

  constructor(root: Node, designW = 720, designH = 1280) {
    this.root = root;
    this.designW = designW;
    this.designH = designH;
    this.boundApply = () => this.apply();
    view.on('canvas-resize', this.boundApply);
    this.apply();
  }

  onMetricsChange(cb: (m: ViewportMetrics) => void): void {
    this.onResizeCallbacks.push(cb);
    cb(this.getMetrics());
  }

  getMetrics(): ViewportMetrics {
    const visible = view.getVisibleSize();
    const w = Math.max(1, Math.round(visible.width));
    const h = Math.max(1, Math.round(visible.height));
    const scaleX = w / this.designW;
    const scaleY = h / this.designH;
    const scale = Math.min(scaleX, scaleY, 1.15);
    return {
      visibleWidth: w,
      visibleHeight: h,
      scale: Number(scale.toFixed(3)),
      orientation: h >= w ? 'PORTRAIT' : 'LANDSCAPE',
    };
  }

  apply(): ViewportMetrics {
    const m = this.getMetrics();
    const tf = this.root.getComponent(UITransform);
    if (tf) {
      tf.setContentSize(new Size(this.designW, this.designH));
    }
    this.root.setScale(new Vec3(m.scale, m.scale, 1));
    for (const cb of this.onResizeCallbacks) {
      cb(m);
    }
    return m;
  }

  dispose(): void {
    view.off('canvas-resize', this.boundApply);
    this.onResizeCallbacks.length = 0;
  }
}
