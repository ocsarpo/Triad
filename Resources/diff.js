(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function decodeGitQuotedPath(value) {
    const source = String(value || '');
    if (!(source.startsWith('"') && source.endsWith('"'))) return source;
    const bytes = [];
    const appendCharacter = character => {
      const encoded = encodeURIComponent(character);
      if (encoded.startsWith('%')) {
        for (const part of encoded.split('%')) if (part) bytes.push(Number.parseInt(part, 16));
      } else bytes.push(character.charCodeAt(0));
    };
    for (let index = 1; index < source.length - 1; index++) {
      const character = source[index];
      if (character !== '\\') { appendCharacter(character); continue; }
      const escaped = source[++index];
      if (escaped >= '0' && escaped <= '7') {
        const octal = `${escaped}${source[index + 1] || ''}${source[index + 2] || ''}`;
        if (/^[0-7]{3}$/.test(octal)) { bytes.push(Number.parseInt(octal, 8)); index += 2; continue; }
      }
      bytes.push(({ a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 }[escaped]) ?? escaped.charCodeAt(0));
    }
    try { return decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')); }
    catch { return source.slice(1, -1); }
  }

  function cleanPath(value) {
    let path = String(value || '').trim();
    path = decodeGitQuotedPath(path);
    return path.replace(/^[ab]\//, '');
  }

  function pathFromDiffHeader(section) {
    const header = section.match(/^diff --git\s+(.+)$/m)?.[1];
    if (!header) return '';
    const quoted = header.match(/(?:^|\s)("b\/(?:[^"\\]|\\.)*")$/);
    if (quoted) return cleanPath(quoted[1]);
    const bStart = header.lastIndexOf(' b/');
    return cleanPath(bStart >= 0 ? header.slice(bStart + 1) : header);
  }

  function nameFor(section, index) {
    const next = section.match(/^\+\+\+\s+(.+)$/m)?.[1];
    if (next && next !== '/dev/null') return cleanPath(next);
    const previous = section.match(/^---\s+(.+)$/m)?.[1];
    if (previous && previous !== '/dev/null') return cleanPath(previous);
    return pathFromDiffHeader(section) || `변경 파일 ${index + 1}`;
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
    const lines = String(section || '').split('\n').filter(line => !metadata.test(line));
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  return { filesFor, activeFileIdForOffsets, displayLinesFor };
});
