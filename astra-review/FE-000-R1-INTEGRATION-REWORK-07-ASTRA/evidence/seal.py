from pathlib import Path
import re,json,hashlib
e=Path(__file__).resolve().parent
root=e.parent
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
required={'REVIEW_REPORT.md','CODE_REVIEW.md','TEST_VERIFICATION.md','DESIGN_ISSUES.md','ACCEPTANCE_CHECKLIST.md','HISTORICAL_CLOSURE_CHECK.md'}
assert {p.name for p in root.glob('*.md')}==required
for p in root.glob('*.md'):
    for name in re.findall(r'\]\(([^)]+)\)',p.read_text('utf-8')): assert (root/name).is_file(),name
def read(p):return p.read_text('utf-8-sig')
expected_errors={'transaction','frontend-types','refresh-ui','refresh-repeat'}
assert {p.stem for p in e.glob('*.rc') if int(read(p).strip())}==expected_errors
a,b=[json.loads(read(e/n)) for n in ['before.log','after.log']]
assert a==b and not a['testStatus'] and a['candidate'].split()[0]==a['remote'].split()[0]
for suffix in ['A','B']:
    j=json.loads(read(e/('web'+suffix)/'r1-green-web-results.json'))
    assert len(j['assertions'])==39 and all(x['status']=='PASS' for x in j['assertions']) and not any(j[k] for k in ['failures','consoleErrors','uncaughtExceptions'])
    assert 'rounds=12, doubles=0' in read(e/('race'+suffix+'.log'))
for name in ['refresh-ui','refresh-repeat']:
    j=json.loads(read(e/(name+'.log')))
    assert not j['same'] and j['pendingPayload']['gold']=='31' and j['savedPayload']['gold']=='0' and j['after']['lastRecoveryOutcome']=='RECOVERED_VALID'
for name in ['probe-standard','probe-confirm']:
    j=json.loads(read(e/(name+'.log')))
    assert not j['ops'] and all(j[k] for k in ['slotsIdentical','markerIdentical','historyIdentical','destroyed','halted']) and j['outcome']=='CANCELLED_DESTROYED'
for line in read(e/'build-compare.log').splitlines():
    j=json.loads(line);assert not j['mismatches'] and j['refCount']==j['equal']==j['localCount']
p=root/'EVIDENCE_MANIFEST.sha256'
files=sorted((f for f in root.rglob('*') if f.is_file() and f!=p),key=lambda f:f.relative_to(root).as_posix())
assert not p.exists()
p.write_bytes(''.join(h(f)+'  '+f.relative_to(root).as_posix()+'\n' for f in files).encode())
for line in read(p).splitlines():
    expected,name=line.split('  ',1);assert h(root/name)==expected
print(len(files),'entries verified; manifest SHA-256',h(p))

