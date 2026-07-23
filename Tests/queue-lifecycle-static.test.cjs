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
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.43\.0<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>62<\/string>/);
});

test('독립 실행은 대상 슬롯과 공유 문서 충돌을 분리해 판단한다', () => {
  assert.match(renderer, /function independentContextForConversation\(conversationId\)/);
  assert.match(renderer, /pending\.sharedContext\?\.board\?\.phase==='independent'/);
  assert.match(renderer, /function runningDocumentConflict\(conversationId, documentId, sharedContext=null\)/);
  assert.match(renderer, /pending\.conversationId===conversationId[\s\S]*?pending\.sharedContext\?\.runId===sharedContext\?\.runId/);
  assert.match(renderer, /function independentRequestQueued\(targets, documentId, sharedContext=null\)/);
  assert.match(renderer, /if\(targets\.some\(agent=>state\.running\[agent\]\)\)return true/);
  assert.match(renderer, /const sameConversationContext=state\.collaboration\.mode==='independent'\?independentContextForConversation\(state\.activeConversationId\):null/);
  assert.match(renderer, /const reusableContext=sameConversationContext&&routed\.targets\.every\(agent=>!state\.running\[agent\]\)\?sameConversationContext:null/);
  assert.match(renderer, /enqueueIndependentBatch\(routed\.targets,routed\.prompts,original,userMessageId,\{sharedContext:null,documentId:requestedDocumentId\}\)/);
  assert.match(renderer, /const independentContext=reusableContext\|\|createIndependentSharedContext/);
  assert.match(renderer, /item\.sharedContext\|\|createIndependentSharedContext/);
  assert.match(renderer, /targets\.some\(agent=>state\.running\[agent\]\)\|\|runningDocumentConflict\(item\.conversationId,documentId,item\.sharedContext\)/);
  assert.match(renderer, /backgroundDocumentIds: new Map\(\)/);
});

test('백그라운드 실행은 시작 대화에 설정과 스트림을 고정한다', () => {
  assert.match(renderer, /function withConversation\(conversationId, work\)/);
  assert.match(renderer, /if\(!conversationId\)return work\(\);[\s\S]*?if\(!target\)return undefined/);
  assert.match(renderer, /const hadVisibleSave=!!state\.saveTimer;[\s\S]*?clearTimeout\(state\.saveTimer\);state\.saveTimer=null;[\s\S]*?if\(state\.storageReady&&hadVisibleSave\)post\(\{action:'saveConversation',conversation:visible\}\)/);
  assert.match(renderer, /Background work can also schedule the shared debounce[\s\S]*?clearTimeout\(state\.saveTimer\);state\.saveTimer=null;[\s\S]*?conversation:updated/);
  assert.match(renderer, /visible chat data did not change[\s\S]*?renderStatus\(\);renderQueue\(\);/);
  const backgroundRestore=renderer.slice(renderer.indexOf('function withConversation'),renderer.indexOf('function withPendingConversation'));
  assert.doesNotMatch(backgroundRestore, /renderAll\(\)/);
  assert.match(renderer, /conversationId:state\.activeConversationId,config:clone\(state\.settings\[agent\]\)/);
  assert.match(renderer, /conversationId:state\.activeConversationId,settings:clone\(state\.settings\)/);
  assert.match(renderer, /withPendingConversation\(agent,\(\)=>parseLine\(agent,line\)\)/);
  assert.match(renderer, /withPendingConversation\(agent,\(\)=>finishAgent\(agent,exitCode\)\)/);
  assert.match(renderer, /backgroundWaits: new Set\(\)/);
  assert.match(renderer, /state\.backgroundWaits\.has\(conversationId\)/);
  assert.match(renderer, /const conversationId=pending\?\.conversationId;[\s\S]*?state\.backgroundWaits\.add\(conversationId\)/);
  assert.match(renderer, /setTimeout\(\(\)=>\{\s*try \{\s*withConversation\(conversationId,\(\)=>\{/);
  assert.match(renderer, /state\.backgroundWaits\.delete\(conversationId\);[\s\S]*?state\.backgroundDocumentIds\.delete\(documentId\);[\s\S]*?done\(\);/);
  assert.match(renderer, /setTimeout\(\(\)=>\{\s*withConversation\(flow\.conversationId,\(\)=>\{/);
  assert.match(renderer, /if\(Object\.values\(state\.pending\)\.some\(pending=>pending\?\.conversationId===conversationId\)/);
  assert.doesNotMatch(renderer, /function newConversation\(skipPersist=false\) \{\s*if\(agents\.some/);
  assert.doesNotMatch(renderer, /function selectConversation\(conversationId\) \{\s*if\(conversationId===state\.activeConversationId\|\|agents\.some/);
});
