const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../Resources/collaboration.js'), 'utf8'),
  context
);
const { tasksFor, extractHandoff } = context.TriadCollaboration;
const plain = value => JSON.parse(JSON.stringify(value));

test('상호 토론은 두 AI를 라운드마다 교대시킨다', () => {
  assert.deepEqual(plain(tasksFor({ mode: 'debate', lead: 'codex', rounds: 2, finalizer: 'none' })), [
    { agent: 'codex', kind: 'debate', round: 1 },
    { agent: 'claude', kind: 'debate', round: 1 },
    { agent: 'codex', kind: 'debate', round: 2 },
    { agent: 'claude', kind: 'debate', round: 2 }
  ]);
});

test('상호 토론의 최종 종합자를 마지막에 배치한다', () => {
  const tasks = tasksFor({ mode: 'debate', lead: 'claude', rounds: 1, finalizer: 'codex' });
  assert.deepEqual(plain(tasks.at(-1)), { agent: 'codex', kind: 'synthesize', round: 2 });
});

test('교차 검토는 초안, 검토, 수정 순서로 진행한다', () => {
  assert.deepEqual(plain(tasksFor({ mode: 'review', lead: 'claude', rounds: 1 })), [
    { agent: 'claude', kind: 'draft', round: 0 },
    { agent: 'codex', kind: 'critique', round: 1 },
    { agent: 'claude', kind: 'revise', round: 1 }
  ]);
});

test('독립 실행에는 릴레이 작업이 없다', () => {
  assert.deepEqual(plain(tasksFor({ mode: 'independent', lead: 'codex', rounds: 3 })), []);
});

test('Codex의 Claude 인계 요청을 구조화해 추출한다', () => {
  const result = extractHandoff('조사가 필요합니다.\n[[TRIAD_HANDOFF]]\n{"to":"claude","question":"Jira 상태를 확인해줘","reason":"MCP 필요"}\n[[/TRIAD_HANDOFF]]', 'codex');
  assert.equal(result.text, '조사가 필요합니다.');
  assert.deepEqual(plain(result.handoff), { to: 'claude', question: 'Jira 상태를 확인해줘', reason: 'MCP 필요' });
  assert.equal(result.error, null);
});

test('Claude도 Codex에게 역방향 인계를 요청할 수 있다', () => {
  const result = extractHandoff('[[TRIAD_HANDOFF]]{"to":"codex","question":"이 코드를 검증해줘"}[[/TRIAD_HANDOFF]]', 'claude');
  assert.deepEqual(plain(result.handoff), { to: 'codex', question: '이 코드를 검증해줘', reason: '' });
});

test('자기 자신이나 잘못된 상대에게 보내는 인계는 거부한다', () => {
  const result = extractHandoff('[[TRIAD_HANDOFF]]{"to":"codex","question":"질문"}[[/TRIAD_HANDOFF]]', 'codex');
  assert.equal(result.handoff, null);
  assert.match(result.error, /claude/);
});
