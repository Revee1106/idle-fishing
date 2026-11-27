/**
 * FE-000 Test Page 2: WeChat FileSystem, 3-Slot Fault Injection, Lifecycle, Clock, Ad Stub & Subpackage (T10).
 * Dynamically constructed 100% via TypeScript Code First.
 */
import { assetManager, Color, JsonAsset, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { VerificationCaseResult } from '../platform/PlatformTypes';
import {
  runFileSystemAndSaveSuite,
  runLifecycleClockAndAdSuite,
} from '../platform/PlatformVerificationSuite';
import {
  createButton,
  createImageNode,
  createLabel,
  createLayoutContainer,
  createPanel,
  createScrollList,
  createUiNode,
  SPIKE_PALETTE,
  type ModalHandle,
  type ScrollListHandle,
  type UiAssets,
} from './CodeFirstFactory';
import type { SpikePage } from './PageRouter';

export interface SubpackageCheckResult {
  readonly status: 'PASS' | 'FAIL';
  readonly bundleName: string;
  readonly manifestVersion: string;
  readonly iconLoaded: boolean;
  readonly durationMs: number;
  readonly detail: string;
}

export class PlatformPage implements SpikePage {
  readonly id = 'platform' as const;
  readonly node: Node;
  private readonly subpackSprite: Sprite;
  private readonly bannerLabel: Label;
  private readonly metricsRowLabels: Record<string, Label> = {};
  private readonly list: ScrollListHandle;
  private readonly modal: ModalHandle;

  lastFsResults: VerificationCaseResult[] = [];
  lastPlatformResults: VerificationCaseResult[] = [];
  lastSubpackResult: SubpackageCheckResult | null = null;

  constructor(assets: UiAssets, modal: ModalHandle, onBackToOverview: () => void) {
    this.modal = modal;
    this.node = createUiNode('PlatformPage', 720, 1280);

    const { node: column } = createLayoutContainer('PlatformColumn', 680, 1220, 'VERTICAL', 14, 16, false);
    this.node.addChild(column);

    // 1. Header with subpackage icon + back button
    const headerCard = createPanel('PlatformHeaderCard', 680, 112, SPIKE_PALETTE.card, assets.whiteFrame);
    const { node: headerRow } = createLayoutContainer('PlatformHeaderRow', 656, 92, 'HORIZONTAL', 14, 12, false);
    headerCard.addChild(headerRow);

    const { node: iconNode, sprite: iconSprite } = createImageNode(
      'SubpackIconImg',
      72,
      72,
      null,
      assets.whiteFrame
    );
    this.subpackSprite = iconSprite;
    headerRow.addChild(iconNode);

    const { node: titleCol } = createLayoutContainer('PlatformTitleCol', 360, 84, 'VERTICAL', 4, 4, false);
    const { node: tLbl } = createLabel('PlatformTitle', 'Page 2 — Platform & T10', {
      fontSize: 23,
      width: 356,
      height: 34,
      color: SPIKE_PALETTE.accent,
      overflow: Label.Overflow.SHRINK,
      isBold: true,
    });
    const { node: bNode, label: bLbl } = createLabel('PlatformBanner', 'FS / Lifecycle / Ad Stub / Subpackage', {
      fontSize: 16,
      width: 356,
      height: 24,
      color: SPIKE_PALETTE.muted,
      overflow: Label.Overflow.SHRINK,
    });
    this.bannerLabel = bLbl;
    titleCol.addChild(tLbl);
    titleCol.addChild(bNode);
    headerRow.addChild(titleCol);

    const backBtn = createButton(
      'BtnBackOverview',
      '<- Page 1',
      180,
      54,
      SPIKE_PALETTE.accentDark,
      assets.whiteFrame,
      onBackToOverview,
      20
    );
    headerRow.addChild(backBtn.node);
    column.addChild(headerCard);

    // 2. Horizontal action buttons
    const { node: btnRow1 } = createLayoutContainer('PlatBtnRow1', 680, 56, 'HORIZONTAL', 12, 0, false);
    const btnFs = createButton(
      'BtnRunFs',
      '1. FS & 3-Slot Faults',
      334,
      54,
      new Color(30, 120, 96, 255),
      assets.whiteFrame,
      () => {
        void this.runFsChecks();
      },
      20
    );
    const btnLife = createButton(
      'BtnRunLifeAd',
      '2. Lifecycle, Clock & Ad',
      334,
      54,
      new Color(96, 74, 158, 255),
      assets.whiteFrame,
      () => {
        void this.runLifeAndAdChecks();
      },
      20
    );
    btnRow1.addChild(btnFs.node);
    btnRow1.addChild(btnLife.node);
    column.addChild(btnRow1);

    const { node: btnRow2 } = createLayoutContainer('PlatBtnRow2', 680, 56, 'HORIZONTAL', 12, 0, false);
    const btnSubpack = createButton(
      'BtnLoadSubpack',
      '3. Load Subpackage (T10)',
      334,
      54,
      new Color(180, 108, 34, 255),
      assets.whiteFrame,
      () => {
        void this.runSubpackageCheck();
      },
      20
    );
    const btnDetails = createButton(
      'BtnPlatModal',
      '4. Open Diagnostic Modal',
      334,
      54,
      SPIKE_PALETTE.accentDark,
      assets.whiteFrame,
      () => this.openDiagnosticModal(),
      20
    );
    btnRow2.addChild(btnSubpack.node);
    btnRow2.addChild(btnDetails.node);
    column.addChild(btnRow2);

    // 3. Horizontal metrics summary pills
    const { node: pillsRow } = createLayoutContainer('MetricsPillsRow', 680, 74, 'HORIZONTAL', 10, 0, false);
    const keys = [
      { key: 'fs', title: 'FS/Save' },
      { key: 'life', title: 'Life/Clock' },
      { key: 'ad', title: 'Ad Stub' },
      { key: 'sub', title: 'Subpack' },
    ];
    for (const k of keys) {
      const pill = createPanel(`Pill_${k.key}`, 162, 72, SPIKE_PALETTE.card, assets.whiteFrame);
      const { node: kLbl } = createLabel(`PillTitle_${k.key}`, k.title, {
        fontSize: 16,
        width: 150,
        height: 24,
        hAlign: Label.HorizontalAlign.CENTER,
        color: SPIKE_PALETTE.muted,
      });
      kLbl.setPosition(0, 16, 0);
      const { node: vNode, label: vLbl } = createLabel(`PillVal_${k.key}`, 'PENDING', {
        fontSize: 19,
        width: 150,
        height: 28,
        hAlign: Label.HorizontalAlign.CENTER,
        color: SPIKE_PALETTE.warn,
        isBold: true,
      });
      vNode.setPosition(0, -14, 0);
      this.metricsRowLabels[k.key] = vLbl;
      pill.addChild(kLbl);
      pill.addChild(vNode);
      pillsRow.addChild(pill);
    }
    column.addChild(pillsRow);

    // 4. Scrollable verification log
    this.list = createScrollList('PlatformResultScrollList', 680, 820, assets.whiteFrame);
    column.addChild(this.list.root);
  }

  async runFsChecks(): Promise<VerificationCaseResult[]> {
    this.lastFsResults = await runFileSystemAndSaveSuite();
    const ok = this.lastFsResults.every((r) => r.status === 'PASS');
    this.setPill('fs', ok ? `${this.lastFsResults.length}/${this.lastFsResults.length} OK` : 'FAIL', ok);
    this.refreshList();
    return this.lastFsResults;
  }

  async runLifeAndAdChecks(): Promise<VerificationCaseResult[]> {
    this.lastPlatformResults = await runLifecycleClockAndAdSuite();
    const lifeOk = this.lastPlatformResults
      .filter((r) => r.id.startsWith('T08'))
      .every((r) => r.status === 'PASS');
    const adStubOk = this.lastPlatformResults.some((r) => r.id === 'T09-AD-STUB-5' && r.status === 'PASS');
    this.setPill('life', lifeOk ? 'PASS' : 'FAIL', lifeOk);
    this.setPill('ad', adStubOk ? 'STUB OK' : 'FAIL', adStubOk);
    this.refreshList();
    return this.lastPlatformResults;
  }

  async runSubpackageCheck(): Promise<SubpackageCheckResult> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const bundle = await new Promise<ReturnType<typeof assetManager.getBundle>>((resolve, reject) => {
        assetManager.loadBundle('spike-pack', (err, b) => {
          if (err || !b) reject(err ?? new Error('Bundle spike-pack missing'));
          else resolve(b);
        });
      });

      const manifest = await new Promise<JsonAsset>((resolve, reject) => {
        bundle!.load('subpack_manifest', JsonAsset, (err, asset) => {
          if (err || !asset) reject(err ?? new Error('subpack_manifest missing'));
          else resolve(asset);
        });
      });

      const iconFrame = await new Promise<SpriteFrame>((resolve, reject) => {
        bundle!.load('subpack_icon/spriteFrame', SpriteFrame, (err, frame) => {
          if (err || !frame) reject(err ?? new Error('subpack_icon spriteFrame missing'));
          else resolve(frame);
        });
      });

      this.subpackSprite.spriteFrame = iconFrame;
      this.subpackSprite.color = Color.WHITE.clone();

      const json = (manifest.json ?? {}) as { bundle?: string; checksumHint?: string };
      const elapsed = Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(2));
      this.lastSubpackResult = {
        status: 'PASS',
        bundleName: json.bundle ?? 'spike-pack',
        manifestVersion: json.checksumHint ?? 'unknown',
        iconLoaded: true,
        durationMs: elapsed,
        detail: `Loaded local bundle "spike-pack" (icon 64x64 + manifest=${json.checksumHint}) in ${elapsed}ms`,
      };
      this.setPill('sub', 'LOADED', true);
    } catch (err) {
      const elapsed = Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(2));
      this.lastSubpackResult = {
        status: 'FAIL',
        bundleName: 'spike-pack',
        manifestVersion: 'error',
        iconLoaded: false,
        durationMs: elapsed,
        detail: err instanceof Error ? err.message : String(err),
      };
      this.setPill('sub', 'FAIL', false);
    }
    this.refreshList();
    return this.lastSubpackResult;
  }

  async runAllPlatformChecks(): Promise<void> {
    await this.runFsChecks();
    await this.runLifeAndAdChecks();
    await this.runSubpackageCheck();
  }

  private setPill(key: string, text: string, ok: boolean): void {
    const lbl = this.metricsRowLabels[key];
    if (!lbl) return;
    lbl.string = text;
    lbl.color = ok ? SPIKE_PALETTE.success.clone() : SPIKE_PALETTE.danger.clone();
  }

  private refreshList(): void {
    const combined: { title: string; subtitle: string; badge: string; badgeColor: Color }[] = [];
    for (const r of [...this.lastFsResults, ...this.lastPlatformResults]) {
      combined.push({
        title: `${r.id} [${r.env}] — ${r.name}`,
        subtitle: `${r.detail} (${r.durationMs}ms)`,
        badge: r.status,
        badgeColor:
          r.status === 'PASS'
            ? SPIKE_PALETTE.success
            : r.status === 'BLOCKED'
              ? SPIKE_PALETTE.warn
              : SPIKE_PALETTE.danger,
      });
    }
    if (this.lastSubpackResult) {
      const s = this.lastSubpackResult;
      combined.push({
        title: `T10-SUBPACK — Local Bundle "${s.bundleName}"`,
        subtitle: s.detail,
        badge: s.status,
        badgeColor: s.status === 'PASS' ? SPIKE_PALETTE.success : SPIKE_PALETTE.danger,
      });
    }
    this.bannerLabel.string = `Executed ${combined.length} platform checks`;
    this.list.setItems(combined);
  }

  openDiagnosticModal(): void {
    const all = [...this.lastFsResults, ...this.lastPlatformResults];
    const passCount = all.filter((x) => x.status === 'PASS').length;
    const blockedCount = all.filter((x) => x.status === 'BLOCKED').length;
    const failCount = all.filter((x) => x.status === 'FAIL').length;
    const lines = [
      `Platform Verification Summary`,
      `PASS: ${passCount} | BLOCKED: ${blockedCount} | FAIL: ${failCount}`,
      `Subpackage T10: ${this.lastSubpackResult ? `${this.lastSubpackResult.status} (${this.lastSubpackResult.manifestVersion})` : 'Not loaded'}`,
      `Real WeChat FS / Device / Ad: requires WeChat DevTools & real phone`,
      `Web fallback never substitutes for real WeChat verification.`,
    ];
    this.modal.show('Platform Diagnostics', lines.join('\n'));
  }
}
