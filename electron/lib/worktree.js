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