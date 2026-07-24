'use strict';

// Ports Native/main.m:558-634 runAuthOperation: — spawns the agent CLI's
// login/status/logout, collects its output, and emits authStatus / authResult
// / authProgress exactly as the native shell did.  `status` is non-interactive;
// `connect` runs the CLI's own interactive browser login (codex login /
// claude auth login --claudeai) and reports when it finishes, then refreshes
// status (mirrors main.m:622).

const os = require('os');
const { spawn } = require('child_process');
const platform = require('../platform');
const util = require('./util');

const running = new Set(); // agents with an in-flight auth task

function argsFor(agent, operation) {
  if (agent === 'codex') {
    if (operation === 'status') return ['login', 'status'];
    if (operation === 'connect') return ['login'];
    if (operation === 'logout') return ['logout'];
  } else if (agent === 'claude') {
    if (operation === 'status') return ['auth', 'status', '--json'];
    if (operation === 'connect') return ['auth', 'login', '--claudeai'];
    if (operation === 'logout') return ['auth', 'logout'];
  }
  return null;
}

function run(operation, agent, config, emit) {
  operation = util.stringOrNil(operation);
  agent = util.stringOrNil(agent);
  config = util.dictOrNil(config);
  if (!operation || !agent || !config) return;
  if (running.has(agent)) return;

  const executable = util.stringOrNil(config.executablePath);
  if (!executable || !platform.isExecutable(executable)) {
    emit({ type: 'authStatus', agent, connected: false, message: `CLI 실행 파일을 찾을 수 없습니다: ${executable || ''}` });
    return;
  }
  const args = argsFor(agent, operation);
  if (!args) return;

  const env = Object.assign({}, process.env);
  env.PATH = platform.agentPathEnv(os.homedir());
  env.NO_COLOR = '1';

  let child;
  try {
    child = spawn(executable, args, { cwd: os.homedir(), env });
  } catch (error) {
    emit({ type: 'authStatus', agent, connected: false, message: (error && error.message) || '인증 명령 실행 실패' });
    return;
  }

  running.add(agent);
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d.toString('utf8'); });
  child.stderr.on('data', (d) => { err += d.toString('utf8'); });
  child.on('error', (error) => {
    running.delete(agent);
    emit({ type: 'authStatus', agent, connected: false, message: (error && error.message) || '인증 명령 실행 실패' });
  });
  child.on('close', (code) => {
    running.delete(agent);
    const detail = out.length ? out : err;
    if (operation === 'status') {
      emit({ type: 'authStatus', agent, connected: code === 0, message: detail.length ? detail : (code === 0 ? '연결됨' : '연결되지 않음') });
    } else {
      emit({ type: 'authResult', agent, operation, success: code === 0, message: detail });
      run('status', agent, config, emit);
    }
  });
  emit({ type: 'authProgress', agent, operation });
}

module.exports = { run };
