/**
 * FE-000 Minimal BootEntry component attached to Canvas in Boot.scene.
 * Everything below Canvas is generated dynamically in TypeScript (Code First).
 * Owns the top-level RuntimeLifecycleProvider (disposed cleanly in onDestroy) and
 * persists state via SpikeFileSaveRepository when a real platform HIDE callback fires.
 */
import { _decorator, Component, JsonAsset, resources, SpriteFrame } from 'cc';
import {
  advanceOffline,
  createInitialState,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  type SpikeGameState,
} from '@idle-fishing/game-core';
import { detectRuntimeEnv } from '../platform/PlatformTypes';
import { createRuntimeFilePort } from '../platform/PlatformVerificationSuite';
import { RuntimeLifecycleProvider } from '../platform/WeChatLifecycleProvider';
import { createModal, createUiNode, type ModalHandle, type UiAssets } from '../ui/CodeFirstFactory';
import { OverviewPage } from '../ui/OverviewPage';
import { PageRouter, type SpikePageId } from '../ui/PageRouter';
import { PlatformPage } from '../ui/PlatformPage';
import { ResponsiveCanvasAdapter } from '../ui/ResponsiveCanvas';

const { ccclass } = _decorator;

interface SpikeFixtureJson {
  experimentalFixture?: boolean;
  title?: string;
}

export interface BootPersistenceRecord {
  readonly restoredOnBoot: boolean;
  readonly revision: string | null;
  readonly gold: string;
  readonly cursorMs: number;
  readonly deadlineMs: number | null;
  readonly lastHideCommitAtMs: number | null;
  readonly lastHideTriggerSource: string | null;
  readonly hideCommitCount: number;
  readonly showEventCount: number;
}

@ccclass('BootEntry')
export class BootEntry extends Component {
  private router: PageRouter | null = null;
  private responsive: ResponsiveCanvasAdapter | null = null;
  private overviewPage: OverviewPage | null = null;
  private platformPage: PlatformPage | null = null;
  private modal: ModalHandle | null = null;
  private lifecycle: RuntimeLifecycleProvider | null = null;
  private lifecycleUnsub: (() => void) | null = null;
  private pendingHideSave: Promise<void> = Promise.resolve();
  private persistState: SpikeGameState | null = null;
  private persistRevision: string | null = null;
  private persistRecord: BootPersistenceRecord = {
    restoredOnBoot: false,
    revision: null,
    gold: '0',
    cursorMs: 0,
    deadlineMs: null,
    lastHideCommitAtMs: null,
    lastHideTriggerSource: null,
    hideCommitCount: 0,
    showEventCount: 0,
  };

  start(): void {
    void this.bootstrap();
  }

  onDestroy(): void {
    this.lifecycleUnsub?.();
    this.lifecycleUnsub = null;
    this.lifecycle?.dispose();
    this.lifecycle = null;
    this.responsive?.dispose();
    this.responsive = null;
  }

  private loadResource<T>(path: string, type: new (...args: never[]) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      resources.load(path, type as never, (err, asset) => {
        if (err || !asset) reject(err ?? new Error(`Missing resource: ${path}`));
        else resolve(asset as T);
      });
    });
  }

  private async bootstrap(): Promise<void> {
    const [whiteFrame, badgeFrame, fixtureAsset] = await Promise.all([
      this.loadResource<SpriteFrame>('textures/white_pixel/spriteFrame', SpriteFrame),
      this.loadResource<SpriteFrame>('textures/spike_badge/spriteFrame', SpriteFrame).catch(() => null),
      this.loadResource<JsonAsset>('data/spike_fixture', JsonAsset).catch(() => null),
    ]);

    const fixture = (fixtureAsset?.json ?? {}) as SpikeFixtureJson;
    const title = fixture.title ?? 'Idle Fishing — FE-000 Technical Spike';

    // Real platform persistence repository for lifecycle HIDE save + cross-reload recovery verification
    const persistPort = createRuntimeFilePort('idle_fishing_lifecycle_persist');
    const persistRepo = new SpikeFileSaveRepository(persistPort);

    const existing = await persistRepo.load();
    if (existing.kind === 'VALID' && existing.schemaVersion === 2) {
      const restored = existing.raw as SpikeGameState;
      this.persistState = restored;
      this.persistRevision = existing.revision;
      this.persistRecord = {
        restoredOnBoot: true,
        revision: existing.revision,
        gold: restored.gold,
        cursorMs: restored.cursorMs,
        deadlineMs: restored.offline?.deadlineMs ?? null,
        lastHideCommitAtMs: null,
        lastHideTriggerSource: 'boot-load',
        hideCommitCount: 0,
        showEventCount: 0,
      };
    } else {
      const fresh = createInitialState({
        saveEpoch: 'fe000-lifecycle-epoch',
        startMs: 1_700_000_000_000,
        allowanceMs: 8 * 3600 * 1000,
      });
      this.persistState = fresh;
      this.persistRevision = null;
      this.persistRecord = {
        restoredOnBoot: false,
        revision: null,
        gold: fresh.gold,
        cursorMs: fresh.cursorMs,
        deadlineMs: fresh.offline?.deadlineMs ?? null,
        lastHideCommitAtMs: null,
        lastHideTriggerSource: null,
        hideCommitCount: 0,
        showEventCount: 0,
      };
    }

    const root = createUiNode('CodeFirstRoot', 720, 1280);
    this.node.addChild(root);

    const assets: UiAssets = { whiteFrame, badgeFrame };
    this.modal = createModal(this.node, 720, 1280, whiteFrame);
    this.router = new PageRouter();

    this.overviewPage = new OverviewPage(assets, this.modal, title, () => {
      this.router?.switchTo('platform');
    });
    this.platformPage = new PlatformPage(assets, this.modal, () => {
      this.router?.switchTo('overview');
    });

    root.addChild(this.overviewPage.node);
    root.addChild(this.platformPage.node);

    this.router.register(this.overviewPage);
    this.router.register(this.platformPage);

    this.responsive = new ResponsiveCanvasAdapter(root, 720, 1280);
    this.responsive.onMetricsChange((m) => {
      this.overviewPage?.updateViewport(m);
    });

    // Show Page 1 and immediately run shared core verification on boot
    this.router.switchTo('overview');
    this.overviewPage.runCoreChecks();

    const getSnapshot = () => ({
      env: detectRuntimeEnv(),
      page: this.router?.getCurrentId(),
      switchHistory: this.router?.switchHistory ?? [],
      viewport: this.responsive?.getMetrics(),
      modalVisible: this.modal?.isVisible() ?? false,
      coreReport: this.overviewPage?.lastCoreReport,
      perfReport: this.overviewPage?.lastPerfReport,
      fsResults: this.platformPage?.lastFsResults ?? [],
      platformResults: this.platformPage?.lastPlatformResults ?? [],
      subpackResult: this.platformPage?.lastSubpackResult,
      lifecyclePersistence: this.persistRecord,
      lifecycleLogCount: this.lifecycle?.eventLog.length ?? 0,
    });

    const syncWebDataset = () => {
      if (typeof document !== 'undefined' && document.body) {
        try {
          document.body.dataset.spikeSnapshot = JSON.stringify(getSnapshot());
        } catch {
          // Ignore serialization failures in diagnostic mirror
        }
      }
    };

    // Real platform lifecycle subscription owned by BootEntry (disposed in onDestroy)
    this.lifecycle = new RuntimeLifecycleProvider();
    this.lifecycleUnsub = this.lifecycle.subscribe((ev) => {
      if (ev === 'SHOW') {
        this.persistRecord = {
          ...this.persistRecord,
          showEventCount: this.persistRecord.showEventCount + 1,
        };
        syncWebDataset();
        return;
      }
      if (ev === 'HIDE' && this.persistState) {
        const source = this.lifecycle?.lastEventSource ?? 'platform-hide';
        const nextState = advanceOffline(this.persistState, this.persistState.cursorMs + 60_000).state;
        const expectedRev = this.persistRevision;
        this.pendingHideSave = this.pendingHideSave.then(async () => {
          const committed = await persistRepo.commit(nextState, expectedRev);
          if (committed.kind === 'COMMITTED') {
            this.persistState = nextState;
            this.persistRevision = committed.revision;
            this.persistRecord = {
              ...this.persistRecord,
              revision: committed.revision,
              gold: nextState.gold,
              cursorMs: nextState.cursorMs,
              deadlineMs: nextState.offline?.deadlineMs ?? null,
              lastHideCommitAtMs: Date.now(),
              lastHideTriggerSource: source,
              hideCommitCount: this.persistRecord.hideCommitCount + 1,
            };
            syncWebDataset();
          }
        });
      }
    });

    syncWebDataset();
    this.schedule(syncWebDataset, 0.5);

    // Expose read/test harness on globalThis for Web E2E automation & verification evidence capture
    (globalThis as Record<string, unknown>).__SPIKE_HARNESS__ = {
      ready: true,
      env: detectRuntimeEnv(),
      getCurrentPage: () => this.router?.getCurrentId(),
      switchPage: (id: SpikePageId) => {
        const ok = this.router?.switchTo(id) ?? false;
        syncWebDataset();
        return ok;
      },
      runCoreChecks: () => {
        const res = this.overviewPage?.runCoreChecks();
        syncWebDataset();
        return res;
      },
      run24hPerf: async () => {
        const res = await this.overviewPage?.runPerfBenchmark();
        syncWebDataset();
        return res;
      },
      openOverviewModal: () => {
        this.overviewPage?.openSummaryModal();
        syncWebDataset();
      },
      closeModal: () => {
        this.modal?.hide();
        syncWebDataset();
      },
      isModalVisible: () => this.modal?.isVisible() ?? false,
      runAllPlatformChecks: async () => {
        const res = await this.platformPage?.runAllPlatformChecks();
        syncWebDataset();
        return res;
      },
      awaitPendingHideSave: async () => {
        await this.pendingHideSave;
        syncWebDataset();
        return this.persistRecord;
      },
      clearLifecyclePersistence: async () => {
        for (const p of SLOT_PATHS) {
          await persistPort.remove(p);
        }
        const fresh = createInitialState({
          saveEpoch: 'fe000-lifecycle-epoch',
          startMs: 1_700_000_000_000,
          allowanceMs: 8 * 3600 * 1000,
        });
        this.persistState = fresh;
        this.persistRevision = null;
        this.persistRecord = {
          restoredOnBoot: false,
          revision: null,
          gold: fresh.gold,
          cursorMs: fresh.cursorMs,
          deadlineMs: fresh.offline?.deadlineMs ?? null,
          lastHideCommitAtMs: null,
          lastHideTriggerSource: null,
          hideCommitCount: 0,
          showEventCount: 0,
        };
        syncWebDataset();
      },
      getLifecycleLog: () => this.lifecycle?.eventLog ?? [],
      getSnapshot,
    };
  }
}
