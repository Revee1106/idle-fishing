/**
 * FE-000 Test Page 1: Code First UI + Shared Backend Core (@idle-fishing/game-core) Verification.
 * Demonstrates:
 * - Dynamic nodes, buttons, labels, loaded PNG image, horizontal & vertical layouts
 * - Dynamic ScrollView list, dynamic animated Modal, Tween pulse indicator
 * - Screen metrics display & live UI refresh from shared module outputs
 */
import { Color, Label, Node, SpriteFrame } from 'cc';
import {
  run24hOfflineBenchmark,
  runSharedCoreVerification,
  type Offline24hBenchmarkResult,
  type SharedCoreReport,
} from '../shared/SharedCoreBridge';
import {
  attachPulseTween,
  createButton,
  createImageNode,
  createLabel,
  createLayoutContainer,
  createPanel,
  createScrollList,
  createUiNode,
  SPIKE_PALETTE,
  type ButtonHandle,
  type ModalHandle,
  type ScrollListHandle,
  type UiAssets,
} from './CodeFirstFactory';
import type { SpikePage } from './PageRouter';
import type { ViewportMetrics } from './ResponsiveCanvas';

export class OverviewPage implements SpikePage {
  readonly id = 'overview' as const;
  readonly node: Node;
  private readonly statusLabel: Label;
  private readonly sharedSummaryLabel: Label;
  private readonly viewportLabel: Label;
  private readonly list: ScrollListHandle;
  private readonly modal: ModalHandle;
  private readonly btnRunCore: ButtonHandle;
  private readonly btnRun24h: ButtonHandle;
  private readonly btnOpenModal: ButtonHandle;
  private readonly btnSwitchPage: ButtonHandle;
  private readonly badgeSpriteNode: Node;

  lastCoreReport: SharedCoreReport | null = null;
  lastPerfReport: Offline24hBenchmarkResult | null = null;

  constructor(
    assets: UiAssets,
    modal: ModalHandle,
    fixtureTitle: string,
    onSwitchToPlatform: () => void
  ) {
    this.modal = modal;
    this.node = createUiNode('OverviewPage', 720, 1280);

    // Main vertical layout container
    const { node: column } = createLayoutContainer('OverviewColumn', 680, 1220, 'VERTICAL', 14, 16, false);
    column.setPosition(0, 0, 0);
    this.node.addChild(column);

    // 1. Header card (horizontal layout: badge image + title + Tween pulse dot)
    const headerCard = createPanel('HeaderCard', 680, 112, SPIKE_PALETTE.card, assets.whiteFrame);
    const { node: headerRow } = createLayoutContainer('HeaderRow', 656, 92, 'HORIZONTAL', 14, 12, false);
    headerCard.addChild(headerRow);

    const { node: badgeNode } = createImageNode('SpikeBadgeImg', 72, 72, assets.badgeFrame, assets.whiteFrame);
    this.badgeSpriteNode = badgeNode;
    headerRow.addChild(badgeNode);

    const { node: titleCol } = createLayoutContainer('TitleCol', 490, 84, 'VERTICAL', 4, 4, false);
    const { node: titleLbl } = createLabel('MainTitle', fixtureTitle, {
      fontSize: 24,
      width: 486,
      height: 34,
      color: SPIKE_PALETTE.accent,
      overflow: Label.Overflow.SHRINK,
      isBold: true,
    });
    const { node: vpNode, label: vpLabel } = createLabel('ViewportInfo', 'Viewport: 720x1280 (PORTRAIT)', {
      fontSize: 16,
      width: 486,
      height: 24,
      color: SPIKE_PALETTE.muted,
      overflow: Label.Overflow.SHRINK,
    });
    this.viewportLabel = vpLabel;
    titleCol.addChild(titleLbl);
    titleCol.addChild(vpNode);
    headerRow.addChild(titleCol);

    const pulseDot = createPanel('TweenPulseDot', 22, 22, SPIKE_PALETTE.success, assets.whiteFrame);
    attachPulseTween(pulseDot);
    headerRow.addChild(pulseDot);
    column.addChild(headerCard);

    // 2. Horizontal action toolbar (Row 1 + Row 2)
    const { node: actionRow1 } = createLayoutContainer('ActionRow1', 680, 56, 'HORIZONTAL', 12, 0, false);
    this.btnRunCore = createButton(
      'BtnRunCore',
      '1. Verify Shared Core',
      334,
      54,
      SPIKE_PALETTE.accentDark,
      assets.whiteFrame,
      () => this.runCoreChecks(),
      20
    );
    this.btnRun24h = createButton(
      'BtnRun24h',
      '2. Run 24h Offline Perf',
      334,
      54,
      new Color(30, 120, 96, 255),
      assets.whiteFrame,
      () => {
        void this.runPerfBenchmark();
      },
      20
    );
    actionRow1.addChild(this.btnRunCore.node);
    actionRow1.addChild(this.btnRun24h.node);
    column.addChild(actionRow1);

    const { node: actionRow2 } = createLayoutContainer('ActionRow2', 680, 56, 'HORIZONTAL', 12, 0, false);
    this.btnOpenModal = createButton(
      'BtnOpenModal',
      '3. Open Detail Modal',
      334,
      54,
      new Color(96, 74, 158, 255),
      assets.whiteFrame,
      () => this.openSummaryModal(),
      20
    );
    this.btnSwitchPage = createButton(
      'BtnToPlatform',
      '4. Page 2: Platform ->',
      334,
      54,
      new Color(180, 108, 34, 255),
      assets.whiteFrame,
      onSwitchToPlatform,
      20
    );
    actionRow2.addChild(this.btnOpenModal.node);
    actionRow2.addChild(this.btnSwitchPage.node);
    column.addChild(actionRow2);

    // 3. Shared Module Data Card (refreshed dynamically from @idle-fishing/game-core)
    const dataCard = createPanel('SharedDataCard', 680, 186, SPIKE_PALETTE.card, assets.whiteFrame);
    const { node: dataCol } = createLayoutContainer('SharedDataCol', 652, 168, 'VERTICAL', 6, 8, false);
    const { node: statusNode, label: statusLabel } = createLabel('CoreStatusBanner', 'Shared Core: Pending...', {
      fontSize: 21,
      width: 644,
      height: 30,
      color: SPIKE_PALETTE.warn,
      overflow: Label.Overflow.SHRINK,
      isBold: true,
    });
    this.statusLabel = statusLabel;
    const { node: summaryNode, label: summaryLabel } = createLabel(
      'CoreSummaryText',
      'Loading @idle-fishing/game-core...',
      {
        fontSize: 17,
        lineHeight: 24,
        width: 644,
        height: 118,
        color: SPIKE_PALETTE.text,
        overflow: Label.Overflow.SHRINK,
      }
    );
    summaryLabel.verticalAlign = Label.VerticalAlign.TOP;
    this.sharedSummaryLabel = summaryLabel;
    dataCol.addChild(statusNode);
    dataCol.addChild(summaryNode);
    dataCard.addChild(dataCol);
    column.addChild(dataCard);

    // 4. Dynamic ScrollView list of verification results
    this.list = createScrollList('CoreResultScrollList', 680, 720, assets.whiteFrame);
    column.addChild(this.list.root);
  }

  updateViewport(metrics: ViewportMetrics): void {
    this.viewportLabel.string = `Page 1 | Viewport: ${metrics.visibleWidth}x${metrics.visibleHeight} (${metrics.orientation}, scale=${metrics.scale})`;
  }

  setBadgeFrame(frame: SpriteFrame): void {
    const sp = this.badgeSpriteNode.getComponent('cc.Sprite') as { spriteFrame?: SpriteFrame; color?: Color } | null;
    if (sp) {
      sp.spriteFrame = frame;
      sp.color = Color.WHITE.clone();
    }
  }

  runCoreChecks(): SharedCoreReport {
    const report = runSharedCoreVerification();
    this.lastCoreReport = report;
    const passed = report.cases.filter((c) => c.status === 'PASS').length;
    this.statusLabel.string = `Shared Core (${report.env}): ${passed}/${report.cases.length} PASS`;
    this.statusLabel.color = report.allPassed ? SPIKE_PALETTE.success.clone() : SPIKE_PALETTE.danger.clone();

    const s = report.summaryState;
    this.sharedSummaryLabel.string = [
      `Source: @idle-fishing/game-core (single TS source)`,
      `1h Cycles: ${s.cycles} | Attempts: ${s.attempts} | Gold(Nat): ${s.gold}`,
      `BigInt(>2^53): ${s.big}`,
      `RNG: ${s.rngPreview}`,
      `Canonical SHA-256: ${s.canonicalHash.slice(0, 32)}...`,
    ].join('\n');

    this.list.setItems(
      report.cases.map((c) => ({
        title: `${c.id} — ${c.name}`,
        subtitle: `${c.detail} (${c.durationMs}ms)`,
        badge: c.status,
        badgeColor: c.status === 'PASS' ? SPIKE_PALETTE.success : SPIKE_PALETTE.danger,
      }))
    );
    return report;
  }

  async runPerfBenchmark(): Promise<Offline24hBenchmarkResult> {
    this.statusLabel.string = 'Running 24h Offline Benchmark (sliced)...';
    this.statusLabel.color = SPIKE_PALETTE.warn.clone();
    const perf = await run24hOfflineBenchmark(250);
    this.lastPerfReport = perf;

    this.statusLabel.string = `24h Offline Perf (${perf.env}): ${perf.singleEqualsSliced ? 'PASS' : 'FAIL'} (${perf.singleShotMs}ms)`;
    this.statusLabel.color = perf.singleEqualsSliced ? SPIKE_PALETTE.success.clone() : SPIKE_PALETTE.danger.clone();

    this.sharedSummaryLabel.string = [
      `24h Single-shot: ${perf.singleShotMs}ms | Sliced compute: ${perf.slicedComputeMs}ms`,
      `Slices: ${perf.sliceCount} | Max slice: ${perf.maxSliceMs}ms | Avg: ${perf.avgSliceMs}ms`,
      `Nodes: ${perf.processedNodes} | Cycles: ${perf.cycles} | Gold: ${perf.gold}`,
      `Single === Sliced: ${String(perf.singleEqualsSliced)} | Mem: ${perf.memorySnapshot}`,
      `SHA-256: ${perf.canonicalHash.slice(0, 32)}...`,
    ].join('\n');

    const rows = [
      ...(this.lastCoreReport?.cases ?? []).map((c) => ({
        title: `${c.id} — ${c.name}`,
        subtitle: `${c.detail} (${c.durationMs}ms)`,
        badge: c.status,
        badgeColor: c.status === 'PASS' ? SPIKE_PALETTE.success : SPIKE_PALETTE.danger,
      })),
      {
        title: 'T06-24H — 24h Offline Advancement Benchmark',
        subtitle: `single=${perf.singleShotMs}ms, sliced=${perf.slicedComputeMs}ms (${perf.sliceCount} slices, max=${perf.maxSliceMs}ms), cycles=${perf.cycles}`,
        badge: perf.singleEqualsSliced ? 'PASS' : 'FAIL',
        badgeColor: perf.singleEqualsSliced ? SPIKE_PALETTE.success : SPIKE_PALETTE.danger,
      },
    ];
    this.list.setItems(rows);
    return perf;
  }

  openSummaryModal(): void {
    const core = this.lastCoreReport;
    const perf = this.lastPerfReport;
    const lines = [
      `FE-000 Code First Modal (Animated Tween)`,
      `Runtime: ${core?.env ?? 'unknown'}`,
      `Shared Core Checks: ${core ? `${core.cases.filter((c) => c.status === 'PASS').length}/${core.cases.length} PASS` : 'Not run'}`,
      `1h State Gold: ${core?.summaryState.gold ?? '-'}`,
      `1h State BigInt: ${core?.summaryState.big ?? '-'}`,
      `1h Hash: ${core?.summaryState.canonicalHash.slice(0, 36) ?? '-'}`,
      `24h Perf: ${perf ? `single=${perf.singleShotMs}ms, maxSlice=${perf.maxSliceMs}ms, match=${perf.singleEqualsSliced}` : 'Click "Run 24h Offline Perf"'}`,
    ];
    this.modal.show('Shared Module & Perf Report', lines.join('\n'));
  }
}
