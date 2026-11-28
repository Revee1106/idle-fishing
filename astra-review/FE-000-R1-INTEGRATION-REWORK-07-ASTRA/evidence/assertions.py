from pathlib import Path
import subprocess, re,json
s=Path('E:/idle-fishing-astra-r7-test')
files=['tests/frontend/fe-000/platform-and-core.test.ts','tests/frontend/fe-000/verify-web-build.mjs','tests/frontend/fe-000/run-node-tests.mjs']
def get(ref,name):return subprocess.check_output(['git','-C',str(s),'show',ref+':'+name]).decode().splitlines()
for name in files:
    import difflib
    old=get('HEAD^',name)
    new=get('HEAD',name)
    delta=list(difflib.unified_diff(old,new,n=2))
    print(name,'deleted lines:',len([l for l in delta[2:] if l.startswith('-')]),'inserted:',len([l for l in delta[2:] if l.startswith('+')]))
    if 'platform-and-core' in name:
        for x in difflib.SequenceMatcher(None,old,new,autojunk=False).get_opcodes():
            tag, a,b,c,d=x
            if a!=b and tag!='equal':
                print('\n'.join('- '+line for line in old[a:b])); print('\n'.join('+ '+line for line in new[c:min(d,c+26)]))
    rx=r"assertCheck\(\s*'([^']+)'" if 'verify-web' in name else r"(?:it|test)\(\s*'([^']+)'"
    old_cases=re.findall(rx,'\n'.join(old)); new_cases=re.findall(rx,'\n'.join(new))
    assert not set(old_cases)-set(new_cases), set(old_cases)-set(new_cases)
    print(json.dumps(dict(old=len(old_cases),new=len(new_cases),added=sorted(set(new_cases)-set(old_cases)))))

