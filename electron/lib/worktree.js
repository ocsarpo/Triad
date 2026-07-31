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

// git-ops.js runGit 미러 + 패치 스트리밍용 stdin input·환경변수(임시 인덱스) 지원.
function runGit(args, cwd, input = null, extraEnv = null) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(settings.gitBin, args, { cwd, env: extraEnv ? { ...process.env, ...extraEnv } : undefined }); }
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
  // apply --3way는 --index를 함축해 "워킹트리 == 인덱스"를 요구한다 — 사용자
  // dirty 상태에서는 즉시 거부("does not match index"). 임시 인덱스에 현재
  // 워킹트리를 스테이징해 그 기준으로 적용하면 3-way가 동작하면서도 실제
  // 인덱스(사용자 스테이징)는 무변화로 남는다.
  const tmpIndex = path.join(settings.userDataDir, `adopt-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    fs.mkdirSync(settings.userDataDir, { recursive: true });
    await runGitImpl(['add', '-A'], entry.root, null, env);
    const apply = await runGitImpl(['apply', '--3way', '--whitespace=nowarn'], entry.root, diff.data, env);
    if (apply.code !== 0) {
      const unmerged = await runGitImpl(['ls-files', '-u'], entry.root, null, env);
      const conflicts = [...new Set(unmerged.output.split('\n').filter(Boolean).map(line => line.split('\t')[1]).filter(Boolean))];
      // 충돌 파일도 안 남았으면 아예 적용 실패 — 원본 무변경, 워크트리 보존.
      if (!conflicts.length) throw new Error(`패치를 적용하지 못했습니다: ${(apply.error || '').trim().slice(0, 400)}`);
      await discard(conversationId, slot);
      return { applied: true, empty: false, conflicts };
    }
  } finally {
    fs.rmSync(tmpIndex, { force: true });
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

module.exports = {
  configure, resolveRoot, ensure, ensureIsolation,
  adopt, discard, cleanupConversation, gcOrphans,
  _registry: loadRegistry, _saveRegistry: saveRegistry,
};