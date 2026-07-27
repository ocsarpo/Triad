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

test('시간순 배치: 에이전트 협업 답변 말풍선은 첫 토큰에 지연 생성된다', () => {
  assert.match(renderer, /const lazyBubble=isolated&&state\.orchestration\?\.mode==='agent'/);
  assert.match(renderer, /state\.responseIds\[agent\]=lazyBubble\?null:addMessage\(agent,'',true,bubbleMeta\)/);
  assert.match(renderer, /function ensureResponseBubble\(agent\)/);
  assert.match(renderer, /function appendAgentText\(agent, text\) \{ ensureResponseBubble\(agent\)/);
  // 실패/오류 시엔 토큰이 없어도 말풍선을 만들어 오류를 표시
  assert.match(renderer, /if\(failed\)ensureResponseBubble\(agent\)/);
  // 핸드오프 시 현재 세그먼트를 봉인 → 다음 출력은 새 말풍선 (한 말풍선 누적 방지)
  assert.match(renderer, /if\(state\.responseIds\[from\]\)\{updateMessage\(state\.responseIds\[from\],m=>\{m\.streaming=false;if\(!m\.completedAt\)m\.completedAt=Date\.now\(\);\}\);state\.responseIds\[from\]=null;\}/);
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
