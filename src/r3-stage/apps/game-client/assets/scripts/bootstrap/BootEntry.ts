/**
 * FE-000 Minimal BootEntry component attached to Canvas in Boot.scene.
 * Everything below Canvas is generated dynamically in TypeScript (Code First).
 *
 * Persistence & Lifecycle Guarantees (FE-000-R1-INTEGRATION-REWORK-03):
 * - P0 (A01): All commits execute through SingleWriterSaveCoordinator over linearizable
 *   IndexedDB (BrowserFilePort) + W3C Web Locks cross-tab exclusivity (fail-closed).
 * - P1-01 (N1+N2+A02): Strictly separates StorageHealthState (AVAILABLE | STORAGE_UNAVAILABLE)
 *   from SaveState (EMPTY | VALID | CORRUPT | UNSUPPORTED). Any runtime storage failure OR
 *   UNCERTAIN commit freezes the ENTIRE shared storage namespace across all coordinator instances
 *   until explicit complete loadSafe() recovery succeeds.
 * - P1-02 (A03): Partial slot IO failure stays frozen (STORAGE_UNAVAILABLE) and never promotes
 *   an older backup to writable AVAILABLE state.
 * - P1-03 (N3+A04+A06):
 *   - Production Web build exposes ONLY read-only observation & normal UI controls on
 *     globalThis.__SPIKE_HARNESS__ — ZERO destructive save-clearing, raw coordinator, or
 *     owner-bypassing commit methods exist on the production harness.
 *   - onDestroy() marks destroyed, severs coordinator/port/state references, cancels QUEUED
 *     tasks before physical execution, allows in-flight STARTED writes to finish cleanly,
 *     and rejects all subsequent tasks.
 *   - Pending save queue catches per-task errors without poisoning subsequent HIDE tasks or
 *     explicit recovery (A06).
 */
import { _decorator, Component, JsonAsset, resources, SpriteFrame } from 'cc';
import { advanceOffline, createInitialState, type SpikeGameState } from '@idle-fishing/game-core';
import { detectRuntimeEnv, type FilePort, type StorageHealthState } from '../platform/PlatformTypes';
import { createRuntimeFilePort } from '../platform/PlatformVerificationSuite';
import {
  SingleWriterSaveCoordinator,
  type SafeSaveCommitResult,
} from '../platform/SingleWriterSaveCoordinator';
import { UnavailableFilePort } from '../platform/WeChatFilePort';
import { RuntimeLifecycleProvider } from '../platform/WeChatLifecycleProvider';
import { createModal, createUiNode, type ModalHandle, type UiAssets } from '../ui/CodeFirstFactory';
import { OverviewPage } from '../ui/OverviewPage';
import { PageRouter, type SpikePageId } from '../ui/PageRouter';
import { PlatformPage } from '../ui/PlatformPage';
import { ResponsiveCanvasAdapter } from '../ui/ResponsiveCanvas';

const { ccclass } = _decorator;

/**
 * Tracks destroyed BootEntry instances OUTSIDE Cocos Component own properties.
 * Cocos Creator's CCObject._destroyImmediate() nulls all own properties on a destroyed
 * Component right after onDestroy(), which would clear a plain `this.isDestroyed = true` field.
 */
const destroyedBootEntries = new WeakSet<BootEntry>();

interface SpikeFixtureJson {
  experimentalFixture?: boolean;
  title?: string;
}

export type SaveTaskLifecycleState =
  | 'QUEUED'
  | 'STARTED'
  | 'COMMITTED'
  | 'CONFLICT'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'STORAGE_UNAVAILABLE'
  | 'CANCELLED';

export interface BootCommitHistoryEntry {
  readonly seq: number;
  readonly triggerSource: string;
  readonly expectedRevision: string | null;
  readonly taskState: SaveTaskLifecycleState;
  readonly resultKind:
    | 'COMMITTED'
    | 'CONFLICT'
    | 'FAILED'
    | 'UNCERTAIN'
    | 'STORAGE_UNAVAILABLE'
    | 'CANCELLED'
    | 'SKIPPED_HALTED'
    | 'SKIPPED_DESTROYED';
  readonly revision: string | null;
  readonly cursorMs: number;
  readonly gold: string;
  readonly detail: string | null;
}

export interface BootPersistenceRecord {
  readonly storageHealth: StorageHealthState;
  readonly storageUnavailableReason: string | null;
  readonly loadStatus: 'EMPTY' | 'VALID' | 'CORRUPT' | 'UNSUPPORTED' | 'STORAGE_UNAVAILABLE';
  readonly loadDetail: string | null;
  readonly persistenceHalted: boolean;
  readonly restoredOnBoot: boolean;
  readonly revision: string | null;
  readonly gold: string;
  readonly cursorMs: number;
  readonly deadlineMs: number | null;
  readonly lastHideCommitAtMs: number | null;
  readonly lastHideTriggerSource: string | null;
  readonly lastCommitKind:
    | 'COMMITTED'
    | 'CONFLICT'
    | 'FAILED'
    | 'UNCERTAIN'
    | 'STORAGE_UNAVAILABLE'
    | 'CANCELLED'
    | null;
  readonly lastCommitDetail: string | null;
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
  private persistPort: FilePort | null = null;
  private persistCoordinator: SingleWriterSaveCoordinator | null = null;
  private pendingHideSave: Promise<void> = Promise.resolve();
  private persistState: SpikeGameState | null = null;
  private persistRevision: string | null = null;
  private persistenceHalted = false;
  private isDestroyed = false;
  private hideEnqueueSeq = 0;
  private commitHistory: BootCommitHistoryEntry[] = [];
  private persistRecord: BootPersistenceRecord = {
    storageHealth: 'AVAILABLE',
    storageUnavailableReason: null,
    loadStatus: 'EMPTY',
    loadDetail: null,
    persistenceHalted: false,
    restoredOnBoot: false,
    revision: null,
    gold: '0',
    cursorMs: 0,
    deadlineMs: null,
    lastHideCommitAtMs: null,
    lastHideTriggerSource: null,
    lastCommitKind: null,
    lastCommitDetail: null,
    hideCommitCount: 0,
    showEventCount: 0,
  };

  private isComponentDestroyed(): boolean {
    return destroyedBootEntries.has(this) || this.isDestroyed === true || this.isValid === false;
  }

  start(): void {
    void this.bootstrap();
  }

  onDestroy(): void {
    // P1-02 (N3) + P1-03 (A04): Synchronously mark destroyed in WeakSet (immune to Cocos
    // CCObject._destroyImmediate() property nulling) and sever live storage references
    // so queued tasks cancel before physical execution and NO entry point on this destroyed
    // instance can ever dispatch new storage I/O. In-flight STARTED tasks retain their local
    // coordinator reference and complete cleanly.
    destroyedBootEntries.add(this);
    this.isDestroyed = true;
    this.persistCoordinator = null;
    this.persistPort = null;
    this.persistState = null;
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

  private async initializePersistence(coordinator: SingleWriterSaveCoordinator): Promise<BootPersistenceRecord> {
    if (this.isComponentDestroyed()) return this.persistRecord;
    const existing = await coordinator.loadSafe();
    if (this.isComponentDestroyed()) return this.persistRecord;

    if (existing.kind === 'VALID' && existing.schemaVersion === 2) {
      const restored = existing.raw as SpikeGameState;
      this.persistState = restored;
      this.persistRevision = existing.revision;
      this.persistenceHalted = false;
      this.persistRecord = {
        storageHealth: 'AVAILABLE',
        storageUnavailableReason: null,
        loadStatus: 'VALID',
        loadDetail: existing.warnings.length > 0 ? existing.warnings.join('; ') : null,
        persistenceHalted: false,
        restoredOnBoot: true,
        revision: existing.revision,
        gold: restored.gold,
        cursorMs: restored.cursorMs,
        deadlineMs: restored.offline?.deadlineMs ?? null,
        lastHideCommitAtMs: null,
        lastHideTriggerSource: 'boot-load',
        lastCommitKind: null,
        lastCommitDetail: null,
        hideCommitCount: 0,
        showEventCount: 0,
      };
    } else if (existing.kind === 'EMPTY') {
      const fresh = createInitialState({
        saveEpoch: 'fe000-lifecycle-epoch',
        startMs: 1_700_000_000_000,
        allowanceMs: 8 * 3600 * 1000,
      });
      this.persistState = fresh;
      this.persistRevision = null;
      this.persistenceHalted = false;
      this.persistRecord = {
        storageHealth: 'AVAILABLE',
        storageUnavailableReason: null,
        loadStatus: 'EMPTY',
        loadDetail: null,
        persistenceHalted: false,
        restoredOnBoot: false,
        revision: null,
        gold: fresh.gold,
        cursorMs: fresh.cursorMs,
        deadlineMs: fresh.offline?.deadlineMs ?? null,
        lastHideCommitAtMs: null,
        lastHideTriggerSource: null,
        lastCommitKind: null,
        lastCommitDetail: null,
        hideCommitCount: 0,
        showEventCount: 0,
      };
    } else if (existing.kind === 'STORAGE_UNAVAILABLE') {
      // P1-01 & P1-02 (A03): Persistent storage unavailable (or partial slot IO error) MUST stay
      // frozen, MUST NOT be treated as EMPTY/new player, and MUST NOT promote older backups as writable.
      this.persistState = null;
      this.persistRevision = null;
      this.persistenceHalted = true;
      this.persistRecord = {
        storageHealth: 'STORAGE_UNAVAILABLE',
        storageUnavailableReason: existing.detail,
        loadStatus: 'STORAGE_UNAVAILABLE',
        loadDetail: existing.detail,
        persistenceHalted: true,
        restoredOnBoot: false,
        revision: null,
        gold: '0',
        cursorMs: 0,
        deadlineMs: null,
        lastHideCommitAtMs: null,
        lastHideTriggerSource: null,
        lastCommitKind: null,
        lastCommitDetail: null,
        hideCommitCount: 0,
        showEventCount: 0,
      };
    } else {
      // Fail-closed: NEVER treat CORRUPT / UNSUPPORTED / unmigrated saves as a new player,
      // and NEVER delete or overwrite slots to work around incompatibility.
      const loadStatus = existing.kind === 'CORRUPT' ? 'CORRUPT' : 'UNSUPPORTED';
      const loadDetail =
        existing.kind === 'VALID'
          ? `schemaVersion ${existing.schemaVersion} requires explicit migration`
          : existing.detail;
      this.persistState = null;
      this.persistRevision = null;
      this.persistenceHalted = true;
      this.persistRecord = {
        storageHealth: coordinator.storageHealth,
        storageUnavailableReason: coordinator.storageUnavailableReason,
        loadStatus,
        loadDetail,
        persistenceHalted: true,
        restoredOnBoot: false,
        revision: null,
        gold: '0',
        cursorMs: 0,
        deadlineMs: null,
        lastHideCommitAtMs: null,
        lastHideTriggerSource: null,
        lastCommitKind: null,
        lastCommitDetail: null,
        hideCommitCount: 0,
        showEventCount: 0,
      };
    }
    return this.persistRecord;
  }

  private async bootstrap(): Promise<void> {
    const [whiteFrame, badgeFrame, fixtureAsset] = await Promise.all([
      this.loadResource<SpriteFrame>('textures/white_pixel/spriteFrame', SpriteFrame),
      this.loadResource<SpriteFrame>('textures/spike_badge/spriteFrame', SpriteFrame).catch(() => null),
      this.loadResource<JsonAsset>('data/spike_fixture', JsonAsset).catch(() => null),
    ]);
    if (this.isComponentDestroyed()) return;

    const fixture = (fixtureAsset?.json ?? {}) as SpikeFixtureJson;
    const title = fixture.title ?? 'Idle Fishing — FE-000 Technical Spike';

    // Real single-writer persistence coordinator; catch any port construction exception fail-closed (P1-01 N2)
    let persistPort: FilePort;
    try {
      persistPort = createRuntimeFilePort('idle_fishing_lifecycle_persist');
    } catch (err) {
      persistPort = new UnavailableFilePort(
        detectRuntimeEnv(),
        'idle_fishing_lifecycle_persist',
        `Failed to initialize persistent storage port: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const persistCoordinator = new SingleWriterSaveCoordinator(persistPort);
    this.persistPort = persistPort;
    this.persistCoordinator = persistCoordinator;

    await this.initializePersistence(persistCoordinator);
    if (this.isComponentDestroyed()) return;

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

    // Closure-retained read-only mirrors remain safe to inspect even after Cocos _destroyImmediate() nulls fields
    const commitHistoryLog = this.commitHistory;
    let latestPersistRecord = this.persistRecord;
    const updatePersistRecord = (rec: BootPersistenceRecord) => {
      latestPersistRecord = rec;
      if (!this.isComponentDestroyed()) {
        this.persistRecord = rec;
      }
    };

    const getSnapshot = () => {
      const destroyed = this.isComponentDestroyed();
      return {
        env: detectRuntimeEnv(),
        page: destroyed ? null : this.router?.getCurrentId(),
        switchHistory: destroyed ? [] : (this.router?.switchHistory ?? []),
        viewport: destroyed ? null : this.responsive?.getMetrics(),
        modalVisible: destroyed ? false : (this.modal?.isVisible() ?? false),
        coreReport: destroyed ? null : this.overviewPage?.lastCoreReport,
        perfReport: destroyed ? null : this.overviewPage?.lastPerfReport,
        fsResults: destroyed ? [] : (this.platformPage?.lastFsResults ?? []),
        platformResults: destroyed ? [] : (this.platformPage?.lastPlatformResults ?? []),
        subpackResult: destroyed ? null : this.platformPage?.lastSubpackResult,
        lifecyclePersistence: latestPersistRecord,
        commitHistory: commitHistoryLog.slice(),
        lifecycleLogCount: destroyed ? 0 : (this.lifecycle?.eventLog.length ?? 0),
        destroyed,
      };
    };

    const syncWebDataset = () => {
      if (this.isComponentDestroyed()) return;
      if (typeof document !== 'undefined' && document.body) {
        try {
          document.body.dataset.spikeSnapshot = JSON.stringify(getSnapshot());
        } catch {
          // Ignore serialization failures in diagnostic mirror
        }
      }
    };

    const enqueueHideSave = (source: string): boolean => {
      // P1-02 (N3): Destroyed instance strictly rejects new tasks from entering its queue.
      if (this.isComponentDestroyed()) return false;
      const seq = ++this.hideEnqueueSeq;
      // A06 Fix: Isolate per-task exceptions inside try/catch so a single task error NEVER
      // poisons `this.pendingHideSave` for subsequent HIDE events or explicit recovery.
      this.pendingHideSave = (this.pendingHideSave ?? Promise.resolve()).then(async () => {
        try {
          if (this.isComponentDestroyed()) {
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: latestPersistRecord.revision,
              taskState: 'CANCELLED',
              resultKind: 'SKIPPED_DESTROYED',
              revision: latestPersistRecord.revision,
              cursorMs: latestPersistRecord.cursorMs,
              gold: latestPersistRecord.gold,
              detail: 'BootEntry destroyed while task was QUEUED in BootEntry queue',
            });
            return;
          }
          const coordinator = this.persistCoordinator;
          const baseState = this.persistState;
          if (this.persistenceHalted || !baseState || !coordinator) {
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: this.persistRevision,
              taskState: 'CANCELLED',
              resultKind: 'SKIPPED_HALTED',
              revision: this.persistRevision,
              cursorMs: baseState?.cursorMs ?? 0,
              gold: baseState?.gold ?? '0',
              detail: `Persistence halted (health=${latestPersistRecord.storageHealth}, loadStatus=${latestPersistRecord.loadStatus})`,
            });
            syncWebDataset();
            return;
          }

          const expectedRev = this.persistRevision;
          const nextState = advanceOffline(baseState, baseState.cursorMs + 60_000).state;
          let started = false;
          const committed: SafeSaveCommitResult = await coordinator.commit(nextState, expectedRev, {
            shouldCancelBeforeStart: () => this.isComponentDestroyed() || this.persistenceHalted,
            onStarted: () => {
              started = true;
            },
          });

          if (committed.kind === 'CANCELLED') {
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: expectedRev,
              taskState: 'CANCELLED',
              resultKind: this.isComponentDestroyed() ? 'SKIPPED_DESTROYED' : 'CANCELLED',
              revision: expectedRev,
              cursorMs: baseState.cursorMs,
              gold: baseState.gold,
              detail: committed.detail,
            });
            syncWebDataset();
            return;
          }

          if (committed.kind === 'COMMITTED') {
            if (!this.isComponentDestroyed()) {
              this.persistState = nextState;
              this.persistRevision = committed.revision;
            }
            updatePersistRecord({
              ...latestPersistRecord,
              revision: committed.revision,
              gold: nextState.gold,
              cursorMs: nextState.cursorMs,
              deadlineMs: nextState.offline?.deadlineMs ?? null,
              lastHideCommitAtMs: Date.now(),
              lastHideTriggerSource: source,
              lastCommitKind: 'COMMITTED',
              lastCommitDetail: null,
              hideCommitCount: latestPersistRecord.hideCommitCount + 1,
            });
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: expectedRev,
              taskState: 'COMMITTED',
              resultKind: 'COMMITTED',
              revision: committed.revision,
              cursorMs: nextState.cursorMs,
              gold: nextState.gold,
              detail: started && this.isComponentDestroyed() ? 'Completed in-flight STARTED write during onDestroy' : null,
            });
          } else if (committed.kind === 'STORAGE_UNAVAILABLE') {
            if (!this.isComponentDestroyed()) {
              this.persistenceHalted = true;
            }
            updatePersistRecord({
              ...latestPersistRecord,
              storageHealth: 'STORAGE_UNAVAILABLE',
              storageUnavailableReason: committed.detail,
              persistenceHalted: true,
              lastHideTriggerSource: source,
              lastCommitKind: 'STORAGE_UNAVAILABLE',
              lastCommitDetail: committed.detail,
            });
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: expectedRev,
              taskState: 'STORAGE_UNAVAILABLE',
              resultKind: 'STORAGE_UNAVAILABLE',
              revision: expectedRev,
              cursorMs: baseState.cursorMs,
              gold: baseState.gold,
              detail: committed.detail,
            });
          } else if (committed.kind === 'UNCERTAIN') {
            if (!this.isComponentDestroyed()) {
              this.persistenceHalted = true;
            }
            updatePersistRecord({
              ...latestPersistRecord,
              storageHealth: 'STORAGE_UNAVAILABLE',
              storageUnavailableReason: committed.detail,
              persistenceHalted: true,
              lastHideTriggerSource: source,
              lastCommitKind: 'UNCERTAIN',
              lastCommitDetail: committed.detail,
            });
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: expectedRev,
              taskState: 'UNCERTAIN',
              resultKind: 'UNCERTAIN',
              revision: expectedRev,
              cursorMs: baseState.cursorMs,
              gold: baseState.gold,
              detail: committed.detail,
            });
          } else {
            updatePersistRecord({
              ...latestPersistRecord,
              lastHideTriggerSource: source,
              lastCommitKind: committed.kind,
              lastCommitDetail: committed.detail,
            });
            commitHistoryLog.push({
              seq,
              triggerSource: source,
              expectedRevision: expectedRev,
              taskState: committed.kind,
              resultKind: committed.kind,
              revision: expectedRev,
              cursorMs: baseState.cursorMs,
              gold: baseState.gold,
              detail: committed.detail,
            });
          }
          syncWebDataset();
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          updatePersistRecord({
            ...latestPersistRecord,
            lastHideTriggerSource: source,
            lastCommitKind: 'FAILED',
            lastCommitDetail: detail,
          });
          commitHistoryLog.push({
            seq,
            triggerSource: source,
            expectedRevision: latestPersistRecord.revision,
            taskState: 'FAILED',
            resultKind: 'FAILED',
            revision: latestPersistRecord.revision,
            cursorMs: latestPersistRecord.cursorMs,
            gold: latestPersistRecord.gold,
            detail: `Unhandled hide-save task exception: ${detail}`,
          });
          syncWebDataset();
        }
      });
      return true;
    };

    // Real platform lifecycle subscription owned by BootEntry (disposed in onDestroy)
    this.lifecycle = new RuntimeLifecycleProvider();
    this.lifecycleUnsub = this.lifecycle.subscribe((ev) => {
      if (this.isComponentDestroyed()) return;
      if (ev === 'SHOW') {
        updatePersistRecord({
          ...latestPersistRecord,
          showEventCount: latestPersistRecord.showEventCount + 1,
        });
        syncWebDataset();
        return;
      }
      if (ev === 'HIDE') {
        const source = this.lifecycle?.lastEventSource ?? 'platform-hide';
        enqueueHideSave(source);
      }
    });

    syncWebDataset();
    this.schedule(syncWebDataset, 0.5);

    // P1-03 (A04): Production build exposes ONLY read-only observation & normal UI navigation on
    // __SPIKE_HARNESS__. Destructive save-clearing, raw coordinator handles, and owner-bypassing
    // commit hooks are strictly excluded from the production bundle.
    (globalThis as Record<string, unknown>).__SPIKE_HARNESS__ = {
      ready: true,
      env: detectRuntimeEnv(),
      getCurrentPage: () => (this.isComponentDestroyed() ? null : this.router?.getCurrentId()),
      switchPage: (id: SpikePageId) => {
        if (this.isComponentDestroyed()) return false;
        const ok = this.router?.switchTo(id) ?? false;
        syncWebDataset();
        return ok;
      },
      runCoreChecks: () => {
        if (this.isComponentDestroyed()) return null;
        const res = this.overviewPage?.runCoreChecks();
        syncWebDataset();
        return res;
      },
      run24hPerf: async () => {
        if (this.isComponentDestroyed()) return null;
        const res = await this.overviewPage?.runPerfBenchmark();
        syncWebDataset();
        return res;
      },
      openOverviewModal: () => {
        if (this.isComponentDestroyed()) return;
        this.overviewPage?.openSummaryModal();
        syncWebDataset();
      },
      closeModal: () => {
        if (this.isComponentDestroyed()) return;
        this.modal?.hide();
        syncWebDataset();
      },
      isModalVisible: () => (this.isComponentDestroyed() ? false : (this.modal?.isVisible() ?? false)),
      runAllPlatformChecks: async () => {
        if (this.isComponentDestroyed()) return null;
        const res = await this.platformPage?.runAllPlatformChecks();
        syncWebDataset();
        return res;
      },
      awaitPendingHideSave: async () => {
        await (this.pendingHideSave ?? Promise.resolve());
        syncWebDataset();
        return latestPersistRecord;
      },
      getCommitHistory: () => commitHistoryLog.slice(),
      getLifecycleLog: () => (this.isComponentDestroyed() ? [] : (this.lifecycle?.eventLog ?? [])),
      getSnapshot,
    };
  }
}
