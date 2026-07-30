const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('회의실 질답: 질문 메시지는 유지되고 답변은 별도 메시지로 추가된다', () => {
  // 질문(agent_call_started)은 그대로 두고 스피너만 끈다
  assert.match(renderer, /const qid=state\.brokerMessages\[event\.id\];if\(qid\)updateMessage\(qid,m=>\{m\.streaming=false;\}\)/);
  // 답변은 새 메시지 (덮어쓰기 아님)
  assert.match(renderer, /const answerId=addMessage\(to,L\('handoffAnswer',\{\.\.\.fields,body:preview\}\),false\)/);
  // 실패도 별도 메시지로
  assert.match(renderer, /addMessage\('system',L\('handoffFailed',\{from:names\[from\],to:names\[to\],count,error:event\.error\|\|L\('unknownError'\)\}\),false\)/);
});

test('시간순 배치: 말풍선은 즉시 생성(작업 표시)하고 핸드오프마다 세그먼트를 봉인한다', () => {
  // 즉시 생성 → "생각 중…" 스피너로 작업 중임을 항상 표시
  assert.match(renderer, /state\.responseIds\[agent\]=addMessage\(agent,'',true,bubbleMeta\);renderStatus\(\)/);
  assert.doesNotMatch(renderer, /const lazyBubble=/);
  assert.match(renderer, /function ensureResponseBubble\(agent\)/); // 봉인 후 이어지는 세그먼트용
  assert.match(renderer, /function appendAgentText\(agent, text\) \{ ensureResponseBubble\(agent\)/);
  assert.match(renderer, /if\(failed\)ensureResponseBubble\(agent\)/);
  // 핸드오프 시 세그먼트 봉인 + 빈 세그먼트(스피너만)는 제거 → 새 말풍선은 Q&A 아래
  assert.match(renderer, /if\(seg&&!String\(seg\.text\|\|''\)\.trim\(\)\)state\.messages=state\.messages\.filter\(m=>m\.id!==segId\)/);
  assert.match(renderer, /else if\(seg\)updateMessage\(segId,m=>\{m\.streaming=false;if\(!m\.completedAt\)m\.completedAt=Date\.now\(\);\}\)/);
});

test('모드 축소: 저장된 토론/교차 검토 설정은 독립 실행으로 흡수된다', () => {
  assert.match(renderer, /if\(collaboration\.mode!=='dialog'\)collaboration\.mode='independent';/);
  assert.match(renderer, /delete collaboration\.finalizer;/);
  // 컴포저에는 두 모드 버튼만 남는다
  assert.doesNotMatch(renderer, /data-collab-mode="debate"/);
  assert.doesNotMatch(renderer, /data-collab-mode="review"/);
  assert.doesNotMatch(renderer, /collab-finalizer/);
});

test('#검토 태그: 답변이 끝나면 상대 에이전트의 교차 검토 실행을 대기열로 돌린다', () => {
  // 라우터 플래그 → pending → finishAgent 훅 → enqueueReviewRun
  assert.match(renderer, /function buildReviewPrompt\(author, userText, answerText\)/);
  assert.match(renderer, /function enqueueReviewRun\(author, userText, answerText\)/);
  assert.match(renderer, /const wantsReview=pending\?\.reviewRequested\|\|\(selfReviewAsk&&!!pending\?\.reviewSource\)/);
  assert.match(renderer, /enqueueReviewRun\(agent,pending\.reviewSource\|\|'',answerText\)/);
  // 검토 프롬프트는 보드 의식 없이 판정+근거만 요구
  assert.match(renderer, /판정\(동의 \/ 보완 필요\)으로 시작/);
  // 진행 중이면 대기열이 순서를 보장 (검토 실행은 kind 'agent' 큐 항목)
  assert.match(renderer, /교차 검토 대기열 등록/);
});

// 완료 보류 기계(finishAgentFlowWhenReady)는 agent 플로우와 함께 제거됨 — 독립 실행 Q&A는 완료 메시지가 없다.

test('#대화: 두 AI가 채팅에서 직접 말을 주고받고 [[대화종료]] 또는 최대 턴에서 끝난다', () => {
  // send: dialog 태그가 실행별 dialog 모드를 만든다
  assert.match(renderer, /if\(routed\.dialog\)\{/);
  assert.match(renderer, /runCollaboration=\{\.\.\.state\.collaboration,mode:'dialog',lead,autoLeadReason\}/);
  // dialog flow: 보드 없음(sharedContext null) + MCP 없음(shouldEnableMcp는 agent만)
  assert.match(renderer, /state\.orchestration=\{mode:'dialog'/);
  assert.match(renderer, /sharedContext:null,collaboration,conversationId/);
  // 턴 루프: 첫 턴만 주제·규칙, 이후엔 상대의 말만 (재개 세션)
  assert.match(renderer, /function runDialogueTurn\(agent, received\)/);
  assert.match(renderer, /당신이 먼저 말문을 여세요/);
  assert.match(renderer, /:`\$\{names\[other\]\}: \$\{received\}`;/);
  // 종료: [[대화종료]] 마커 제거 후 종료, 빈 답/최대 턴도 종료
  assert.match(renderer, /const DIALOG_END=\/\\\[\\\[\\s\*대화\\s\*종료\\s\*\\\]\\\]\/u;/);
  assert.match(renderer, /if\(ended\|\|!text\|\|flow\.turns>=flow\.maxTurns\)\{finishDialogue\(flow,agent\);return;\}/);
  assert.match(renderer, /const DIALOG_MAX_TURNS=8;/);
  // 시작 전 양쪽 catch-up 캡처 (첫 턴 연결용)
  assert.match(renderer, /dialogCatchUp:\{codex:window\.TriadRecentContext\.crossAgentPacket\(state\.messages,'codex',names\),claude:window\.TriadRecentContext\.crossAgentPacket\(state\.messages,'claude',names\)\}/);
});

test('[[검토요청]] 마커: 에이전트가 스스로 산출물 검수를 상대에게 넘긴다', () => {
  assert.match(renderer, /const REVIEW_REQUEST=\/\\\[\\\[\\s\*검토\\s\*요청\\s\*\\\]\\\]\/u;/);
  // 프롬프트가 마커 사용을 안내 (작업성 티어만)
  assert.match(renderer, /답변 맨 끝에 \[\[검토요청\]\]을 붙이세요/);
  // 표시 전에 마커 제거 + reviewSource 없는 실행(검토 실행 자체)은 재트리거 금지
  assert.match(renderer, /if\(REVIEW_REQUEST\.test\(m\.text\|\|''\)\)\{selfReviewAsk=true;/);
  // 검수 캘리브레이션: 확인 근거 필수·억지 반박 금지·문제 없으면 동의가 정답
  assert.match(renderer, /확인하지 않은 추측성 반례를 만들지 마세요/);
  assert.match(renderer, /억지로 지적거리를 만들지 말고/);
  assert.match(renderer, /동조하지 말고 명확히 짚으세요/);
});

test('앱 재시작 후 첫 메시지는 재개 여부와 무관하게 최근 맥락을 프라이밍한다', () => {
  assert.match(renderer, /const primedAfterBoot=new Set\(\)/);
  assert.match(renderer, /const firstSinceBoot=!primedAfterBoot\.has\(primeKey\)/);
  assert.match(renderer, /if\(packet\)primedAfterBoot\.add\(primeKey\)/);
});

test('작업 환경 라인: 상호작용 프롬프트가 양쪽 폴더를 명시해 "같은 저장소" 가정을 막는다', () => {
  assert.match(renderer, /function workspaceContextLine\(agent\)/);
  assert.match(renderer, /서로 다른 폴더\/저장소입니다\. 상대 폴더의 파일·커밋·브랜치는 당신에게 보이지 않는 것이 정상/);
  // 주입 지점: #대화 첫 턴 · 협업 리드 · 검토 프롬프트
  assert.match(renderer, /\$\{catchUp\}\\n\$\{workspaceContextLine\(agent\)\}/);
  assert.match(renderer, /ask_agent 도구로 요청하세요\(답변은 이 실행 안으로 돌아옵니다\)/);
  assert.match(renderer, /\$\{workspaceContextLine\(reviewer\)\}/);
  // 폴더 다르면 검토자는 확인 가능한 범위만 직접 검증
  assert.match(renderer, /당신 폴더에서 확인 가능한 범위만 직접 검증/);
  // 독립 실행 작업 티어도 양쪽 폴더 명시 (상호 호출이 열렸으므로)
  assert.match(renderer, /\$\{boardBlock\}\\n\$\{workspaceContextLine\(agent\)\}/);
  // MCP 보조 프롬프트도 양쪽 경로 명시
  const mcp = fs.readFileSync(path.join(__dirname, '../Resources/triad-mcp-server.cjs'), 'utf8');
  assert.match(mcp, /요청한 AI의 작업 폴더 = \$\{callerWs\}/);
});

test('통합: 독립 실행도 ask_agent로 상대를 자연 호출하고, 대화 전환은 [[대화시작]] 모델 판단이다', () => {
  // 브로커: dialog만 제외하고 ask_agent 개방 (독립 실행 포함)
  const broker = fs.readFileSync(path.join(__dirname, '../electron/lib/broker.js'), 'utf8');
  assert.match(broker, /allowAskAgent: collaborationMode !== 'dialog'/);
  // 독립 스캐폴드: 호출 금지 문구 삭제 + ask_agent 안내
  assert.doesNotMatch(renderer, /이 실행에서는 상대 AI를 호출하지 마세요/);
  assert.match(renderer, /ask_agent 도구로 요청하세요\(답변은 이 실행 안으로 돌아옵니다\)/);
  // 키워드 정규식 대신 마커: [[대화시작]] 지시 + finishAgent 감지 + runId 1회 전환
  assert.match(renderer, /답변 대신 정확히 \[\[대화시작\]\] 한 줄만 출력하세요/);
  assert.match(renderer, /const DIALOG_START=\/\\\[\\\[\\s\*대화\\s\*시작\\s\*\\\]\\\]\/u;/);
  assert.match(renderer, /if\(DIALOG_START\.test\(m\.text\|\|''\)\)\{dialogAsk=true;/);
  assert.match(renderer, /dialogueStartedRuns\.has\(runKey\)/);
  assert.match(renderer, /enqueueCollaboration\(pending\.reviewSource,pending\.reviewSource,null,\{\.\.\.state\.collaboration,mode:'dialog',lead:agent\}/);
  // 라우터에는 더 이상 자연어 키워드 정규식이 없다 (태그만)
  const router = fs.readFileSync(path.join(__dirname, '../Resources/router.js'), 'utf8');
  assert.doesNotMatch(router, /DIALOG_INTENT|REVIEW_INTENT/);
});
