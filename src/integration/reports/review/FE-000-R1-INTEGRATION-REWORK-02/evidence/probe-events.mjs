import fs from 'node:fs';
import { run } from 'node:test';
const file = process.argv[2];
const stream = run({ files: [file], concurrency: false, isolation: 'none' });
const events = [];
for (const ev of ['test:start','test:pass','test:fail','test:diagnostic','test:plan']) {
  stream.on(ev, (e) => events.push({ ev, name: e.name, nesting: e.nesting, skip: e.skip, todo: e.todo, type: e.details?.type, file: e.file ? String(e.file).slice(-60) : undefined }));
}
stream.compose(new (await import('node:test/reporters')).spec()).pipe(process.stdout);
await new Promise(r => { stream.on('end', r); stream.on('close', r); });
console.log('\n=== EVENT TREE ===');
for (const e of events) console.log(JSON.stringify(e));
