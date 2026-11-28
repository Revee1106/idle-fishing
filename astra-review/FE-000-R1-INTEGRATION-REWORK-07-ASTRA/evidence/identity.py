from pathlib import Path
import hashlib, subprocess, json, sys
s = Path('E:/idle-fishing-astra-r7-test')
v = Path('E:/idle-fishing-verify-rework07')
r = Path(__file__).resolve().parents[1]
h = r.parent / r.name.replace('07-ASTRA','06-ASTRA')
d = Path('reports/integration/FE-000-R1-INTEGRATION-REWORK-07')
def git(root, *args):
    return subprocess.check_output(['git','--no-optional-locks','-C',str(root),*args])
def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest(root, p, count, digest):
    assert sha(p)==digest
    entries={}
    for line in p.read_text('utf-8-sig').splitlines():
        value, name=line.split(None,1)
        assert name not in entries and sha(root/name)==value,name
        entries[name]=value
    assert len(entries)==count
    return entries
def tree(root, ref):
    return {name.decode():obj.split()[2].decode() for obj,name in (item.split(b'\t',1) for item in git(root,'ls-tree','-rz',ref).split(b'\0') if item)}
assert git(v,'rev-parse','HEAD').decode().strip()==git(s,'rev-parse','HEAD').decode().strip()=='8458cb34362cf3a207eed963355cdfcd6ba36ea7'
assert git(v,'show','-s','--format=%P').decode().strip()=='dda015cbc5ae698f3df406ea8ffbdd7f756332bc'
assert not git(v,'status','--porcelain')
t=tree(v,'HEAD'); old=tree(v,'HEAD^'); be=tree(v,'5bcc9ac')
assert all(n in t for n in old)
modified=[n for n in old if t[n]!=old[n]]
same=[n for n in old if t[n]==old[n]]
protected=git(v,'diff','--name-only','358b111','5bcc9ac').decode().splitlines()
assert len(protected)==58 and all(t[n]==be[n] for n in protected)
for n, blob in t.items():
    data=(v/n).read_bytes()
    assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==blob,n
    assert (s/n).read_bytes()==data,n
manifestpath=d/'FILES-REWORK.sha256'
m=manifest(v,v/manifestpath,60,'78384a81e6244b7c60c45efcdde276b4b23495c6ef4a3fd17ffa391a064f5e97')
assert set(modified) | (set(t)-set(old)) == set(m)|{manifestpath.as_posix()}
assert (len(same),len(modified),len(t))==(294,8,355)
legacy='reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json'
assert m[legacy]=='21c750c5c52701d29183c64fe9965798140b18cf4df4c69c32ddb2d3159e0258' and (s/legacy).stat().st_size==169730
rh=manifest(h,h/'EVIDENCE_MANIFEST.sha256',86,'e56620d2262acbfe0042f626e2b3f3834490a84e00f296b3c92b448fd4cea36c')
print(json.dumps(dict(candidate=git(v,'show','-s','--format=%H %P').decode().strip(),remote=git(v,'ls-remote','origin','refs/heads/candidate/fe-000-rework07').decode().strip(),candidateStatus=git(v,'status','--porcelain').decode(),testStatus=git(s,'status','--porcelain').decode(),dev=git(Path('E:/idle-fishing-rework07'),'status','--short','--branch').decode(),candidateBlobs=len(t),unchanged=len(same),modified=modified,protected=protected,delivery=len(m),historical=len(rh),legacy=[legacy,m[legacy],169730],deliveryManifest=sha(v/manifestpath),historicalManifest=sha(h/'EVIDENCE_MANIFEST.sha256')),indent=2))

