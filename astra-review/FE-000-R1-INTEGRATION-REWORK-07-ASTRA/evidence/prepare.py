from pathlib import Path
e=Path(__file__).resolve().parent
s=Path('E:/idle-fishing-astra-r7-test')
h=Path('E:/idle-fishing-astra-review-20261127/FE-000-R1-INTEGRATION-REWORK-06-ASTRA/evidence')
d=s/'reports/integration/FE-000-R1-INTEGRATION-REWORK-07/evidence'
def save(name, data):
    (e/name).write_text(data,'utf-8')
race=(d/'r7-isolated-race.mjs').read_text('utf-8')
save('race.mjs',race.replace("path.resolve(__dirname, '../../../..')","process.cwd()"))
for fname in ['probe-owner.mjs','capacity.mjs']:
    src=(h/fname).read_text('utf-8').replace('E:/idle-fishing-astra-test-20261127',s.as_posix()).replace(h.as_posix(),e.as_posix())
    # Historical capacity uses a bare package import. Resolve from isolated package exports.
    src=src.replace("from '@idle-fishing/game-core'", "from '"+(s/'packages/game-core/dist/cocos/spike/index.mjs').as_uri()+"'")
    src=src.replace("from '../tests/frontend/", "from '"+s.as_uri()+"/tests/frontend/")
    save('original-'+fname,src)
src=(d/'repro-r503-probe-owner.mjs').read_text('utf-8')
a=src.index('  await hide();'); b=src.index('} finally {\n  cdp?.close()',a)
body="""  const snapshot = () => cdp.eval('globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence');
  const slots = () => cdp.eval(`(${IDB_HELPERS}).readSlots(${JSON.stringify(appNs)})`);
  const marker = () => cdp.eval(`(${IDB_HELPERS}).readTxState(${JSON.stringify(appNs)})`);
  const boot = await snapshot();
  await cdp.eval(`(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key) {
      if (String(key).startsWith(${JSON.stringify(appNs + ':save_slot_')}) && typeof value === 'string' && value.length > 1000) {
        globalThis.attemptedSlotText = value;
        throw new DOMException('audit slot quota','QuotaExceededError');
      }
      return original.call(this,value,key);
    };
    return true;
  })()`);
  await hide();
  const pending = await cdp.eval('globalThis.attemptedSlotText');
  const beforeReload = await snapshot();
  const markerBefore = await marker();
  if (!pending || !beforeReload.persistenceHalted || !markerBefore || (await slots()).some(Boolean)) throw Error('fixture invalid');
  await cdp.send('Page.reload', {ignoreCache:true});
  await waitUntil(() => cdp.eval('globalThis.__SPIKE_HARNESS__?.ready && globalThis.__SPIKE_HARNESS__.getSnapshot().recoveryOverlayVisible'),25000,'frozen page after reload');
  const reloaded = await snapshot();
  await clickBtn('BtnRecoverStorage');
  await waitUntil(async () => ['RECOVERED_VALID','FAILED'].includes((await snapshot()).lastRecoveryOutcome),10000,'completed recovery');
  const after = await snapshot();
  const disk = (await slots()).find(Boolean);
  const unpack = text => text && JSON.parse(JSON.parse(text).payload);
  const pendingPayload = unpack(pending);
  const savedPayload = unpack(disk);
  const rawHistory = await cdp.eval(`(${IDB_HELPERS}).readHistoryState(${JSON.stringify(appNs)})`);
  const same = disk && JSON.parse(pending).payload === JSON.parse(disk).payload;
  console.log(JSON.stringify({boot,beforeReload,markerBefore,reloaded,after,markerAfter:await marker(),rawHistory,pendingPayload,savedPayload,same},null,2));
  pass = after.persistenceHalted === true || Boolean(same);
"""
save('refresh-ui.mjs',src[:a]+body+src[b:])

