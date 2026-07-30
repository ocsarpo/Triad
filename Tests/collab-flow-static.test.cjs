const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('회의실 질답: 질문 메시지는 유지되고 답변은 별도 메시지로 추가된다', () => {
  // 질문(agent_call_started)은 그대로 두고 스피너만 끈다
  assert.match(renderer, /const qid=state\.brokerMessages\[event\.id\];if\(qid\)updateMessage\(qid,m=>\{m\.streaming=false;\}\)/);
  // 답변은 새 메시지 (덮어쓰기 아님)
  assert.match(renderer, /const answerId=addMessage\('system',L\('handoffAnswer',\{\.\.\.fields,body:preview\}\),false\)/);
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
  assert.match(renderer, /if\(!\['agent','dialog'\]\.includes\(collaboration\.mode\)\)collaboration\.mode='independent';/);
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
  assert.match(renderer, /pending\?\.reviewRequested&&!state\.orchestration/);
  assert.match(renderer, /enqueueReviewRun\(agent,pending\.reviewSource\|\|'',answerText\)/);
  // 협업(agent) 완료 후에도 검토 가능
  assert.match(renderer, /if\(flow\?\.reviewRequested\)\{/);
  // 검토 프롬프트는 보드 의식 없이 판정+근거만 요구
  assert.match(renderer, /판정\(동의 \/ 보완 필요\)으로 시작/);
  // 진행 중이면 대기열이 순서를 보장 (검토 실행은 kind 'agent' 큐 항목)
  assert.match(renderer, /교차 검토 대기열 등록/);
});

test('완료 조기표기 방지: 미해결 회의실 질답이 있으면 "완료"를 보류한다', () => {
  assert.match(renderer, /function finishAgentFlowWhenReady\(flow, agent, message\)/);
  assert.match(renderer, /if\(Object\.keys\(state\.brokerMessages\)\.length\)\{flow\.pendingFinish=\{agent,message\};/);
  // MCP 흐름은 150ms 파일 tail을 감안해 잠깐 대기
  assert.match(renderer, /if\(flow\.mcpCalls>0\)setTimeout\(\(\)=>\{if\(state\.orchestration===flow\)withConversation\(flow\.conversationId,go\);\},500\)/);
  assert.match(renderer, /function drainPendingAgentFinish\(\)/);
  // 마지막 답변이 렌더된 뒤(brokerMessages 비면) 보류된 완료를 게시
  assert.match(renderer, /if\(flow\?\.pendingFinish&&!Object\.keys\(state\.brokerMessages\)\.length\)/);
  // advanceCollaboration의 최종 완료는 지연 버전을 쓴다
  assert.match(renderer, /finishAgentFlowWhenReady\(flow,agent\);return;/);
});

test('#대화: 두 AI가 채팅에서 직접 말을 주고받고 [[대화종료]] 또는 최대 턴에서 끝난다', () => {
  // send: dialog 태그가 실행별 dialog 모드를 만든다
  assert.match(renderer, /if\(routed\.dialog\|\|state\.collaboration\.mode!=='independent'\)\{/);
  assert.match(renderer, /\.\.\.\(routed\.dialog\?\{mode:'dialog'\}:\{\}\)/);
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
