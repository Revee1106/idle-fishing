/**
 * ClockProvider & MonotonicTimelineGuard aligned with docs/interfaces/19 §2.
 * - Foreground advances via monotonic delta, never blindly trusting wall clock jumps.
 * - Detects wall clock rollback beyond tolerance (foreground) or strict rollback on resume (CLOCK_ERROR).
 * - Clamps offline resume target by locked session deadline.
 */
import type { ClockProvider } from './PlatformTypes';

interface WxPerf {
  now?: () => number;
}

export class RuntimeClockProvider implements ClockProvider {
  readonly monotonicSupported: boolean;
  readonly monotonicSource: string;
  private readonly monoFn: () => number;
  private readonly wxMicroToMsDivider: number;

  constructor() {
    const g = globalThis as {
      wx?: { getPerformance?: () => WxPerf };
      performance?: { now?: () => number };
    };
    if (g.wx && typeof g.wx.getPerformance === 'function') {
      const perf = g.wx.getPerformance();
      if (perf && typeof perf.now === 'function') {
        const sample = perf.now();
        // WeChat Mini Game wx.getPerformance().now() returns microseconds (>1e12 or large values on many runtimes),
        // whereas Web performance.now() returns milliseconds. Heuristic check with explicit diagnostic tag.
        this.wxMicroToMsDivider = sample > 1e12 ? 1000 : 1;
        this.monoFn = () => Math.floor(perf.now!() / this.wxMicroToMsDivider);
        this.monotonicSupported = true;
        this.monotonicSource = this.wxMicroToMsDivider === 1000 ? 'wx.getPerformance(us->ms)' : 'wx.getPerformance(ms)';
        return;
      }
    }
    if (g.performance && typeof g.performance.now === 'function') {
      this.monoFn = () => Math.floor(g.performance!.now!());
      this.monotonicSupported = true;
      this.monotonicSource = 'performance.now(ms)';
      this.wxMicroToMsDivider = 1;
      return;
    }
    // Fallback strictly marked unsupported so we never pretend Date.now() is monotonic (Doc 19 §1)
    this.monoFn = () => Date.now();
    this.monotonicSupported = false;
    this.monotonicSource = 'UNSUPPORTED_WALL_FALLBACK';
    this.wxMicroToMsDivider = 1;
  }

  wallNowMs(): number {
    return Date.now();
  }

  monotonicNowMs(): number {
    return this.monoFn();
  }
}

export class VirtualClockProvider implements ClockProvider {
  readonly monotonicSupported = true;
  readonly monotonicSource = 'virtual-test-clock';
  private wallMs: number;
  private monoMs: number;

  constructor(initialWallMs: number, initialMonoMs = 0) {
    this.wallMs = initialWallMs;
    this.monoMs = initialMonoMs;
  }

  wallNowMs(): number {
    return this.wallMs;
  }

  monotonicNowMs(): number {
    return this.monoMs;
  }

  advance(deltaMs: number): void {
    this.wallMs += deltaMs;
    this.monoMs += Math.max(0, deltaMs);
  }

  setWallMs(wallMs: number): void {
    this.wallMs = wallMs;
  }

  setMonoMs(monoMs: number): void {
    this.monoMs = monoMs;
  }
}

export interface TimelineTickOutcome {
  readonly ok: boolean;
  readonly code: 'OK' | 'CLOCK_ERROR';
  readonly cursorMs: number;
  readonly highWaterMs: number;
  readonly frozen: boolean;
  readonly detail: string;
}

export interface ResumeTargetOutcome {
  readonly ok: boolean;
  readonly code: 'OK' | 'CLOCK_ERROR';
  readonly lockedTargetMs: number | null;
  readonly clampedByDeadline: boolean;
  readonly detail: string;
}

export class MonotonicTimelineGuard {
  cursorMs: number;
  highWaterMs: number;
  lastWallMs: number;
  frozen = false;
  private anchorLogicalMs: number;
  private anchorMonoMs: number;
  private readonly toleranceMs: number;

  constructor(clock: ClockProvider, toleranceMs = 2000) {
    const wall = clock.wallNowMs();
    const mono = clock.monotonicNowMs();
    this.cursorMs = wall;
    this.highWaterMs = wall;
    this.lastWallMs = wall;
    this.anchorLogicalMs = wall;
    this.anchorMonoMs = mono;
    this.toleranceMs = toleranceMs;
  }

  tickForeground(clock: ClockProvider): TimelineTickOutcome {
    const wall = clock.wallNowMs();
    const mono = clock.monotonicNowMs();

    if (wall + this.toleranceMs < this.highWaterMs) {
      this.frozen = true;
      return {
        ok: false,
        code: 'CLOCK_ERROR',
        cursorMs: this.cursorMs,
        highWaterMs: this.highWaterMs,
        frozen: true,
        detail: `Wall rollback detected: wall=${wall}, highWater=${this.highWaterMs}, tol=${this.toleranceMs}`,
      };
    }

    if (this.frozen) {
      if (wall < this.highWaterMs) {
        return {
          ok: false,
          code: 'CLOCK_ERROR',
          cursorMs: this.cursorMs,
          highWaterMs: this.highWaterMs,
          frozen: true,
          detail: 'Still frozen until wall >= highWaterMs',
        };
      }
      // Recover cleanly without rewinding cursor
      this.frozen = false;
      this.anchorLogicalMs = this.cursorMs;
      this.anchorMonoMs = mono;
      this.lastWallMs = wall;
    }

    if (mono < this.anchorMonoMs) {
      // Monotonic counter reset (e.g. process/counter wrap): re-anchor with 0 delta
      this.anchorLogicalMs = this.cursorMs;
      this.anchorMonoMs = mono;
    }

    const deltaMono = mono - this.anchorMonoMs;
    const candidate = Math.max(this.cursorMs, this.anchorLogicalMs + deltaMono);
    this.cursorMs = candidate;
    if (candidate > this.highWaterMs) this.highWaterMs = candidate;
    if (wall >= this.highWaterMs) {
      this.lastWallMs = wall;
    }

    return {
      ok: true,
      code: 'OK',
      cursorMs: this.cursorMs,
      highWaterMs: this.highWaterMs,
      frozen: false,
      detail: `Advanced via mono delta=${deltaMono}ms`,
    };
  }

  lockOfflineResumeTarget(clock: ClockProvider, deadlineMs: number): ResumeTargetOutcome {
    const wall = clock.wallNowMs();
    const mono = clock.monotonicNowMs();
    if (wall < this.highWaterMs) {
      this.frozen = true;
      return {
        ok: false,
        code: 'CLOCK_ERROR',
        lockedTargetMs: null,
        clampedByDeadline: false,
        detail: `Strict resume rollback rejected: wall=${wall} < highWater=${this.highWaterMs}`,
      };
    }
    this.frozen = false;
    const locked = Math.min(wall, deadlineMs);
    const clampedByDeadline = wall > deadlineMs;
    this.cursorMs = Math.max(this.cursorMs, locked);
    this.highWaterMs = Math.max(this.highWaterMs, wall);
    this.lastWallMs = wall;
    this.anchorLogicalMs = this.cursorMs;
    this.anchorMonoMs = mono;
    return {
      ok: true,
      code: 'OK',
      lockedTargetMs: locked,
      clampedByDeadline,
      detail: clampedByDeadline
        ? `Target clamped to deadline=${deadlineMs} (wall=${wall})`
        : `Target locked at wall=${locked}`,
    };
  }
}
