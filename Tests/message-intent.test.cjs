const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/message-intent.js'), 'utf8'), context);
const intent = context.TriadMessageIntent;

test('인사·확인·감사 등 짧은 대화성 메시지는 conversational', () => {
  for (const value of [
    'ㅎㅇ?', 'ㅎㅇ', 'ㅎㅇㅇ', '안녕', '안녕하세요', '하이~', '반가워',
    'ㅋㅋㅋ', 'ㅎㅎ', 'ㅋ', '감사', '고마워요', '감사합니다',
    'hi', 'hey!', 'hello', 'ok', 'okay', 'good', 'good morning', '굿',
    'ㅇㅇ', '넵', '엉', '어엉~', '수고', 'bye', 'ping', 'thanks'
  ]) {
    assert.equal(intent.isConversational(value), true, `대화성이어야 함: ${value}`);
  }
});

test('작업 지시·코드·파일 참조는 conversational 아님', () => {
  for (const value of [
    'OrderProductService 수정해줘', '버그 고쳐줘', '이 파일 좀 봐줘',
    '테스트 돌려줘', '리뷰해줘', '커밋하고 푸시해줘', '로그 확인해',
    'fix the bug', 'implement login', 'run the tests', 'check src/main.kt',
    '@"OrderProductService.kt" 확인', 'src/main.kt', '이 함수 리팩터해',
    '안녕 이거 구현해줘'
  ]) {
    assert.equal(intent.isConversational(value), false, `작업이어야 함: ${value}`);
  }
});

test('빈 값·너무 긴 메시지·비인사 문장은 conversational 아님', () => {
  assert.equal(intent.isConversational(''), false);
  assert.equal(intent.isConversational('   '), false);
  assert.equal(intent.isConversational(null), false);
  assert.equal(intent.isConversational('오늘 회의에서 결정된 내용을 바탕으로 전체 흐름을 다시 정리해보면 이렇게 됩니다 그리고'), false);
  assert.equal(intent.isConversational('이거 왜 안돼'), false); // 인사 아님 → 정식 경로
});

test('MAX_LENGTH 초과는 인사말이어도 conversational 아님', () => {
  const longGreeting = '안녕하세요 ' + '반갑습니다 '.repeat(10);
  assert.ok(longGreeting.length > intent.MAX_LENGTH);
  assert.equal(intent.isConversational(longGreeting), false);
});

test('작업 신호 없는 질문·의견은 inquiry (기여 기록 선택 티어)', () => {
  for (const value of [
    '리액트랑 뷰 중에 뭐가 나아?', '이 방식 어떻게 생각해?', '왜 그렇게 되는 거야',
    '지금 구조 어때?', '캐시를 쓰는 게 맞을까', 'MSA가 뭔지 궁금해서 그런데 뭐야?',
    '몇 명이서 개발하는 게 좋아?', '네 의견은?', '어느 쪽을 추천해?'
  ]) {
    assert.equal(intent.isInquiry(value), true, `inquiry여야 함: ${value}`);
  }
});

test('작업 신호가 있으면 질문형이어도 inquiry 아님 (필수 기록 유지)', () => {
  for (const value of [
    '이 버그 왜 나는지 분석해줄래?', '이 파일 좀 봐줄래?', '테스트 왜 깨져? 고쳐줘',
    'src/main.kt 어떻게 생각해?', '이 쿼리 실행하면 어떻게 돼?', '커밋해도 될까?'
  ]) {
    assert.equal(intent.isInquiry(value), false, `작업이어야 함: ${value}`);
  }
});

test('inquiry 경계: 빈 값·평서문 지시·초과 길이는 아님', () => {
  assert.equal(intent.isInquiry(''), false);
  assert.equal(intent.isInquiry(null), false);
  assert.equal(intent.isInquiry('오늘 서버 점검 있었음'), false); // 질문 신호 없음
  const long = '이게 맞을까? ' + '조금 더 자세히 말하면 상황이 이렇습니다. '.repeat(10);
  assert.ok(long.length > intent.INQUIRY_MAX_LENGTH);
  assert.equal(intent.isInquiry(long), false);
});

