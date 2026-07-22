const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/linkify.js'), 'utf8'), context);
const { tokensFor, blocksFor, tableCells } = context.TriadLinkify;
const plain = value => JSON.parse(JSON.stringify(value));

test('일반 웹 주소를 링크로 변환하고 문장 부호는 제외한다', () => {
  assert.deepEqual(plain(tokensFor('공식 사이트는 https://example.com/docs.')), [
    { type: 'text', text: '공식 사이트는 ' },
    { type: 'link', text: 'https://example.com/docs', url: 'https://example.com/docs' },
    { type: 'text', text: '.' }
  ]);
});

test('마크다운 링크의 이름을 유지한다', () => {
  assert.deepEqual(plain(tokensFor('[공식 문서](https://example.com/docs) 참고')), [
    { type: 'link', text: '공식 문서', url: 'https://example.com/docs' },
    { type: 'text', text: ' 참고' }
  ]);
});

test('http와 https 이외 문자열은 링크로 만들지 않는다', () => {
  assert.deepEqual(plain(tokensFor('javascript:alert(1)')), [{ type: 'text', text: 'javascript:alert(1)' }]);
});

test('굵게, 기울임, 취소선과 인라인 코드를 토큰화한다', () => {
  assert.deepEqual(plain(tokensFor('**중요** *강조* ~~삭제~~ `const x = 1`')), [
    { type: 'bold', text: '중요' }, { type: 'text', text: ' ' },
    { type: 'italic', text: '강조' }, { type: 'text', text: ' ' },
    { type: 'strike', text: '삭제' }, { type: 'text', text: ' ' },
    { type: 'code', text: 'const x = 1' }
  ]);
});

test('언어가 지정된 코드 블록을 토큰화한다', () => {
  assert.deepEqual(plain(tokensFor('결과:\n```js\nconst x = 1;\n```')), [
    { type: 'text', text: '결과:\n' },
    { type: 'code_block', text: 'const x = 1;\n', language: 'js' }
  ]);
});

test('굵은 글씨 안의 링크는 재귀 렌더링할 수 있게 내용을 보존한다', () => {
  assert.deepEqual(plain(tokensFor('**[문서](https://example.com)**')), [
    { type: 'bold', text: '[문서](https://example.com)' }
  ]);
});

test('제목과 표를 블록 마크다운으로 분리한다', () => {
  const markdown = `### 쟁점별 분류

| # | 쟁점 | 분류 | 근거 |
|---|------|------|------|
| 1 | 환불액 필수화 | **의도된 최신 계약** | LP-9435 plan §2.3 |
| 2 | REFUND_DONE 생성 | **의도된 최신 계약** | 요청값 기반 |`;
  assert.deepEqual(plain(blocksFor(markdown)), [
    { type: 'heading', level: 3, text: '쟁점별 분류' },
    {
      type: 'table',
      header: ['#', '쟁점', '분류', '근거'],
      alignments: ['', '', '', ''],
      rows: [
        ['1', '환불액 필수화', '**의도된 최신 계약**', 'LP-9435 plan §2.3'],
        ['2', 'REFUND_DONE 생성', '**의도된 최신 계약**', '요청값 기반']
      ]
    }
  ]);
});

test('표 셀의 이스케이프 파이프와 인라인 코드 파이프를 보존한다', () => {
  assert.deepEqual(plain(tableCells('| A \\| B | `x | y` |')), ['A | B', '`x | y`']);
});

test('표 앞뒤의 일반 문단과 닫히지 않은 코드 블록도 보존한다', () => {
  assert.deepEqual(plain(blocksFor('설명\n\n```kotlin\nval x = 1')), [
    { type: 'paragraph', text: '설명' },
    { type: 'code_block', text: 'val x = 1\n', language: 'kotlin' }
  ]);
});
