const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/queue.js'), 'utf8'), context);
const { positionFor, nextIndex, canRemoveMessage, shouldRenderMessage, removeDeferredOrphans } = context.TriadQueue;

const queue = [
  { id: 'c1', kind: 'agent', agent: 'codex' },
  { id: 'a1', kind: 'agent', agent: 'claude' },
  { id: 'c2', kind: 'agent', agent: 'codex' },
  { id: 'w1', kind: 'collaboration' }
];

test('AI별 대기 순번을 독립적으로 계산한다', () => {
  assert.equal(positionFor(queue, queue[0]), 1);
  assert.equal(positionFor(queue, queue[1]), 1);
  assert.equal(positionFor(queue, queue[2]), 2);
  assert.equal(positionFor(queue, queue[3]), 1);
});

test('대상 AI의 가장 오래된 항목을 찾는다', () => {
  assert.equal(nextIndex(queue, 'agent', 'codex'), 0);
  assert.equal(nextIndex(queue, 'agent', 'claude'), 1);
  assert.equal(nextIndex(queue, 'collaboration'), 3);
  assert.equal(nextIndex(queue, 'agent', 'missing'), -1);
});

test('마지막 대기 작업 취소 시 실행 전 사용자 메시지를 제거한다', () => {
  const removed = { id: 'q1', kind: 'agent', agent: 'codex', messageId: 'm1' };
  assert.equal(canRemoveMessage([], removed, { id: 'm1', workStarted: false }), true);
});

test('같은 메시지의 다른 대기 작업이나 시작된 작업이 있으면 메시지를 유지한다', () => {
  const removed = { id: 'q1', kind: 'agent', agent: 'codex', messageId: 'm1' };
  assert.equal(canRemoveMessage([{ id: 'q2', kind: 'agent', agent: 'claude', messageId: 'm1' }], removed, { id: 'm1' }), false);
  assert.equal(canRemoveMessage([], removed, { id: 'm1', workStarted: true }), false);
});

test('대기 메시지는 실제 작업 시작 전에는 채팅에서 숨기고 시작 시 표시한다', () => {
  const message = { id: 'm1', deferred: true, workStarted: false };
  assert.equal(shouldRenderMessage(message), false);
  assert.equal(shouldRenderMessage({ ...message, deferred: false, workStarted: true }), true);
});

test('비영속 대기열로부터 복원된 미시작 메시지는 orphan으로 제거한다', () => {
  const messages = [
    { id: 'visible' },
    { id: 'started', deferred: true, workStarted: true },
    { id: 'orphan', deferred: true, workStarted: false }
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(removeDeferredOrphans(messages).map(message => message.id))), ['visible', 'started']);
});
