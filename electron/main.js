'use strict';

// Electron entry point — the cross-platform replacement for Native/main.m's
// AppKit + WKWebView shell.  It reuses Resources/index.html UNCHANGED and
// reimplements the JS↔native bridge (main.m:328-366 dispatch, main.m:1543 emit)
// plus the actions the UI posts.  OS-specifics live in ./platform.js; the
// stores live in ./lib.  Prototype scope: single-agent `run` (no MCP broker
// yet), clipboard/dialogs/openURL, JSON persistence, safeStorage tokens, git
// ops; usage/auth/update are shape-correct stubs.  See memory
// triad-electron-migration for the full plan.

const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const platform = require('./platform');
const resources = require('./lib/resources');
const util = require('./lib/util');
const appInfo = require('./lib/app-info');
const tokenStore = require('./lib/token-store');
const conversationStore = require('./lib/conversation-store');
const sharedDocs = require('./lib/shared-documents-store');
const gitOps = require('./lib/git-ops');
const auth = require('./lib/auth');
const usage = require('./lib/usage');
const broker = require('./lib/broker');
const models = require('./lib/models');

let win = null;
const running = new Map(); // slotId -> child process

// main→renderer: identical mechanism to native emit: (main.m:1549) —
// evaluate `window.nativeEvent(<json>)` in the page.  safeJson escapes the two
// line/paragraph separators that are valid JSON but break a JS string literal.
function emit(payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript('window.nativeEvent(' + util.safeJson(payload) + ')').catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    title: 'Triad',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(resources.dir(), 'index.html'));
  win.webContents.on('did-finish-load', () => {
    // The run-process (실행 과정) toggle lives in the app menu here (View →
    // 실행 과정), so hide the in-page header button in Electron only — the
    // native shell keeps its header button untouched (shared index.html).
    win.webContents.insertCSS('#trace-toggle { display: none !important; }').catch(() => {});
    emitBoot();
  });
}

// Toggle the trace panel by driving the (now hidden) in-page button, reusing
// its existing click handler / persistence.
function toggleTrace() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    'void (document.getElementById("trace-toggle") && document.getElementById("trace-toggle").click())'
  ).catch(() => {});
}

function setupMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: '보기',
      submenu: [
        { label: '실행 과정 표시/숨기기', accelerator: 'CmdOrCtrl+Shift+E', click: toggleTrace },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Boot handshake consumed at index.html:1908 (event.type==='boot').
function emitBoot() {
  const codexPath = platform.resolveExecutable('codex');
  const claudePath = platform.resolveExecutable('claude');
  emit({
    type: 'boot',
    appVersion: appInfo.readAppVersion(),
    codexModels: models.codexCatalog(),
    claudeModels: models.claudeCatalog(claudePath),
    conversations: conversationStore.loadConversations(),
    home: os.homedir(),
    codexPath,
    claudePath,
    tokenStatus: tokenStore.status(),
  });
  console.log('[triad-electron] boot emitted');
}

// ---- run helpers (ports of main.m:1442-1461, 1006-1017) --------------------
function expandTilde(p) {
  const home = os.homedir();
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

function writableRootsFromConfig(config) {
  const raw = typeof config.writableRoots === 'string' ? config.writableRoots : '';
  const roots = [];
  for (const value of raw.split(/[,\n]/)) {
    const p = expandTilde(value.trim());
    if (p && !roots.includes(p)) roots.push(p);
  }
  return roots;
}

function writableRootsCodexConfig(config) {
  const roots = writableRootsFromConfig(config);
  if (!roots.length) return null;
  const quoted = roots.map((r) => '"' + r.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
  return 'sandbox_workspace_write.writable_roots=[' + quoted.join(',') + ']';
}

function slotIdForRequest(request, agent, conversationId, runId) {
  const s = util.stringOrNil(request.slotId);
  if (s && s.length) return s;
  if (conversationId.length || runId.length) return `legacy:${conversationId}:${agent}:${runId}`;
  return `legacy-agent:${agent}`;
}

// Port of main.m:1162-1372 runAgent: — MCP broker wiring intentionally omitted
// for the prototype (see TODO(phase2) markers).
function runAgent(request) {
  const agent = util.stringOrNil(request.agent);
  const prompt = util.stringOrNil(request.prompt);
  const config = util.dictOrNil(request.config);
  const session = util.stringOrNil(request.session);
  const runId = util.stringOrNil(request.runId) || '';
  const conversationId = util.stringOrNil(request.conversationId) || '';
  if (agent === null || prompt === null || config === null) return;

  const slotId = slotIdForRequest(request, agent, conversationId, runId);
  const metadata = { agent, conversationId, slotId, runId };
  const meta = (extra) => Object.assign({}, metadata, extra);

  if (running.has(slotId)) {
    emit(meta({ type: 'error', message: '이미 작업 중입니다.' }));
    return;
  }

  const executable = util.stringOrNil(config.executablePath);
  if (!executable || !platform.isExecutable(executable)) {
    emit(meta({ type: 'error', message: `CLI 실행 파일을 찾을 수 없습니다: ${executable || ''}` }));
    return;
  }

  const workspace = util.stringOrDefault(config.workspacePath, os.homedir());
  const model = util.stringOrDefault(config.model, '');
  const effort = util.stringOrDefault(config.effort, 'medium');
  const speed = util.stringOrDefault(config.speedMode, 'standard');
  const permission = util.stringOrDefault(config.permissionMode, 'workspace-write');
  const networkAccess = config.networkAccess === true;
  const allowLocalBinding = config.allowLocalBinding === true;
  const writableRoots = writableRootsFromConfig(config);
  const writableRootsConfig = writableRootsCodexConfig(config);

  // MCP broker: provides the shared-context / submit_contribution / ask_agent
  // tools.  Set up only when the renderer requests it (mcpEnabled) — otherwise
  // the prompt's tool instructions would reference tools that don't exist.
  const brokerInfo = broker.setup(agent, slotId, metadata, request, emit);
  const brokerArgs = brokerInfo ? broker.args(brokerInfo, agent) : null;

  const args = [];
  if (agent === 'codex') {
    args.push('exec');
    if (session && session.length) {
      args.push('resume', '--json', '--skip-git-repo-check', '--model', model,
        '--config', `model_reasoning_effort="${effort}"`,
        '--config', `sandbox_mode="${permission}"`, session);
    } else {
      args.push('--json', '--color', 'never', '--skip-git-repo-check', '--cd', workspace,
        '--model', model, '--config', `model_reasoning_effort="${effort}"`, '--sandbox', permission);
    }
    if (permission === 'workspace-write' && writableRootsConfig) args.push('--config', writableRootsConfig);
    if (permission === 'workspace-write' && (networkAccess || allowLocalBinding)) {
      args.push('--config', 'sandbox_workspace_write.network_access=true');
    }
    if (permission === 'workspace-write' && allowLocalBinding) {
      args.push('--config', 'features.network_proxy.enabled=true', '--config', 'features.network_proxy.allow_local_binding=true');
      if (networkAccess) args.push('--config', 'features.network_proxy.domains={ "*" = "allow" }');
    }
    if (speed === 'fast') args.push('--enable', 'fast_mode', '--config', 'service_tier="fast"');
    else args.push('--disable', 'fast_mode');
    if (brokerInfo) {
      args.push('--config', 'mcp_servers.triad.command=' + JSON.stringify(brokerInfo.nodePath));
      args.push('--config', 'mcp_servers.triad.args=' + JSON.stringify(brokerArgs));
      // Without this, codex treats the dynamically-added triad server as
      // untrusted and gates every tool call behind approval — which, in the
      // non-interactive `exec` run, auto-cancels ("user cancelled MCP tool
      // call"). The broker is the app's own server, so mark it trusted.
      args.push('--config', 'mcp_servers.triad.trust_level=' + JSON.stringify('trusted'));
    }
    args.push('-');
  } else {
    const claudeSettings = { fastMode: speed === 'fast' };
    const sandbox = {};
    if (writableRoots.length) sandbox.filesystem = { allowWrite: writableRoots };
    const network = {};
    if (networkAccess) network.allowedDomains = ['*'];
    if (allowLocalBinding) network.allowLocalBinding = true;
    if (Object.keys(network).length) sandbox.network = network;
    if (Object.keys(sandbox).length) claudeSettings.sandbox = sandbox;
    args.push('--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--model', model, '--effort', effort, '--permission-mode', permission,
      '--settings', JSON.stringify(claudeSettings));
    if (permission === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions');
    if (writableRoots.length) { args.push('--add-dir'); args.push(...writableRoots); }
    if (brokerInfo) {
      args.push('--mcp-config', JSON.stringify({ mcpServers: { triad: { command: brokerInfo.nodePath, args: brokerArgs } } }));
      // The triad broker is the app's own trusted coordination channel, so its
      // tools must always be permitted — otherwise a conversation on the
      // default permission mode (acceptEdits) has its shared_context_update /
      // submit_contribution calls denied ("사용자가 취소"). Allowlisting them
      // removes the need for bypassPermissions just to record on the board.
      args.push('--allowedTools', [
        'mcp__triad__shared_context_manifest',
        'mcp__triad__shared_context_read',
        'mcp__triad__shared_context_update',
        'mcp__triad__submit_verdict',
        'mcp__triad__submit_contribution',
        'mcp__triad__ask_agent',
      ].join(','));
    }
    if (session && session.length) args.push('--resume', session);
    else args.push('--session-id', crypto.randomUUID().toLowerCase());
  }

  const env = Object.assign({}, process.env);
  env.PATH = platform.agentPathEnv(os.homedir());
  env.TERM = 'dumb';
  env.NO_COLOR = '1';

  const allConfigs = util.dictOrNil(request.agentConfigs) || { [agent]: config };
  for (const configuredAgent of ['codex', 'claude']) {
    const agentConfig = util.dictOrNil(allConfigs[configuredAgent]);
    if (!agentConfig) continue;
    if (util.stringOrNil(agentConfig.authMode) !== 'apiKey') continue;
    const token = tokenStore.getToken(configuredAgent);
    if ((!token || !token.length) && configuredAgent === agent) {
      broker.cleanup(slotId, brokerInfo);
      emit(meta({ type: 'error', message: '키체인에 저장된 API 키가 없습니다.' }));
      return;
    }
    if (token && token.length && configuredAgent === 'codex') env.CODEX_API_KEY = token;
    if (token && token.length && configuredAgent === 'claude') env.ANTHROPIC_API_KEY = token;
  }

  let child;
  try {
    // detached so the CLI (and any children it spawns) forms its own process
    // group we can signal as a unit — mirrors main.m:1367 setpgid intent.
    child = spawn(executable, args, { cwd: workspace, env, detached: true });
  } catch (error) {
    broker.cleanup(slotId, brokerInfo);
    emit(meta({ type: 'error', message: (error && error.message) || '실행 실패' }));
    return;
  }

  running.set(slotId, child);
  child.stdout.on('data', (chunk) => emit(meta({ type: 'raw', chunk: chunk.toString('utf8') })));
  child.stderr.on('data', (chunk) => emit(meta({ type: 'stderr', chunk: chunk.toString('utf8') })));
  child.on('error', (error) => emit(meta({ type: 'error', message: (error && error.message) || '실행 실패' })));
  child.on('close', (code) => {
    running.delete(slotId);
    emit(meta({ type: 'terminated', exitCode: code == null ? -1 : code }));
    setTimeout(() => broker.cleanup(slotId, brokerInfo), 300);
  });

  try { child.stdin.write(prompt); child.stdin.end(); } catch { /* stdin may already be closed */ }
}

function stopAgent(request) {
  const agent = util.stringOrNil(request.agent) || '';
  const conversationId = util.stringOrNil(request.conversationId) || '';
  const runId = util.stringOrNil(request.runId) || '';
  const slotId = slotIdForRequest(request, agent, conversationId, runId);
  const child = running.get(slotId);
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
}

// ---- other actions ---------------------------------------------------------
async function chooseDirectory(payload) {
  const agent = util.stringOrNil(payload.agent) || '';
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], buttonLabel: '선택' });
  if (!result.canceled && result.filePaths[0]) emit({ type: 'directory', agent, path: result.filePaths[0] });
}

async function chooseFiles(payload) {
  const workspace = util.stringOrNil(payload.workspace);
  const options = { properties: ['openFile', 'multiSelections'], buttonLabel: '참조' };
  if (workspace) options.defaultPath = workspace;
  const result = await dialog.showOpenDialog(win, options);
  if (result.canceled) return;
  emit({ type: 'files', paths: result.filePaths });
}

function copyText(payload) {
  const requestId = util.stringOrNil(payload.requestId) || '';
  try {
    clipboard.writeText(payload.text == null ? '' : String(payload.text));
    emit({ type: 'clipboardResult', requestId, success: true });
  } catch (error) {
    emit({ type: 'clipboardResult', requestId, success: false, message: (error && error.message) || '복사 실패' });
  }
}

function openURL(payload) {
  const url = util.stringOrNil(payload.url) || '';
  let ok = false;
  try { const parsed = new URL(url); ok = parsed.protocol === 'http:' || parsed.protocol === 'https:'; } catch { ok = false; }
  if (!ok) { emit({ type: 'linkError', message: '열 수 없는 링크입니다.' }); return; }
  shell.openExternal(url);
}

function saveTokenAction(payload) {
  const result = tokenStore.saveToken(util.stringOrNil(payload.agent) || '', payload.token);
  if (!result.success) emit({ type: 'tokenError', message: result.message || '토큰 저장 실패' });
  emit({ type: 'tokenStatus', status: tokenStore.status() });
}

function deleteTokenAction(payload) {
  tokenStore.deleteToken(util.stringOrNil(payload.agent) || '');
  emit({ type: 'tokenStatus', status: tokenStore.status() });
}

function saveSharedDocumentAction(payload) {
  const result = sharedDocs.saveDocument(payload.document);
  if (!result.ok) emit({ type: 'sharedDocumentsError', message: result.message });
  emit({ type: 'sharedDocuments', documents: sharedDocs.listDocuments() });
}

function deleteSharedDocumentAction(payload) {
  const result = sharedDocs.deleteDocument(util.stringOrNil(payload.documentId));
  if (!result.ok) emit({ type: 'sharedDocumentsError', message: result.message });
  emit({ type: 'sharedDocuments', documents: sharedDocs.listDocuments() });
}

// Ports main.m:371-384 checkForUpdates — compare the latest GitHub release tag
// against this build; the renderer shows a banner when it's newer.
function checkUpdate() {
  const current = appInfo.readAppVersion();
  fetch('https://api.github.com/repos/ocsarpo/Triad/releases/latest', {
    headers: { 'User-Agent': 'Triad-electron-update-check' },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release) return;
      const latest = typeof release.tag_name === 'string' ? release.tag_name : '';
      const url = typeof release.html_url === 'string' ? release.html_url : '';
      if (!latest || !url) return;
      emit({ type: 'updateCheck', latest, current, url });
    })
    .catch(() => {});
}

function dispatch(payload) {
  if (!payload || typeof payload !== 'object') return;
  switch (payload.action) {
    case 'run': return runAgent(payload);
    case 'stop': return stopAgent(payload);
    case 'chooseDirectory': return void chooseDirectory(payload);
    case 'chooseFiles': return void chooseFiles(payload);
    case 'copyText': return copyText(payload);
    case 'openURL': return openURL(payload);
    case 'saveToken': return saveTokenAction(payload);
    case 'deleteToken': return deleteTokenAction(payload);
    case 'tokenStatus': return emit({ type: 'tokenStatus', status: tokenStore.status() });
    case 'saveConversation': return conversationStore.saveConversation(payload.conversation);
    case 'deleteConversation': return conversationStore.deleteConversation(payload.id);
    case 'listSharedDocuments': return emit({ type: 'sharedDocuments', documents: sharedDocs.listDocuments() });
    case 'saveSharedDocument': return saveSharedDocumentAction(payload);
    case 'deleteSharedDocument': return deleteSharedDocumentAction(payload);
    case 'projectFiles': return void gitOps.loadProjectFiles(payload.workspace, payload.agent, payload.conversationId, emit);
    case 'gitBranch': return void gitOps.loadGitBranch(payload.workspace, payload.agent, payload.conversationId, emit);
    case 'projectDiff': return void gitOps.loadProjectDiff(payload.workspace, payload.agent, payload.conversationId, emit);
    case 'refreshUsage': return usage.refreshCodex(payload.config, emit);
    case 'authAccount': return auth.run(payload.operation, payload.agent, payload.config, emit);
    case 'checkUpdate': return checkUpdate();
    default: return;
  }
}

ipcMain.on('triad:post', (event, payload) => {
  try { dispatch(payload); }
  catch (error) { console.error('[triad-electron] dispatch error:', error); }
});

app.whenReady().then(() => { createWindow(); setupMenu(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
