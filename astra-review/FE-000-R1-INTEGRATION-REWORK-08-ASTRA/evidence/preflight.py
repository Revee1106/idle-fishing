import hashlib, json, subprocess, sys
from pathlib import Path
D=Path('E:/idle-fishing-rework08')
H=Path('E:/idle-fishing-astra-review-20261127/FE-000-R1-INTEGRATION-REWORK-07-ASTRA')
P=Path('reports/integration/FE-000-R1-INTEGRATION-REWORK-08')
base='8458cb34362cf3a207eed963355cdfcd6ba36ea7'
def git(*args):
    return subprocess.check_output(['git','--no-optional-locks','-C',str(D),*args]).decode().strip()
def tree(ref):
    return {n:s.split()[2] for s,n in (x.split('\t',1) for x in git('ls-tree','-rz',ref).split('\0') if x)}
def blob(p):
    b=p.read_bytes()
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest(root,p):
    seen=set(); bad=[]
    for line in p.read_text('utf-8-sig').splitlines():
        h,n=line.split(None,1)
        if n in seen or not (root/n).is_file() or sha(root/n)!=h: bad.append(n)
        seen.add(n)
    return {'entries':len(seen),'mismatches':bad,'manifestSha256':sha(p)},seen
m,listed=manifest(D,D/P/'FILES-REWORK.sha256')
hist,_=manifest(H,H/'EVIDENCE_MANIFEST.sha256')
old=tree(base); be=tree('5bcc9ac')
changed=[p for p in old if not (D/p).is_file() or blob(D/p)!=old[p]]
paths=git('diff','--name-only','358b111','5bcc9ac').splitlines()
legacy='reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json'
expected=set(changed)|{p.relative_to(D).as_posix() for p in (D/P).rglob('*') if p.is_file() and p.name!='FILES-REWORK.sha256'}
remote=git('ls-remote','--heads','--tags','origin')
obs={}
for name in ['refresh-ui.log','refresh-repeat.log']:
    j=json.loads((H/'evidence'/name).read_text('utf-8-sig'))
    obs[name]={k:[j[k]['gold'],j[k]['cursorMs']] for k in ['pendingPayload','savedPayload']}
    obs[name]['outcome']=j['after']['lastRecoveryOutcome']
result=dict(branch=git('branch','--show-current'),head=git('rev-parse','HEAD'),headParents=git('show','-s','--format=%P'),remote=git('remote','get-url','origin'),remoteR8=[l for l in remote.splitlines() if 'rework08' in l.lower() or 'rework-08' in l.lower()],remoteR7=[l for l in remote.splitlines() if l.endswith('refs/heads/candidate/fe-000-rework07')],localRefs=git('for-each-ref','--format=%(refname) %(objectname)','*rework08*','refs/heads/*/*rework08*','refs/remotes/*/*/*rework08*'),status=git('status','--short','--branch'),staged=git('diff','--cached','--name-only'),workingChanges=changed,unchangedRaw=len(old)-len(changed),protectedCount=len(paths),protectedMismatch=[n for n in paths if blob(D/n)!=be[n]],delivery=m,unlisted=sorted(expected-listed),extra=sorted(listed-expected),history=hist,fixtureBytes=(D/legacy).stat().st_size,fixtureSHA256=sha(D/legacy),priorIndependentResults=obs)
print(json.dumps(result,indent=2))

