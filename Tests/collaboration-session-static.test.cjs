const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

// Phase 2: same-agent turns within one collaboration flow resume a per-flow
// session (cached prefix), while staying fully isolated from the chat session.

test('협업 orchestration은 flow별 세션 저장소와 턴 카운터를 갖는다', () => {
  const matches = renderer.match(/sessions:\{codex:null,claude:null\},sessionTurns:\{codex:0,claude:0\}/g) || [];
  assert.ok(matches.length >= 1, '협업(agent) orchestration이 flow 세션을 초기화해야 함');
});

test('dispatchAgent은 isolated일 때 sessionStore에서 재개하고 pending에 실어 보낸다', () => {
  assert.match(renderer, /const sessionStore=options\.sessionStore\|\|null;/);
  assert.match(renderer, /let session=isolated\?\(sessionStore\?sessionStore\[agent\]\|\|null:null\):state\.sessions\[agent\];/);
  assert.match(renderer, /state\.pending\[agent\]=\{prompt,retried:false,isolated,sessionStore,/);
});

test('flow 세션은 협업 내내 캡 없이 유지된다 (자동 회전 제거)', () => {
  // 턴 캡 제거 — flow 길이는 rounds/위임 한도로 유한하고 CLI가 문맥을 관리한다.
  assert.doesNotMatch(renderer, /COLLAB_SESSION_TURN_CAP/);
  assert.match(renderer, /function collabSessionStore\(flow, agent\)/);
  assert.match(renderer, /flow\.sessionTurns\[agent\]=\(flow\.sessionTurns\[agent\]\|\|0\)\+1;/);
  // 대화(dialog) 턴이 flow 세션 store로 재개된다 (유일한 오케스트레이션)
  assert.match(renderer, /const store=collabSessionStore\(flow,agent\);/);
  assert.doesNotMatch(renderer, /buildCollaborationPrompt|buildAgentPrompt/);
});

test('세션 캡처는 isolated면 flow 저장소에만 쓰고 chat 세션엔 안 쓴다 (격리·rider b)', () => {
  // codex 캡처: isolated 분기와 chat-세션 분기가 모두 존재
  const codex = renderer.slice(renderer.indexOf("if (data.type==='thread.started' && data.thread_id)"));
  const codexStmt = codex.slice(0, codex.indexOf('\n'));
  assert.match(codexStmt, /if\(p\?\.isolated\)\{ if\(p\.sessionStore\)p\.sessionStore\[agent\]=data\.thread_id;/);
  assert.match(codexStmt, /else \{ state\.sessions\[agent\]=data\.thread_id;/);
  // 격리 핵심: isolated 분기 안에서는 state.sessions에 쓰지 않는다
  const isolatedBranch = codexStmt.slice(codexStmt.indexOf('if(p?.isolated)'), codexStmt.indexOf('else {'));
  assert.doesNotMatch(isolatedBranch, /state\.sessions/, 'isolated 분기가 chat 세션(state.sessions)에 쓰면 격리 붕괴');
  // claude & worker session 이벤트도 동일 패턴 (슬롯 키)
  assert.match(renderer, /if\(p\?\.isolated\)\{ if\(p\.sessionStore\)p\.sessionStore\[agent\]=data\.session_id;/);
  assert.match(renderer, /if\(p\?\.isolated\)\{if\(p\.sessionStore\)p\.sessionStore\[event\.agent\]=event\.session;/);
});

test('대화 턴은 첫 턴만 주제·규칙을 싣고 재개 턴은 상대의 말만 전달한다', () => {
  assert.match(renderer, /const first=!flow\.sessions\?\.\[agent\];/);
  assert.match(renderer, /:`\$\{names\[other\]\}: \$\{received\}`;/);
});