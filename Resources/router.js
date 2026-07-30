(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadRouter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const agents = ['codex', 'claude'];
  // #a / #b are slot aliases (A = codex slot, B = claude slot) so a Claude×2 or
  // Codex×2 preset can still be addressed unambiguously; #codex / #claude stay.
  const aliases = [
    ['codex', ['@codex', '@코덱스', '#codex', '#코덱스', '@a', '#a']],
    ['claude', ['@claude', '@클로드', '#claude', '#클로드', '@b', '#b']],
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
      if (!['codex', '코덱스', 'claude', '클로드', 'all', '모두', 'a', 'b'].includes(path.toLowerCase())) {
        files.push(path);
        return prefix;
      }
      return full;
    });
    cleaned = cleaned.replace(/^\\(#(?:codex|코덱스|claude|클로드|all|모두|a|b):[ \t]*)$/gimu, '$1');
    cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    return { text: cleaned, files };
  }

  function blockTagMatches(input) {
    const targetFor = { codex: 'codex', '코덱스': 'codex', a: 'codex', claude: 'claude', '클로드': 'claude', b: 'claude', all: 'all', '모두': 'all' };
    const regex = /^#(codex|코덱스|claude|클로드|all|모두|a|b):[ \t]*$/gimu;
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

  function normalizeDefaultTarget(value) {
    return agents.includes(value) ? value : 'all';
  }

  // #검토: not a routing target — a per-message flag asking the OTHER agent to
  // cross-review the finished answer(s).  Stripped before routing.
  const REVIEW_TAG = /(^|[\s,])[#@](?:검토|리뷰|review)(?=$|[\s,.:;!?])/giu;
  // #대화/#토론: run a direct visible conversation between the two agents on
  // this message's topic (no board, no MCP — plain turn-by-turn bubbles).
  const DIALOG_TAG = /(^|[\s,])[#@](?:대화|토론|dialog|debate)(?=$|[\s,.:;!?])/giu;

  function route(input, options = {}) {
    let review = false;
    let dialog = false;
    input = String(input || '').replace(REVIEW_TAG, (full, prefix) => { review = true; return prefix; });
    input = input.replace(DIALOG_TAG, (full, prefix) => { dialog = true; return prefix; });
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
      const defaultTarget = normalizeDefaultTarget(options.defaultTarget);
      add(defaultTarget === 'all' ? agents : [defaultTarget], common);
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
    return { targets, prompts, prompt, files: [...new Set(agents.flatMap(agent => filesByAgent[agent]))], mode, commonText, errors, review, dialog };
  }

  // Auto-lead: pick the collaboration lead from workspace relevance — which
  // slot's folder the message is actually about.  Deterministic, zero tokens.
  // Signals (only when the two slots watch DIFFERENT folders):
  //  ①(+3/file) referenced @file path lives under a slot's workspace
  //  ②(+2/name) a filename mentioned in the text exists in exactly one slot's
  //             project file list
  //  ③(+2)      the workspace folder's basename is mentioned
  // Tie or no signal → {lead:null} and the caller falls back.
  function autoLead(input = {}) {
    const text = String(input.text || '');
    const files = Array.isArray(input.files) ? input.files : [];
    const norm = p => String(p || '').replace(/\/+$/, '');
    const ws = { codex: norm(input.workspaces?.codex), claude: norm(input.workspaces?.claude) };
    if (!ws.codex || !ws.claude || ws.codex === ws.claude) return { lead: null, reason: '' };
    const lists = { codex: input.projectFiles?.codex || [], claude: input.projectFiles?.claude || [] };
    const score = { codex: 0, claude: 0 };
    const reasons = { codex: [], claude: [] };
    for (const file of files) {
      const f = String(file || '');
      for (const agent of agents) {
        if (f === ws[agent] || f.startsWith(ws[agent] + '/')) { score[agent] += 3; reasons[agent].push(`참조 파일이 ${ws[agent].split('/').pop()} 폴더 소속`); }
      }
    }
    const names = { codex: new Set(lists.codex.map(p => String(p).split('/').pop().toLowerCase())), claude: new Set(lists.claude.map(p => String(p).split('/').pop().toLowerCase())) };
    const mentioned = [...new Set([...text.matchAll(/[\w.\-/]+\.[A-Za-z][A-Za-z0-9]{0,7}\b/gu)].map(m => m[0].split('/').pop().toLowerCase()))];
    for (const name of mentioned) {
      const inCodex = names.codex.has(name); const inClaude = names.claude.has(name);
      if (inCodex !== inClaude) { const agent = inCodex ? 'codex' : 'claude'; score[agent] += 2; reasons[agent].push(`${name} 파일 보유`); }
    }
    const lower = text.toLowerCase();
    for (const agent of agents) {
      const base = ws[agent].split('/').pop();
      const otherBase = ws[agent === 'codex' ? 'claude' : 'codex'].split('/').pop();
      if (base && base.length >= 3 && base !== otherBase && lower.includes(base.toLowerCase())) { score[agent] += 2; reasons[agent].push(`'${base}' 폴더 언급`); }
    }
    if (score.codex === score.claude) return { lead: null, reason: '' };
    const lead = score.codex > score.claude ? 'codex' : 'claude';
    return { lead, reason: [...new Set(reasons[lead])].join(' · ') };
  }

  function collaborationLeadFor(result, currentLead, defaultTarget = 'all') {
    if (!result) return currentLead;
    if (result.mode === 'broadcast') {
      const pinned = normalizeDefaultTarget(defaultTarget);
      return pinned === 'all' ? currentLead : pinned;
    }
    // A collaboration can begin only with one explicitly selected AI. Keep
    // the long-standing rejection for #all and multi-agent instructions.
    return result.targets.length === 1 ? result.targets[0] : null;
  }

  return { route, collaborationLeadFor, autoLead };
});
