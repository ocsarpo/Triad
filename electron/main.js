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
const worktree = require('./lib/worktree');

let win = null;
// App language for the native menu + dialogs. OS-detected at ready; kept in
// sync by the renderer's setLocale action (auto/manual toggle). The renderer's
// strings live in Resources/i18n.js (a browser <script>); main keeps its own
// tiny table since require() of that UMD module is unreliable under this Node.
let appLang = 'en';
// The renderer owns the language *preference* (auto/en/ko); main mirrors it so
// the menu can show the right radio checkmark, and drives changes back to the
// renderer (which persists + reloads).
let appLocalePref = 'auto';
const MAIN_MSG = {
  menuView: { en: 'View', ko: '보기' },
  menuTrace: { en: 'Show/Hide Run Log', ko: '실행 과정 표시/숨기기' },
  menuLanguage: { en: 'Language', ko: '언어' },
  langAuto: { en: 'Auto (OS)', ko: '자동 (OS)' },
  dlgSelect: { en: 'Select', ko: '선택' },
  dlgReference: { en: 'Reference', ko: '참조' },
  dlgAttach: { en: 'Attach', ko: '첨부' },
  dlgImages: { en: 'Images', ko: '이미지' },
  busy: { en: 'Already working.', ko: '이미 작업 중입니다.' },
  cliNotFound: { en: 'CLI executable not found: {path}', ko: 'CLI 실행 파일을 찾을 수 없습니다: {path}' },
};
function M(key, params) {
  const entry = MAIN_MSG[key];
  let s = entry ? (entry[appLang] || entry.en) : key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
  return s;
}
function detectLang(locale) { return /^ko\b/i.test(String(locale || '')) ? 'ko' : 'en'; }
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
      label: M('menuView'),
      submenu: [
        { label: M('menuTrace'), accelerator: 'CmdOrCtrl+Shift+E', click: toggleTrace },
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
    {
      label: M('menuLanguage'),
      submenu: [
        { label: M('langAuto'), type: 'radio', checked: appLocalePref === 'auto', click: () => setLocaleFromMenu('auto') },
        { label: 'English', type: 'radio', checked: appLocalePref === 'en', click: () => setLocaleFromMenu('en') },
        { label: '한국어', type: 'radio', checked: appLocalePref === 'ko', click: () => setLocaleFromMenu('ko') },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Drive a language change from the menu: the renderer persists it and reloads,
// then reports the new preference back via setLocale (which rebuilds the menu).
function setLocaleFromMenu(pref) {
  if (pref === appLocalePref) return;
  emit({ type: 'setLocalePref', pref });
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
async function runAgent(request) {
  const agent = util.stringOrNil(request.agent);
  const prompt = util.stringOrNil(request.prompt);
  const config = util.dictOrNil(request.config);
  // A slot (agent id) may run a second Codex/Claude session, so the CLI to
  // build args for comes from the slot's provider, not its id.
  const provider = (config && util.stringOrNil(config.provider)) || agent;
  const session = util.stringOrNil(request.session);
  const runId = util.stringOrNil(request.runId) || '';
  const conversationId = util.stringOrNil(request.conversationId) || '';
  if (agent === null || prompt === null || config === null) return;

  const slotId = slotIdForRequest(request, agent, conversationId, runId);
  const metadata = { agent, conversationId, slotId, runId };
  const meta = (extra) => Object.assign({}, metadata, extra);

  if (running.has(slotId)) {
    emit(meta({ type: 'error', message: M('busy') }));
    return;
  }

  const executable = util.stringOrNil(config.executablePath);
  if (!executable || !platform.isExecutable(executable)) {
    emit(meta({ type: 'error', message: M('cliNotFound', { path: executable || '' }) }));
    return;
  }

  // 같은-레포 충돌 격리: 모든 실행 경로가 이 지점을 지나므로 여기서 한 번만
  // 스왑하면 spawn cwd·codex --cd·MCP 헬퍼(agentConfigs)가 전부 워크트리를 본다.
  const isolationNote = await worktree.ensureIsolation({
    conversationId, agent, config,
    agentConfigs: util.dictOrNil(request.agentConfigs), emit,
  });
  if (running.has(slotId)) { emit(meta({ type: 'error', message: M('busy') })); return; }

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

  // Attached images: codex takes them with `-i <file>`; claude has no local-image
  // flag, so we point --add-dir at each image's folder and tell it to Read them.
  const images = Array.isArray(request.images) ? request.images.filter((p) => typeof p === 'string' && p) : [];
  let promptToSend = prompt;

  const args = [];
  if (provider === 'codex') {
    // In non-interactive `exec`, codex gates every MCP tool call behind
    // approval and auto-denies it ("user cancelled MCP tool call") — verified
    // that trust_level, approval_policy=never, project trust, and --full-auto
    // do NOT lift it; only --dangerously-bypass-approvals-and-sandbox does. So
    // when the broker is wired (collaboration needs the shared-board tools) we
    // run codex with that bypass and drop the (now-conflicting) sandbox flags.
    // Independent runs keep the normal --sandbox — they never call MCP tools.
    const bypass = !!brokerInfo;
    args.push('exec');
    if (session && session.length) {
      args.push('resume', '--json', '--skip-git-repo-check', '--model', model, '--config', `model_reasoning_effort="${effort}"`);
      if (bypass) args.push('--dangerously-bypass-approvals-and-sandbox');
      else args.push('--config', `sandbox_mode="${permission}"`);
      args.push(session);
    } else {
      args.push('--json', '--color', 'never', '--skip-git-repo-check', '--cd', workspace, '--model', model, '--config', `model_reasoning_effort="${effort}"`);
      if (bypass) args.push('--dangerously-bypass-approvals-and-sandbox');
      else args.push('--sandbox', permission);
    }
    if (!bypass) {
      if (permission === 'workspace-write' && writableRootsConfig) args.push('--config', writableRootsConfig);
      if (permission === 'workspace-write' && (networkAccess || allowLocalBinding)) {
        args.push('--config', 'sandbox_workspace_write.network_access=true');
      }
      if (permission === 'workspace-write' && allowLocalBinding) {
        args.push('--config', 'features.network_proxy.enabled=true', '--config', 'features.network_proxy.allow_local_binding=true');
        if (networkAccess) args.push('--config', 'features.network_proxy.domains={ "*" = "allow" }');
      }
    }
    if (speed === 'fast') args.push('--enable', 'fast_mode', '--config', 'service_tier="fast"');
    else args.push('--disable', 'fast_mode');
    if (brokerInfo) {
      args.push('--config', 'mcp_servers.triad.command=' + JSON.stringify(brokerInfo.nodePath));
      args.push('--config', 'mcp_servers.triad.args=' + JSON.stringify(brokerArgs));
    }
    for (const p of images) args.push('-i', p); // codex attaches images directly
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
    if (images.length) {
      // claude has no image flag; grant read access to each image's folder and
      // tell it to Read the files (its Read tool renders images to vision).
      for (const dir of new Set(images.map((p) => path.dirname(p)))) args.push('--add-dir', dir);
      promptToSend = prompt + '\n\n[첨부 이미지] 아래 이미지 파일을 Read 도구로 열어 내용을 확인한 뒤 답하세요:\n' + images.join('\n');
    }
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

  if (isolationNote) promptToSend += isolationNote;

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

  try { child.stdin.write(promptToSend); child.stdin.end(); } catch { /* stdin may already be closed */ }
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

// ---- other actions ---------------------------------------------------------
async function chooseDirectory(payload) {
  const agent = util.stringOrNil(payload.agent) || '';
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], buttonLabel: M('dlgSelect') });
  if (!result.canceled && result.filePaths[0]) emit({ type: 'directory', agent, path: result.filePaths[0] });
}

async function chooseFiles(payload) {
  const workspace = util.stringOrNil(payload.workspace);
  const options = { properties: ['openFile', 'multiSelections'], buttonLabel: M('dlgReference') };
  if (workspace) options.defaultPath = workspace;
  const result = await dialog.showOpenDialog(win, options);
  if (result.canceled) return;
  emit({ type: 'files', paths: result.filePaths });
}

async function chooseImages(payload) {
  const workspace = util.stringOrNil(payload.workspace);
  const options = {
    properties: ['openFile', 'multiSelections'],
    buttonLabel: M('dlgAttach'),
    filters: [{ name: M('dlgImages'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif'] }],
  };
  if (workspace) options.defaultPath = workspace;
  const result = await dialog.showOpenDialog(win, options);
  if (result.canceled) return;
  emit({ type: 'images', paths: result.filePaths });
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

// ---- integrated terminal (node-pty) ---------------------------------------
// A single interactive PTY tied to the terminal panel. Input/resize/start/stop
// arrive over the normal post() bridge; the high-volume output stream goes back
// over a dedicated ipc channel (triad:pty-data) rather than executeJavaScript.
let ptyProc = null;
function ptyStart(payload) {
  ptyStop();
  let pty;
  try { pty = require('node-pty'); }
  catch (error) { emit({ type: 'ptyError', message: (error && error.message) || 'node-pty를 불러오지 못했습니다.' }); return; }
  const home = os.homedir();
  const { file, args } = platform.defaultShell();
  let cwd = home;
  try { if (payload.cwd && require('fs').statSync(payload.cwd).isDirectory()) cwd = payload.cwd; } catch { /* fall back to home */ }
  const env = Object.assign({}, process.env, { TERM: 'xterm-256color', PATH: platform.agentPathEnv(home) });
  try {
    ptyProc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Number(payload.cols) || 80,
      rows: Number(payload.rows) || 24,
      cwd, env,
    });
  } catch (error) { emit({ type: 'ptyError', message: (error && error.message) || '셸을 시작하지 못했습니다.' }); ptyProc = null; return; }
  ptyProc.onData((data) => { if (win && !win.isDestroyed()) win.webContents.send('triad:pty-data', data); });
  ptyProc.onExit(({ exitCode }) => { if (win && !win.isDestroyed()) win.webContents.send('triad:pty-exit', { exitCode }); ptyProc = null; });
}
function ptyInput(payload) { if (ptyProc && typeof payload.data === 'string') { try { ptyProc.write(payload.data); } catch { /* pty may have exited */ } } }
function ptyResize(payload) { if (ptyProc) { try { ptyProc.resize(Math.max(1, Number(payload.cols) || 80), Math.max(1, Number(payload.rows) || 24)); } catch { /* ignore */ } } }
function ptyStop() { if (ptyProc) { try { ptyProc.kill(); } catch { /* ignore */ } ptyProc = null; } }

function dispatch(payload) {
  if (!payload || typeof payload !== 'object') return;
  switch (payload.action) {
    case 'run': return runAgent(payload);
    case 'stop': return stopAgent(payload);
    case 'chooseDirectory': return void chooseDirectory(payload);
    case 'chooseFiles': return void chooseFiles(payload);
    case 'chooseImages': return void chooseImages(payload);
    case 'copyText': return copyText(payload);
    case 'openURL': return openURL(payload);
    case 'saveToken': return saveTokenAction(payload);
    case 'deleteToken': return deleteTokenAction(payload);
    case 'tokenStatus': return emit({ type: 'tokenStatus', status: tokenStore.status() });
    case 'saveConversation': return conversationStore.saveConversation(payload.conversation);
    case 'deleteConversation': void worktree.cleanupConversation(util.stringOrNil(payload.id) || ''); return conversationStore.deleteConversation(payload.id);
    case 'worktreeAdopt': return void worktreeAdoptAction(payload);
    case 'worktreeDiscard': return void worktreeDiscardAction(payload);
    case 'listSharedDocuments': return emit({ type: 'sharedDocuments', documents: sharedDocs.listDocuments() });
    case 'saveSharedDocument': return saveSharedDocumentAction(payload);
    case 'deleteSharedDocument': return deleteSharedDocumentAction(payload);
    case 'projectFiles': return void gitOps.loadProjectFiles(payload.workspace, payload.agent, payload.conversationId, emit);
    case 'gitBranch': return void gitOps.loadGitBranch(payload.workspace, payload.agent, payload.conversationId, emit);
    case 'projectDiff': return void gitOps.loadProjectDiff(payload.workspace, payload.agent, payload.conversationId, emit);
    case 'refreshUsage': return usage.refreshCodex(payload.config, emit);
    case 'authAccount': return auth.run(payload.operation, payload.agent, payload.config, emit);
    case 'checkUpdate': return checkUpdate();
    case 'setLocale': appLang = payload.locale === 'ko' ? 'ko' : 'en'; if (typeof payload.pref === 'string') appLocalePref = payload.pref; setupMenu(); return;
    case 'ptyStart': return ptyStart(payload);
    case 'ptyInput': return ptyInput(payload);
    case 'ptyResize': return ptyResize(payload);
    case 'ptyStop': return ptyStop();
    default: return;
  }
}

ipcMain.on('triad:post', (event, payload) => {
  try { dispatch(payload); }
  catch (error) { console.error('[triad-electron] dispatch error:', error); }
});

app.on('before-quit', () => { ptyStop(); });
app.whenReady().then(() => { worktree.configure({ userDataDir: app.getPath('userData'), gitBin: platform.gitBin() }); void worktree.gcOrphans(); try { appLang = detectLang(app.getLocale()); } catch { /* keep en */ } createWindow(); setupMenu(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
