const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../Resources/router.js'), 'utf8'),
  context
);
const { route, collaborationLeadFor } = context.TriadRouter;
const plain = value => JSON.parse(JSON.stringify(value));

test('#codex는 Codex만 호출한다', () => {
  const result=plain(route('#codex 구현해줘'));
  assert.deepEqual(result.targets, ['codex']);
  assert.deepEqual(result.prompts, {codex:'구현해줘'});
  assert.equal(result.prompt,'구현해줘');
});

test('#all은 두 AI를 호출한다', () => {
  assert.deepEqual(plain(route('#all 검토해줘').targets).sort(), ['claude', 'codex']);
});

test('에이전트 협업의 단일 호출 태그가 시작 AI를 덮어쓴다', () => {
  assert.equal(collaborationLeadFor(route('#claude 구현해줘'), 'codex'), 'claude');
  assert.equal(collaborationLeadFor(route('#codex 구현해줘'), 'claude'), 'codex');
  assert.equal(collaborationLeadFor(route('구현해줘'), 'codex'), 'codex');
});

test('태그 없는 메시지는 대화별 기본 대상으로 라우팅한다', () => {
  assert.deepEqual(plain(route('구현해줘', { defaultTarget: 'all' }).targets), ['codex', 'claude']);
  assert.deepEqual(plain(route('구현해줘', { defaultTarget: 'codex' }).targets), ['codex']);
  assert.deepEqual(plain(route('구현해줘', { defaultTarget: 'claude' }).targets), ['claude']);
  assert.deepEqual(plain(route('구현해줘', { defaultTarget: 'unknown' }).targets), ['codex', 'claude']);
});

test('명시 호출 태그와 블록 라우팅은 기본 고정보다 우선한다', () => {
  assert.deepEqual(plain(route('#claude 검토해줘', { defaultTarget: 'codex' }).targets), ['claude']);
  const block = plain(route('#claude:\n검토해줘', { defaultTarget: 'codex' }));
  assert.equal(block.mode, 'block');
  assert.deepEqual(block.targets, ['claude']);
});

test('협업에서는 고정 대상이 태그 없는 실행의 시작 AI만 덮어쓴다', () => {
  assert.equal(collaborationLeadFor(route('구현해줘', { defaultTarget: 'codex' }), 'claude', 'codex'), 'codex');
  assert.equal(collaborationLeadFor(route('구현해줘', { defaultTarget: 'claude' }), 'codex', 'claude'), 'claude');
  assert.equal(collaborationLeadFor(route('#claude 구현해줘', { defaultTarget: 'codex' }), 'codex', 'codex'), 'claude');
});

test('협업에서 #all과 복수 호출은 시작 AI가 모호해 전송을 막는다', () => {
  assert.equal(collaborationLeadFor(route('#all 검토해줘'), 'codex', 'claude'), null);
  assert.equal(collaborationLeadFor(route('#codex 구현 #claude 검토'), 'claude', 'codex'), null);
});

test('기본 대상 고정의 렌더러 연결을 보장한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /defaultTarget:'all'/);
  assert.match(renderer, /defaultTarget:normalizeDefaultTarget\(state\.defaultTarget\)/);
  assert.match(renderer, /state\.defaultTarget=normalizeDefaultTarget\(conversation\.defaultTarget\)/);
  assert.match(renderer, /data-default-target="codex"/);
  assert.match(renderer, /aria-pressed/);
  assert.match(renderer, /route\(references\.clean,\{defaultTarget:state\.defaultTarget\}\)/);
  assert.match(renderer, /startCollaboration\(routed\.prompt,runCollaboration,state\.activeConversationId,effectiveAgentConfigs\(\),referencePacket,images\)/);
  assert.match(renderer, /const collaboration=clone\(options\.collaboration\|\|activeCollaboration\(\)\)/);
  assert.match(renderer, /\.compose-tools \{ display: flex; flex-wrap: wrap;/);
  assert.match(renderer, /@media \(max-width: 1180px\) \{ \.compose-tools > \.hint \{ display: none; \} \}/);
  assert.match(renderer, /function collaborationDefaultTargetHint\(\)/);
});

test('@ 문서 참조는 AI 호출과 분리된다', () => {
  const result = route('#claude @"/tmp/My Spec.md" 이 문서를 리뷰해줘');
  assert.deepEqual(plain(result.targets), ['claude']);
  assert.deepEqual(plain(result.files), ['/tmp/My Spec.md']);
  assert.match(result.prompt, /참조 파일/);
  assert.match(result.prompt, /\/tmp\/My Spec\.md/);
});

test('호출 태그가 없으면 두 AI에게 전달한다', () => {
  const result = route('@"/tmp/file.md" 읽어줘');
  assert.deepEqual(plain(result.targets).sort(), ['claude', 'codex']);
  assert.deepEqual(plain(result.files), ['/tmp/file.md']);
});

test('호환용 @codex 호출도 유지한다', () => {
  assert.deepEqual(plain(route('@codex 확인해').targets), ['codex']);
});

test('한 메시지의 서로 다른 지시를 AI별로 분리한다', () => {
  const result=plain(route('#codex API를 구현해줘\n#claude 보안 관점에서 설계를 검토해줘'));
  assert.deepEqual(result.targets,['codex','claude']);
  assert.deepEqual(result.prompts,{codex:'API를 구현해줘',claude:'보안 관점에서 설계를 검토해줘'});
});

test('여러 AI 지시 앞의 공통 배경은 양쪽에 전달한다', () => {
  const result=plain(route('공통 배경을 먼저 읽어라\n#codex 구현해줘\n#claude 검토해줘'));
  assert.equal(result.prompts.codex,'공통 배경을 먼저 읽어라\n\n구현해줘');
  assert.equal(result.prompts.claude,'공통 배경을 먼저 읽어라\n\n검토해줘');
});

test('태그가 뒤에 붙은 단일 호출은 앞 문장까지 해당 AI만 받는다', () => {
  const result=plain(route('이 변경을 구현해줘 #codex'));
  assert.deepEqual(result.targets,['codex']);
  assert.equal(result.prompts.codex,'이 변경을 구현해줘');
});

test('#all 구간은 두 AI에게 전달하고 개별 구간은 분리한다', () => {
  const result=plain(route('#all 공통 조건\n#codex 코드 작성\n#claude 문서 작성'));
  assert.equal(result.prompts.codex,'공통 조건\n\n코드 작성');
  assert.equal(result.prompts.claude,'공통 조건\n\n문서 작성');
});

test('콜론 헤더가 있으면 긴 명령을 블록 단위로 분리한다', () => {
  const result=plain(route(`공통 제약
#codex:
API를 구현해라.
#claude라는 문자열은 이 블록의 일반 내용이다.

#claude:
보안 검토를 수행해라.`));
  assert.equal(result.mode,'block');
  assert.equal(result.commonText,'공통 제약');
  assert.equal(result.prompts.codex,'공통 제약\n\nAPI를 구현해라.\n#claude라는 문자열은 이 블록의 일반 내용이다.');
  assert.equal(result.prompts.claude,'공통 제약\n\n보안 검토를 수행해라.');
});

test('블록 모드에서는 줄 중간의 호출 태그를 구분자로 해석하지 않는다', () => {
  const result=plain(route(`#codex:
문서에서 #claude 호출법을 설명해라.
#claude:
결과를 검토해라.`));
  assert.equal(result.prompts.codex,'문서에서 #claude 호출법을 설명해라.');
  assert.equal(result.prompts.claude,'결과를 검토해라.');
});

test('비어 있는 블록은 오류로 반환한다', () => {
  const result=plain(route('#codex:\n\n#claude:\n검토해라'));
  assert.deepEqual(result.errors,['codex 블록이 비어 있습니다.']);
});

test('이스케이프한 블록 헤더는 일반 내용으로 유지한다', () => {
  const result=plain(route('#codex:\n\\#claude:\n이 문자열을 그대로 문서화해라'));
  assert.equal(result.prompts.codex,'#claude:\n이 문자열을 그대로 문서화해라');
  assert.deepEqual(result.errors,[]);
});

test('블록별 문서 참조는 해당 AI에게만 붙는다', () => {
  const result=plain(route('#codex:\n@"/tmp/code.md" 구현\n#claude:\n@"/tmp/review.md" 검토'));
  assert.match(result.prompts.codex,/\/tmp\/code\.md/);
  assert.doesNotMatch(result.prompts.codex,/review\.md/);
  assert.match(result.prompts.claude,/\/tmp\/review\.md/);
  assert.doesNotMatch(result.prompts.claude,/code\.md/);
});
