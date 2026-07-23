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
const { tasksFor, rolesFor, harnessTasks, shouldRunResolution, boardStageError, promptEnvelope, extractHandoff } = context.TriadCollaboration;
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

test('공유 보드 하네스는 시작 AI와 무관하게 owner → reviewer → owner 순서다', () => {
  assert.deepEqual(plain(rolesFor('codex')), { owner: 'codex', reviewer: 'claude' });
  assert.deepEqual(plain(rolesFor('claude')), { owner: 'claude', reviewer: 'codex' });
  assert.deepEqual(plain(harnessTasks('claude').map(task => [task.agent, task.kind])), [
    ['claude', 'proposal'], ['codex', 'verdict'], ['claude', 'resolve'], ['claude', 'decision']
  ]);
});

test('agree verdict는 이견 해결 라운드를 생략한다', () => {
  assert.equal(shouldRunResolution('agree'), false);
  assert.equal(shouldRunResolution('conditional'), true);
  assert.equal(shouldRunResolution('disagree'), true);
});

test('하네스는 필수 보드 기록을 강제한다', () => {
  assert.match(boardStageError({ kind: 'proposal' }, { proposal: '' }), /proposal/);
  assert.match(boardStageError({ kind: 'verdict' }, { verdict: null }), /verdict/);
  assert.match(boardStageError({ kind: 'decision' }, { decision: '' }), /decision/);
  assert.equal(boardStageError({ kind: 'verdict' }, { verdict: 'agree' }), null);
});

test('협업 프롬프트 봉투에는 전체 transcript가 포함되지 않는다', () => {
  const envelope = promptEnvelope({ lead: 'claude', objective: '요청', task: { agent: 'claude', phase: 'proposal' }, board: { revision: 0 }, sections: ['objective'] });
  assert.equal(envelope.role, 'owner');
  assert.equal(envelope.includesTranscript, false);
  assert.equal(Object.hasOwn(envelope, 'transcript'), false);
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
