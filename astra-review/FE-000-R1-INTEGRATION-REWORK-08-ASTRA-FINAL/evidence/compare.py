from pathlib import Path
import hashlib,json,subprocess,re
s=Path('E:/idle-fishing-astra-r8-test')
e=Path(__file__).resolve().parent
old=Path('E:/idle-fishing-astra-review-20261127/FE-000-R1-INTEGRATION-REWORK-07-ASTRA/evidence')
d=s/'reports/integration/FE-000-R1-INTEGRATION-REWORK-08/evidence'
def hashfile(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def cmd(*args):return subprocess.check_output(['git','-C',str(s),*args]).decode('utf-8')
result={}
for nm in ['platform-and-core.test.ts','verify-web-build.mjs','run-node-tests.mjs']:
    path='tests/frontend/fe-000/'+nm
    diff=cmd('diff','--ignore-space-at-eol','--unified=0','HEAD^','HEAD','--',path).splitlines()
    deleted=[l[1:] for l in diff if l.startswith('-') and not l.startswith('---')]
    result[nm]={'removed':deleted,'addedLines':sum(x.startswith('+') and not x.startswith('+++') for x in diff)}
    if nm=='platform-and-core.test.ts':
        for l in deleted:
            if l.strip().startswith('//'): continue
            assert "assert.equal(" in l and "'WRITE_CAPABILITY_UNAVAILABLE'" in l,l
            assert '+'+l.replace('WRITE_CAPABILITY_UNAVAILABLE','INITIAL_COMMIT_STATE_UNAVAILABLE') in diff
    else: assert not deleted
def tested(p):
    return {m[1].strip() for m in re.finditer(r'^✔ (.*?) \(\d+(?:\.\d+)?ms\)\s*$',p.read_text('utf-8-sig'),re.M)}
o=tested(old/'node.log'); n=tested(e/'node.log')
assert (len(o),len(n))==(35,36) and o<=n,(len(o),len(n),o-n)
result['nodeCases']=dict(old=len(o),now=len(n),new=sorted(n-o))
for label in ['webA','webB']:
    def assertions(root): return json.loads((root/label/'r1-green-web-results.json').read_text('utf-8-sig'))['assertions']
    before=assertions(old); after=assertions(e)
    assert [x['name'] for x in before]==[x['name'] for x in after if x['name'] in {b['name'] for b in before}]
    assert len(before)==39 and len(after)==40 and all(x['status']=='PASS' for x in after)
    result[label]=dict(old=len(before),now=len(after))
for target,key in [('web-mobile','web'),('wechatgame','wechat')]:
    ref=json.loads((d/(key+'-rework08-build-manifest.json')).read_text('utf-8-sig'))
    build=s/'apps/game-client/build'/target
    rows={f.relative_to(build).as_posix():{'bytes':f.stat().st_size,'sha256':hashfile(f)} for f in build.rglob('*') if f.is_file()}
    theirs={x['path']:{k:x[k] for k in ('bytes','sha256')} for x in ref['files']}
    result[target]=dict(files=len(rows),bytes=sum(x['bytes'] for x in rows.values()),developerFiles=ref['fileCount'],developerBytes=ref['totalBytes'],mismatches=[k for k in sorted(rows.keys()|theirs.keys()) if rows.get(k)!=theirs.get(k)],observed=rows)
print(json.dumps(result,indent=2))

