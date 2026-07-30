const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'Resources/index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
const platform = fs.readFileSync(path.join(root, 'electron/platform.js'), 'utf8');
const pkg = require(path.join(root, 'electron/package.json'));

test('패키징은 node-pty 전체를 asar에서 unpack한다 (spawn-helper는 .node가 아니라 누락되던 버그)', () => {
  // electron-builder(release): 전체 node-pty unpack
  assert.deepEqual(pkg.build.asarUnpack, ['**/node_modules/node-pty/**']);
  // @electron/packager(quick build): 동일하게 unpack — 안 하면 spawn-helper가
  // app.asar 안에 갇혀 posix_spawnp 실패.
  assert.match(pkg.scripts.pack, /--asar\.unpack=\*\*\/node-pty\/\*\*/);
});

test('node-pty가 의존성이고 xterm 자산이 vendoring 되어 있다', () => {
  assert.ok(pkg.dependencies && pkg.dependencies['node-pty'], 'node-pty dependency');
  assert.ok(fs.existsSync(path.join(root, 'Resources/vendor/xterm.js')));
  assert.ok(fs.existsSync(path.join(root, 'Resources/vendor/xterm.css')));
  assert.ok(fs.existsSync(path.join(root, 'Resources/vendor/addon-fit.js')));
  assert.match(renderer, /<script src="vendor\/xterm\.js"><\/script>/);
  assert.match(renderer, /<link rel="stylesheet" href="vendor\/xterm\.css">/);
});

test('플랫폼 심은 인터랙티브 셸을 해석한다 (darwin 로그인 셸)', () => {
  assert.match(platform, /function defaultShell\(\)/);
  assert.match(platform, /function defaultShellDarwin\(\)/);
  assert.match(platform, /process\.env\.SHELL/);
  assert.match(platform, /args: \['-l'\]/);
  assert.match(platform, /module\.exports = \{[^}]*defaultShell/);
});

test('셸(main)은 node-pty로 PTY를 관리하고 전용 채널로 출력을 보낸다', () => {
  assert.match(main, /let ptyProc = null/);
  assert.match(main, /require\('node-pty'\)/);
  assert.match(main, /pty\.spawn\(file, args,/);
  assert.match(main, /win\.webContents\.send\('triad:pty-data', data\)/);
  assert.match(main, /win\.webContents\.send\('triad:pty-exit'/);
  assert.match(main, /case 'ptyStart': return ptyStart\(payload\)/);
  assert.match(main, /case 'ptyInput': return ptyInput\(payload\)/);
  assert.match(main, /case 'ptyResize': return ptyResize\(payload\)/);
  assert.match(main, /case 'ptyStop': return ptyStop\(\)/);
  assert.match(main, /app\.on\('before-quit', \(\) => \{ ptyStop\(\); \}\)/);
});

test('preload는 고처리량 PTY 출력 채널을 노출한다', () => {
  assert.match(preload, /exposeInMainWorld\('triadPty'/);
  assert.match(preload, /ipcRenderer\.on\('triad:pty-data'/);
  assert.match(preload, /ipcRenderer\.on\('triad:pty-exit'/);
});

test('렌더러는 터미널 패널을 xterm/node-pty에 연결한다', () => {
  assert.match(renderer, /id="terminal-pane"/);
  assert.match(renderer, /id="terminal-toggle"/);
  assert.match(renderer, /\.chat\.terminal-open \.chat-workspace/);
  assert.match(renderer, /function openTerminal\(cwd\)/);
  assert.match(renderer, /function startTerminalSession\(\)/);
  assert.match(renderer, /new window\.Terminal\(/);
  assert.match(renderer, /new window\.FitAddon\.FitAddon\(\)/);
  assert.match(renderer, /window\.triadPty\.onData\(d=>term\.write\(d\)\)/);
  assert.match(renderer, /term\.onData\(d=>post\(\{action:'ptyInput',data:d\}\)\)/);
  assert.match(renderer, /post\(\{action:'ptyStart',cwd,cols:term\.cols\|\|80,rows:term\.rows\|\|24\}\)/);
  assert.match(renderer, /post\(\{action:'ptyResize',cols:term\.cols,rows:term\.rows\}\)/);
  // 우측 패널은 diff/board/terminal 중 하나만 (상호 배타)
  assert.match(renderer, /function openDiff\(\)\{if\(state\.diff\.visible\)\{closeDiff\(\);return;\}closeBoard\(\);closeTerminal\(\)/);
});
