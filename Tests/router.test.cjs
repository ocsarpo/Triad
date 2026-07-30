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
  assert.match(renderer, /startCollaboration\(routed\.prompt,runCollaboration,state\.activeConversationId,effectiveAgentConfigs\(\),referencePacket,images,routed\.review\)/);
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

test('#a·#b 슬롯 별칭이 코덱스/클로드 슬롯으로 라우팅된다 (멀티세션)', () => {
  assert.deepEqual(plain(route('#a 이것좀 봐줘').targets), ['codex']);
  assert.deepEqual(plain(route('#b 이것좀 봐줘').targets), ['claude']);
  assert.deepEqual(plain(route('#A 대문자도').targets), ['codex']);
  // 기존 #codex/#claude 별칭 유지
  assert.deepEqual(plain(route('#codex 여전히').targets), ['codex']);
  // @a 는 파일 참조가 아니라 태그로 처리
  const both = route('#a 코덱스일 #b 클로드일');
  assert.deepEqual(plain(both.targets).sort(), ['claude', 'codex']);
});

test('#검토 태그는 라우팅 대상이 아니라 교차 검토 플래그다', () => {
  const flagged = plain(route('이 함수 설계 어때? #검토'));
  assert.equal(flagged.review, true);
  assert.deepEqual(flagged.targets.sort(), ['claude', 'codex']); // 대상은 그대로
  assert.doesNotMatch(flagged.prompts.codex, /#검토/); // 프롬프트에서 제거
  // 별칭 #리뷰/#review, 단일 대상과 조합
  assert.equal(plain(route('#a 이거 구현해줘 #리뷰')).review, true);
  assert.equal(plain(route('#review please check with #b design')).review, true);
  // 태그가 없으면 false
  assert.equal(plain(route('그냥 질문')).review, false);
  // 검토 태그만 있으면 보낼 내용이 없다 → null
  assert.equal(route('#검토'), null);
});

test('autoLead: 참조 파일·파일명·폴더명으로 시작 AI를 고른다 (다른 폴더일 때만)', () => {
  const base = {
    workspaces: { codex: '/work/api-server', claude: '/work/web-front' },
    projectFiles: { codex: ['src/OrderService.kt', 'build.gradle'], claude: ['src/App.tsx', 'package.json'] }
  };
  // ① @참조 파일 경로가 슬롯 폴더 아래
  const byFile = context.TriadRouter.autoLead({ ...base, text: '이거 고쳐줘', files: ['/work/web-front/src/App.tsx'] });
  assert.equal(byFile.lead, 'claude');
  assert.match(byFile.reason, /web-front 폴더 소속/);
  // ② 파일명이 정확히 한쪽 목록에만 존재
  const byName = context.TriadRouter.autoLead({ ...base, text: 'OrderService.kt 버그 원인 찾아줘', files: [] });
  assert.equal(byName.lead, 'codex');
  assert.match(byName.reason, /orderservice\.kt 파일 보유/);
  // ③ 폴더 이름 언급
  const byFolder = context.TriadRouter.autoLead({ ...base, text: 'web-front 쪽 빌드 왜 깨져?', files: [] });
  assert.equal(byFolder.lead, 'claude');
  // 무승부/신호 없음 → null (호출자가 직전 리드로 폴백)
  assert.equal(context.TriadRouter.autoLead({ ...base, text: '안녕 뭐해', files: [] }).lead, null);
  // 같은 폴더를 보면 항상 null (지금 동작 유지)
  const same = { ...base, workspaces: { codex: '/work/app', claude: '/work/app' } };
  assert.equal(context.TriadRouter.autoLead({ ...same, text: 'OrderService.kt 봐줘', files: [] }).lead, null);
});

test('자동 리드 배선: 렌더러는 auto를 해석해 실행·미리보기·시작 메시지에 반영한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  // 기본값 auto + 셀렉트 옵션
  assert.match(renderer, /collaboration: \{mode:'independent',lead:'auto',rounds:2/);
  assert.match(renderer, /<option value="auto">자동 \(폴더 매칭\)<\/option>/);
  assert.match(renderer, /if\(!\['auto','codex','claude'\]\.includes\(collaboration\.lead\)\)collaboration\.lead='auto';/);
  // send: auto → resolveAutoLead(폴더 매칭) → 무승부 시 직전 리드
  assert.match(renderer, /function resolveAutoLead\(routed, cleanText\)/);
  assert.match(renderer, /window\.TriadRouter\.autoLead\(\{/);
  assert.match(renderer, /if\(lead==='auto'\)\{const picked=resolveAutoLead\(routed,references\.clean\);lead=picked\.lead;autoLeadReason=picked\.reason;\}/);
  assert.match(renderer, /return \{lead:state\.lastCollabLead\|\|'codex',reason:''\};/);
  assert.match(renderer, /state\.lastCollabLead=collaboration\.lead;/);
  // 자동 선택 사유를 시작 메시지에 표시
  assert.match(renderer, /L\('autoLeadPicked',\{reason:collaboration\.autoLeadReason\}\)/);
});

test('#대화 태그는 두-AI 직접 대화 플래그다 (라우팅 대상 아님)', () => {
  const flagged = plain(route('MSA 전환 어떻게 생각하는지 둘이 얘기해봐 #대화'));
  assert.equal(flagged.dialog, true);
  assert.doesNotMatch(flagged.prompts.codex, /#대화/);
  assert.equal(plain(route('#토론 이 설계 괜찮은지')).dialog, true);
  assert.equal(plain(route('#debate is this design ok')).dialog, true);
  assert.equal(plain(route('그냥 질문')).dialog, false);
});
