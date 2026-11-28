from pathlib import Path
import json,hashlib,re
root=Path(__file__).resolve().parents[1]; e=root/'evidence'
def log(n):return (e/(n+'.log')).read_text('utf-8-sig')
def parsed(n):return json.loads(log(n))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
runs='identity-before identity-after install verify perf a1-a8 cocos-types fe-types node build-web build-wx webA webB raceA raceB originalA originalB same-page normal-ui repeat-ui wx-static compare'.split()
for n in runs: assert int((e/(n+'.rc')).read_text().strip())==0,n
assert parsed('identity-before')==parsed('identity-after')
assert digest(e/'original-refresh.mjs')=='f1576561455d834f63d614f5ffa072e04582625f259d409d5b4861b366fdea26'
for name in ['originalA','originalB']:
    j=parsed(name); state=j['after']; assert j['pendingPayload']['gold']=='31' and j['pendingPayload']['cursorMs']==1700000060000
    assert state['persistenceHalted'] and state['revision'] is None and state['lastRecoveryOutcome']=='FAILED'
    assert state['recoveryClassification']=='INITIAL_COMMIT_STATE_UNAVAILABLE' and j['markerBefore']==j['markerAfter'] and j['markerBefore'] and j['rawHistory'] is None and not j.get('savedPayload')
for idx in 'AB':
    j=json.loads((e/('web'+idx)/'r1-green-web-results.json').read_text('utf-8'))
    assert len(j['assertions'])==40 and all(x['status']=='PASS' for x in j['assertions']) and not any(j[k] for k in ['failures','uncaughtExceptions','consoleErrors'])
    race=json.loads((e/('r8-isolated-race-independent'+idx+'.json')).read_text('utf-8'))
    assert not race['failures'] and len(race['rounds'])==12 and {race['empty']['a'],race['empty']['b']}=={'CONFLICT','COMMITTED'} and race['crash']['reload']=='21'
    assert 'rounds=12, doubles=0' in log('race'+idx)
assert len(parsed('repeat-ui')['rows'])==4
assert 'total=36 pass=36 fail=0 skip=0 todo=0 containerFail=0 procErr=0' in log('node')
assert 'pass 82' in log('verify') and 'pass 8' in log('a1-a8') and '10/10' in log('wx-static')
assert '0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f' in log('perf')
cmp=parsed('compare')
for k in ['web-mobile','wechatgame']: assert not cmp[k]['mismatches'] and cmp[k]['files']==cmp[k]['developerFiles'] and cmp[k]['bytes']==cmp[k]['developerBytes']
required={'REVIEW_REPORT.md','CODE_REVIEW.md','TEST_VERIFICATION.md','DESIGN_ISSUES.md','ACCEPTANCE_CHECKLIST.md','HISTORICAL_CLOSURE_CHECK.md'}
assert {x.name for x in root.glob('*.md')}==required
for doc in root.glob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',doc.read_text('utf-8')):assert (root/target).is_file(),target
out=root/'EVIDENCE_MANIFEST.sha256'
assert not out.exists()
rows=sorted((p for p in root.rglob('*') if p.is_file()),key=lambda p:p.relative_to(root).as_posix())
out.write_bytes(''.join(digest(p)+'  '+p.relative_to(root).as_posix()+'\n' for p in rows).encode())
for l in out.read_text().splitlines():
    h,n=l.split('  ',1); assert digest(root/n)==h
print(len(rows),'files verified; manifest',digest(out))

