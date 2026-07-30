const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('작업 폴더 MRU: 최근 5개를 앱 전역으로 유지하고 드롭다운으로 고른다', () => {
  // localStorage 영속 + 최대 5개 + 중복 제거(맨 앞으로)
  assert.match(renderer, /localStorage\.getItem\('triad\.recentWorkspaces'\)/);
  assert.match(renderer, /function rememberWorkspace\(path\)/);
  assert.match(renderer, /state\.recentWorkspaces=\[value,\.\.\.state\.recentWorkspaces\.filter\(p=>p!==value\)\]\.slice\(0,5\)/);
  assert.match(renderer, /localStorage\.setItem\('triad\.recentWorkspaces',JSON\.stringify\(state\.recentWorkspaces\)\)/);
  // 공통·에이전트 경로 입력 옆 "최근" 셀렉트 (표시는 폴더 basename)
  assert.match(renderer, /function recentWorkspaceSelect\(target, disabled\)/);
  assert.match(renderer, /\$\{recentWorkspaceSelect\('common',commonDisabled\)\}/);
  assert.match(renderer, /\$\{recentWorkspaceSelect\(agent,workspaceDisabled\)\}/);
  assert.match(renderer, /p\.split\('\/'\)\.pop\(\)/);
  // 기록 지점: 다이얼로그 선택·직접 입력·최근 선택, 그리고 첫 시드
  assert.match(renderer, /event\.type==='directory'\) \{ rememberWorkspace\(event\.path\);/);
  assert.match(renderer, /rememberWorkspace\(event\.target\.value\)/);
  assert.match(renderer, /rememberWorkspace\(c\.workspacePath\)/);
  assert.match(renderer, /if\(!state\.recentWorkspaces\.length\)/);
});

test('에이전트 카드 터미널 버튼은 그 AI의 작업 폴더에서 터미널을 연다', () => {
  assert.match(renderer, /<button class="small-btn agent-terminal"/);
  assert.match(renderer, /card\.querySelector\('\.agent-terminal'\)\.onclick=\(\)=>openTerminal\(effectiveWorkspacePath\(agent\)\)/);
  // openTerminal은 문자열 cwd만 인정(헤더 토글의 이벤트 객체 방어),
  // 열려 있는 상태에서 다른 폴더 요청이면 그 폴더로 재시작
  assert.match(renderer, /function openTerminal\(cwd\)/);
  assert.match(renderer, /const requested=typeof cwd==='string'&&cwd\.trim\(\)\?cwd\.trim\(\):''/);
  assert.match(renderer, /if\(requested&&requested!==state\.terminalCwd\)\{state\.terminalCwd=requested;restartTerminalSession\(\);return;\}/);
  assert.match(renderer, /const cwd=state\.terminalCwd\|\|effectiveWorkspacePath\('codex'\)\|\|effectiveWorkspacePath\('claude'\)\|\|''/);
});
