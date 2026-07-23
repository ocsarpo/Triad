const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Native 실행은 agent 대신 slotId로 격리하고 모든 실행 이벤트에 요청 메타데이터를 붙인다', () => {
  const native = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');
  assert.match(native, /NSString \*conversationId = TriadStringOrNil\(request\[@"conversationId"\]\) \?: @""/);
  assert.match(native, /slotIdForRequest:request agent:agent conversationId:conversationId runId:runId/);
  assert.match(native, /runMetadataForAgent:agent conversationId:conversationId slotId:slotId runId:runId/);
  assert.match(native, /self\.tasks\[slotId\] = task/);
  assert.doesNotMatch(native, /self\.tasks\[agent\]/);
  assert.match(native, /self\.brokerArtifacts\[slotId\] = artifacts/);
  assert.match(native, /self\.brokerEventTasks\[slotId\] = tail/);
  assert.match(native, /\[message addEntriesFromDictionary:metadata \?: @\{\}\]/);
  assert.match(native, /event\[@"type"\] = @"raw"/);
  assert.match(native, /event\[@"type"\] = @"stderr"/);
  assert.match(native, /terminated\[@"type"\] = @"terminated"/);
});

test('Native 종료와 브로커 cleanup은 늦은 이전 실행이 새 슬롯을 제거하지 않게 제한한다', () => {
  const native = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');
  assert.match(native, /if \(weakSelf\.tasks\[slotId\] == finished\)/);
  assert.match(native, /cleanupBrokerForSlotId:slotId expectedArtifacts:broker/);
  assert.match(native, /expectedArtifacts && artifacts != expectedArtifacts/);
  assert.match(native, /stopAgent:\(NSString \*\)agent slotId:\(NSString \*\)requestedSlotId conversationId:\(NSString \*\)conversationId runId:\(NSString \*\)runId/);
  assert.match(native, /if \(matches\.count == 1\)/);
  assert.match(native, /중지할 실행을 식별하지 못했습니다/);
});

test('Native 프로젝트 조회 결과는 요청 대화 ID를 비동기 성공·오류 모두에 그대로 전달한다', () => {
  const native = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');
  assert.match(native, /loadProjectDiff:body\[@"workspace"\] agent:body\[@"agent"\] conversationId:body\[@"conversationId"\]/);
  assert.match(native, /loadGitBranch:body\[@"workspace"\] agent:body\[@"agent"\] conversationId:body\[@"conversationId"\]/);
  assert.match(native, /loadProjectFiles:body\[@"workspace"\] agent:body\[@"agent"\] conversationId:body\[@"conversationId"\]/);
  assert.match(native, /loadProjectDiff:\(NSString \*\)workspace agent:\(NSString \*\)agent conversationId:\(NSString \*\)conversationId/);
  assert.match(native, /loadGitBranch:\(NSString \*\)workspace agent:\(NSString \*\)agent conversationId:\(NSString \*\)conversationId/);
  assert.match(native, /loadProjectFiles:\(NSString \*\)workspace agent:\(NSString \*\)agent conversationId:\(NSString \*\)conversationId/);
  assert.equal((native.match(/@"type": @"diffResult"[\s\S]{0,180}@"conversationId": sourceConversationId/g) || []).length, 3);
  assert.equal((native.match(/@"type": @"branchResult"[\s\S]{0,180}@"conversationId": sourceConversationId/g) || []).length, 2);
  assert.equal((native.match(/@"type": @"projectFiles"[\s\S]{0,180}@"conversationId": sourceConversationId/g) || []).length, 2);
});
