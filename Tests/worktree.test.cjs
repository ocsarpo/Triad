const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const worktree = require('../electron/lib/worktree.js');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// 스크립트된 fake git: 호출 기록 + 미리 정한 응답 반환
function fakeGit(t, script) {
  const calls = [];
  worktree.configure({
    userDataDir: tmpDir(t, 'triad-wt-data-'),
    runGitImpl: async (args, cwd, input) => {
      calls.push({ args, cwd, input });
      for (const rule of script) if (rule.match(args, cwd)) return { code: 0, output: '', error: '', data: Buffer.alloc(0), ...rule.result };
      return { code: 0, output: '', error: '', data: Buffer.alloc(0) };
    },
  });
  return calls;
}

test('resolveRoot: git 레포면 루트를, 아니면 null을 돌려준다', async t => {
  const ws = tmpDir(t, 'triad-wt-ws-');
  fakeGit(t, [{ match: a => a[0] === 'rev-parse', result: { output: '/repo/root\n' } }]);
  assert.equal(await worktree.resolveRoot(ws), '/repo/root');
  fakeGit(t, [{ match: a => a[0] === 'rev-parse', result: { code: 128, output: '' } }]);
  assert.equal(await worktree.resolveRoot(ws), null);
});

test('resolveRoot: 존재하지 않는 경로·빈 문자열은 git 호출 없이 null', async t => {
  const calls = fakeGit(t, []);
  assert.equal(await worktree.resolveRoot(''), null);
  assert.equal(await worktree.resolveRoot('/no/such/dir/xyz'), null);
  assert.equal(calls.length, 0);
});

test('ensure: 신규 생성은 worktree add → 스냅샷 → untracked 복사 → 베이스라인 커밋 순서로 진행한다', async t => {
  const root = tmpDir(t, 'triad-wt-root-');
  fs.writeFileSync(path.join(root, 'loose.txt'), 'untracked');
  const calls = fakeGit(t, [
    { match: a => a[0] === 'stash' && a[1] === 'create', result: { output: 'stashsha\n' } },
    { match: a => a[0] === 'ls-files', result: { output: 'loose.txt' + String.fromCharCode(0) } },
    { match: a => a[0] === 'rev-parse' && a[1] === 'HEAD', result: { output: 'baselinesha\n' } },
  ]);
  const entry = await worktree.ensure('conv-abc', 'codex', root);
  assert.equal(entry.created, true);
  assert.equal(entry.baseline, 'baselinesha');
  assert.match(entry.branch, /^triad\//);
  const names = calls.map(c => c.args.filter(s => !s.startsWith('-')).join(' '));
  const addIdx = calls.findIndex(c => c.args[0] === 'worktree' && c.args[1] === 'add');
  const stashApplyIdx = calls.findIndex(c => c.args[0] === 'stash' && c.args[1] === 'apply' && c.args[2] === 'stashsha');
  const commitIdx = calls.findIndex(c => c.args.includes('commit'));
  assert.ok(addIdx >= 0 && stashApplyIdx > addIdx && commitIdx > stashApplyIdx, names.join(' | '));
  // stash apply·commit은 워크트리 디렉토리에서 실행된다
  assert.equal(calls[stashApplyIdx].cwd, entry.path);
  assert.equal(calls[commitIdx].cwd, entry.path);
  // untracked 파일이 워크트리로 복사됐다
  assert.equal(fs.readFileSync(path.join(entry.path, 'loose.txt'), 'utf8'), 'untracked');
});

test('ensure: 등록된 워크트리가 살아 있으면 재사용한다(created:false, git 재생성 없음)', async t => {
  const root = tmpDir(t, 'triad-wt-root-');
  const calls = fakeGit(t, [
    { match: a => a[0] === 'stash' && a[1] === 'create', result: { output: '' } },
    { match: a => a[0] === 'rev-parse' && a[1] === 'HEAD', result: { output: 'base\n' } },
  ]);
  const first = await worktree.ensure('conv-abc', 'codex', root);
  fs.mkdirSync(path.join(first.path, '.git'), { recursive: true }); // fake git은 실제 .git을 안 만드니 살아있음 표시
  const before = calls.length;
  const second = await worktree.ensure('conv-abc', 'codex', root);
  assert.equal(second.created, false);
  assert.equal(second.path, first.path);
  assert.equal(calls.length, before); // git 호출 추가 없음
});

test('ensure: worktree add 실패는 throw한다', async t => {
  const root = tmpDir(t, 'triad-wt-root-');
  fakeGit(t, [{ match: a => a[0] === 'worktree' && a[1] === 'add', result: { code: 128, error: 'fatal: bad ref' } }]);
  await assert.rejects(() => worktree.ensure('conv-x', 'claude', root), /bad ref|worktree add/);
});

test('레지스트리는 userData/worktrees.json에 저장되고 재로드된다', async t => {
  const dataDir = tmpDir(t, 'triad-wt-data-');
  worktree.configure({ userDataDir: dataDir, runGitImpl: async () => ({ code: 0, output: '', error: '', data: Buffer.alloc(0) }) });
  const reg = worktree._registry();
  reg['conv1:codex'] = { conversationId: 'conv1', slot: 'codex', root: '/r', path: '/p', branch: 'b', baseline: 'x', createdAt: 1 };
  worktree._saveRegistry();
  assert.ok(fs.existsSync(path.join(dataDir, 'worktrees.json')));
  worktree.configure({ userDataDir: dataDir }); // 재로드
  assert.equal(worktree._registry()['conv1:codex'].branch, 'b');
});