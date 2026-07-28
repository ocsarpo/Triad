const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');

test('각 말풍선은 렌더링 결과가 아닌 저장된 원문을 전체 복사한다', () => {
  assert.match(renderer, /copy.className='bubble-copy'/);
  assert.match(renderer, /copyMessageText\(m\.id,fullBody\)/);
  assert.match(renderer, /const fullBody=String\(m\.fullText\|\|\(m\.boardResult\?/);
  assert.match(renderer, /마크다운과 줄바꿈을 포함한 원문 전체 복사/);
  assert.match(renderer, /copy\.addEventListener\('click',event=>\{event\.preventDefault\(\);event\.stopPropagation\(\);/);
});

test('클립보드는 native bridge를 우선하고 WKWebView 외 환경에서는 fallback을 사용한다', () => {
  assert.match(renderer, /post\(\{action:'copyText',requestId,text\}\)/);
  assert.match(renderer, /navigator\.clipboard\?\.writeText/);
  assert.match(renderer, /document\.execCommand\('copy'\)/);
  assert.match(renderer, /event\.type==='clipboardResult'/);
  assert.match(native, /\[action isEqualToString:@"copyText"\]/);
  assert.match(native, /NSPasteboard\.generalPasteboard/);
  assert.match(native, /@"type": @"clipboardResult"/);
});

test('복사 결과는 성공·실패를 버튼에 명확하게 표시한다', () => {
  assert.match(renderer, /setCopyFeedback\(messageId,\{label:'복사됨'/);
  assert.match(renderer, /setCopyFeedback\(messageId,\{label:'복사 실패'/);
  assert.match(renderer, /delete state\.copyFeedback\[messageId\];renderMessages\(\)/);
});

test('스트리밍 재렌더 뒤에도 messageId 기반 복사 피드백을 이어간다', () => {
  assert.match(renderer, /clipboardRequests:\{\}, copyFeedback:\{\}/);
  assert.match(renderer, /state\.clipboardRequests\[requestId\]=\{messageId,text,timer\}/);
  assert.match(renderer, /function applyCopyFeedback\(button, messageId, hasText\)/);
  assert.match(renderer, /const feedback=state\.copyFeedback\[messageId\]/);
  assert.match(renderer, /applyCopyFeedback\(copy,m\.id,fullBody\.length>0\)/);
});

test('AI 말풍선 하단에는 전체 복사와 답장 액션을 함께 표시한다', () => {
  assert.match(renderer, /\.bubble-actions \{ display: flex; justify-content: flex-end; gap: 6px;/);
  assert.doesNotMatch(renderer, /\.bubble-copy \{\s*margin-left: auto/);
  assert.match(renderer, /const actions=document\.createElement\('div'\);actions\.className='bubble-actions'/);
  assert.match(renderer, /actions\.appendChild\(copy\)/);
  assert.match(renderer, /if\(agents\.includes\(m\.author\)\)\{const reply=/);
  assert.match(renderer, /actions\.appendChild\(reply\)/);
  assert.match(renderer, /wrap\.append\(who,bubble\)/);
  assert.match(renderer, /wrap\.append\(actions\)/);
});

test('말풍선에 시각·날짜 스탬프를 표시한다 (답변 시작 / 작성 완료)', () => {
  assert.match(renderer, /function stampFmt\(ts\)/);
  assert.match(renderer, /className='bubble-time'/);
  assert.match(renderer, /답변 시작 \$\{stampFmt\(m\.startedAt\)\}/);
  assert.match(renderer, /작성 완료 \$\{stampFmt\(m\.completedAt\)\}/);
  // 첫 토큰에 startedAt, 완료 지점에 completedAt 기록
  assert.match(renderer, /if\(!m\.startedAt\)m\.startedAt=Date\.now\(\)/);
  assert.match(renderer, /m\.completedAt=Date\.now\(\)/);
});

test('답장은 실행 기록이 있으면 참조를 붙이고 없어도 해당 AI를 호출한다', () => {
  assert.match(renderer, /const agentTag=`#\$\{m\.replyAgent\|\|m\.author\}`/);
  assert.match(renderer, /const reference=m\.recordId\?`@실행\[\$\{m\.recordId\}\]`:\'\'/);
  assert.match(renderer, /const additions=\[\];[\s\S]*?additions\.push\(agentTag\)/);
  assert.match(renderer, /if\(reference&&!text\.includes\(reference\)\)additions\.push\(reference\)/);
  assert.match(renderer, /m\.recordId\?'이 AI에게 이 실행 기록을 참고해 답장합니다\.':'이 AI에게 답장합니다\.'/);
});
