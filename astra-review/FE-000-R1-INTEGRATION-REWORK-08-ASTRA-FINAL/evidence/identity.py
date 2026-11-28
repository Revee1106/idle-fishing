from pathlib import Path
import hashlib, subprocess,json
s=Path('E:/idle-fishing-astra-r8-test')
v=Path('E:/idle-fishing-verify-rework08')
d=Path('E:/idle-fishing-rework08')
main=Path('E:/idle-fishing')
blocked=Path('E:/idle-fishing-astra-review-20261128/FE-000-R1-INTEGRATION-REWORK-08-ASTRA')
r7=Path('E:/idle-fishing-astra-review-20261127/FE-000-R1-INTEGRATION-REWORK-07-ASTRA')
delivery=Path('reports/integration/FE-000-R1-INTEGRATION-REWORK-08')
sha='ff6941f013fefd385c904920d69c1b12d43742c6'
parent='8458cb34362cf3a207eed963355cdfcd6ba36ea7'
arc='e523d67d92dd85499a3ddca0dc8a84dfcb437f3b'
def git(root,*args):
    return subprocess.check_output(['git','--no-optional-locks','-C',str(root),*args]).decode().strip()
def tree(root,ref):
    return {name:info.split()[2] for info,name in (r.split('\t',1) for r in git(root,'ls-tree','-rz',ref).split('\0') if r)}
def blob(data): return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest(root,path):
    entries={}
    for line in path.read_text('utf-8-sig').splitlines():
        h,n=line.split(None,1)
        assert n not in entries and digest(root/n)==h,n
        entries[n]=h
    return entries
t=tree(s,sha); old=tree(s,parent); archive=tree(main,arc)
refs=git(main,'ls-remote','origin','refs/heads/candidate/fe-000-rework08','refs/heads/archive/20261128-rework07-08-astra')
assert {l.split()[0] for l in refs.splitlines()}=={arc,sha}
assert git(s,'show','-s','--format=%H %P')==sha+' '+parent
statuses={}
for root in (v,s,d):
    assert git(root,'rev-parse','HEAD')==sha and len(t)==399
    statuses[str(root)]=git(root,'status','--porcelain')
    for n,b in t.items(): assert blob((root/n).read_bytes())==b,(root,n)
    assert not statuses[str(root)],statuses[str(root)]
pre=json.loads((blocked/'evidence/preflight.json').read_text('utf-8-sig'))
m=delivery/'FILES-REWORK.sha256'; entries=manifest(s,s/m)
assert len(entries)==47 and digest(s/m)==pre['delivery']['manifestSha256']=='5276bc16090717b48de6f4e7ddd0e55688877257cd173d3ec09159be1b323a0f'
changed=[n for n in t if n in old and t[n]!=old[n]]
added=set(t)-set(old)
assert sorted(changed)==sorted(pre['workingChanges']) and len(changed)==4 and len(added)==44 and not set(old)-set(t)
assert all(n.startswith(delivery.as_posix()+'/') for n in added)
assert set(entries)|{m.as_posix()}==set(changed)|added
pr=git(s,'diff','--name-only','358b111','5bcc9ac').splitlines(); back=tree(s,'5bcc9ac')
assert len(pr)==58 and all(t[n]==back[n] for n in pr)
legacy='reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json'
assert (s/legacy).stat().st_size==169730 and digest(s/legacy)==pre['fixtureSHA256']=='21c750c5c52701d29183c64fe9965798140b18cf4df4c69c32ddb2d3159e0258'
history={}
for root,count,h in [(r7,90,'595c7fb8921b6c04e719dedb25e725b2423e3de681316338969e2429b8e54153'),(blocked,9,'92be325a50737f93ab62d0fdfdb9a5675eb2f464d90bc16fa0d95883e9cbbebf')]:
    p=root/'EVIDENCE_MANIFEST.sha256'
    items=manifest(root,p); assert len(items)==count and digest(p)==h
    for n in [*items,p.name]:
        assert blob((root/n).read_bytes())==archive['astra-review/'+root.name+'/'+n],n
    history[str(root)]=[count,h]
print(json.dumps(dict(remote=refs,sha=sha,parent=parent,archive=arc,rawFilesPerTree=len(t),statuses=statuses,changed=changed,added=len(added),parentFilesUnchanged=len(old)-len(changed),protected=len(pr),fixture=[(s/legacy).stat().st_size,digest(s/legacy)],manifest=[len(entries),digest(s/m)],history=history),indent=2))

