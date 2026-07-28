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

test('토론/교차검토 턴은 원문(대화)을 채팅에 띄우고 제안·검토·결정 정리는 과정 보기 토글로 둔다', () => {
  // 결과 라벨 구성 — 표시만, 추가 토큰/호출 없음
  assert.match(renderer, /const labels=\{proposal:'📝 제안',verdict:'🔍 검토',resolve:'🔧 이견 해결',decision:'✅ 결정'\}/);
  // 검토 턴은 이견·근거까지 붙여서 실속을 보여준다
  assert.match(renderer, /if\(task\.kind==='verdict'\)\{const d=flatten\(b\?\.disputes\)\.trim\(\);if\(d\)content\+=/);
  // 원문이 있으면 그게 채팅(m.text) 유지, 결과는 m.boardResult 토글로. 원문 없으면 결과를 직접 표시
  assert.match(renderer, /const hasNarration=orig&&orig!==labeled&&orig!==content&&!\/\^\(응답 없이 종료.*\)\/\.test\(orig\)/);
  assert.match(renderer, /if\(hasNarration\)\{m\.boardResult=labeled;\}\s*\n\s*else\{m\.text=labeled;delete m\.boardResult;\}/);
  // "과정 보기" 토글 + expandedTexts로 정리 과정 펼침
  assert.match(renderer, /if\(m\.boardResult\)\{const expandedNow=!!state\.expandedTexts\[m\.id\]/);
  assert.match(renderer, /toggle\.textContent=expandedNow\?L\('collapseProcess'\):L\('viewProcess'\)/);
  assert.match(renderer, /if\(m\.boardResult&&state\.expandedTexts\[m\.id\]\)displayBody=/);
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
