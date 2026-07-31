const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const worktree = require('../electron/lib/worktree.js');

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }
function hasGit() { try { execFileSync('git', ['--version']); return true; } catch { return false; } }

test('통합: 생성→편집→채택이 원본 작업 카피에 델타만 얹는다', { skip: !hasGit() }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-wt-int-'));
  t.after(() => { try { git(root, 'worktree', 'prune'); } catch { /* 정리 실패 무시 */ } fs.rmSync(root, { recursive: true, force: true }); });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-wt-int-data-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  git(root, 'init'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'app.js'), 'line1\nline2\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'init');
  // 사용자 dirty 상태: tracked 수정 + untracked 파일
  fs.writeFileSync(path.join(root, 'app.js'), 'line1-edited\nline2\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'user note\n');
  worktree.configure({ userDataDir: dataDir, gitBin: 'git' });

  const config = { workspacePath: root };
  const agentConfigs = { codex: config, claude: { workspacePath: root } };
  const note = await worktree.ensureIsolation({ conversationId: 'int1', agent: 'codex', config, agentConfigs, emit: () => {} });
  assert.match(note, /격리/);
  const wt = config.workspacePath;
  assert.notEqual(wt, root);
  // dirty 스냅샷이 워크트리에 있다
  assert.match(fs.readFileSync(path.join(wt, 'app.js'), 'utf8'), /line1-edited/);
  assert.equal(fs.readFileSync(path.join(wt, 'notes.txt'), 'utf8'), 'user note\n');

  // 에이전트 작업 시뮬레이션: 기존 파일 수정 + 새 파일
  fs.writeFileSync(path.join(wt, 'app.js'), 'line1-edited\nline2\nagent-line\n');
  fs.writeFileSync(path.join(wt, 'agent.js'), 'new file\n');

  const result = await worktree.adopt('int1', 'codex');
  assert.deepEqual(result, { applied: true, empty: false, conflicts: [] });
  // 원본: 에이전트 델타 반영 + 사용자 dirty/untracked 그대로 + 브랜치·히스토리 무변화
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'line1-edited\nline2\nagent-line\n');
  assert.equal(fs.readFileSync(path.join(root, 'agent.js'), 'utf8'), 'new file\n');
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'user note\n');
  assert.equal(git(root, 'rev-list', '--count', 'HEAD').trim(), '1'); // 커밋 안 생김
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), ''); // 스테이징 무변화
  assert.ok(!fs.existsSync(wt)); // 채택 후 워크트리 정리
  assert.match(git(root, 'branch', '--list', 'triad/*codex*'), /^\s*$/); // codex 브랜치 정리
  assert.match(git(root, 'branch', '--list', 'triad/*claude*'), /claude/); // 채택 안 한 claude 워크트리는 유지
});

test('통합: 원본과 워크트리가 같은 줄을 다르게 고치면 충돌 마커가 남는다', { skip: !hasGit() }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-wt-int2-'));
  t.after(() => { try { git(root, 'worktree', 'prune'); } catch { /* 정리 실패 무시 */ } fs.rmSync(root, { recursive: true, force: true }); });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-wt-int2-data-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  git(root, 'init'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'f.txt'), 'original\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'init');
  worktree.configure({ userDataDir: dataDir, gitBin: 'git' });
  const config = { workspacePath: root };
  await worktree.ensureIsolation({ conversationId: 'int2', agent: 'codex', config, agentConfigs: { codex: config, claude: { workspacePath: root } }, emit: () => {} });
  fs.writeFileSync(path.join(config.workspacePath, 'f.txt'), 'agent version\n');   // 워크트리 쪽
  fs.writeFileSync(path.join(root, 'f.txt'), 'user version\n');                     // 그 사이 사용자도 수정
  const result = await worktree.adopt('int2', 'codex');
  assert.equal(result.applied, true);
  assert.deepEqual(result.conflicts, ['f.txt']);
  assert.match(fs.readFileSync(path.join(root, 'f.txt'), 'utf8'), /<<<<<<</);
});
