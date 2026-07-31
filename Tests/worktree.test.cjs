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