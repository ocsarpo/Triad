const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');
const plist = fs.readFileSync(path.join(__dirname, '../Resources/Info.plist'), 'utf8');

test('대기 사용자 메시지는 생성부터 deferred이며 dequeue에서만 원자적으로 공개한다', () => {
  assert.match(renderer, /const userMessageId=addMessage\('user',original,false,\{deferred:queued\}\)/);
  assert.match(renderer, /if\(!window\.TriadQueue\.shouldRenderMessage\(m\)\)continue/);
  assert.match(renderer, /message\.deferred=false;message\.workStarted=true;state\.forceMessageBottom=true/);
  assert.match(renderer, /save\(\);renderMessages\(\);requestAnimationFrame/);
  assert.match(renderer, /removeDeferredOrphans\(conversation\.messages\|\|\[\]\)/);
  assert.match(renderer, /const messages=removeDeferredOrphans\(conversation\.messages\|\|\[\]\)/);
  assert.match(renderer, /recoveredConversationIds\.add\(conversation\.id\)/);
});

test('취소는 마지막 미시작 대기 메시지만 지우고 큐 drain을 단일 예약한다', () => {
  assert.match(renderer, /window\.TriadQueue\.canRemoveMessage\(state\.queue,item,message\)/);
  assert.match(renderer, /function scheduleQueueDrain\(\)/);
  assert.match(renderer, /if\(state\.queueDrainScheduled\)return/);
  assert.match(renderer, /scheduleQueueDrain\(\);/);
});

test('사용자 중지는 재시도와 contribution 대기를 건너뛰며 대기열을 보존한다', () => {
  assert.match(renderer, /stopRequested: \{ codex:false, claude:false \}/);
  assert.match(renderer, /if\(state\.stopRequested\[agent\]\)\{finishStoppedAgent\(agent\);return;\}/);
  assert.match(renderer, /사용자가 중지했습니다\./);
  assert.match(renderer, /!state\.stopRequested\[agent\] && !state\.pending\[agent\]\?\.retried/);
  assert.match(renderer, /if\(state\.orchestration\)cancelCollaboration\('사용자가 중지했습니다\.'\)/);
  assert.match(renderer, /현재 실행만 중지하고 대기 작업은 유지합니다/);
  assert.match(renderer, /scheduleQueueDrain\(\);/);
  assert.match(renderer, /function parseLine[\s\S]*?if\(state\.stopRequested\[agent\]\)return;[\s\S]*?recordProviderFailure/);
  assert.match(renderer, /event\.type==='error'.*failAgent\(event\.agent,event\.message,\{source:'native',terminal:true\}\)/);
});

test('종료 이벤트는 실행 ID로 늦은 이벤트를 무시한다', () => {
  assert.match(renderer, /const runId=id\(\)/);
  assert.match(renderer, /session,runId/);
  assert.match(renderer, /event\.runId&&state\.pending\[event\.agent\]\?\.runId!==event\.runId/);
  assert.match(native, /NSString \*runId = TriadStringOrNil\(request\[@"runId"\]\) \?: @""/);
  assert.match(native, /@"runId": runId/);
});

test('대기열 생명주기 변경의 앱 버전은 이 테스트에서 검증한다', () => {
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.41\.0<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>60<\/string>/);
});
