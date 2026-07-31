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

module.exports = {
  configure, resolveRoot, ensure,
  _registry: loadRegistry, _saveRegistry: saveRegistry,
};