from pathlib import Path
import hashlib,json,sys
archive=Path(__file__).resolve().parent
candidate=Path(sys.argv[1]).resolve()
def digest(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(f.read()).hexdigest()
def verify(root,rows):
    count=0
    for n,wanted in rows:
        p=(root/n).resolve()
        if root not in p.parents or not p.is_file() or digest(p)!=wanted:
            raise SystemExit('FAIL '+str(p))
        count+=1
    return count
n='reports/integration/FE-000-R1-INTEGRATION-REWORK-06/FILES-REWORK.sha256'
m=candidate/n
if digest(m)!=json.loads((archive/'HANDOFF-IDENTITY.json').read_text(encoding='utf8'))['candidateManifestSHA256']:
    raise SystemExit('Candidate manifest digest mismatch')
rows=[]
for line in m.read_text(encoding='utf-8-sig').splitlines():
    if line.strip():
        h,name=line.split(maxsplit=1)
        rows.append((name.lstrip('*').replace('\\','/'),h))
if len(rows)!=82 or len(dict(rows))!=82:raise SystemExit('Expected 82 distinct delivery entries')
print('Candidate:',verify(candidate,rows),'plus manifest OK')
mapping=json.loads((archive/'ARCHIVE-MANIFEST.json').read_text(encoding='utf8'))
print('Archive:',verify(archive,[(r['archive'],r['sha256']) for r in mapping]),'source files OK')
