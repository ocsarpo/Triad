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

// rev-parse 응답이 cwd에 따라 달라야 하므로(자기/상대 워크스페이스) fakeGit 대신 직접 configure.
// worktree add는 실제 git처럼 대상 디렉토리에 .git 표식을 만들어 재사용 판정이 동작하게 한다.
function isolationSetup(t, { sameRoot }) {
  const root = tmpDir(t, 'triad-wt-root-');
  const otherRoot = sameRoot ? root : tmpDir(t, 'triad-wt-other-');
  const calls = [];
  worktree.configure({
    userDataDir: tmpDir(t, 'triad-wt-data-'),
    runGitImpl: async (args, cwd, input) => {
      calls.push({ args, cwd, input });
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, output: (cwd === root ? root : otherRoot) + '\n', error: '', data: Buffer.alloc(0) };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, output: 'base\n', error: '', data: Buffer.alloc(0) };
      if (args[0] === 'worktree' && args[1] === 'add') { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return { code: 0, output: '', error: '', data: Buffer.alloc(0) }; }
      return { code: 0, output: '', error: '', data: Buffer.alloc(0) };
    },
  });
  return { root, otherRoot, calls };
}

test('ensureIsolation: 같은 레포면 양쪽 config를 워크트리 경로로 스왑하고 노트를 돌려준다', async t => {
  const { root } = isolationSetup(t, { sameRoot: true });
  const config = { workspacePath: root };
  const agentConfigs = { codex: config, claude: { workspacePath: root } };
  const events = [];
  const note = await worktree.ensureIsolation({ conversationId: 'c1', agent: 'codex', config, agentConfigs, emit: e => events.push(e) });
  assert.match(note, /격리/);
  assert.notEqual(config.workspacePath, root);
  assert.notEqual(agentConfigs.claude.workspacePath, root);
  assert.notEqual(config.workspacePath, agentConfigs.claude.workspacePath); // 슬롯별 별도 워크트리
  const state = events.find(e => e.type === 'worktreeState');
  assert.ok(state && state.worktrees.codex.path === config.workspacePath);
});

test('ensureIsolation: 레포가 다르면 아무것도 바꾸지 않는다', async t => {
  const { root, otherRoot } = isolationSetup(t, { sameRoot: false });
  const config = { workspacePath: root };
  const agentConfigs = { codex: config, claude: { workspacePath: otherRoot } };
  const note = await worktree.ensureIsolation({ conversationId: 'c1', agent: 'codex', config, agentConfigs, emit: () => {} });
  assert.equal(note, '');
  assert.equal(config.workspacePath, root);
});

test('ensureIsolation: 생성 실패는 warning emit 후 빈 문자열(런은 계속)', async t => {
  const root = tmpDir(t, 'triad-wt-root-');
  worktree.configure({
    userDataDir: tmpDir(t, 'triad-wt-data-'),
    runGitImpl: async (args, cwd) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, output: root + '\n', error: '', data: Buffer.alloc(0) };
      if (args[0] === 'worktree' && args[1] === 'add') return { code: 128, output: '', error: 'fatal: disk full', data: Buffer.alloc(0) };
      return { code: 0, output: '', error: '', data: Buffer.alloc(0) };
    },
  });
  const config = { workspacePath: root };
  const events = [];
  const note = await worktree.ensureIsolation({ conversationId: 'c1', agent: 'codex', config, agentConfigs: { codex: config, claude: { workspacePath: root } }, emit: e => events.push(e) });
  assert.equal(note, '');
  assert.equal(config.workspacePath, root); // 원본 유지
  assert.ok(events.some(e => e.type === 'worktreeWarning' && /disk full/.test(e.message)));
});

test('ensureIsolation: 동시 호출도 슬롯당 워크트리를 한 번만 만든다(직렬화)', async t => {
  const { root, calls } = isolationSetup(t, { sameRoot: true });
  const mk = agent => worktree.ensureIsolation({ conversationId: 'c1', agent, config: { workspacePath: root }, agentConfigs: { codex: { workspacePath: root }, claude: { workspacePath: root } }, emit: () => {} });
  await Promise.all([mk('codex'), mk('claude')]);
  const adds = calls.filter(c => c.args[0] === 'worktree' && c.args[1] === 'add');
  assert.equal(adds.length, 2); // codex용 1 + claude용 1 (4가 아님)
});

async function adoptSetup(t, applyResult, diffData = Buffer.from('diff --git a/f b/f\n')) {
  const root = tmpDir(t, 'triad-wt-root-');
  const calls = [];
  worktree.configure({
    userDataDir: tmpDir(t, 'triad-wt-data-'),
    runGitImpl: async (args, cwd, input) => {
      calls.push({ args, cwd, input });
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, output: root + '\n', error: '', data: Buffer.alloc(0) };
      if (args[0] === 'worktree' && args[1] === 'add') { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return { code: 0, output: '', error: '', data: Buffer.alloc(0) }; }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, output: 'headsha\n', error: '', data: Buffer.alloc(0) };
      if (args[0] === 'diff' && args.includes('--binary')) return { code: 0, output: diffData.toString(), error: '', data: diffData };
      if (args[0] === 'apply') return applyResult;
      if (args[0] === 'ls-files' && args.includes('-u')) return { code: 0, output: '100644 abc 1\tsrc/conflict.js\n100644 def 2\tsrc/conflict.js\n', error: '', data: Buffer.alloc(0) };
      return { code: 0, output: '', error: '', data: Buffer.alloc(0) };
    },
  });
  await worktree.ensure('c1', 'codex', root);
  return { root, calls };
}

test('adopt: 패치를 원본에 --3way로 적용하고 워크트리를 정리한다', async t => {
  const { root, calls } = await adoptSetup(t, { code: 0, output: '', error: '', data: Buffer.alloc(0) });
  const result = await worktree.adopt('c1', 'codex');
  assert.deepEqual(result, { applied: true, empty: false, conflicts: [] });
  const apply = calls.find(c => c.args[0] === 'apply');
  assert.ok(apply.args.includes('--3way'));
  assert.equal(apply.cwd, root);           // 원본에서 적용
  assert.ok(apply.input && apply.input.length); // 패치는 stdin으로
  assert.equal(worktree._registry()['c1:codex'], undefined); // 채택 후 레지스트리 정리
});

test('adopt: 3way 충돌이면 충돌 파일 목록을 돌려주고 정리한다', async t => {
  await adoptSetup(t, { code: 1, output: '', error: 'Applied patch to src/conflict.js with conflicts.', data: Buffer.alloc(0) });
  const result = await worktree.adopt('c1', 'codex');
  assert.equal(result.applied, true);
  assert.deepEqual(result.conflicts, ['src/conflict.js']);
});

test('adopt: 델타가 비어 있으면 적용 없이 정리만 한다', async t => {
  const { calls } = await adoptSetup(t, { code: 0, output: '', error: '', data: Buffer.alloc(0) }, Buffer.alloc(0));
  const result = await worktree.adopt('c1', 'codex');
  assert.equal(result.empty, true);
  assert.ok(!calls.some(c => c.args[0] === 'apply'));
});

test('discard: 워크트리 제거·브랜치 삭제·레지스트리 정리', async t => {
  const { calls } = await adoptSetup(t, { code: 0, output: '', error: '', data: Buffer.alloc(0) });
  assert.equal(await worktree.discard('c1', 'codex'), true);
  assert.ok(calls.some(c => c.args[0] === 'worktree' && c.args[1] === 'remove'));
  assert.ok(calls.some(c => c.args[0] === 'branch' && c.args[1] === '-D'));
  assert.equal(worktree._registry()['c1:codex'], undefined);
  assert.equal(await worktree.discard('c1', 'codex'), false); // 이미 없음
});

test('gcOrphans: 디렉토리가 사라진 항목을 레지스트리에서 걷어낸다', async t => {
  await adoptSetup(t, { code: 0, output: '', error: '', data: Buffer.alloc(0) });
  const entry = worktree._registry()['c1:codex'];
  fs.rmSync(entry.path, { recursive: true, force: true });
  await worktree.gcOrphans();
  assert.equal(worktree._registry()['c1:codex'], undefined);
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