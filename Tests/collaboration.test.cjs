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
const { tasksFor, rolesFor, harnessTasks, shouldRunResolution, shouldEnableMcp, boardStageError, promptEnvelope, extractHandoff, documentTitleFromObjective, upsertDocument, selectedDocument, continuationInput } = context.TriadCollaboration;
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

test('독립 실행 또는 orchestration 부재에서는 MCP 브로커를 켜지 않는다', () => {
  assert.equal(shouldEnableMcp(null), false);
  assert.equal(shouldEnableMcp(undefined), false);
  assert.equal(shouldEnableMcp({ mode: 'independent' }), false);
  assert.equal(shouldEnableMcp({ mode: 'review' }), true);
  assert.equal(shouldEnableMcp({ mode: 'agent' }), true);
  assert.equal(shouldEnableMcp(null, { board: { documentId: 'doc-1' } }), true);
});

test('렌더러의 실행과 재시도 요청은 명시적 MCP predicate와 공유 문서를 함께 전달한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.doesNotMatch(renderer, /mcpEnabled:state\.orchestration\?\.mode!==['"]independent['"]/);
  assert.equal((renderer.match(/mcpEnabled:window\.TriadCollaboration\.shouldEnableMcp\(/g) || []).length, 2);
  assert.match(renderer, /continueBoard/);
  assert.match(renderer, /continueIndependentBoard/);
  assert.match(renderer, /submit_contribution/);
  assert.match(renderer, /runId: \$\{sharedContext\?\.runId/);
  assert.match(renderer, /enqueueIndependentBatch/);
  assert.match(renderer, /nativeSave:false/);
  assert.match(renderer, /waitForIndependentContribution\(agent,pending,scheduleQueueDrain\)/);
  assert.match(renderer, /sharedDocumentsLocked\(\)/);
  assert.doesNotMatch(renderer, /row\.disabled=documentLocked/);
  assert.doesNotMatch(renderer, /if\(!force&&sharedDocumentsLocked\(\)\)return/);
  assert.match(renderer, /activeSharedDocument\(\)\|\|state\.orchestration\?\.sharedContext\?\.board/);
  assert.match(renderer, /function currentWorkSharedDocument\(\)/);
  assert.match(renderer, /if\(!state\.running\[agent\]\)continue/);
  assert.match(renderer, /현재 AI 실행은 기존 작업 문서를 계속 사용합니다/);
  assert.match(renderer, /documentIdOf\(canonical\)===state\.activeSharedDocumentId/);
  assert.doesNotMatch(renderer, /documentIdOf\(canonical\)===state\.activeSharedDocumentId\|\|current\?\.documentId/);
  assert.match(renderer, /if\(state\.orchestration&&documentIdOf\(state\.orchestration\.sharedContext\?\.board\)===documentIdOf\(canonical\)\)/);
  assert.match(renderer, /the user is browsing a different document/);
  assert.match(renderer, /waitForIndependentContribution/);
  assert.match(renderer, /공유 문서 기여 미확인/);
  assert.match(renderer, /const canonical=upsertSharedDocument/);
  assert.doesNotMatch(renderer, /for\s*\(const document of state\.sharedDocuments\)/);
  assert.match(renderer, /for\s*\(const sharedDocument of state\.sharedDocuments\)/);
});

test('공유 보드 프롬프트는 manifest-first이며 독립 실행에 과거 기여를 반복 주입하지 않는다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /sections,maxCharacters:4000/);
  assert.match(renderer, /window\.TriadSharedContext\.manifest\(board\)/);
  assert.match(renderer, /shared_context_read\(history\/contributions\)를 사용하세요/);
  assert.doesNotMatch(renderer, /sections:\['objective','constraints','decision'\],maxCharacters:12000/);
  // 빈 보드 인덱스는 생략(빈 manifest ~170토큰 낭비 방지), 내용 있는 섹션만 나열
  assert.match(renderer, /function promptBoardIndex\(board\)/);
  assert.match(renderer, /\(s\.characters\|\|0\)>4\|\|\(s\.items\|\|0\)>0/);
  assert.match(renderer, /const boardBlock=boardIndex\?/);
});

test('공유 문서 화면은 현재 작업과 접이식 실행 기록을 분리해 렌더한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /currentHeading\.textContent='현재 작업'/);
  assert.match(renderer, /L\('runHistory',\{n:history\.length\}\)/);
  assert.match(renderer, /document\.createElement\('details'\)/);
  assert.match(renderer, /history\.slice\(\)\.reverse\(\)/);
  assert.match(renderer, /historyContributionText\(entry\.contributions\)/);
  assert.match(renderer, /decisionTitle\.textContent='결론'/);
  assert.match(renderer, /decision\.textContent=entry\.decision\|\|'결론이 기록되지 않았습니다\.'/);
  assert.match(renderer, /AI 기여 요약/);
  // Legacy records only have decision text. They retain that text as the
  // conclusion; no synthetic contribution section is rendered without data.
  assert.match(renderer, /if\(contribution\)\{const contributionTitle/);
  assert.match(renderer, /board-history-entry/);
});

test('공유 문서는 최근 수정 순으로 합치고 선택 ID로만 찾는다', () => {
  const first = { documentId: 'first', updatedAt: '2026-07-21T00:00:00.000Z' };
  const newer = { documentId: 'newer', updatedAt: '2026-07-22T00:00:00.000Z' };
  const replaced = { documentId: 'first', updatedAt: '2026-07-23T00:00:00.000Z' };
  const documents = upsertDocument(upsertDocument([first], newer), replaced);
  assert.deepEqual(plain(documents.map(item => item.documentId)), ['first', 'newer']);
  assert.equal(selectedDocument(documents, 'newer').documentId, 'newer');
  assert.equal(selectedDocument(documents, 'missing'), null);
});

test('새 실행 시 의제 제목과 run ID만 넘겨 이전 단계 값을 재사용하지 않는다', () => {
  assert.equal(documentTitleFromObjective('  환불 API 설계를\n상세히 검토해줘'), '환불 API 설계를');
  assert.deepEqual(plain(continuationInput({ conversationId: 'chat-1', runId: 'run-2', objective: '새 의제', owner: 'claude' })), {
    conversationId: 'chat-1', runId: 'run-2', objective: '새 의제', owner: 'claude'
  });
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
