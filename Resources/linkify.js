(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadLinkify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const pattern = /```([^\n`]*)\n([\s\S]*?)```|`([^`\n]+)`|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([^~\n]+)~~|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/giu;
  const trailingPunctuation = /[.,!?;:)\]}，。]$/u;

  function tokensFor(text) {
    const tokens = [];
    let cursor = 0;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) tokens.push({ type: 'text', text: text.slice(cursor, match.index) });
      if (match[2] !== undefined) {
        tokens.push({ type: 'code_block', text: match[2], language: match[1].trim() });
      } else if (match[3] !== undefined) {
        tokens.push({ type: 'code', text: match[3] });
      } else if (match[4] !== undefined || match[5] !== undefined) {
        tokens.push({ type: 'bold', text: match[4] ?? match[5] });
      } else if (match[6] !== undefined) {
        tokens.push({ type: 'strike', text: match[6] });
      } else if (match[7] !== undefined) {
        tokens.push({ type: 'italic', text: match[7] });
      } else if (match[9]) {
        tokens.push({ type: 'link', text: match[8], url: match[9] });
      } else {
        const raw = match[10];
        let url = raw;
        while (url && trailingPunctuation.test(url)) url = url.slice(0, -1);
        if (url) tokens.push({ type: 'link', text: url, url });
        if (url.length < raw.length) tokens.push({ type: 'text', text: raw.slice(url.length) });
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) tokens.push({ type: 'text', text: text.slice(cursor) });
    return tokens.length ? tokens : [{ type: 'text', text }];
  }

  function tableCells(line) {
    let source = String(line || '').trim();
    if (source.startsWith('|')) source = source.slice(1);
    if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
    const cells = [];
    let value = '';
    let code = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === '\\' && source[index + 1] === '|') {
        value += '|';
        index += 1;
      } else if (character === '`') {
        code = !code;
        value += character;
      } else if (character === '|' && !code) {
        cells.push(value.trim());
        value = '';
      } else {
        value += character;
      }
    }
    cells.push(value.trim());
    return cells;
  }

  function tableDivider(line) {
    const cells = tableCells(line);
    if (!cells.length || !cells.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
    return cells.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');
  }

  function blocksFor(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].trim()) { index += 1; continue; }

      const fence = lines[index].match(/^\s*```([^`]*)$/);
      if (fence) {
        const body = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index++]);
        if (index < lines.length) index += 1;
        blocks.push({ type: 'code_block', text: body.join('\n') + (body.length ? '\n' : ''), language: fence[1].trim() });
        continue;
      }

      const heading = lines[index].match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
        index += 1;
        continue;
      }

      const divider = index + 1 < lines.length ? tableDivider(lines[index + 1]) : null;
      if (divider && lines[index].includes('|')) {
        const header = tableCells(lines[index]);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          const row = tableCells(lines[index]);
          while (row.length < header.length) row.push('');
          rows.push(row.slice(0, header.length));
          index += 1;
        }
        blocks.push({ type: 'table', header, alignments: divider, rows });
        continue;
      }

      const paragraph = [];
      while (index < lines.length && lines[index].trim()) {
        if (paragraph.length && (/^\s*#{1,6}\s+/.test(lines[index]) || /^\s*```/.test(lines[index]))) break;
        if (paragraph.length && index + 1 < lines.length && lines[index].includes('|') && tableDivider(lines[index + 1])) break;
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    }
    return blocks.length ? blocks : [{ type: 'paragraph', text: '' }];
  }

  return { tokensFor, blocksFor, tableCells };
});
