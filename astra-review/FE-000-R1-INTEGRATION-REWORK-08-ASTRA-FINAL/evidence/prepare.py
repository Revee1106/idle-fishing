from pathlib import Path
from shutil import copyfile
e=Path(__file__).resolve().parent
s=Path('E:/idle-fishing-astra-r8-test')
prev=Path('E:/idle-fishing-astra-review-20261127/FE-000-R1-INTEGRATION-REWORK-07-ASTRA/evidence')
copyfile(prev/'refresh-ui.mjs',e/'original-refresh.mjs')
d=s/'reports/integration/FE-000-R1-INTEGRATION-REWORK-08/evidence'
race=(d/'r8-isolated-race.mjs').read_text('utf-8')
token="path.resolve(__dirname, '../../../..')"
assert race.count(token)==1
(e/'race.mjs').write_text(race.replace(token,'process.cwd()'),'utf-8')
src=(e/'original-refresh.mjs').read_text('utf-8')
start=src.index("  await cdp.send('Page.reload', {ignoreCache:true});",src.index('  const beforeReload'))
end=src.index('} finally {\n  cdp?.close()',start)
src=src.replace("        globalThis.attemptedSlotText = value;", "        globalThis.attemptedSlotText = value;") # retain captured formal slot contents
extra=(e/'adjacent-body.txt').read_text('utf-8')
head=src[:start].replace('const original = IDBObjectStore.prototype.put;', 'const original = IDBObjectStore.prototype.put; globalThis.auditOriginalPut = original;')
(e/'adjacent-ui.mjs').write_text(head+extra+'\n'+src[end:],'utf-8')
(e/'normal-ui.mjs').write_text(src[:src.index('  const boot = await snapshot();')]+(e/'normal-body.txt').read_text('utf-8')+'\n'+src[end:],'utf-8')

