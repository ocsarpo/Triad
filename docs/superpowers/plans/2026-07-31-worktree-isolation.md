# 슬롯별 git-worktree 격리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 두 슬롯이 같은 git 레포를 물면 각자 격리 워크트리에서 작업하고, 사용자가 diff 패널에서 채택/폐기로 원본 반영을 결정한다.

**Architecture:** 감지·생성·경로 스왑은 전부 메인 프로세스 — 모든 실행 경로(직접 전송·큐·재시도·대화·검토)가 `main.js runAgent()` 한 곳으로 수렴하므로 거기서 `config.workspacePath`/`request.agentConfigs[*].workspacePath`를 in-place 교체하면 spawn cwd(`main.js:344`), codex `--cd`(`main.js:258`), MCP 헬퍼 설정(`broker.js:61-102` → `triad-mcp-server.cjs:121,176`)에 자동으로 흐른다. 렌더러는 `worktreeState` 이벤트를 받아 배지·diff 경로·채택/폐기 버튼만 표시한다. 채택은 베이스라인 커밋 대비 `git diff --binary` 패치를 원본에 `git apply --3way`.

**Tech Stack:** Electron main (CJS), 순수 Node(`child_process.spawn` git), `node:test` + 실 git 통합 테스트.

> **스펙 대비 변경점(승인된 아키텍처 내 메커니즘 정제):** 스펙은 "렌더러가 디스패치 직전 worktree:ensure IPC 후 스왑"이라 했으나, 렌더러 dispatchAgent는 동기 함수이고 config 캡처 지점이 3곳+(send 직접/큐 아이템/재시도 pending/대화 flow.settings)이라 누락 위험이 있다. 메인 runAgent는 비동기 가능하고 모든 런이 통과하는 단일 지점이므로 스왑을 여기로 옮긴다. 감지 주체(메인)·스왑 결과의 전파(주 실행+헬퍼)·UI(배지/diff/채택)는 스펙 그대로. Task 7에서 스펙 문서에 이 정제를 반영한다.

## Global Constraints

- 버전 범프·릴리스 없음(커밋만). 커밋 메시지는 저장소 관례(한국어, `feat:`/`test:`/`docs:` 접두)를 따른다.
- 사용자향 문자열은 한국어. 렌더러 diff 패널은 기존처럼 raw 한국어 사용(예: `index.html:1033` '변경 사항 닫기').
- `electron/lib/worktree.js`는 electron 모듈 import 금지(테스트에서 순수 require 가능해야 함). 의존성은 `configure()` 주입.
- 코드 스타일: 이 저장소의 밀도 높은 스타일과 한국어 주석 관례를 따른다. 주석은 코드로 표현 못 하는 제약만.
- 테스트 실행: `node --test Tests/<file>.test.cjs`.
- 워크트리 위치: `<userData>/worktrees/<repoHash8>/<convKey>-<slot>`, 브랜치 `triad/<convKey>-<slot>`. 사용자 레포 내부 오염 금지.
- 격리 실패는 절대 런을 막지 않는다(reactive 철학): 경고 emit 후 원본에서 진행.

---

### Task 1: worktree.js 골격 — configure/레지스트리/루트 해석

**Files:**
- Create: `electron/lib/worktree.js`
- Test: `Tests/worktree.test.cjs`

**Interfaces:**
- Consumes: 없음 (신규 모듈)
- Produces:
  - `configure({ userDataDir?, gitBin?, runGitImpl? })` — 의존성 주입. `runGitImpl(args, cwd, input?) → Promise<{code,output,error,data}>` (테스트 전용 오버라이드)
  - `resolveRoot(workspace: string) → Promise<string|null>` — git 레포 루트 or null
  - `_registry()` — 테스트용 현재 레지스트리 객체 반환
  - 내부: `loadRegistry()/saveRegistry()` (userData/worktrees.json), `runGit(args,cwd,input)` (git-ops.js:17-38 미러 + stdin input 지원)

- [ ] **Step 1: 실패하는 테스트 작성**

`Tests/worktree.test.cjs`:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: FAIL — `Cannot find module '../electron/lib/worktree.js'`

- [ ] **Step 3: 최소 구현**

`electron/lib/worktree.js`:

```js
'use strict';

// 슬롯별 git-worktree 격리: 두 슬롯이 같은 레포를 물면 각자 워크트리에서 작업하고
// 사용자 채택(git apply --3way)으로만 원본에 반영한다.
// 스펙: docs/superpowers/specs/2026-07-30-worktree-isolation-design.md

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const settings = { userDataDir: path.join(os.tmpdir(), 'triad-worktrees'), gitBin: 'git' };
let runGitImpl = runGit;
let registry = null;

function configure(options = {}) {
  if (options.userDataDir) settings.userDataDir = options.userDataDir;
  if (options.gitBin) settings.gitBin = options.gitBin;
  if (options.runGitImpl) runGitImpl = options.runGitImpl;
  registry = null; // 위치가 바뀌었을 수 있으니 다음 접근 때 다시 읽는다
}

// git-ops.js runGit 미러 + 패치 스트리밍용 stdin input 지원.
function runGit(args, cwd, input = null) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(settings.gitBin, args, { cwd }); }
    catch (error) { resolve({ code: -1, output: '', error: (error && error.message) || 'git 실행 실패', data: Buffer.alloc(0) }); return; }
    const stdoutChunks = []; const stderrChunks = [];
    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));
    child.on('error', error => resolve({ code: -1, output: '', error: (error && error.message) || 'git 실행 실패', data: Buffer.alloc(0) }));
    child.on('close', code => {
      const stdout = Buffer.concat(stdoutChunks);
      resolve({ code: code == null ? -1 : code, output: stdout.toString('utf8'), error: Buffer.concat(stderrChunks).toString('utf8'), data: stdout });
    });
    try { if (input) child.stdin.write(input); child.stdin.end(); } catch { /* 파이프가 먼저 닫혀도 close에서 정리 */ }
  });
}

function registryPath() { return path.join(settings.userDataDir, 'worktrees.json'); }
function loadRegistry() {
  if (registry) return registry;
  try { registry = JSON.parse(fs.readFileSync(registryPath(), 'utf8')) || {}; } catch { registry = {}; }
  return registry;
}
function saveRegistry() {
  fs.mkdirSync(settings.userDataDir, { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(loadRegistry(), null, 2));
}

async function resolveRoot(workspace) {
  const dir = typeof workspace === 'string' ? workspace.trim() : '';
  if (!dir) return null;
  let stat = null; try { stat = fs.statSync(dir); } catch { return null; }
  if (!stat.isDirectory()) return null;
  const result = await runGitImpl(['rev-parse', '--show-toplevel'], dir);
  const root = result.output.trim();
  return result.code === 0 && root ? root : null;
}

module.exports = {
  configure, resolveRoot,
  _registry: loadRegistry, _saveRegistry: saveRegistry,
};
```

- [ ] **Step 4: 통과 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add electron/lib/worktree.js Tests/worktree.test.cjs
git commit -m "feat: worktree 격리 모듈 골격 — 레지스트리·레포 루트 해석"
```

---

### Task 2: ensure() — 워크트리 생성·dirty 스냅샷·베이스라인

**Files:**
- Modify: `electron/lib/worktree.js`
- Test: `Tests/worktree.test.cjs` (추가)

**Interfaces:**
- Consumes: Task 1의 `runGitImpl`, `loadRegistry/saveRegistry`, `settings`
- Produces:
  - `ensure(conversationId, slot, root) → Promise<entry & {created: boolean}>` — entry = `{ conversationId, slot, root, path, branch, baseline, createdAt }`. 실패 시 throw.
  - 내부 `convKey(conversationId)`, `repoHash(root)`, `gitIdentity(args)`

- [ ] **Step 1: 실패하는 테스트 추가**

`Tests/worktree.test.cjs`에 추가:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: FAIL — `worktree.ensure is not a function`

- [ ] **Step 3: 구현**

`worktree.js`의 `resolveRoot` 아래에 추가, exports에 `ensure` 추가:

```js
// 대화 id에서 파일시스템/브랜치 안전한 짧은 키 — 앞 8자 + 전체 해시 4자로
// 접두 충돌(다른 대화가 같은 8자로 시작)까지 방어한다.
function convKey(conversationId) {
  const clean = String(conversationId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'conv';
  const tail = crypto.createHash('sha1').update(String(conversationId || '')).digest('hex').slice(0, 4);
  return `${clean}-${tail}`;
}
function repoHash(root) { return crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 8); }
function gitIdentity(args) { return ['-c', 'user.name=Triad', '-c', 'user.email=triad@app.local', ...args]; }

async function ensure(conversationId, slot, root) {
  const reg = loadRegistry();
  const key = `${conversationId}:${slot}`;
  const existing = reg[key];
  if (existing && existing.root === root && fs.existsSync(path.join(existing.path, '.git'))) return { ...existing, created: false };
  const short = convKey(conversationId);
  const dir = path.join(settings.userDataDir, 'worktrees', repoHash(root), `${short}-${slot}`);
  const branch = `triad/${short}-${slot}`;
  // 크래시 잔재 청소 — 없으면 조용히 실패하는 게 정상
  await runGitImpl(['worktree', 'remove', '--force', dir], root);
  fs.rmSync(dir, { recursive: true, force: true });
  await runGitImpl(['worktree', 'prune'], root);
  await runGitImpl(['branch', '-D', branch], root);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const add = await runGitImpl(['worktree', 'add', dir, '-b', branch, 'HEAD'], root);
  if (add.code !== 0) throw new Error((add.error || '').trim() || 'git worktree add 실패');
  // dirty 스냅샷: tracked는 stash create(원본 무접촉), untracked는 파일 복사.
  // stash create는 untracked를 포함하지 않으므로 복사 단계는 생략 불가.
  const stash = await runGitImpl(['stash', 'create', 'triad snapshot'], root);
  const snapshot = stash.output.trim();
  if (snapshot) await runGitImpl(['stash', 'apply', snapshot], dir);
  const untracked = await runGitImpl(['ls-files', '--others', '--exclude-standard', '-z'], root);
  for (const rel of untracked.output.split(String.fromCharCode(0)).filter(Boolean)) {
    try {
      const to = path.join(dir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(root, rel), to);
    } catch { /* 개별 파일 복사 실패는 스냅샷 불완전으로 넘어간다 */ }
  }
  // 베이스라인: 워크트리 브랜치 안에서만 커밋 — 이후 에이전트 델타의 기준점.
  // --allow-empty로 깨끗한 레포에서도 기준 커밋을 보장한다.
  await runGitImpl(['add', '-A'], dir);
  await runGitImpl(gitIdentity(['commit', '--no-verify', '--allow-empty', '-m', 'triad: baseline (사용자 스냅샷)']), dir);
  const baseline = (await runGitImpl(['rev-parse', 'HEAD'], dir)).output.trim();
  reg[key] = { conversationId, slot, root, path: dir, branch, baseline, createdAt: Date.now() };
  saveRegistry();
  return { ...reg[key], created: true };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add electron/lib/worktree.js Tests/worktree.test.cjs
git commit -m "feat: worktree ensure — 생성·dirty 스냅샷·베이스라인 커밋"
```

---

### Task 3: ensureIsolation() — 감지·스왑·직렬화·프롬프트 노트

**Files:**
- Modify: `electron/lib/worktree.js`
- Test: `Tests/worktree.test.cjs` (추가)

**Interfaces:**
- Consumes: Task 1-2의 `resolveRoot`, `ensure`
- Produces:
  - `ensureIsolation({ conversationId, agent, config, agentConfigs, emit }) → Promise<string>` — 격리 시 `config.workspacePath`와 `agentConfigs[codex|claude].workspacePath`를 **in-place 교체**하고 프롬프트 노트 문자열 반환. 비격리/실패 시 `''`. 절대 throw하지 않음. 실패 시 `emit({type:'worktreeWarning',...})`.
  - emit 이벤트: `{ type:'worktreeState', conversationId, worktrees: { codex?: {path,branch,root,createdAt}|null, claude?: ... } }`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: FAIL — `worktree.ensureIsolation is not a function`

- [ ] **Step 3: 구현**

```js
const OTHER = { codex: 'claude', claude: 'codex' };
function publicEntry(entry) { return { path: entry.path, branch: entry.branch, root: entry.root, createdAt: entry.createdAt }; }

// send()가 두 슬롯을 같은 틱에 디스패치하므로 ensure 경합을 전역 체인으로 직렬화.
let chain = Promise.resolve();
function serialized(work) {
  const next = chain.then(work, work);
  chain = next.then(() => {}, () => {});
  return next;
}

async function ensureIsolation({ conversationId, agent, config, agentConfigs, emit }) {
  try {
    if (!conversationId || !config || !OTHER[agent]) return '';
    const other = OTHER[agent];
    const wsSelf = typeof config.workspacePath === 'string' ? config.workspacePath : '';
    const wsOther = typeof agentConfigs?.[other]?.workspacePath === 'string' ? agentConfigs[other].workspacePath : '';
    if (!wsSelf || !wsOther) return '';
    const rootSelf = await resolveRoot(wsSelf);
    if (!rootSelf) return '';
    if (await resolveRoot(wsOther) !== rootSelf) return '';
    const { mine, theirs } = await serialized(async () => ({
      mine: await ensure(conversationId, agent, rootSelf),
      theirs: await ensure(conversationId, other, rootSelf),
    }));
    config.workspacePath = mine.path;
    if (agentConfigs?.[agent]) agentConfigs[agent].workspacePath = mine.path;
    if (agentConfigs?.[other]) agentConfigs[other].workspacePath = theirs.path;
    if (typeof emit === 'function') emit({ type: 'worktreeState', conversationId, worktrees: { [agent]: publicEntry(mine), [other]: publicEntry(theirs) } });
    return `\n\n[작업 환경 — 격리 워크트리] 이 실행은 원본 폴더(${rootSelf}) 보호를 위해 격리 git 워크트리(${mine.path}, 브랜치 ${mine.branch})에서 진행됩니다.${mine.created ? ' 워크트리는 방금 원본의 최신 상태(커밋 전 변경 포함) 기준으로 준비되었습니다.' : ''} 파일 변경은 워크트리에만 기록되고, 사용자가 '채택'하면 원본에 반영됩니다. 경로 차이는 신경 쓰지 말고 평소처럼 작업하세요.`;
  } catch (error) {
    if (typeof emit === 'function') emit({ type: 'worktreeWarning', conversationId, agent, message: `격리 실패 — 원본에서 직접 작업합니다: ${(error && error.message) || error}` });
    return '';
  }
}
```

exports에 `ensureIsolation` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add electron/lib/worktree.js Tests/worktree.test.cjs
git commit -m "feat: ensureIsolation — 같은 레포 감지 시 슬롯별 워크트리로 경로 스왑"
```

---

### Task 4: adopt/discard/cleanupConversation/gcOrphans

**Files:**
- Modify: `electron/lib/worktree.js`
- Test: `Tests/worktree.test.cjs` (추가)

**Interfaces:**
- Consumes: Task 1-3 전부
- Produces:
  - `adopt(conversationId, slot) → Promise<{applied:boolean, empty:boolean, conflicts:string[]}>` — 성공/충돌-포함-성공 후 워크트리 폐기까지 수행. 전체 적용 불가면 throw(원본 무변경, 워크트리 유지).
  - `discard(conversationId, slot) → Promise<boolean>`
  - `cleanupConversation(conversationId) → Promise<void>`
  - `gcOrphans() → Promise<void>` — 디렉토리가 사라진 레지스트리 항목 정리 + `git worktree prune`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
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
      if (args[0] === 'diff' && args.includes('--diff-filter=U')) return { code: 0, output: 'src/conflict.js\n', error: '', data: Buffer.alloc(0) };
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
  const { root, calls } = await adoptSetup(t, { code: 0, output: '', error: '', data: Buffer.alloc(0) });
  assert.equal(await worktree.discard('c1', 'codex'), true);
  assert.ok(calls.some(c => c.args[0] === 'worktree' && c.args[1] === 'remove'));
  assert.ok(calls.some(c => c.args[0] === 'branch' && c.args[1] === '-D'));
  assert.equal(worktree._registry()['c1:codex'], undefined);
  assert.equal(await worktree.discard('c1', 'codex'), false); // 이미 없음
});

test('gcOrphans: 디렉토리가 사라진 항목을 레지스트리에서 걷어낸다', async t => {
  const { } = await adoptSetup(t, { code: 0, output: '', error: '', data: Buffer.alloc(0) });
  const entry = worktree._registry()['c1:codex'];
  fs.rmSync(entry.path, { recursive: true, force: true });
  await worktree.gcOrphans();
  assert.equal(worktree._registry()['c1:codex'], undefined);
});
```

첫 테스트의 `assert.deepEqual` 줄은 오타 방지를 위해 다음으로 쓴다: `assert.deepEqual(result, { applied: true, empty: false, conflicts: [] });`

- [ ] **Step 2: 실패 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: FAIL — `worktree.adopt is not a function`

- [ ] **Step 3: 구현**

```js
async function adopt(conversationId, slot) {
  const reg = loadRegistry();
  const entry = reg[`${conversationId}:${slot}`];
  if (!entry) throw new Error('격리 워크트리가 없습니다.');
  // 현재 상태 봉인 → 베이스라인 대비 델타만 패치로 뽑는다(사용자 dirty 스냅샷은
  // 베이스라인 안에 있으므로 중복 반영되지 않는다).
  await runGitImpl(['add', '-A'], entry.path);
  await runGitImpl(gitIdentity(['commit', '--no-verify', '--allow-empty', '-m', `triad: ${slot} 작업 채택`]), entry.path);
  const head = (await runGitImpl(['rev-parse', 'HEAD'], entry.path)).output.trim();
  const diff = await runGitImpl(['diff', '--binary', `${entry.baseline}..${head}`], entry.path);
  if (!diff.data.length) { await discard(conversationId, slot); return { applied: false, empty: true, conflicts: [] }; }
  const apply = await runGitImpl(['apply', '--3way', '--whitespace=nowarn'], entry.root, diff.data);
  if (apply.code !== 0) {
    const unmerged = await runGitImpl(['diff', '--name-only', '--diff-filter=U'], entry.root);
    const conflicts = unmerged.output.split('\n').filter(Boolean);
    // 충돌 파일도 안 남았으면 아예 적용 실패 — 원본 무변경, 워크트리 보존.
    if (!conflicts.length) throw new Error(`패치를 적용하지 못했습니다: ${(apply.error || '').trim().slice(0, 400)}`);
    await discard(conversationId, slot);
    return { applied: true, empty: false, conflicts };
  }
  await discard(conversationId, slot);
  return { applied: true, empty: false, conflicts: [] };
}

async function discard(conversationId, slot) {
  const reg = loadRegistry();
  const key = `${conversationId}:${slot}`;
  const entry = reg[key];
  if (!entry) return false;
  await runGitImpl(['worktree', 'remove', '--force', entry.path], entry.root);
  fs.rmSync(entry.path, { recursive: true, force: true });
  await runGitImpl(['worktree', 'prune'], entry.root);
  await runGitImpl(['branch', '-D', entry.branch], entry.root);
  delete reg[key];
  saveRegistry();
  return true;
}

async function cleanupConversation(conversationId) {
  const reg = loadRegistry();
  for (const key of Object.keys(reg)) {
    if (reg[key].conversationId === conversationId) await discard(conversationId, reg[key].slot);
  }
}

async function gcOrphans() {
  const reg = loadRegistry();
  for (const key of Object.keys(reg)) {
    const entry = reg[key];
    if (fs.existsSync(path.join(entry.path, '.git'))) continue;
    await runGitImpl(['worktree', 'prune'], entry.root);
    delete reg[key];
  }
  saveRegistry();
}
```

exports에 `adopt, discard, cleanupConversation, gcOrphans` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --test Tests/worktree.test.cjs`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add electron/lib/worktree.js Tests/worktree.test.cjs
git commit -m "feat: worktree 채택(apply --3way)·폐기·대화 정리·고아 GC"
```

---

### Task 5: main.js 배선 — 스왑·프롬프트 노트·IPC 액션·GC

**Files:**
- Modify: `electron/main.js`
- Test: `Tests/worktree-static.test.cjs` (생성)

**Interfaces:**
- Consumes: worktree.js 전체 공개 API
- Produces: IPC 액션 `worktreeAdopt`/`worktreeDiscard` (payload: `{action, conversationId, agent}`), emit 이벤트 `worktreeState`/`worktreeWarning`/`worktreeAdoptResult`/`worktreeDiscardResult`/`worktreeError` — Task 6 렌더러가 소비.

- [ ] **Step 1: 실패하는 정적 테스트 작성**

`Tests/worktree-static.test.cjs` (이 저장소의 *-static 관례: 소스 문자열로 배선 회귀 검증):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');

test('runAgent는 async로 격리 스왑을 기다린 뒤 spawn한다', () => {
  assert.match(main, /async function runAgent\(/);
  assert.match(main, /await worktree\.ensureIsolation\(/);
  // 스왑은 workspace 읽기(line: config.workspacePath → workspace)보다 앞서야 한다
  assert.ok(main.indexOf('await worktree.ensureIsolation(') < main.indexOf("stringOrDefault(config.workspacePath"));
  // await 후 슬롯 busy 재확인 (async 재진입 방어)
  const after = main.slice(main.indexOf('await worktree.ensureIsolation('));
  assert.match(after, /running\.has\(slotId\)/);
});

test('격리 노트는 이미지 프롬프트 재조립 이후에 덧붙는다', () => {
  assert.ok(main.indexOf('promptToSend += isolationNote') > main.indexOf('[첨부 이미지]'));
});

test('worktreeAdopt/worktreeDiscard 액션과 대화 삭제 정리·부팅 GC가 배선돼 있다', () => {
  assert.match(main, /case 'worktreeAdopt': return void worktreeAdoptAction\(payload\);/);
  assert.match(main, /case 'worktreeDiscard': return void worktreeDiscardAction\(payload\);/);
  assert.match(main, /case 'deleteConversation': void worktree\.cleanupConversation\(/);
  assert.match(main, /worktree\.configure\(\{ userDataDir: app\.getPath\('userData'\), gitBin: platform\.gitBin\(\) \}\)/);
  assert.match(main, /void worktree\.gcOrphans\(\)/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test Tests/worktree-static.test.cjs`
Expected: FAIL (3 tests 모두)

- [ ] **Step 3: main.js 수정 (5곳)**

(a) require 블록(다른 `require('./lib/...')` 옆)에:

```js
const worktree = require('./lib/worktree');
```

(b) `function runAgent(request) {` (main.js:193) → `async function runAgent(request) {`로 바꾸고, executable 검증 블록(main.js:214-218)과 `const workspace = ...`(main.js:220) 사이에 삽입:

```js
  // 같은-레포 충돌 격리: 모든 실행 경로가 이 지점을 지나므로 여기서 한 번만
  // 스왑하면 spawn cwd·codex --cd·MCP 헬퍼(agentConfigs)가 전부 워크트리를 본다.
  const isolationNote = await worktree.ensureIsolation({
    conversationId, agent, config,
    agentConfigs: util.dictOrNil(request.agentConfigs), emit,
  });
  if (running.has(slotId)) { emit(meta({ type: 'error', message: M('busy') })); return; }
```

(c) 이미지 처리로 `promptToSend`가 재조립된 뒤, `const env = Object.assign({}, process.env);`(main.js:320) 바로 위에:

```js
  if (isolationNote) promptToSend += isolationNote;
```

(d) 액션 스위치(main.js:495-523): `case 'deleteConversation'` 교체 + 케이스 2개 추가:

```js
    case 'deleteConversation': void worktree.cleanupConversation(util.stringOrNil(payload.id) || ''); return conversationStore.deleteConversation(payload.id);
    case 'worktreeAdopt': return void worktreeAdoptAction(payload);
    case 'worktreeDiscard': return void worktreeDiscardAction(payload);
```

액션 핸들러는 `stopAgent` 아래(main.js:373 근처)에:

```js
async function worktreeAdoptAction(payload) {
  const conversationId = util.stringOrNil(payload.conversationId) || '';
  const agent = util.stringOrNil(payload.agent) || '';
  try {
    const result = await worktree.adopt(conversationId, agent);
    emit({ type: 'worktreeAdoptResult', conversationId, agent, applied: result.applied, empty: result.empty, conflicts: result.conflicts });
    emit({ type: 'worktreeState', conversationId, worktrees: { [agent]: null } });
  } catch (error) {
    emit({ type: 'worktreeError', conversationId, agent, message: (error && error.message) || '채택 실패' });
  }
}

async function worktreeDiscardAction(payload) {
  const conversationId = util.stringOrNil(payload.conversationId) || '';
  const agent = util.stringOrNil(payload.agent) || '';
  try {
    await worktree.discard(conversationId, agent);
    emit({ type: 'worktreeDiscardResult', conversationId, agent });
    emit({ type: 'worktreeState', conversationId, worktrees: { [agent]: null } });
  } catch (error) {
    emit({ type: 'worktreeError', conversationId, agent, message: (error && error.message) || '폐기 실패' });
  }
}
```

(e) `app.whenReady().then(...)`(main.js:532)의 콜백 맨 앞에:

```js
worktree.configure({ userDataDir: app.getPath('userData'), gitBin: platform.gitBin() }); void worktree.gcOrphans();
```

주의: `dispatch()`의 `case 'run': return runAgent(payload);`는 그대로 둔다 — 반환값은 사용되지 않고, ensureIsolation은 throw하지 않으므로 unhandled rejection이 없다.

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `node --test Tests/worktree-static.test.cjs && node --test Tests/`
Expected: 신규 3개 PASS, 기존 테스트 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add electron/main.js Tests/worktree-static.test.cjs
git commit -m "feat: runAgent 격리 스왑 배선 — 채택/폐기 액션·대화 정리·부팅 GC"
```

---

### Task 6: 렌더러 — worktreeState 미러·배지·diff 채택/폐기 UI

**Files:**
- Modify: `Resources/index.html`
- Test: `Tests/worktree-static.test.cjs` (추가)

**Interfaces:**
- Consumes: Task 5의 emit 이벤트 5종, IPC 액션 `worktreeAdopt`/`worktreeDiscard`
- Produces: `state.worktrees` (conversationId → slot → {path,branch,root,createdAt}), `activeWorktree(agent)` 헬퍼

- [ ] **Step 1: 실패하는 정적 테스트 추가**

`Tests/worktree-static.test.cjs`에 추가:

```js
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('렌더러가 worktree 이벤트 5종을 처리하고 diff 요청이 워크트리 경로를 우선한다', () => {
  for (const type of ['worktreeState', 'worktreeWarning', 'worktreeAdoptResult', 'worktreeDiscardResult', 'worktreeError']) {
    assert.match(renderer, new RegExp(`event\\.type==='${type}'`));
  }
  assert.match(renderer, /activeWorktree\(agent\)/);
  assert.match(renderer, /wt\?\.path\|\|effectiveWorkspacePath\(agent\)/);
});

test('채택/폐기 버튼이 confirm 후 IPC로 나가고 실행 중엔 비활성화된다', () => {
  assert.match(renderer, /action:'worktreeAdopt'/);
  assert.match(renderer, /action:'worktreeDiscard'/);
  assert.match(renderer, /id="wt-adopt"/);
  assert.match(renderer, /id="wt-discard"/);
  assert.match(renderer, /wt-adopt'\)\.disabled=busy/);
});

test('격리 중엔 workspaceContextLine이 워크트리 상황을 설명하고 슬롯 배지가 있다', () => {
  assert.match(renderer, /서로 다른 격리 워크트리/);
  assert.match(renderer, /id="wt-codex"/);
  assert.match(renderer, /id="wt-claude"/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test Tests/worktree-static.test.cjs`
Expected: 신규 3개 FAIL

- [ ] **Step 3: index.html 수정 (7곳)**

(a) **state 초기화**: `grep -n "pendingImages:\[\]" Resources/index.html`로 state 객체 리터럴을 찾아 같은 리터럴에 `worktrees:{},` 필드 추가.

(b) **헬퍼** — `workspaceContextLine`(697) 위에:

```js
    function activeWorktree(agent){ return state.worktrees?.[state.activeConversationId]?.[agent]||null; }
```

(c) **workspaceContextLine**(697-704) — `if(!mine||!theirs)return '';` 다음 줄에 삽입:

```js
      const conv=state.worktrees?.[state.activeConversationId];
      if(conv?.[agent]&&conv?.[other])return `\n작업 환경: 당신과 ${names[other]}는 같은 저장소(${conv[agent].root})를 서로 다른 격리 워크트리에서 작업합니다(당신: ${conv[agent].path}). 상대 워크트리의 파일 변경은 당신에게 보이지 않는 것이 정상이고, 원본 반영은 사용자의 채택으로 이뤄집니다.`;
```

(d) **refreshProjectDiff**(1026-1029) — post 줄 교체:

```js
      const wt=activeWorktree(agent);
      post({action:'projectDiff',agent,workspace:wt?.path||effectiveWorkspacePath(agent),conversationId:state.activeConversationId});
```

(e) **이벤트 핸들러** — `else if(event.type==='diffResult')`(2328) 위에 삽입:

```js
      else if(event.type==='worktreeState'){
        const current=state.worktrees[event.conversationId]||{};
        for(const [slot,entry] of Object.entries(event.worktrees||{})){ if(entry)current[slot]=entry; else delete current[slot]; }
        if(Object.keys(current).length)state.worktrees[event.conversationId]=current; else delete state.worktrees[event.conversationId];
        if(!isBackgroundRuntime()){renderStatus(false);if(state.diff.visible)renderDiff();}
      }
      else if(event.type==='worktreeWarning'){withConversation(event.conversationId,()=>{addTrace(event.agent||'codex','error','워크트리 격리 실패',event.message||'');addMessage('system',`⚠️ ${event.message||'격리 실패 — 원본에서 직접 작업합니다.'}`);save();});}
      else if(event.type==='worktreeAdoptResult'){withConversation(event.conversationId,()=>{
        const who=names[event.agent]||event.agent;
        if(event.empty)addMessage('system',`🌿 ${who}의 워크트리에 채택할 변경이 없어 정리만 했습니다.`);
        else if(event.conflicts?.length)addMessage('system',`🌿 ${who}의 작업을 원본에 채택했지만 ${event.conflicts.length}개 파일에서 충돌이 났습니다. 충돌 마커(<<<<<<<)를 확인해 정리하세요:\n${event.conflicts.join('\n')}`);
        else addMessage('system',`🌿 ${who}의 작업을 원본 작업 폴더에 채택했습니다. 변경 사항을 확인한 뒤 평소처럼 커밋하세요.`);
        save();});refreshProjectDiff(event.agent);}
      else if(event.type==='worktreeDiscardResult'){withConversation(event.conversationId,()=>{addMessage('system',`🌿 ${names[event.agent]||event.agent}의 격리 워크트리를 폐기했습니다.`);save();});refreshProjectDiff(event.agent);}
      else if(event.type==='worktreeError'){withConversation(event.conversationId,()=>{addMessage('system',`⚠️ 워크트리 작업 실패: ${event.message||''}`);save();});}
```

(f) **배지** — 마크업에서 `id="summary-codex"`/`id="summary-claude"`를 찾아 각 요소 바로 뒤에 `<span id="wt-codex" class="wt-badge" hidden>🌿</span>` / `<span id="wt-claude" class="wt-badge" hidden>🌿</span>` 추가. `renderStatus`(2340-2344)의 for 루프 안에 추가:

```js
        const wtBadge=document.getElementById(`wt-${agent}`);
        if(wtBadge){const wt=activeWorktree(agent);wtBadge.hidden=!wt;if(wt)wtBadge.title=`격리 워크트리에서 작업 중\n${wt.path}\n브랜치 ${wt.branch}`;}
```

CSS(`<style>` 블록 diff 관련 규칙 근처): `.wt-badge{font-size:12px;margin-left:4px;cursor:help;}`

(g) **diff 패널 채택/폐기** — 마크업에서 `id="diff-agent"` select 근처(diff 패널 헤더)에 추가:

```html
<span id="wt-actions" hidden><button id="wt-adopt" title="워크트리 변경을 원본 작업 폴더에 반영">🌿 채택</button><button id="wt-discard" title="워크트리 변경을 모두 버림">폐기</button></span>
```

`renderDiff`(1030) 도입부 `document.getElementById('diff-agent').value=state.diff.agent;` 다음에:

```js
      const wtActions=document.getElementById('wt-actions');
      if(wtActions){const wt=activeWorktree(state.diff.agent);wtActions.hidden=!wt;const busy=!!state.running[state.diff.agent];document.getElementById('wt-adopt').disabled=busy;document.getElementById('wt-discard').disabled=busy;}
```

클릭 배선 — 다른 버튼 onclick들이 묶인 부트 구간(`grep -n "diff-toggle').onclick" Resources/index.html`로 위치 확인) 옆에:

```js
    document.getElementById('wt-adopt').onclick=()=>{const agent=state.diff.agent;if(!activeWorktree(agent)||state.running[agent])return;if(!confirm(`${names[agent]}의 워크트리 변경을 원본 작업 폴더에 채택할까요?`))return;post({action:'worktreeAdopt',conversationId:state.activeConversationId,agent});};
    document.getElementById('wt-discard').onclick=()=>{const agent=state.diff.agent;if(!activeWorktree(agent)||state.running[agent])return;if(!confirm(`${names[agent]}의 워크트리 변경을 모두 버릴까요? 되돌릴 수 없습니다.`))return;post({action:'worktreeDiscard',conversationId:state.activeConversationId,agent});};
```

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `node --test Tests/worktree-static.test.cjs && node --test Tests/`
Expected: 전부 PASS (기존 static 테스트 중 index.html 문자열을 검사하는 것들이 있으므로 전체 실행 필수)

- [ ] **Step 5: 커밋**

```bash
git add Resources/index.html Tests/worktree-static.test.cjs
git commit -m "feat: 워크트리 격리 UI — 슬롯 배지·diff 채택/폐기·격리 컨텍스트 라인"
```

---

### Task 7: 실 git 통합 테스트 + 스펙 문서 정합화

**Files:**
- Test: `Tests/worktree-integration.test.cjs` (생성)
- Modify: `docs/superpowers/specs/2026-07-30-worktree-isolation-design.md`

**Interfaces:**
- Consumes: worktree.js 공개 API 전부 (진짜 git으로)

- [ ] **Step 1: 통합 테스트 작성**

`Tests/worktree-integration.test.cjs`:

```js
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
  t.after(() => { try { git(root, 'worktree', 'prune'); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
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
  assert.ok(!fs.existsSync(wt)); // 채택 후 워크트리 정리
  assert.match(git(root, 'branch', '--list', 'triad/*'), /^\s*$/); // 브랜치 정리
});

test('통합: 원본과 워크트리가 같은 줄을 다르게 고치면 충돌 마커가 남는다', { skip: !hasGit() }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-wt-int2-'));
  t.after(() => { try { git(root, 'worktree', 'prune'); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
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
```

- [ ] **Step 2: 실행 확인**

Run: `node --test Tests/worktree-integration.test.cjs`
Expected: PASS (2 tests). 실패하면 worktree.js 로직 버그 — 테스트를 고치지 말고 구현을 고친다.

- [ ] **Step 3: 스펙 문서 정합화**

`docs/superpowers/specs/2026-07-30-worktree-isolation-design.md`의 "데이터 흐름" 1·3항을 실제 구현(메인 runAgent 단일 지점 스왑, 렌더러는 worktreeState 소비)으로 수정하고 문서 끝에 한 줄 추가: `구현: 2026-07-31, 계획 docs/superpowers/plans/2026-07-31-worktree-isolation.md`.

- [ ] **Step 4: 전체 테스트**

Run: `node --test Tests/`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add Tests/worktree-integration.test.cjs docs/superpowers/specs/2026-07-30-worktree-isolation-design.md
git commit -m "test: 워크트리 격리 실 git 통합 검증 + 스펙 정합화"
```