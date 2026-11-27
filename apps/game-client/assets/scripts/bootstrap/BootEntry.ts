/**
 * FE-000 Minimal BootEntry component attached to Canvas in Boot.scene.
 * Everything below Canvas is generated dynamically in TypeScript (Code First).
 *
 * Persistence, Recovery & Lifecycle Guarantees (FE-000-R1-INTEGRATION-REWORK-05):
 * - P0 (A01): All commits execute through SingleWriterSaveCoordinator over linearizable
 *   IndexedDB (BrowserFilePort) + W3C Web Locks cross-tab exclusivity (fail-closed).
 * - A02 + REV4-01 + REV4-02 + REV4-03 + REV4-04:
 *   - Automatic boot, reload, SHOW, and HIDE NEVER silently clear a shared pending/uncertain/frozen
 *     tx marker (`clearPendingTxMarker: false` on boot).
 *   - When storage is halted/frozen, displays the minimal Code-First StorageRecoveryOverlay showing
 *     status, freeze cause, read-only backup info, and user guidance (including quota recovery).
 *   - User-triggered "Re-check & Recover Save" (`BtnRecoverStorage`) and separate controlled
 *     corrupt-marker confirmation (`BtnConfirmCorruptMarkerRecovery`) serialize on the SAME queue as
 *     HIDE saves, deduplicate duplicate clicks, update `persistState`/`persistRevision` strictly from
 *     verified persisted state (never stale frozen memory), clear `persistenceHalted` ONLY on complete
 *     recovery, and NEVER reactivate a destroyed BootEntry on async callback completion.
 * - P1-03 (A04): Production Web build keeps the EXACT 14 read-only/UI keys on `__SPIKE_HARNESS__` —
 *   ZERO destructive save-clearing, raw coordinator, or owner-bypassing methods exposed.
 */
import { _decorator, Component, JsonAsset, resources, SpriteFrame } from 'cc';
import { advanceOffline, createInitialState, type SpikeGameState } from '@idle-fishing/game-core';
import {
  detectRuntimeEnv,
  type FilePort,
  type LegacyLocalStorageStatus,
  type StorageHealthState,
} from '../platform/PlatformTypes';
import { createRuntimeFilePort } from '../platform/PlatformVerificationSuite';
import {
  SingleWriterSaveCoordinator,
  type CorruptMarkerRecoveryPreview,
  type ReadOnlyBackupInfo,
  type RecoveryFailureClassification,
  type SafeSaveCommitResult,
  type SafeSaveLoadResult,
} from '../platform/SingleWriterSaveCoordinator';
import { UnavailableFilePort } from '../platform/WeChatFilePort';
import { RuntimeLifecycleProvider } from '../platform/WeChatLifecycleProvider';
import {
  createModal,
  createStorageRecoveryOverlay,
  createUiNode,
  type ModalHandle,
  type StorageRecoveryOverlayHandle,
  type UiAssets,
} from '../ui/CodeFirstFactory';
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
  readonly recoveryClassification: RecoveryFailureClassification | null;
  readonly readOnlyBackup: ReadOnlyBackupInfo | null;
  readonly corruptMarkerRecoveryPreview: CorruptMarkerRecoveryPreview | null;
  readonly legacyExperimentalSave: LegacyLocalStorageStatus | null;
  readonly loadStatus: 'EMPTY' | 'VALID' | 'CORRUPT' | 'UNSUPPORTED' | 'STORAGE_UNAVAILABLE';
  readonly loadDetail: string | null;
  readonly persistenceHalted: boolean;
  readonly recoveryInProgress: boolean;
  readonly recoveryAttemptCount: number;
  readonly recoveryDuplicateClicksIgnored: number;
  readonly lastRecoveryOutcome:
    | 'RECOVERED_VALID'
    | 'RECOVERED_EMPTY'
    | 'COMPLETED_AFTER_DESTROY'
    | 'FAILED'
    | 'CANCELLED_DESTROYED'
    | null;
  readonly lastRecoveryDetail: string | null;
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
  private recoveryOverlay: StorageRecoveryOverlayHandle | null = null;
  private lifecycle: RuntimeLifecycleProvider | null = null;
  private lifecycleUnsub: (() => void) | null = null;
  private persistPort: FilePort | null = null;
  private persistCoordinator: SingleWriterSaveCoordinator | null = null;
  private pendingHideSave: Promise<void> = Promise.resolve();
  private activeRecoveryPromise: Promise<BootPersistenceRecord> | null = null;
  private persistState: SpikeGameState | null = null;
  private persistRevision: string | null = null;
  private persistenceHalted = false;
  private isDestroyed = false;
  private hideEnqueueSeq = 0;
  private commitHistory: BootCommitHistoryEntry[] = [];
  private persistRecord: BootPersistenceRecord = {
    storageHealth: 'AVAILABLE',
    storageUnavailableReason: null,
    recoveryClassification: null,
    readOnlyBackup: null,
    corruptMarkerRecoveryPreview: null,
    legacyExperimentalSave: null,
    loadStatus: 'EMPTY',
    loadDetail: null,
    persistenceHalted: false,
    recoveryInProgress: false,
    recoveryAttemptCount: 0,
    recoveryDuplicateClicksIgnored: 0,
    lastRecoveryOutcome: null,
    lastRecoveryDetail: null,
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
    // P1-02 (N3) + P1-03 (A04) + REV4-02: Synchronously mark destroyed in WeakSet (immune to Cocos
    // CCObject._destroyImmediate() property nulling) and sever live storage references so queued
    // saves and async recovery callbacks NEVER reactivate or dispatch new storage I/O.
    destroyedBootEntries.add(this);
    this.isDestroyed = true;
    this.persistCoordinator = null;
    this.persistPort = null;
    this.persistState = null;
    this.activeRecoveryPromise = null;
    this.lifecycleUnsub?.();
    this.lifecycleUnsub = null;
    this.lifecycle?.dispose();
    this.lifecycle = null;
    this.responsive?.dispose();
    this.responsive = null;
    this.recoveryOverlay = null;
  }

  private loadResource<T>(path: string, type: new (...args: never[]) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      resources.load(path, type as never, (err, asset) => {
        if (err || !asset) reject(err ?? new Error(`Missing resource: ${path}`));
        else resolve(asset as T);
      });
    });
  }

  private buildRecordFromLoadResult(
    prev: BootPersistenceRecord,
    coordinator: SingleWriterSaveCoordinator,
    existing: SafeSaveLoadResult,
    legacyExperimentalSave: LegacyLocalStorageStatus | null,
    sourceLabel: 'boot-load' | 'explicit-recovery' | 'corrupt-marker-recovery'
  ): BootPersistenceRecord {
    if (existing.kind === 'VALID' && existing.schemaVersion === 2) {
      const restored = existing.raw as SpikeGameState;
      this.persistState = restored;
      this.persistRevision = existing.revision;
      this.persistenceHalted = false;
      return {
        ...prev,
        storageHealth: 'AVAILABLE',
        storageUnavailableReason: null,
        recoveryClassification: null,
        readOnlyBackup: null,
        corruptMarkerRecoveryPreview: null,
        legacyExperimentalSave,
        loadStatus: 'VALID',
        loadDetail: existing.warnings.length > 0 ? existing.warnings.join('; ') : null,
        persistenceHalted: false,
        recoveryInProgress: false,
        lastRecoveryOutcome: sourceLabel === 'boot-load' ? prev.lastRecoveryOutcome : 'RECOVERED_VALID',
        lastRecoveryDetail:
          sourceLabel === 'boot-load'
            ? prev.lastRecoveryDetail
            : `Recovered verified save rev=${existing.revision} (gold=${restored.gold})`,
        restoredOnBoot: sourceLabel === 'boot-load' ? true : prev.restoredOnBoot,
        revision: existing.revision,
        gold: restored.gold,
        cursorMs: restored.cursorMs,
        deadlineMs: restored.offline?.deadlineMs ?? null,
        lastHideTriggerSource: sourceLabel === 'boot-load' ? 'boot-load' : prev.lastHideTriggerSource,
      };
    }

    if (existing.kind === 'EMPTY') {
      const fresh = createInitialState({
        saveEpoch: 'fe000-lifecycle-epoch',
        startMs: 1_700_000_000_000,
        allowanceMs: 8 * 3600 * 1000,
      });
      this.persistState = fresh;
      this.persistRevision = null;
      this.persistenceHalted = false;
      return {
        ...prev,
        storageHealth: 'AVAILABLE',
        storageUnavailableReason: null,
        recoveryClassification: null,
        readOnlyBackup: null,
        corruptMarkerRecoveryPreview: null,
        legacyExperimentalSave,
        loadStatus: 'EMPTY',
        loadDetail: null,
        persistenceHalted: false,
        recoveryInProgress: false,
        lastRecoveryOutcome: sourceLabel === 'boot-load' ? prev.lastRecoveryOutcome : 'RECOVERED_EMPTY',
        lastRecoveryDetail:
          sourceLabel === 'boot-load' ? prev.lastRecoveryDetail : 'Verified clean empty save domain',
        restoredOnBoot: false,
        revision: null,
        gold: fresh.gold,
        cursorMs: fresh.cursorMs,
        deadlineMs: fresh.offline?.deadlineMs ?? null,
      };
    }

    if (existing.kind === 'CANCELLED') {
      return {
        ...prev,
        persistenceHalted: true,
        recoveryInProgress: false,
        lastRecoveryOutcome: 'CANCELLED_DESTROYED',
        lastRecoveryDetail: existing.detail,
      };
    }

    if (existing.kind === 'STORAGE_UNAVAILABLE') {
      // Fail-closed: NEVER treat unavailable/frozen/partial-IO/disappeared/corrupt-marker as EMPTY,
      // and NEVER retain stale pre-freeze memory candidate as writable.
      this.persistState = null;
      this.persistRevision = null;
      this.persistenceHalted = true;
      return {
        ...prev,
        storageHealth: 'STORAGE_UNAVAILABLE',
        storageUnavailableReason: existing.detail,
        recoveryClassification: existing.recoveryClassification ?? null,
        readOnlyBackup: existing.readOnlyBackup ?? null,
        corruptMarkerRecoveryPreview: existing.corruptMarkerRecoveryPreview ?? null,
        legacyExperimentalSave,
        loadStatus: 'STORAGE_UNAVAILABLE',
        loadDetail: existing.detail,
        persistenceHalted: true,
        recoveryInProgress: false,
        lastRecoveryOutcome: sourceLabel === 'boot-load' ? prev.lastRecoveryOutcome : 'FAILED',
        lastRecoveryDetail: sourceLabel === 'boot-load' ? prev.lastRecoveryDetail : existing.detail,
        restoredOnBoot: false,
        revision: null,
        gold: '0',
        cursorMs: 0,
        deadlineMs: null,
      };
    }

    // CORRUPT / UNSUPPORTED / unmigrated schema -> fail-closed
    const loadStatus = existing.kind === 'CORRUPT' ? 'CORRUPT' : 'UNSUPPORTED';
    const loadDetail =
      existing.kind === 'VALID'
        ? `schemaVersion ${existing.schemaVersion} requires explicit migration`
        : existing.detail;
    this.persistState = null;
    this.persistRevision = null;
    this.persistenceHalted = true;
    return {
      ...prev,
      storageHealth: coordinator.storageHealth,
      storageUnavailableReason: coordinator.storageUnavailableReason,
      recoveryClassification: null,
      readOnlyBackup: null,
      corruptMarkerRecoveryPreview: null,
      legacyExperimentalSave,
      loadStatus,
      loadDetail,
      persistenceHalted: true,
      recoveryInProgress: false,
      lastRecoveryOutcome: sourceLabel === 'boot-load' ? prev.lastRecoveryOutcome : 'FAILED',
      lastRecoveryDetail: sourceLabel === 'boot-load' ? prev.lastRecoveryDetail : loadDetail,
      restoredOnBoot: false,
      revision: null,
      gold: '0',
      cursorMs: 0,
      deadlineMs: null,
    };
  }

  private async initializePersistence(coordinator: SingleWriterSaveCoordinator): Promise<BootPersistenceRecord> {
    if (this.isComponentDestroyed()) return this.persistRecord;
    const legacyExperimentalSave = coordinator.port.getLegacyStorageStatus
      ? coordinator.port.getLegacyStorageStatus()
      : null;
    // REWORK-04/05/06 A02 + R5-03: Automatic startup/reload MUST NOT silently clear an unrecovered
    // cross-tab pending/uncertain/frozen marker (`clearPendingTxMarker: false`), and cancels cleanly
    // if destroyed before any mutation.
    const existing = await coordinator.loadSafe({
      clearPendingTxMarker: false,
      hooks: { shouldCancelBeforeMutation: () => this.isComponentDestroyed() },
    });
    if (this.isComponentDestroyed() || existing.kind === 'CANCELLED') return this.persistRecord;

    this.persistRecord = this.buildRecordFromLoadResult(
      this.persistRecord,
      coordinator,
      existing,
      legacyExperimentalSave,
      'boot-load'
    );
    return this.persistRecord;
  }

  private formatRecoveryOverlayViewModel(rec: BootPersistenceRecord) {
    const visible = rec.persistenceHalted;
    const backupLine = rec.readOnlyBackup
      ? `Read-Only Backup: rev=${rec.readOnlyBackup.revision} (epoch=${rec.readOnlyBackup.epoch}, schema=v${rec.readOnlyBackup.schemaVersion})`
      : 'Read-Only Backup: none';
    const guidance =
      rec.recoveryClassification === 'TX_STATE_CORRUPT'
        ? rec.corruptMarkerRecoveryPreview?.canConfirmRecovery
          ? `Action: Review warning below and use "Confirm Discard Corrupt Marker & Recover" to restore rev=${rec.corruptMarkerRecoveryPreview.verifiedRevision}.`
          : 'Action: Controlled corrupt-marker recovery unavailable without a verified VALID save.'
        : rec.recoveryClassification === 'SAVE_DISAPPEARED_PENDING_RECOVERY' ||
            rec.recoveryClassification === 'REVISION_REGRESSION_PENDING_RECOVERY' ||
            rec.recoveryClassification === 'HISTORY_STATE_CORRUPT' ||
            rec.recoveryClassification === 'HISTORY_STATE_UNREADABLE'
          ? 'Action: Save history invariant violation detected. Writes remain frozen to prevent silent rollback or reset.'
          : rec.recoveryClassification === 'WRITE_CAPABILITY_UNAVAILABLE' ||
              rec.recoveryClassification === 'HISTORY_STATE_WRITE_FAILED'
            ? 'Action: Backup save is readable, but save-slot write capability is still failing. Free storage space / restore permissions, then click "Re-check & Recover Save".'
            : 'Action: If storage was full (QUOTA) or unavailable, free space / restore permissions, then click "Re-check & Recover Save".';
    const lines = [
      `Status: ${rec.loadStatus} | StorageHealth: ${rec.storageHealth}`,
      `Classification: ${rec.recoveryClassification ?? 'NONE'}`,
      backupLine,
      `Reason: ${(rec.storageUnavailableReason ?? rec.loadDetail ?? 'Persistence halted').slice(0, 260)}`,
      guidance,
    ];
    if (rec.corruptMarkerRecoveryPreview?.warning) {
      lines.push(`Warning: ${rec.corruptMarkerRecoveryPreview.warning.slice(0, 200)}`);
    }
    if (rec.lastRecoveryDetail) {
      lines.push(`Last Recovery: ${rec.lastRecoveryOutcome ?? '-'} — ${rec.lastRecoveryDetail.slice(0, 140)}`);
    }
    return {
      visible,
      title:
        rec.recoveryClassification === 'TX_STATE_CORRUPT'
          ? 'Corrupt Transaction Marker — Recovery Needed'
          : 'Storage Frozen — Explicit Recovery Required',
      body: lines.join('\n'),
      recovering: rec.recoveryInProgress,
      showCorruptMarkerConfirm:
        rec.recoveryClassification === 'TX_STATE_CORRUPT' &&
        Boolean(rec.corruptMarkerRecoveryPreview?.canConfirmRecovery),
    };
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
    let latestPendingQueue: Promise<void> = this.pendingHideSave ?? Promise.resolve();
    let latestActiveRecovery: Promise<BootPersistenceRecord> | null = null;
    const setPendingQueue = (next: Promise<void>) => {
      latestPendingQueue = next;
      if (!this.isComponentDestroyed()) {
        this.pendingHideSave = next;
      }
    };

    const refreshRecoveryOverlay = () => {
      if (this.isComponentDestroyed() || !this.recoveryOverlay) return;
      this.recoveryOverlay.update(this.formatRecoveryOverlayViewModel(latestPersistRecord));
    };

    const updatePersistRecord = (rec: BootPersistenceRecord) => {
      latestPersistRecord = rec;
      if (!this.isComponentDestroyed()) {
        this.persistRecord = rec;
        refreshRecoveryOverlay();
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
        recoveryOverlayVisible: destroyed ? false : (this.recoveryOverlay?.isVisible() ?? false),
        corruptConfirmButtonVisible: destroyed ? false : (this.recoveryOverlay?.isCorruptConfirmVisible() ?? false),
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

    /**
     * REV4-02 / REV4-03 / REV4-04 / R5-02 / R5-03: User-triggered explicit recovery serialized on
     * the SAME queue as HIDE saves (`this.pendingHideSave`). Deduplicates rapid clicks, checks owner
     * liveness before queueing, after acquiring queue & Web Lock, and immediately before any persistent
     * mutation (immune to Cocos _destroyImmediate() field nulling via WeakSet `destroyedBootEntries`),
     * truthfully distinguishes `CANCELLED_DESTROYED` (0 persistent side effects) from
     * `COMPLETED_AFTER_DESTROY` (legitimately started mutation finished safely while component stayed
     * inactive), and NEVER reactivates a destroyed BootEntry.
     */
    const triggerUserRecovery = (mode: 'STANDARD' | 'CONFIRM_CORRUPT_MARKER'): Promise<BootPersistenceRecord> => {
      if (this.isComponentDestroyed()) {
        return Promise.resolve(latestPersistRecord);
      }
      if (latestActiveRecovery) {
        updatePersistRecord({
          ...latestPersistRecord,
          recoveryDuplicateClicksIgnored: latestPersistRecord.recoveryDuplicateClicksIgnored + 1,
        });
        syncWebDataset();
        return latestActiveRecovery;
      }

      const previewSnapshot = latestPersistRecord.corruptMarkerRecoveryPreview;
      if (
        mode === 'CONFIRM_CORRUPT_MARKER' &&
        (!previewSnapshot ||
          !previewSnapshot.canConfirmRecovery ||
          !previewSnapshot.verifiedRevision ||
          !previewSnapshot.slotsSnapshotSha256)
      ) {
        updatePersistRecord({
          ...latestPersistRecord,
          lastRecoveryOutcome: 'FAILED',
          lastRecoveryDetail: 'Controlled corrupt-marker recovery requires a verified VALID backup preview',
        });
        syncWebDataset();
        return Promise.resolve(latestPersistRecord);
      }

      updatePersistRecord({
        ...latestPersistRecord,
        recoveryInProgress: true,
        recoveryAttemptCount: latestPersistRecord.recoveryAttemptCount + 1,
      });
      syncWebDataset();

      let resolveRecovery!: (rec: BootPersistenceRecord) => void;
      const recoveryPromise = new Promise<BootPersistenceRecord>((resolve) => {
        resolveRecovery = resolve;
      });
      latestActiveRecovery = recoveryPromise;
      this.activeRecoveryPromise = recoveryPromise;

      setPendingQueue(latestPendingQueue.then(async () => {
        let mutationStarted = false;
        const recoveryHooks = {
          shouldCancelBeforeMutation: () => this.isComponentDestroyed(),
          onMutationStarted: () => {
            mutationStarted = true;
          },
        };
        try {
          if (this.isComponentDestroyed()) {
            latestPersistRecord = {
              ...latestPersistRecord,
              recoveryInProgress: false,
              persistenceHalted: true,
              lastRecoveryOutcome: 'CANCELLED_DESTROYED',
              lastRecoveryDetail: 'BootEntry destroyed while recovery was queued in BootEntry queue (0 disk mutations)',
            };
            resolveRecovery(latestPersistRecord);
            return;
          }
          const coordinator = this.persistCoordinator;
          if (!coordinator) {
            updatePersistRecord({
              ...latestPersistRecord,
              recoveryInProgress: false,
              persistenceHalted: true,
              lastRecoveryOutcome: 'FAILED',
              lastRecoveryDetail: 'Persistence coordinator unavailable',
            });
            syncWebDataset();
            resolveRecovery(latestPersistRecord);
            return;
          }

          const legacyExperimentalSave = coordinator.port.getLegacyStorageStatus
            ? coordinator.port.getLegacyStorageStatus()
            : latestPersistRecord.legacyExperimentalSave;

          const loadRes: SafeSaveLoadResult =
            mode === 'CONFIRM_CORRUPT_MARKER' &&
            previewSnapshot &&
            previewSnapshot.verifiedRevision &&
            previewSnapshot.slotsSnapshotSha256
              ? await coordinator.recoverFromCorruptTxMarker(
                  {
                    expectedCorruptMarkerSha256: previewSnapshot.corruptMarkerSha256,
                    expectedValidRevision: previewSnapshot.verifiedRevision,
                    expectedSlotsSnapshotSha256: previewSnapshot.slotsSnapshotSha256,
                  },
                  recoveryHooks
                )
              : await coordinator.loadSafe({
                  clearPendingTxMarker: true,
                  hooks: recoveryHooks,
                });

          // R5-03: True pre-mutation cancellation (0 persistent side effects!)
          if (loadRes.kind === 'CANCELLED') {
            latestPersistRecord = {
              ...latestPersistRecord,
              recoveryInProgress: false,
              persistenceHalted: true,
              lastRecoveryOutcome: 'CANCELLED_DESTROYED',
              lastRecoveryDetail: loadRes.detail,
            };
            resolveRecovery(latestPersistRecord);
            return;
          }

          // R5-03 Requirements 6, 7 & 8: Destroyed BootEntry MUST NEVER be reactivated, AND if a
          // legitimately started persistent mutation already executed, NEVER disguise it as CANCELLED_DESTROYED!
          if (this.isComponentDestroyed()) {
            const diskOutcome =
              loadRes.kind === 'VALID'
                ? `VALID rev=${loadRes.revision}`
                : loadRes.kind === 'EMPTY'
                  ? 'EMPTY'
                  : `${loadRes.kind}: ${loadRes.detail}`;
            latestPersistRecord = {
              ...latestPersistRecord,
              recoveryInProgress: false,
              persistenceHalted: true,
              lastRecoveryOutcome: mutationStarted
                ? loadRes.kind === 'VALID' || loadRes.kind === 'EMPTY'
                  ? 'COMPLETED_AFTER_DESTROY'
                  : 'FAILED'
                : 'CANCELLED_DESTROYED',
              lastRecoveryDetail: mutationStarted
                ? `Persistent recovery mutation had already started before BootEntry destroy; disk result=${diskOutcome}; destroyed BootEntry remained inactive`
                : `BootEntry destroyed before persistent mutation; disk result=${diskOutcome}; destroyed BootEntry remained inactive`,
            };
            resolveRecovery(latestPersistRecord);
            return;
          }

          const updated = this.buildRecordFromLoadResult(
            latestPersistRecord,
            coordinator,
            loadRes,
            legacyExperimentalSave,
            mode === 'CONFIRM_CORRUPT_MARKER' ? 'corrupt-marker-recovery' : 'explicit-recovery'
          );
          updatePersistRecord(updated);
          syncWebDataset();
          resolveRecovery(updated);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (!this.isComponentDestroyed()) {
            this.persistState = null;
            this.persistRevision = null;
            this.persistenceHalted = true;
            updatePersistRecord({
              ...latestPersistRecord,
              storageHealth: 'STORAGE_UNAVAILABLE',
              storageUnavailableReason: `Explicit recovery threw: ${detail}`,
              persistenceHalted: true,
              recoveryInProgress: false,
              lastRecoveryOutcome: 'FAILED',
              lastRecoveryDetail: detail,
            });
            syncWebDataset();
          } else {
            latestPersistRecord = {
              ...latestPersistRecord,
              recoveryInProgress: false,
              persistenceHalted: true,
              lastRecoveryOutcome: mutationStarted ? 'FAILED' : 'CANCELLED_DESTROYED',
              lastRecoveryDetail: mutationStarted
                ? `Recovery threw after mutation started while BootEntry destroyed: ${detail}`
                : `Destroyed before mutation during failed recovery: ${detail}`,
            };
          }
          resolveRecovery(latestPersistRecord);
        } finally {
          if (latestActiveRecovery === recoveryPromise) {
            latestActiveRecovery = null;
          }
          if (!this.isComponentDestroyed() && this.activeRecoveryPromise === recoveryPromise) {
            this.activeRecoveryPromise = null;
          }
        }
      }));

      return recoveryPromise;
    };

    // Create minimal Code-First Storage Recovery Overlay (visible ONLY when persistenceHalted === true)
    this.recoveryOverlay = createStorageRecoveryOverlay(
      this.node,
      720,
      1280,
      whiteFrame,
      () => {
        void triggerUserRecovery('STANDARD');
      },
      () => {
        void triggerUserRecovery('CONFIRM_CORRUPT_MARKER');
      }
    );
    refreshRecoveryOverlay();

    const enqueueHideSave = (source: string): boolean => {
      // P1-02 (N3): Destroyed instance strictly rejects new tasks from entering its queue.
      if (this.isComponentDestroyed()) return false;
      const seq = ++this.hideEnqueueSeq;
      // A06 Fix: Isolate per-task exceptions inside try/catch so a single task error NEVER
      // poisons `this.pendingHideSave` for subsequent HIDE events or explicit recovery.
      setPendingQueue(latestPendingQueue.then(async () => {
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
              this.persistState = null;
              this.persistRevision = null;
            }
            updatePersistRecord({
              ...latestPersistRecord,
              storageHealth: 'STORAGE_UNAVAILABLE',
              storageUnavailableReason: committed.detail,
              recoveryClassification:
                coordinator.freezeCode === 'TX_STATE_CORRUPT'
                  ? 'TX_STATE_CORRUPT'
                  : 'PENDING_RECOVERY_REQUIRED',
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
              this.persistState = null;
              this.persistRevision = null;
            }
            updatePersistRecord({
              ...latestPersistRecord,
              storageHealth: 'STORAGE_UNAVAILABLE',
              storageUnavailableReason: committed.detail,
              recoveryClassification: 'PENDING_RECOVERY_REQUIRED',
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
      }));
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

    // P1-03 (A04) + REV4-02 Requirement 12: Production build keeps ONLY the exact 14 read-only/UI
    // keys on __SPIKE_HARNESS__. Explicit storage recovery is triggered strictly by normal user UI
    // buttons (BtnRecoverStorage / BtnConfirmCorruptMarkerRecovery), never destructive test hooks.
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
        await latestPendingQueue;
        syncWebDataset();
        return latestPersistRecord;
      },
      getCommitHistory: () => commitHistoryLog.slice(),
      getLifecycleLog: () => (this.isComponentDestroyed() ? [] : (this.lifecycle?.eventLog ?? [])),
      getSnapshot,
    };
  }
}
