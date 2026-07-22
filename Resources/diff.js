(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function cleanPath(value) {
    let path = String(value || '').trim();
    if (path.startsWith('"') && path.endsWith('"')) {
      try { path = JSON.parse(path); } catch { path = path.slice(1, -1); }
    }
    return path.replace(/^[ab]\//, '');
  }

  function nameFor(section, index) {
    const next = section.match(/^\+\+\+\s+(.+)$/m)?.[1];
    if (next && next !== '/dev/null') return cleanPath(next);
    const previous = section.match(/^---\s+(.+)$/m)?.[1];
    if (previous && previous !== '/dev/null') return cleanPath(previous);
    const header = section.match(/^diff --git\s+.+?\s+(?:"?b\/)(.+?)"?$/m)?.[1];
    return cleanPath(header || `변경 파일 ${index + 1}`);
  }

  function filesFor(text) {
    const source = String(text || '');
    if (!source.trim()) return [];
    const starts = [...source.matchAll(/^diff --git .*$/gm)].map(match => match.index);
    if (!starts.length) return [{ id: 'all', name: '전체 변경', text: source, additions: 0, deletions: 0, status: 'modified' }];
    return starts.map((start, index) => {
      const section = source.slice(start, starts[index + 1] ?? source.length).replace(/\n+$/u, '');
      const lines = section.split('\n');
      const additions = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
      const deletions = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
      const status = /new file mode|--- \/dev\/null/m.test(section) ? 'new' : /deleted file mode|\+\+\+ \/dev\/null/m.test(section) ? 'deleted' : /^rename (?:from|to) /m.test(section) ? 'renamed' : 'modified';
      const name = nameFor(section, index);
      return { id: `${index}:${name}`, name, text: section, additions, deletions, status };
    });
  }

  function activeFileIdForOffsets(items, scrollTop) {
    if (!items.length) return null;
    let active = items[0].id;
    for (const item of items) {
      if (item.top > scrollTop) break;
      active = item.id;
    }
    return active;
  }

  function displayLinesFor(section) {
    const metadata = /^(?:diff --git |index |--- |\+\+\+ |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index )/;
    return String(section || '').split('\n').filter(line => !metadata.test(line));
  }

  return { filesFor, activeFileIdForOffsets, displayLinesFor };
});
