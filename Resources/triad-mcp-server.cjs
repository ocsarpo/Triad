#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const configPath = argument('--config');
const caller = argument('--caller');
const depth = Number(argument('--depth', '0')) || 0;
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const target = caller === 'codex' ? 'claude' : 'codex';
const activeChildren = new Set();

function emitEvent(value) {
  try { fs.appendFileSync(config.eventsPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8' }); } catch {}
}

function claimCall() {
  const lockPath = `${config.statePath}.lock`;
  let lock = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { lock = fs.openSync(lockPath, 'wx', 0o600); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
  }
  if (lock == null) throw new Error('AI 간 호출 예산 잠금을 얻지 못했습니다.');
  try {
  let state = { used: 0, limit: Number(config.callLimit) || 6 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(config.statePath, 'utf8')) }; } catch {}
  if (state.used >= state.limit) return { allowed: false, used: state.used, limit: state.limit };
  state.used += 1;
  const temporary = `${config.statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, config.statePath);
  return { allowed: true, used: state.used, limit: state.limit };
  } finally { try { fs.closeSync(lock); } catch {} try { fs.unlinkSync(lockPath); } catch {} }
}

function writableRoots(agentConfig) {
  return String(agentConfig.writableRoots || '').split(/[,\n]/u).map(value => value.trim()).filter(Boolean);
}

function codexMcpArguments(nextCaller, nextDepth) {
  const args = [config.brokerPath, '--config', configPath, '--caller', nextCaller, '--depth', String(nextDepth)];
  return [
    '--config', `mcp_servers.triad.command=${JSON.stringify(config.nodePath)}`,
    '--config', `mcp_servers.triad.args=${JSON.stringify(args)}`
  ];
}

function claudeMcpJSON(nextCaller, nextDepth) {
  return JSON.stringify({ mcpServers: { triad: { command: config.nodePath, args: [config.brokerPath, '--config', configPath, '--caller', nextCaller, '--depth', String(nextDepth)] } } });
}

function buildCodex(targetConfig, nextDepth) {
  const permission = targetConfig.permissionMode || 'workspace-write';
  const args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check', '--cd', targetConfig.workspacePath, '--model', targetConfig.model, '--config', `model_reasoning_effort=${JSON.stringify(targetConfig.effort || 'medium')}`, '--sandbox', permission];
  for (const root of writableRoots(targetConfig)) args.push('--add-dir', root);
  if (permission === 'workspace-write' && (targetConfig.networkAccess || targetConfig.allowLocalBinding)) args.push('--config', 'sandbox_workspace_write.network_access=true');
  if (permission === 'workspace-write' && targetConfig.allowLocalBinding) args.push('--config', 'features.network_proxy.enabled=true', '--config', 'features.network_proxy.allow_local_binding=true');
  if (targetConfig.speedMode === 'fast') args.push('--enable', 'fast_mode', '--config', 'service_tier="fast"');
  else args.push('--disable', 'fast_mode');
  if (nextDepth < Number(config.maxDepth || 2)) args.push(...codexMcpArguments('codex', nextDepth));
  args.push('-');
  return args;
}

function buildClaude(targetConfig, nextDepth) {
  const roots = writableRoots(targetConfig);
  const sandbox = {};
  if (roots.length) sandbox.filesystem = { allowWrite: roots };
  const network = {};
  if (targetConfig.networkAccess) network.allowedDomains = ['*'];
  if (targetConfig.allowLocalBinding) network.allowLocalBinding = true;
  if (Object.keys(network).length) sandbox.network = network;
  const settings = { fastMode: targetConfig.speedMode === 'fast' };
  if (Object.keys(sandbox).length) settings.sandbox = sandbox;
  const args = ['--print', '--output-format', 'stream-json', '--verbose', '--model', targetConfig.model, '--effort', targetConfig.effort || 'medium', '--permission-mode', targetConfig.permissionMode || 'acceptEdits', '--settings', JSON.stringify(settings)];
  if (targetConfig.permissionMode === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions');
  if (roots.length) args.push('--add-dir', ...roots);
  if (nextDepth < Number(config.maxDepth || 2)) args.push('--mcp-config', claudeMcpJSON('claude', nextDepth));
  return args;
}

function supportingPrompt(question, reason, context, nextDepth) {
  return `당신은 Triad에서 ${caller === 'codex' ? 'Codex' : 'Claude'}가 작업 중 호출한 보조 AI입니다.\n` +
    `요청한 AI에게 돌려줄 정확하고 실행 가능한 답만 작성하세요. 필요한 도구와 MCP를 실제로 사용하고, 확인하지 못한 내용은 추측하지 마세요.\n` +
    `${nextDepth < Number(config.maxDepth || 2) ? '정보가 정말 부족한 경우에만 Triad ask_agent 도구로 상대 AI에게 한 번 더 확인할 수 있습니다.\n' : '중첩 호출 한도에 도달했으므로 상대 AI를 다시 호출하지 마세요.\n'}` +
    `\n질문:\n${question}\n` +
    `${reason ? `\n호출 이유:\n${reason}\n` : ''}` +
    `${context ? `\n공유 문맥:\n${context}\n` : ''}`;
}

function runHelper(agent, prompt, nextDepth) {
  const agentConfig = config.agents[agent];
  if (!agentConfig || !agentConfig.executablePath) return Promise.reject(new Error(`${agent} 실행 설정이 없습니다.`));
  const args = agent === 'codex' ? buildCodex(agentConfig, nextDepth) : buildClaude(agentConfig, nextDepth);
  return new Promise((resolve, reject) => {
    const child = spawn(agentConfig.executablePath, args, { cwd: agentConfig.workspacePath, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    activeChildren.add(child);
    let stdout = ''; let stderr = ''; let settled = false;
    const timeout = setTimeout(() => { if (!settled) child.kill('SIGTERM'); }, Number(config.timeoutMs) || 300000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 8_000_000) stdout = stdout.slice(-8_000_000); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 500_000) stderr = stderr.slice(-500_000); });
    child.on('error', error => { settled = true; clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      activeChildren.delete(child);
      settled = true; clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim() || `${agent} 보조 실행 종료 코드 ${code}`));
      let answer = '';
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (agent === 'codex' && value.type === 'item.completed' && value.item?.type === 'agent_message' && value.item.text) answer = value.item.text;
          if (agent === 'claude' && value.type === 'stream_event' && value.event?.type === 'content_block_delta' && value.event?.delta?.type === 'text_delta') answer += value.event.delta.text || '';
          if (agent === 'claude' && !answer && value.type === 'result' && value.result) answer = value.result;
        } catch {}
      }
      answer = answer.trim();
      if (!answer) return reject(new Error(`${agent}가 답변 없이 종료되었습니다.`));
      resolve(answer);
    });
    child.stdin.end(prompt);
  });
}

async function askAgent(input) {
  const question = String(input?.question || '').trim();
  const reason = String(input?.reason || '').trim();
  const context = String(input?.context || '').trim().slice(0, 18000);
  if (!question) throw new Error('question은 필수입니다.');
  if (input?.to && input.to !== target) throw new Error(`${caller}는 ${target}만 호출할 수 있습니다.`);
  if (depth >= Number(config.maxDepth || 2)) throw new Error('AI 간 중첩 호출 깊이 한도에 도달했습니다.');
  const budget = claimCall();
  if (!budget.allowed) throw new Error(`AI 간 호출 한도 ${budget.limit}회에 도달했습니다.`);
  const id = `${Date.now()}-${process.pid}-${budget.used}`;
  const nextDepth = depth + 1;
  emitEvent({ eventType: 'agent_call_started', id, from: caller, to: target, question, reason, used: budget.used, limit: budget.limit, depth: nextDepth, timestamp: Date.now() });
  const started = Date.now();
  try {
    const answer = await runHelper(target, supportingPrompt(question, reason, context, nextDepth), nextDepth);
    emitEvent({ eventType: 'agent_call_completed', id, from: caller, to: target, answer: answer.slice(0, 6000), used: budget.used, limit: budget.limit, depth: nextDepth, durationMs: Date.now() - started, timestamp: Date.now() });
    return `[Triad AI 호출 ${budget.used}/${budget.limit} · ${target} 답변]\n${answer}`;
  } catch (error) {
    emitEvent({ eventType: 'agent_call_failed', id, from: caller, to: target, error: error.message || String(error), used: budget.used, limit: budget.limit, depth: nextDepth, durationMs: Date.now() - started, timestamp: Date.now() });
    throw error;
  }
}

function send(id, result, error) {
  const value = { jsonrpc: '2.0', id };
  if (error) value.error = { code: -32000, message: error.message || String(error) };
  else value.result = result;
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/u); buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let request; try { request = JSON.parse(line); } catch { continue; }
    if (request.method === 'initialize') {
      send(request.id, { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'triad-agent-broker', version: '0.1.0' } });
    } else if (request.method === 'tools/list') {
      send(request.id, { tools: [{ name: 'ask_agent', description: `작업 도중 상대 AI(${target})의 정보, 검토, 도구 사용이 필요할 때 호출합니다. 답변은 이 도구 결과로 돌아오며 현재 작업을 계속할 수 있습니다.`, inputSchema: { type: 'object', properties: { question: { type: 'string', description: '상대 AI가 수행할 구체적인 단일 질문' }, reason: { type: 'string', description: '호출이 필요한 이유' }, context: { type: 'string', description: '질문 해결에 필요한 최소 문맥' }, to: { type: 'string', enum: [target] } }, required: ['question'], additionalProperties: false } }] });
    } else if (request.method === 'tools/call') {
      if (request.params?.name !== 'ask_agent') send(request.id, null, new Error('지원하지 않는 도구입니다.'));
      else askAgent(request.params.arguments).then(text => send(request.id, { content: [{ type: 'text', text }], isError: false })).catch(error => send(request.id, { content: [{ type: 'text', text: error.message || String(error) }], isError: true }));
    } else if (request.id != null) send(request.id, {});
  }
});
function shutdown() { for (const child of activeChildren) child.kill('SIGTERM'); }
process.stdin.on('end', shutdown);
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('SIGINT', () => { shutdown(); process.exit(0); });
