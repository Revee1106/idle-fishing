/**
 * FE-000 Minimal BootEntry component attached to Canvas in Boot.scene.
 * Everything below Canvas is generated dynamically in TypeScript (Code First).
 */
import { _decorator, Component, JsonAsset, resources, SpriteFrame } from 'cc';
import { detectRuntimeEnv } from '../platform/PlatformTypes';
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

@ccclass('BootEntry')
export class BootEntry extends Component {
  private router: PageRouter | null = null;
  private responsive: ResponsiveCanvasAdapter | null = null;
  private overviewPage: OverviewPage | null = null;
  private platformPage: PlatformPage | null = null;
  private modal: ModalHandle | null = null;

  start(): void {
    void this.bootstrap();
  }

  onDestroy(): void {
    this.responsive?.dispose();
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
      getSnapshot,
    };
  }
}
