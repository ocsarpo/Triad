'use strict';

// Ports Native/main.m:974-1160 — the agent-collaboration MCP broker wiring.
// Writes the broker config/state/events files, exposes the triad MCP server's
// launch args for injection into the CLI, tails the events file for ask_agent
// handoffs, and cleans up.  Uses a Node-based file tail (fs.watchFile) instead
// of `/usr/bin/tail -F` so it also works on Windows.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const platform = require('../platform');
const resources = require('./resources');
const util = require('./util');

const artifactsBySlot = new Map(); // slotId -> { configPath, statePath, eventsPath, nodePath, brokerPath, stopWatch }

function safeId(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function sharedContextPathFor(documentId) {
  const id = safeId(documentId);
  if (!id) return null;
  const dir = path.join(platform.appDataDir(), 'Shared Context');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return null; }
  return path.join(dir, id + '.json');
}

// main.m:974-1004 — write the current board to a stable per-document file the
// broker reads/writes. The first write for a runId wins; a second launch of the
// same run just reuses the path.
function prepareSharedContext(request) {
  const sharedContext = util.dictOrNil(request.sharedContext);
  if (!sharedContext) return null;
  const runId = util.stringOrNil(sharedContext.runId);
  const board = util.dictOrNil(sharedContext.board);
  if (!runId || !board) return null;
  const documentId = util.stringOrNil(sharedContext.documentId)
    || util.stringOrNil(board.documentId)
    || util.stringOrNil(sharedContext.conversationId);
  const target = sharedContextPathFor(documentId);
  if (!target) return null;
  try {
    const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (existing && existing.runId === runId) return target;
  } catch { /* no existing file — fall through and write */ }
  try {
    fs.writeFileSync(target, JSON.stringify(board), { mode: 0o600 });
  } catch { return null; }
  return target;
}

// main.m:1026-1088
function setup(agent, slotId, metadata, request, emit) {
  if (!util.dictOrNil(request)) return null;
  if (request.mcpEnabled !== true) return null;
  const agentConfigs = util.dictOrNil(request.agentConfigs);
  const codexConfig = agentConfigs && util.dictOrNil(agentConfigs.codex);
  const claudeConfig = agentConfigs && util.dictOrNil(agentConfigs.claude);
  if (!agentConfigs || !codexConfig || !claudeConfig) return null;
  const collaboration = util.dictOrNil(request.collaboration) || {};
  const sharedContext = util.dictOrNil(request.sharedContext);

  const nodePath = platform.resolveExecutable('node');
  const brokerPath = path.join(resources.dir(), 'triad-mcp-server.cjs');
  if (!platform.isExecutable(nodePath) || !fs.existsSync(brokerPath)) {
    emit(Object.assign({}, metadata, {
      type: 'brokerWarning',
      message: 'AI 간 호출 도구를 시작할 Node.js 또는 브로커 파일을 찾지 못했습니다. 기존 인계 방식으로 진행합니다.',
    }));
    return null;
  }

  const base = path.join(os.tmpdir(), `triad-broker-${crypto.randomUUID().toLowerCase()}`);
  const configPath = base + '.json';
  const statePath = base + '.state.json';
  const eventsPath = base + '.events.jsonl';

  let callLimit = Math.floor(Number(collaboration.rounds));
  if (!(callLimit >= 1)) callLimit = 6;
  if (callLimit > 10) callLimit = 10;
  let helperTimeoutMinutes = 5;
  const configuredTimeout = collaboration.helperTimeoutMinutes;
  if (typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout)
    && Math.floor(configuredTimeout) === configuredTimeout && configuredTimeout >= 1 && configuredTimeout <= 120) {
    helperTimeoutMinutes = configuredTimeout;
  }
  const sharedContextPath = prepareSharedContext(request);
  const collaborationMode = util.stringOrDefault(collaboration.mode, 'independent');
  const owner = util.stringOrDefault(sharedContext && sharedContext.owner, agent);
  const payload = {
    nodePath, brokerPath, statePath, eventsPath,
    callLimit, maxDepth: 2, timeoutMs: helperTimeoutMinutes * 60 * 1000, helperTimeoutMinutes,
    agents: agentConfigs, collaborationMode, allowAskAgent: collaborationMode === 'agent', owner,
  };
  if (sharedContextPath) payload.sharedContextPath = sharedContextPath;

  try {
    fs.writeFileSync(configPath, JSON.stringify(payload), { mode: 0o600 });
    fs.writeFileSync(eventsPath, '', { mode: 0o600 });
    fs.writeFileSync(statePath, JSON.stringify({ used: 0, limit: callLimit }), { mode: 0o600 });
  } catch {
    return null;
  }

  cleanup(slotId, null); // drop any watcher left on a reused legacy slot
  const artifacts = { configPath, statePath, eventsPath, nodePath, brokerPath };
  artifactsBySlot.set(slotId, artifacts);
  startEvents(agent, slotId, metadata, artifacts, emit);
  return artifacts;
}

// The triad MCP server's launch args, injected into the CLI's mcp config.
function args(artifacts, agent) {
  return [artifacts.brokerPath, '--config', artifacts.configPath, '--caller', agent, '--depth', '0'];
}

// main.m:1090-1127 — tail the events file (Node-based, cross-platform) and relay
// each JSON line as a brokerEvent.
function startEvents(agent, slotId, metadata, artifacts, emit) {
  let offset = 0;
  try { offset = fs.statSync(artifacts.eventsPath).size; } catch { offset = 0; }
  let buffer = '';

  const drain = () => {
    let size;
    try { size = fs.statSync(artifacts.eventsPath).size; } catch { return; }
    if (size < offset) offset = 0; // truncated/rotated
    if (size <= offset) return;
    let fd;
    try { fd = fs.openSync(artifacts.eventsPath, 'r'); } catch { return; }
    try {
      const length = size - offset;
      const chunk = Buffer.alloc(length);
      fs.readSync(fd, chunk, 0, length, offset);
      offset = size;
      buffer += chunk.toString('utf8');
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event && typeof event === 'object') {
        emit(Object.assign({}, event, { type: 'brokerEvent', rootAgent: agent }, metadata));
      }
    }
  };

  const listener = () => drain();
  fs.watchFile(artifacts.eventsPath, { interval: 150 }, listener);
  artifacts.stopWatch = () => { try { fs.unwatchFile(artifacts.eventsPath, listener); } catch { /* ignore */ } };
  drain();
}

// main.m:1129-1160
function cleanup(slotId, expectedArtifacts) {
  const artifacts = artifactsBySlot.get(slotId);
  if (!artifacts || (expectedArtifacts && artifacts !== expectedArtifacts)) return;
  if (typeof artifacts.stopWatch === 'function') artifacts.stopWatch();
  for (const key of ['configPath', 'statePath', 'eventsPath']) {
    try { fs.unlinkSync(artifacts[key]); } catch { /* already gone */ }
  }
  artifactsBySlot.delete(slotId);
}

module.exports = { setup, args, cleanup };
