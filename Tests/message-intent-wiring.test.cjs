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
  // #3: 재개 세션이면 recentContext를 비운다
  assert.match(renderer, /const willResume=state\.sessions\?\.\[agent\]&&cfg\.sessionPolicy!=='alwaysNew'&&!window\.TriadSessionBudget\.shouldRotate\(cfg,stats,true\)/);
  assert.match(renderer, /willResume\?'':window\.TriadRecentContext\.packetFor\(state\.messages,agent\)/);
});

test('패키저는 message-intent 모듈을 앱 리소스로 복사한다', () => {
  const packager = fs.readFileSync(path.join(__dirname, '../scripts/package-app.sh'), 'utf8');
  assert.match(packager, /Resources\/message-intent\.js/);
});
