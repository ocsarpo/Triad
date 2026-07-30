const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/recent-context.js'), 'utf8'), sandbox);
const context = sandbox.TriadRecentContext;
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
const packager = fs.readFileSync(path.join(__dirname, '../scripts/package-app.sh'), 'utf8');

test('대상 AI의 최근 여러 턴을 오래된 순으로 모으되 다른 AI 기록은 제외한다', () => {
  const packet = context.packetFor([
    { author:'user', text:'첫 요청' }, { author:'codex', text:'첫 Codex 답변' },
    { author:'user', text:'Claude에게만 물어봄' }, { author:'claude', text:'Claude 답변' },
    { author:'user', text:'Codex 후속 요청' }, { author:'codex', text:'최신 Codex 답변' }
  ], 'codex');
  // Codex 자신의 턴은 모두 남는다(직전 1턴이 아니라 최근 N턴).
  assert.match(packet, /첫 요청/);
  assert.match(packet, /첫 Codex 답변/);
  assert.match(packet, /Codex 후속 요청/);
  assert.match(packet, /최신 Codex 답변/);
  // 다른 AI의 답변과, 다른 AI에게만 향한 요청은 들어오지 않는다.
  assert.doesNotMatch(packet, /Claude 답변/);
  assert.doesNotMatch(packet, /Claude에게만 물어봄/);
  // 오래된 순: 첫 턴이 최신 턴보다 앞에 온다.
  assert.ok(packet.indexOf('첫 Codex 답변') < packet.indexOf('최신 Codex 답변'));
});

test('maxTurns로 최근 N턴만 남긴다', () => {
  const messages = [];
  for (let turn = 1; turn <= 5; turn++) {
    messages.push({ author:'user', text:`요청${turn}` });
    messages.push({ author:'codex', text:`답변${turn}` });
  }
  const packet = context.packetFor(messages, 'codex', { maxTurns: 2 });
  assert.match(packet, /답변5/);
  assert.match(packet, /답변4/);
  assert.doesNotMatch(packet, /답변3/);
});

test('턴이 하나뿐이면 헤더 없이 단일 쌍만 낸다', () => {
  const packet = context.packetFor([{author:'user',text:'요청'},{author:'codex',text:'답변'}], 'codex');
  assert.doesNotMatch(packet, /최근 .*턴 대화/);
  assert.match(packet, /요청/);
  assert.match(packet, /답변/);
});

test('다른 AI만 응답했거나 첫 요청이면 패킷이 비어 있다', () => {
  assert.equal(context.packetFor([{author:'user',text:'첫 요청'}], 'codex'), '');
  assert.equal(context.packetFor([{author:'user',text:'요청'},{author:'claude',text:'답변'}], 'codex'), '');
});

test('긴 답변은 head와 tail을 보존하며 bounded packet으로 자른다', () => {
  const long = `시작 파일 근거 ${'x'.repeat(3000)} 결론 변경 완료`;
  const packet = context.packetFor([{author:'user',text:'요청'},{author:'codex',text:long}], 'codex');
  assert.ok(packet.length <= 3000);
  assert.match(packet, /시작 파일 근거/);
  assert.match(packet, /결론 변경 완료/);
  assert.match(packet, /…\(중략\)…/);
});

test('전송 시점 패킷은 즉시 실행과 대기열에 같은 agent별 snapshot으로 연결된다', () => {
  assert.match(renderer, /<script src="recent-context\.js"><\/script>/);
  assert.match(renderer, /const recentContexts=\{\};const fallbackContexts=\{\};/);
  // 재개 세션이면 최근맥락을 생략(히스토리에 이미 있음), 신규/회전 세션에만 주입.
  // 재개 예정이던 턴은 fallback으로 보관 — 재개 실패 재시도 때 재주입.
  assert.match(renderer, /const packet=window\.TriadRecentContext\.packetFor\(state\.messages,agent\)/);
  assert.match(renderer, /recentContexts\[agent\]=\(willResume&&!firstSinceBoot\)\?'':packet;/);
  assert.match(renderer, /fallbackContexts\[agent\]=\(willResume&&!firstSinceBoot\)\?packet:'';/);
  assert.match(renderer, /recentContexts:clone\(options\.recentContexts\|\|\{\}\)/);
  assert.match(renderer, /item\.recentContexts\?\.\[agent\]\|\|''/);
  assert.match(renderer, /buildIndependentPrompt\(agent,routed\.prompts\[agent\],independentContext,recentContexts\[agent\],referencePacket,crossContexts\[agent\]\)/);
  assert.match(packager, /Resources\/recent-context\.js/);
});

test('crossAgentPacket: 상대 답변만, 내 마지막 발언 이후 것만, 압축해서 넘긴다', () => {
  const rc = context; // vm 로드본 (require는 UMD에서 빈 객체 — Node 25)
  const names = { codex: 'Claude A', claude: 'Claude B' };
  const messages = [
    { author: 'user', text: '#a 검증식 분석해줘' },
    { author: 'codex', text: '분석 결과: 서버는 등호(==) 검증입니다. refundedAmount + deductedDeliveryPrice != totalPaidPrice 이면 400.' },
    { author: 'user', text: '#b 야 너 a가 얘기한대로 검증식 바꿔라' }
  ];
  // B(claude)는 아직 발언 없음 → A의 답변 + 그 질문이 실린다
  const packet = rc.crossAgentPacket(messages, 'claude', names);
  assert.match(packet, /\[Claude A의 답변\]/);
  assert.match(packet, /등호\(==\) 검증/);
  assert.match(packet, /\[사용자 → Claude A\]/);
  // A 입장에서는 자기 답변 이후 상대(B) 발언이 없음 → 빈 문자열
  assert.equal(rc.crossAgentPacket(messages, 'codex', names), '');
  // B가 답하고 나면 그 이전 A 답변은 다시 실리지 않는다 (중복 누적 방지)
  const after = [...messages, { author: 'claude', text: '수정 완료했습니다.' }, { author: 'user', text: '#b 테스트도 돌려' }];
  assert.equal(rc.crossAgentPacket(after, 'claude', names), '');
  // 긴 답변은 …(중략)…으로 압축
  const long = [{ author: 'codex', text: 'x'.repeat(4000) }];
  assert.match(rc.crossAgentPacket(long, 'claude', names), /…\(중략\)…/);
});

test('방 따라잡기 배선: 단일 대상·협업 리드에만 주입, 둘 다 답하는 실행은 제외', () => {
  assert.match(renderer, /crossContexts\[agent\]=routed\.targets\.length===1\?window\.TriadRecentContext\.crossAgentPacket\(state\.messages,agent,names\):'';/);
  assert.match(renderer, /crossContexts:clone\(options\.crossContexts\|\|\{\}\)/);
  assert.match(renderer, /item\.crossContexts\?\.\[agent\]\|\|''/);
  // buildIndependentPrompt가 cross 블록을 포함
  assert.match(renderer, /const cross=crossContext\?/);
  assert.match(renderer, /상대 AI가 방금 이 대화에서 답한 내용/);
  // 대화 시작 시 양쪽 catch-up 캡처 (첫 턴 연결용)
  assert.match(renderer, /dialogCatchUp:\{codex:window\.TriadRecentContext\.crossAgentPacket\(state\.messages,'codex',names\)/);
});
