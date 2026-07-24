(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadMessageIntent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Classifies short conversational messages (greetings, acks, thanks) that do
  // not warrant a full independent task run — no project/git/board reads and no
  // mandatory submit_contribution.  Deliberately conservative: anything that
  // looks like real work must fall through to the full path, because treating a
  // task as chit-chat (skipping the contribution) is worse than the reverse.
  const MAX_LENGTH = 30;

  // Any task signal disqualifies a message from the lightweight path.
  const TASK_HINTS = new RegExp([
    // Korean task verbs / nouns
    '구현|수정|고쳐|고치|만들|추가|삭제|지워|리팩터|리팩토|검토|리뷰|분석|디버그',
    '버그|에러|오류|테스트|커밋|푸시|배포|실행|돌려|빌드|설치|설정|확인해|봐줘|봐줄',
    '알려|정리|작성|짜줘|짜줄|생성|파일|코드|함수|클래스|메서드|브랜치|서버|테이블',
    '머지|이슈|로그|쿼리|스키마|마이그레이션|성능|보안|리팩|배치',
    // code / path / reference signals
    '@"|`|/|\\.[a-zA-Z0-9]{1,6}\\b',
    // English task verbs
    '\\b(fix|implement|add|remove|delete|refactor|review|debug|build|deploy|run|commit|push|test|check|write|create|merge)\\b'
  ].join('|'), 'i');

  // Recognised conversational openers (matched at the start of the message).
  const GREETING = new RegExp('^(?:' + [
    'ㅎㅇ+', 'ㅎㅇㅇ', '하이', '안녕', '안뇽', '반가', '반갑', 'hi+', 'hey+', 'hello', '헬로',
    'ㅇㅇ', 'ㅇㅋ', '오케이', '오키', 'ok(?:ay)?', '굿', 'good(?:\\s?(?:morning|night))?', '굿모닝', '굿밤',
    'ㄳ', 'ㄱㅅ', '고마워', '고맙', '감사', 'thanks?', 'thank\\syou', 'thx',
    'ㅋ+', 'ㅎㅎ+', 'ㅎㅋ+', 'ping', '핑', '잘자', '잘가', '바이', 'bye', '수고',
    '넵', '넹', '응', '엉', '어엉', '음+', 'ㅇㅎ', 'ㄴㄴ'
  ].join('|') + ')', 'i');

  function isConversational(text) {
    const value = String(text || '').trim();
    if (!value || value.length > MAX_LENGTH) return false;
    if (TASK_HINTS.test(value)) return false;
    // Trailing punctuation / tildes don't change intent (keep Hangul jamo so
    // "ㅋㅋ", "ㅎㅇ" survive for the greeting test).
    const core = value.replace(/[\s?!.~^,…]*$/u, '') || value;
    return GREETING.test(core);
  }

  return { isConversational, MAX_LENGTH };
});
