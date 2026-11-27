/**
 * Supervised child-process worker for Node 24 node:test execution (P1-03 / N4+N5+A07).
 * Runs a single compiled JS test file, tracks the exact DFS event tree of test:start /
 * test:pass / test:fail across ALL nesting depths, honors Node 24 TODO semantics (including
 * throwing TODO callbacks counted as todo, NOT fail, while preserving zero-pass guard),
 * and writes a structured completion JSON ONLY when the test stream finishes cleanly.
 * If a test calls process.exit(0), crashes on module load, throws an uncaught exception,
 * hangs past worker timeout, or is killed, the completion sentinel is absent and the outer
 * runner fails non-zero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const compiledFile = process.argv[2];
const resultJsonPath = process.argv[3];

if (!compiledFile || !resultJsonPath) {
  console.error('[FE-000 Test Worker] Missing compiledFile or resultJsonPath');
  process.exit(2);
}

const resolvedFile = path.resolve(compiledFile);
const resolvedFileLower = resolvedFile.toLowerCase();

const stack = [];
let passed = 0;
let failed = 0;
let skipped = 0;
let todo = 0;
let containerFailures = 0;
const leafEvents = [];
let uncaughtError = null;

process.on('uncaughtException', (err) => {
  uncaughtError = `uncaughtException: ${err instanceof Error ? err.stack || err.message : String(err)}`;
  console.error(`[FE-000 Test Worker] ${uncaughtError}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  uncaughtError = `unhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`;
  console.error(`[FE-000 Test Worker] ${uncaughtError}`);
  process.exit(1);
});

function isFileWrapper(ev) {
  if (!ev || typeof ev.name !== 'string') return false;
  return path.resolve(ev.name).toLowerCase() === resolvedFileLower;
}

const stream = run({ files: [resolvedFile], concurrency: false, isolation: 'none' });

stream.on('test:start', (ev) => {
  const depth = typeof ev.nesting === 'number' ? ev.nesting : 0;
  // Mark nearest active parent at depth - 1 as a container (hasChildren = true)
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].nesting === depth - 1) {
      stack[i].hasChildren = true;
      break;
    }
  }
  stack.push({
    nesting: depth,
    name: ev.name,
    hasChildren: false,
    childFailures: 0,
  });
});

function popFrame(ev) {
  const depth = typeof ev.nesting === 'number' ? ev.nesting : 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].nesting === depth && stack[i].name === ev.name) {
      return stack.splice(i, 1)[0];
    }
  }
  // Fallback: match by nesting if name differed
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].nesting === depth) {
      return stack.splice(i, 1)[0];
    }
  }
  return { nesting: depth, name: ev.name, hasChildren: false, childFailures: 0 };
}

function incrementParentChildFailure(depth) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].nesting === depth - 1) {
      stack[i].childFailures += 1;
      break;
    }
  }
}

stream.on('test:pass', (ev) => {
  const frame = popFrame(ev);
  const isSuite = ev.details?.type === 'suite';
  if (isSuite || isFileWrapper(ev) || frame.hasChildren) {
    // Container (describe suite, file wrapper, or parent test with subtests) — NEVER counted as a passing leaf!
    return;
  }
  if (ev.skip !== undefined && ev.skip !== false) {
    skipped += 1;
    leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'skip' });
    return;
  }
  if (ev.todo !== undefined && ev.todo !== false) {
    todo += 1;
    leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'todo' });
    return;
  }
  passed += 1;
  leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'pass' });
});

stream.on('test:fail', (ev) => {
  const frame = popFrame(ev);
  const isSuite = ev.details?.type === 'suite';
  if (isFileWrapper(ev)) {
    containerFailures += 1;
    leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'file_error' });
    return;
  }
  if (isSuite || frame.hasChildren) {
    // Only record container failure if none of its child leaves already failed (e.g. hook/body crash)
    if (frame.childFailures === 0) {
      containerFailures += 1;
      leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'container_fail' });
    }
    incrementParentChildFailure(frame.nesting);
    return;
  }
  // A07: Node 24 emits test:fail with ev.todo truthy when a TODO test callback throws.
  // Align with Node 24 official runtime: count as TODO (not fail), while zero-pass guard
  // still rejects files where passed === 0.
  if (ev.todo !== undefined && ev.todo !== false) {
    todo += 1;
    leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'todo' });
    return;
  }
  if (ev.skip !== undefined && ev.skip !== false) {
    skipped += 1;
    leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'skip' });
    return;
  }
  failed += 1;
  incrementParentChildFailure(frame.nesting);
  leafEvents.push({ name: ev.name, nesting: frame.nesting, status: 'fail' });
});

let streamError = null;
stream.on('error', (err) => {
  streamError = err instanceof Error ? err.message : String(err);
});

stream.compose(new spec()).pipe(process.stdout);

await new Promise((resolve) => {
  stream.on('end', resolve);
  stream.on('close', resolve);
});

const summary = {
  completed: true,
  file: resolvedFile,
  passed,
  failed,
  skipped,
  todo,
  containerFailures,
  streamError,
  uncaughtError,
  leafEvents,
};

fs.writeFileSync(resultJsonPath, JSON.stringify(summary, null, 2), 'utf8');
if (failed > 0 || containerFailures > 0 || streamError || uncaughtError) {
  process.exit(1);
}
process.exit(0);
