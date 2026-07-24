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

test('대상 AI의 최신 요청·응답 한 쌍만 선택한다', () => {
  const packet = context.packetFor([
    { author:'user', text:'첫 요청' }, { author:'codex', text:'첫 Codex 답변' },
    { author:'user', text:'Claude에게만 물어봄' }, { author:'claude', text:'Claude 답변' },
    { author:'user', text:'Codex 후속 요청' }, { author:'codex', text:'최신 Codex 답변' }
  ], 'codex');
  assert.match(packet, /Codex 후속 요청/);
  assert.match(packet, /최신 Codex 답변/);
  assert.doesNotMatch(packet, /Claude 답변|첫 Codex 답변/);
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
  assert.match(renderer, /const recentContexts=Object\.fromEntries\(routed\.targets\.map\(agent=>\{/);
  // 재개 세션이면 최근맥락을 생략(히스토리에 이미 있음), 신규/회전 세션에만 주입
  assert.match(renderer, /willResume\?'':window\.TriadRecentContext\.packetFor\(state\.messages,agent\)/);
  assert.match(renderer, /recentContexts:clone\(options\.recentContexts\|\|\{\}\)/);
  assert.match(renderer, /item\.recentContexts\?\.\[agent\]\|\|''/);
  assert.match(renderer, /buildIndependentPrompt\(agent,routed\.prompts\[agent\],independentContext,recentContexts\[agent\],referencePacket\)/);
  assert.match(packager, /Resources\/recent-context\.js/);
});
