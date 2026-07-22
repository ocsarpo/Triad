(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadRouter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const agents = ['codex', 'claude'];
  const aliases = [
    ['codex', ['@codex', '@코덱스', '#codex', '#코덱스']],
    ['claude', ['@claude', '@클로드', '#claude', '#클로드']],
    ['all', ['@all', '@모두', '#all', '#모두']]
  ];

  function cleanContent(value) {
    let cleaned = value;
    const files = [];
    cleaned = cleaned.replace(/(^|\s)@"([^"]+)"(?=$|\s)/gu, (full, prefix, path) => {
      files.push(path);
      return prefix;
    });
    cleaned = cleaned.replace(/(^|\s)@([^\s@#]+)(?=$|\s)/gu, (full, prefix, path) => {
      if (!['codex', '코덱스', 'claude', '클로드', 'all', '모두'].includes(path.toLowerCase())) {
        files.push(path);
        return prefix;
      }
      return full;
    });
    cleaned = cleaned.replace(/^\\(#(?:codex|코덱스|claude|클로드|all|모두):[ \t]*)$/gimu, '$1');
    cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    return { text: cleaned, files };
  }

  function blockTagMatches(input) {
    const targetFor = { codex: 'codex', '코덱스': 'codex', claude: 'claude', '클로드': 'claude', all: 'all', '모두': 'all' };
    const regex = /^#(codex|코덱스|claude|클로드|all|모두):[ \t]*$/gimu;
    return [...input.matchAll(regex)].map(match => ({
      target: targetFor[match[1].toLowerCase()],
      boundary: match.index,
      end: match.index + match[0].length,
      label: match[1]
    }));
  }

  function tagMatches(input) {
    const matches = [];
    for (const [target, tags] of aliases) {
      for (const tag of tags) {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[\\s,])(${escaped})(?=$|[\\s,.:;!?])`, 'giu');
        for (const match of input.matchAll(regex)) {
          matches.push({ target, boundary: match.index, end: match.index + match[1].length + match[2].length });
        }
      }
    }
    return matches.sort((left, right) => left.boundary - right.boundary);
  }

  function route(input) {
    const blockMatches = blockTagMatches(input);
    const matches = blockMatches.length ? blockMatches : tagMatches(input);
    const mode = blockMatches.length ? 'block' : matches.length ? 'inline' : 'broadcast';
    const parts = { codex: [], claude: [] };
    const filesByAgent = { codex: [], claude: [] };
    const errors = [];
    let commonText = '';
    const explicitTargets = new Set();
    for (const match of matches) {
      if (match.target === 'all') agents.forEach(agent => explicitTargets.add(agent));
      else explicitTargets.add(match.target);
    }
    const recipientsFor = target => target === 'all' ? agents : [target];
    const add = (recipients, content) => {
      if (!content.text && !content.files.length) return;
      for (const agent of recipients) {
        if (content.text) parts[agent].push(content.text);
        filesByAgent[agent].push(...content.files);
      }
    };

    if (!matches.length) {
      const common = cleanContent(input);
      commonText = common.text;
      add(agents, common);
    } else {
      const common = cleanContent(input.slice(0, matches[0].boundary));
      commonText = explicitTargets.size > 1 ? common.text : '';
      add(explicitTargets.size === 1 ? [...explicitTargets] : agents, common);
      matches.forEach((match, index) => {
        const nextBoundary = matches[index + 1]?.boundary ?? input.length;
        const content = cleanContent(input.slice(match.end, nextBoundary));
        if (mode === 'block' && !content.text && !content.files.length) errors.push(`${match.label} 블록이 비어 있습니다.`);
        add(recipientsFor(match.target), content);
      });
    }

    const prompts = {};
    for (const agent of agents) {
      const uniqueFiles = [...new Set(filesByAgent[agent])];
      let prompt = parts[agent].filter(Boolean).join('\n\n').trim();
      if (uniqueFiles.length) prompt += `${prompt ? '\n\n' : ''}[참조 파일 — 작업 폴더에서 직접 읽을 것]\n${uniqueFiles.map(path => `- ${path}`).join('\n')}`;
      if (prompt) prompts[agent] = prompt;
    }
    const targets = agents.filter(agent => prompts[agent]);
    if (!targets.length && !errors.length) return null;
    const prompt = targets.length === 1 || prompts.codex === prompts.claude
      ? prompts[targets[0]]
      : `[Codex 지시]\n${prompts.codex || '(없음)'}\n\n[Claude 지시]\n${prompts.claude || '(없음)'}`;
    return { targets, prompts, prompt, files: [...new Set(agents.flatMap(agent => filesByAgent[agent]))], mode, commonText, errors };
  }

  function collaborationLeadFor(result, currentLead) {
    if (!result || result.mode === 'broadcast') return currentLead;
    return result.targets.length === 1 ? result.targets[0] : null;
  }

  return { route, collaborationLeadFor };
});
