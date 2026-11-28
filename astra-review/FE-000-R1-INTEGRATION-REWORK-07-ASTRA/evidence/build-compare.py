from pathlib import Path
import hashlib,json,difflib
s=Path('E:/idle-fishing-astra-r7-test')
d=s/'reports/integration/FE-000-R1-INTEGRATION-REWORK-07/evidence'
def digest(data):return hashlib.sha256(data).hexdigest()
def dif(a,b,k=''):
    if isinstance(a,dict) and isinstance(b,dict):
        for name in sorted(a.keys()|b.keys()): yield from dif(a.get(name),b.get(name),k+'.'+name)
    elif a!=b: yield [k,a,b]
for target,manifest in [('web-mobile','web'),('wechatgame','wechat')]:
    build=s/'apps/game-client/build'/target
    ref=json.loads((d/(manifest+'-rework07-build-manifest.json')).read_text('utf-8-sig'))
    refmap={x['path']:x for x in ref['files']}
    local={p.relative_to(build).as_posix():dict(bytes=p.stat().st_size,sha256=digest(p.read_bytes())) for p in build.rglob('*') if p.is_file()}
    mismatches={}
    for p in sorted(refmap.keys()|local.keys()):
        if local.get(p,{}).get('sha256')==refmap.get(p,{}).get('sha256'):continue
        row=mismatches[p]=dict(local=local.get(p),ref=refmap.get(p))
        dev=Path('E:/idle-fishing-rework07/apps/game-client/build')/target/p
        if not dev.is_file() or not (build/p).is_file() or digest(dev.read_bytes())!=refmap.get(p,{}).get('sha256'):continue
        if p.endswith('.json'):row['differences']=list(dif(json.loads(dev.read_bytes()),json.loads((build/p).read_bytes())))
        elif p.endswith(('.html','.js')):
            a=dev.read_text('utf-8').splitlines()
            b=(build/p).read_text('utf-8').splitlines()
            row['changes']=[x[:500] for x in difflib.unified_diff(a,b,n=0)][:20]
    print(json.dumps(dict(target=target,localCount=len(local),localBytes=sum(x['bytes'] for x in local.values()),refCount=ref['fileCount'],refBytes=ref['totalBytes'],equal=sum(local[p]['sha256']==refmap[p]['sha256'] for p in local.keys()&refmap.keys()),mismatches=mismatches,files=local),ensure_ascii=True))

