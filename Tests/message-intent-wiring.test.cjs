const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('렌더러는 대화성 경량 경로와 재개 세션 최근맥락 생략을 배선한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /<script src="message-intent\.js"><\/script>/);
  // 경량 분기: referencePacket 없고 conversational이면 스캐폴드 생략
  assert.match(renderer, /window\.TriadMessageIntent\?\.isConversational\(prompt\)/);
  assert.match(renderer, /submit_contribution도 하지 말고/);
  // #3: 재개 세션이면 recentContext를 비운다 (자동 회전 제거 — 세션 존재+정책만 판단)
  assert.match(renderer, /const willResume=!!\(state\.sessions\?\.\[agent\]&&cfg\.sessionPolicy!=='alwaysNew'\)/);
  assert.match(renderer, /recentContexts\[agent\]=willResume\?'':packet;/);
});

test('세션 재개 실패 자동 재시도는 send 시점에 캡처한 직전 맥락을 재주입한다 (재시작 기억상실 방지)', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  // 재개 예정이던 턴은 fallback 패킷을 따로 보관
  assert.match(renderer, /fallbackContexts\[agent\]=willResume\?packet:'';/);
  // 즉시 실행·대기열 배치 양쪽 모두 pending까지 전달
  assert.match(renderer, /images,fallbackContext:fallbackContexts\[agent\]/);
  assert.match(renderer, /fallbackContexts:clone\(options\.fallbackContexts\|\|\{\}\)/);
  assert.match(renderer, /fallbackContext:item\.fallbackContexts\?\.\[agent\]\|\|''/);
  assert.match(renderer, /fallbackContext:options\.fallbackContext\|\|''/);
  // retryAgent가 새 세션 재시도 프롬프트에 붙인다
  assert.match(renderer, /const fallback=pending\.fallbackContext\?/);
  assert.match(renderer, /prompt:pending\.prompt\+fallback/);
});

test('질문·논의(inquiry) 티어는 기여 기록을 선택으로 낮추되 체크 정규식과 충돌하지 않는다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /window\.TriadMessageIntent\?\.isInquiry\?\.\(prompt\)/);
  // 선택 문구: "submit_contribution 도구로 runId" 표현을 피해 빨간 점 기대치가 생기지 않음
  const optional = renderer.match(/\?`결과가 다음 작업에 참고될 만하면[^`]*`/);
  assert.ok(optional, 'inquiry 선택 기록 문구가 있어야 함');
  assert.doesNotMatch(optional[0], /submit_contribution 도구로 runId/);
  // 필수 문구: 체크 정규식과 정확히 일치하는 표현 유지
  assert.match(renderer, /:`작업을 마친 뒤 submit_contribution 도구로 runId: /);
  // 답변 오염 방지: 절차 언급 금지 지시
  assert.match(renderer, /보드·기록 절차를 언급하지 말고 요청 자체에 집중하세요/);
});

test('패키저는 message-intent 모듈을 앱 리소스로 복사한다', () => {
  const packager = fs.readFileSync(path.join(__dirname, '../scripts/package-app.sh'), 'utf8');
  assert.match(packager, /Resources\/message-intent\.js/);
});
