const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

// Phase 2: same-agent turns within one collaboration flow resume a per-flow
// session (cached prefix), while staying fully isolated from the chat session.

test('협업 orchestration은 flow별 세션 저장소와 턴 카운터를 갖는다', () => {
  const matches = renderer.match(/sessions:\{codex:null,claude:null\},sessionTurns:\{codex:0,claude:0\}/g) || [];
  assert.ok(matches.length >= 2, 'agent 모드와 debate/review 모드 orchestration 둘 다 flow 세션을 초기화해야 함');
});

test('dispatchAgent은 isolated일 때 sessionStore에서 재개하고 pending에 실어 보낸다', () => {
  assert.match(renderer, /const sessionStore=options\.sessionStore\|\|null;/);
  assert.match(renderer, /let session=isolated\?\(sessionStore\?sessionStore\[agent\]\|\|null:null\):state\.sessions\[agent\];/);
  assert.match(renderer, /state\.pending\[agent\]=\{prompt,retried:false,isolated,sessionStore,/);
});

test('flow 세션은 per-agent 턴 캡으로 회전한다 (rider a)', () => {
  assert.match(renderer, /const COLLAB_SESSION_TURN_CAP=8;/);
  assert.match(renderer, /function collabSessionStore\(flow, agent\)/);
  assert.match(renderer, /flow\.sessions\[agent\]=null;flow\.sessionTurns\[agent\]=0;/);
  // 두 협업 dispatch 경로 모두 캡을 거쳐 sessionStore를 전달
  assert.match(renderer, /const store=collabSessionStore\(flow,task\.agent\);dispatchAgent\(task\.agent,buildAgentPrompt/);
  assert.match(renderer, /const store=collabSessionStore\(flow,task\.agent\);dispatchAgent\(task\.agent,buildCollaborationPrompt/);
});

test('세션 캡처는 isolated면 flow 저장소에만 쓰고 chat 세션엔 안 쓴다 (격리·rider b)', () => {
  // codex 캡처: isolated 분기와 chat-세션 분기가 모두 존재
  const codex = renderer.slice(renderer.indexOf("if (data.type==='thread.started' && data.thread_id)"));
  const codexStmt = codex.slice(0, codex.indexOf('\n'));
  assert.match(codexStmt, /if\(p\?\.isolated\)\{ if\(p\.sessionStore\)p\.sessionStore\.codex=data\.thread_id;/);
  assert.match(codexStmt, /else \{ state\.sessions\.codex=data\.thread_id;/);
  // 격리 핵심: isolated 분기 안에서는 state.sessions에 쓰지 않는다
  const isolatedBranch = codexStmt.slice(codexStmt.indexOf('if(p?.isolated)'), codexStmt.indexOf('else {'));
  assert.doesNotMatch(isolatedBranch, /state\.sessions/, 'isolated 분기가 chat 세션(state.sessions)에 쓰면 격리 붕괴');
  // claude & worker session 이벤트도 동일 패턴
  assert.match(renderer, /if\(p\?\.isolated\)\{ if\(p\.sessionStore\)p\.sessionStore\.claude=data\.session_id;/);
  assert.match(renderer, /if\(p\?\.isolated\)\{if\(p\.sessionStore\)p\.sessionStore\[event\.agent\]=event\.session;/);
});

test('opt2: 재개 턴이면 reference packet만 생략하고 의제는 유지한다', () => {
  const gates = renderer.match(/const resuming=!!flow\.sessions\?\.\[task\.agent\];/g) || [];
  assert.ok(gates.length >= 2, 'buildCollaborationPrompt와 buildAgentPrompt 둘 다 resuming을 판정해야 함');
  assert.match(renderer, /const references=\(!resuming&&flow\.referencePacket\?\.length\)\?/);
  // 의제(사용자 의제 / 사용자의 원래 작업)는 resuming과 무관하게 항상 프롬프트에 포함 (게이팅 대상 아님)
  assert.doesNotMatch(renderer, /resuming[^;]*사용자 의제/);
});
