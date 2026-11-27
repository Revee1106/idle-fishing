/**
 * EXPERIMENTAL_STUB_ONLY Rewarded Video Ad adapter & idempotency coordinator (T09).
 *
 * IMPORTANT:
 * - Real WeChat ad verification is BLOCKED when no real adUnitId is configured.
 * - This module NEVER mutates player gold, bait, XP, or production business state.
 * - Verifies all 5 required callback paths:
 *   1. COMPLETED (full watch)
 *   2. CANCELLED (early close)
 *   3. LOAD_FAILED
 *   4. PLAY_FAILED
 *   5. DUPLICATE_CALLBACK (idempotent request deduplication)
 */
import type { AdOutcome, AdProvider, ExperimentalAdScenario } from './PlatformTypes';

interface WxRewardedVideoAd {
  load(): Promise<void>;
  show(): Promise<void>;
  onClose(cb: (res?: { isEnded?: boolean }) => void): void;
  offClose?(cb: (res?: { isEnded?: boolean }) => void): void;
  onError(cb: (err: unknown) => void): void;
  offError?(cb: (err: unknown) => void): void;
}

interface WxAdGlobal {
  createRewardedVideoAd?: (opts: { adUnitId: string }) => WxRewardedVideoAd;
}

export class WeChatRewardedAdAdapter implements AdProvider {
  readonly isStub = false;
  private readonly adUnitId: string;

  constructor(adUnitId: string) {
    this.adUnitId = adUnitId.trim();
  }

  isAvailable(_placement: string): boolean {
    const wxObj = (globalThis as { wx?: WxAdGlobal }).wx;
    return Boolean(this.adUnitId && wxObj && typeof wxObj.createRewardedVideoAd === 'function');
  }

  async show(requestId: string, placement: string): Promise<{ outcome: AdOutcome; detail: string }> {
    if (!this.isAvailable(placement)) {
      return { outcome: 'FAILED', detail: `AD_UNAVAILABLE: missing adUnitId or wx.createRewardedVideoAd (${requestId})` };
    }
    const wxObj = (globalThis as unknown as { wx: WxAdGlobal }).wx;
    const videoAd = wxObj.createRewardedVideoAd!({ adUnitId: this.adUnitId });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: AdOutcome, detail: string) => {
        if (settled) return;
        settled = true;
        resolve({ outcome, detail });
      };
      const onClose = (res?: { isEnded?: boolean }) => {
        videoAd.offClose?.(onClose);
        videoAd.offError?.(onError);
        // Doc 19 §1: only explicit isEnded === true counts as COMPLETED
        if (res && res.isEnded === true) {
          finish('COMPLETED', 'wx.onClose(isEnded=true)');
        } else {
          finish('CANCELLED', `wx.onClose(isEnded=${String(res?.isEnded)})`);
        }
      };
      const onError = (err: unknown) => {
        videoAd.offClose?.(onClose);
        videoAd.offError?.(onError);
        finish('FAILED', `wx.onError: ${JSON.stringify(err)}`);
      };
      videoAd.onClose(onClose);
      videoAd.onError(onError);
      videoAd
        .load()
        .then(() => videoAd.show())
        .catch((err) => finish('FAILED', `load/show rejected: ${String(err)}`));
    });
  }
}

export interface ExperimentalAdRequestRecord {
  readonly requestId: string;
  readonly seq: number;
  readonly placement: string;
  status: 'CREATED' | 'SHOWING' | 'COMPLETED' | 'REWARDED' | 'CANCELLED' | 'FAILED';
  rewardDispatchCount: number;
  callbackCount: number;
  detail: string;
}

/**
 * Pure experimental stub coordinator that verifies request lifecycle and
 * duplicate callback protection without touching real game assets.
 */
export class ExperimentalAdStubCoordinator {
  readonly isStub = true;
  private nextSeq = 1;
  private lastTerminalSeq = 0;
  private activeRequest: ExperimentalAdRequestRecord | null = null;
  readonly history: ExperimentalAdRequestRecord[] = [];
  private totalSimulatedRewardAcks = 0;

  getRewardAckCount(): number {
    return this.totalSimulatedRewardAcks;
  }

  async runScenario(
    placement: string,
    scenario: ExperimentalAdScenario
  ): Promise<{ record: ExperimentalAdRequestRecord; ignoredDuplicates: number }> {
    if (this.activeRequest !== null) {
      throw new Error('AD_IN_PROGRESS: concurrent ad request rejected');
    }
    const seq = this.nextSeq++;
    const req: ExperimentalAdRequestRecord = {
      requestId: `spike-epoch:ad:${seq}`,
      seq,
      placement,
      status: 'CREATED',
      rewardDispatchCount: 0,
      callbackCount: 0,
      detail: '',
    };
    this.activeRequest = req;
    req.status = 'SHOWING';

    let ignoredDuplicates = 0;

    const deliverCallback = (outcome: AdOutcome, detail: string) => {
      req.callbackCount += 1;
      if (!this.activeRequest || this.activeRequest.requestId !== req.requestId || req.seq <= this.lastTerminalSeq) {
        ignoredDuplicates += 1;
        return;
      }
      if (outcome === 'COMPLETED') {
        req.status = 'COMPLETED';
        // Only one reward ack per requestId; never mutates actual player gold/bait here
        req.rewardDispatchCount += 1;
        this.totalSimulatedRewardAcks += 1;
        req.status = 'REWARDED';
        req.detail = detail;
      } else if (outcome === 'CANCELLED') {
        req.status = 'CANCELLED';
        req.detail = detail;
      } else {
        req.status = 'FAILED';
        req.detail = detail;
      }
      this.lastTerminalSeq = req.seq;
      this.activeRequest = null;
      this.history.push(req);
    };

    switch (scenario) {
      case 'COMPLETED':
        deliverCallback('COMPLETED', 'EXPERIMENTAL_STUB: full watch completed');
        break;
      case 'CANCELLED':
        deliverCallback('CANCELLED', 'EXPERIMENTAL_STUB: user closed early');
        break;
      case 'LOAD_FAILED':
        deliverCallback('FAILED', 'EXPERIMENTAL_STUB: ad.load() failed (1004 no fill)');
        break;
      case 'PLAY_FAILED':
        deliverCallback('FAILED', 'EXPERIMENTAL_STUB: ad.show() failed');
        break;
      case 'DUPLICATE_CALLBACK':
        deliverCallback('COMPLETED', 'EXPERIMENTAL_STUB: first complete callback');
        deliverCallback('COMPLETED', 'EXPERIMENTAL_STUB: duplicate callback #2');
        deliverCallback('COMPLETED', 'EXPERIMENTAL_STUB: duplicate callback #3');
        break;
    }

    return { record: req, ignoredDuplicates };
  }
}
