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

test('에이전트 협업에서 여러 AI를 명시하면 시작 AI를 결정하지 않는다', () => {
  assert.equal(collaborationLeadFor(route('#all 검토해줘'), 'codex'), null);
  assert.equal(collaborationLeadFor(route('#codex 구현 #claude 검토'), 'codex'), null);
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
