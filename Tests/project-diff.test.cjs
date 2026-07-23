const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');
const plist = fs.readFileSync(path.join(__dirname, '../Resources/Info.plist'), 'utf8');
const diffContext = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/diff.js'), 'utf8'), diffContext);

function git(cwd, args) {
  try { return childProcess.execFileSync('/usr/bin/git', args, { cwd, encoding: 'buffer' }); }
  catch (error) {
    if (error.status === 1 && error.stdout) return error.stdout;
    throw error;
  }
}

function untrackedPaths(cwd) {
  const output = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  return output.toString('utf8').split('\0').filter(Boolean)
    .filter(record => record.startsWith('?? ')).map(record => record.slice(3));
}

test('브리지에서 NUL status와 Git unified diff를 사용한다', () => {
  assert.match(source, /@"status", @"--porcelain=v1", @"-z", @"--untracked-files=all"/);
  assert.match(source, /TriadNullSeparatedStrings\(untracked\[@"data"\]\)/);
  assert.match(source, /\[record hasPrefix:@"\?\? "\]/);
  assert.match(source, /@"diff", @"--no-index", @"--no-ext-diff", @"--no-color"/);
  assert.match(source, /maximumNewFileSize = 524288/);
  assert.match(source, /TriadLargeNewFileDiff/);
  assert.match(source, /TriadEmptyTreeObject/);
  assert.match(source, /tracked diff failed/);
  assert.match(source, /untracked-file status failed/);
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.40\.9<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>59<\/string>/);
});

test('Git status -z는 공백·한글 파일을 파일 단위로 반환하고 ignored 파일은 제외한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-project-diff-'));
  try {
    git(root, ['init', '-q']);
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(root, '새 파일 이름.txt'), '마지막 줄');
    fs.writeFileSync(path.join(root, 'empty.sh'), '');
    fs.chmodSync(path.join(root, 'empty.sh'), 0o755);
    fs.writeFileSync(path.join(root, 'ignored.txt'), 'do not list');
    assert.deepEqual(untrackedPaths(root).sort(), ['.gitignore', 'empty.sh', '새 파일 이름.txt']);

    const normal = git(root, ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', '새 파일 이름.txt']).toString('utf8');
    assert.match(normal, /new file mode 100644/);
    assert.match(normal, /--- \/dev\/null/);
    assert.match(normal, /\+\+\+ "?b\//);
    assert.match(normal, /\\ No newline at end of file/);
    assert.equal(JSON.parse(JSON.stringify(diffContext.TriadDiff.filesFor(normal)))[0].name, '새 파일 이름.txt');

    const executable = git(root, ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', 'empty.sh']).toString('utf8');
    assert.match(executable, /new file mode 100755/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Git no-index는 신규 바이너리의 원시 내용을 넣지 않는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-project-diff-binary-'));
  try {
    git(root, ['init', '-q']);
    fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 255]));
    const diff = git(root, ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', 'blob.bin']).toString('utf8');
    assert.match(diff, /Binary files \/dev\/null and b\/blob\.bin differ/);
    assert.doesNotMatch(diff, /\+\x00/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('첫 커밋 전에도 empty tree 비교가 staged 신규 파일 전체를 포함한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-project-diff-unborn-'));
  try {
    git(root, ['init', '-q']);
    fs.writeFileSync(path.join(root, 'staged-new.txt'), 'staged content\n');
    git(root, ['add', 'staged-new.txt']);
    const head = childProcess.spawnSync('/usr/bin/git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root });
    assert.notEqual(head.status, 0);
    const diff = git(root, ['diff', '--no-ext-diff', '--no-color', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '--', '.']).toString('utf8');
    assert.match(diff, /diff --git a\/staged-new\.txt b\/staged-new\.txt/);
    assert.match(diff, /new file mode 100644/);
    assert.match(diff, /\+staged content/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
