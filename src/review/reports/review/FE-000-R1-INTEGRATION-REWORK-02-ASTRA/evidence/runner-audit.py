from pathlib import Path
import subprocess as s,json
p=Path('tests/frontend/fe-000'); out=Path('runner-audit');out.mkdir(exist_ok=True)
cases={'todo-throws':"test('normal',()=>{});test.todo('planned',()=>{throw Error('planned')})",'body-exit':"test('early',()=>process.exit(0))",'exit-one':"process.exit(1)",'child-throw':"test('parent',async t=>{await t.test('child',()=>{throw Error('child')})})",'hanging':"test('pending',async()=>{setInterval(()=>{},100);await new Promise(()=>{})})"}
for k,v in cases.items():(out/(k+'.mjs')).write_text("import test from 'node:test';"+v,encoding='utf8')
for f in list(out.glob('*.mjs'))+list((p/'.compiled/tests/frontend/fe-000/fixtures').glob('*.js')):
 dest=out/(f.stem+'.json'); cmd=['node',str(p/'node-test-worker.mjs'),str(f),str(dest)]
 try:
  r=s.run(cmd,capture_output=True,timeout=2.5 if f.stem=='hanging' else 20); meta={'rc':r.returncode};data=r.stdout+r.stderr
 except s.TimeoutExpired as e:meta={'timeout':e.timeout,'rc':None};data=(e.stdout or b'')+(e.stderr or b'')
 (out/(f.stem+'.log')).write_bytes(data);print(f.name,meta,dest.read_text()[:150] if dest.exists() else 'NO_SENTINEL',flush=True)
f=p/'fixtures/astra-exit.test.ts';f.write_text('process.exit(0); export {};',encoding='utf8')
cmd=['node',str(p/'run-node-tests.mjs'),'--files=fixtures/fixture-deep-nested.test.ts,fixtures/astra-exit.test.ts','--out-dir='+str((p/'.compiled-astra').resolve())];r=s.run(cmd,capture_output=True);(out/'combined.log').write_bytes(r.stdout+r.stderr);print(cmd,r.returncode,(r.stdout+r.stderr).decode(errors='replace')[-650:])
