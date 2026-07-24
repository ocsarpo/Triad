'use strict';

// Ports Native/main.m:662-762 refreshCodexUsage: — talks JSON-RPC over stdio to
// `codex app-server --stdio` (initialize → initialized + account/rateLimits/read)
// and emits {type:'usage', agent:'codex', data} or {type:'usageError', message}.
// Claude usage is NOT fetched here — it arrives via the run stream's
// rate_limit_event (index.html:1099), so a claude run populates it directly.

const os = require('os');
const { spawn } = require('child_process');
const platform = require('../platform');
const tokenStore = require('./token-store');
const util = require('./util');

let active = null; // in-flight codex app-server child

function refreshCodex(config, emit) {
  config = util.dictOrNil(config);
  if (!config) return;
  if (active) return; // one at a time, like main.m's self.usageTask guard

  const executable = util.stringOrNil(config.executablePath);
  if (!executable || !platform.isExecutable(executable)) {
    emit({ type: 'usageError', message: 'Codex CLI 실행 파일을 찾을 수 없습니다.' });
    return;
  }

  const env = Object.assign({}, process.env);
  env.PATH = platform.agentPathEnv(os.homedir());
  env.TERM = 'dumb';
  env.NO_COLOR = '1';
  if (util.stringOrNil(config.authMode) === 'apiKey') {
    const token = tokenStore.getToken('codex');
    if (!token || !token.length) {
      emit({ type: 'usageError', message: 'Codex API 키가 저장되어 있지 않습니다.' });
      return;
    }
    env.CODEX_API_KEY = token;
  }

  const workspace = util.stringOrDefault(config.workspacePath, os.homedir());
  let child;
  try {
    child = spawn(executable, ['app-server', '--stdio'], { cwd: workspace, env });
  } catch (error) {
    emit({ type: 'usageError', message: (error && error.message) || '사용량 조회 실행 실패' });
    return;
  }
  active = child;

  let resolved = false;
  let requestedLimits = false;
  let buffer = '';

  function cleanup() {
    if (active === child) active = null;
    try { child.stdin.end(); } catch { /* ignore */ }
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }

  const timer = setTimeout(() => {
    if (resolved) return;
    resolved = true;
    emit({ type: 'usageError', message: 'Codex 계정 한도 응답을 받지 못했습니다.' });
    cleanup();
  }, 10000);

  function onData(chunk) {
    if (resolved) return;
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (!event || typeof event !== 'object') continue;
      const id = Number(event.id);
      if (event.error && (id === 1 || id === 2)) {
        resolved = true; clearTimeout(timer);
        const message = event.error && typeof event.error === 'object' ? event.error.message : null;
        emit({ type: 'usageError', message: message || 'Codex 사용량 프로토콜 오류' });
        cleanup(); return;
      }
      if (id === 1 && event.result && !requestedLimits) {
        requestedLimits = true;
        const followups = [
          { method: 'initialized', params: {} },
          { id: 2, method: 'account/rateLimits/read', params: null },
        ];
        try { child.stdin.write(followups.map((r) => JSON.stringify(r)).join('\n') + '\n'); } catch { /* ignore */ }
      } else if (id === 2 && event.result && typeof event.result === 'object') {
        resolved = true; clearTimeout(timer);
        emit({ type: 'usage', agent: 'codex', data: event.result });
        cleanup(); return;
      }
    }
  }

  // main.m merges stderr into the same pipe it parses, so read both here.
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (error) => {
    if (resolved) return;
    resolved = true; clearTimeout(timer);
    if (active === child) active = null;
    emit({ type: 'usageError', message: (error && error.message) || '사용량 조회 실행 실패' });
  });
  child.on('close', () => {
    clearTimeout(timer);
    if (active === child) active = null;
    if (!resolved) { resolved = true; emit({ type: 'usageError', message: 'Codex 계정 한도 응답을 받지 못했습니다.' }); }
  });

  try {
    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'triad-room', version: '0.10.0' } } }) + '\n');
  } catch (error) {
    resolved = true; clearTimeout(timer);
    emit({ type: 'usageError', message: (error && error.message) || '사용량 조회 실행 실패' });
    cleanup();
  }
}

module.exports = { refreshCodex };
