const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/diff.js'), 'utf8'), context);
const { filesFor, activeFileIdForOffsets, displayLinesFor } = context.TriadDiff;
const plain = value => JSON.parse(JSON.stringify(value));

test('통합 diff를 파일별 구획으로 분리한다', () => {
  const diff = `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.js b/b.js\nnew file mode 100644\n--- /dev/null\n+++ b/b.js\n@@ -0,0 +1 @@\n+const b = 1;\n`;
  const files = plain(filesFor(diff));
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(file => ({ name: file.name, additions: file.additions, deletions: file.deletions, status: file.status })), [
    { name: 'a.txt', additions: 1, deletions: 1, status: 'modified' },
    { name: 'b.js', additions: 1, deletions: 0, status: 'new' }
  ]);
});

test('삭제된 파일은 이전 경로를 이름으로 사용한다', () => {
  const [file] = plain(filesFor('diff --git a/old.md b/old.md\ndeleted file mode 100644\n--- a/old.md\n+++ /dev/null\n-old\n'));
  assert.equal(file.name, 'old.md');
  assert.equal(file.status, 'deleted');
});

test('연속 diff의 스크롤 위치에 해당하는 파일을 찾는다', () => {
  const offsets=[{id:'a',top:0},{id:'b',top:300},{id:'c',top:700}];
  assert.equal(activeFileIdForOffsets(offsets,0),'a');
  assert.equal(activeFileIdForOffsets(offsets,299),'a');
  assert.equal(activeFileIdForOffsets(offsets,300),'b');
  assert.equal(activeFileIdForOffsets(offsets,999),'c');
});

test('Git 내부 헤더는 화면용 diff 본문에서 제거한다', () => {
  const lines=plain(displayLinesFor('diff --git a/a.kt b/a.kt\nindex 123..456 100644\n--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new'));
  assert.deepEqual(lines,['@@ -1 +1 @@','-old','+new']);
});

test('파일 이름 변경은 별도 상태로 분류한다', () => {
  const [file]=plain(filesFor('diff --git a/old.kt b/new.kt\nsimilarity index 100%\nrename from old.kt\nrename to new.kt\n'));
  assert.equal(file.status,'renamed');
});
