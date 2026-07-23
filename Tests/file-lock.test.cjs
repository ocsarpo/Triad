const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  DEFAULT_STALE_LOCK_AGE_MS,
  acquireFileLock,
  readLock,
  recoverStaleLock,
  releaseFileLock,
} = require('../Resources/file-lock.cjs');

function temporaryFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-file-lock-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'board.json');
}

function writeLock(filePath, value) {
  fs.writeFileSync(`${filePath}.lock`, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
}

function exited(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`lock worker failed (${code}): ${stderr}`)));
  });
}

test('정상 경합에서도 파일 잠금이 lost update 없이 순차 실행된다', async t => {
  const filePath = temporaryFile(t);
  fs.writeFileSync(filePath, JSON.stringify({ updates: [] }));
  const helperPath = path.join(__dirname, '../Resources/file-lock.cjs');
  const worker = `
    const fs = require('node:fs');
    const { withFileLock } = require(${JSON.stringify(helperPath)});
    const target = process.argv[1];
    const value = process.argv[2];
    withFileLock(target, () => {
      const state = JSON.parse(fs.readFileSync(target, 'utf8'));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      state.updates.push(value);
      fs.writeFileSync(target, JSON.stringify(state));
    });
  `;
  await Promise.all([
    exited(spawn(process.execPath, ['-e', worker, filePath, 'codex'])),
    exited(spawn(process.execPath, ['-e', worker, filePath, 'claude'])),
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).updates.sort(), ['claude', 'codex']);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test('죽은 PID가 남긴 락은 즉시 회수한다', t => {
  const filePath = temporaryFile(t);
  writeLock(filePath, { pid: 2_000_000_000, at: Date.now(), token: 'dead-owner' });
  assert.equal(recoverStaleLock(`${filePath}.lock`), true);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test('오래된 락은 PID가 살아 있어도 안전 임계치 이후 회수한다', t => {
  const filePath = temporaryFile(t);
  writeLock(filePath, { pid: process.pid, at: Date.now() - DEFAULT_STALE_LOCK_AGE_MS - 1, token: 'old-owner' });
  assert.equal(recoverStaleLock(`${filePath}.lock`), true);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test('살아있는 프로세스의 신선한 락은 탈취하지 않는다', t => {
  const filePath = temporaryFile(t);
  writeLock(filePath, { pid: process.pid, at: Date.now(), token: 'live-owner' });
  assert.equal(recoverStaleLock(`${filePath}.lock`), false);
  assert.equal(readLock(`${filePath}.lock`).metadata.token, 'live-owner');
});

test('손상됐지만 신선한 락은 탈취하지 않는다', t => {
  const filePath = temporaryFile(t);
  writeLock(filePath, '{not-json');
  assert.equal(recoverStaleLock(`${filePath}.lock`), false);
  assert.equal(fs.readFileSync(`${filePath}.lock`, 'utf8'), '{not-json');
});

test('손상된 오래된 락은 mtime 안전 임계치 이후 회수한다', t => {
  const filePath = temporaryFile(t);
  const lockPath = `${filePath}.lock`;
  writeLock(filePath, '{not-json');
  const old = new Date(Date.now() - DEFAULT_STALE_LOCK_AGE_MS - 1);
  fs.utimesSync(lockPath, old, old);
  assert.equal(recoverStaleLock(lockPath), true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('이전 소유자의 finally는 새 소유자 락을 지우지 않는다', t => {
  const filePath = temporaryFile(t);
  const previous = acquireFileLock(filePath);
  writeLock(filePath, { pid: process.pid, at: Date.now(), token: 'replacement-owner' });
  releaseFileLock(previous);
  assert.equal(readLock(`${filePath}.lock`).metadata.token, 'replacement-owner');
});

test('파일 락 복구 모듈은 버전을 올리고 앱 패키지에 포함한다', () => {
  const root = path.join(__dirname, '..');
  const plist = fs.readFileSync(path.join(root, 'Resources/Info.plist'), 'utf8');
  const packager = fs.readFileSync(path.join(root, 'scripts/package-app.sh'), 'utf8');
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.40\.6<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>56<\/string>/);
  assert.match(packager, /cp "\$root\/Resources\/file-lock\.cjs" "\$app\/Contents\/Resources\/file-lock\.cjs"/);
});
