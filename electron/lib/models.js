'use strict';

// Ports Native/main.m:1465-1544 — the model catalogs sent in the boot event.
// codex: reads ~/.codex/models_cache.json; claude: a curated default list plus
// any extra slugs discovered by parsing `claude --help`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const platform = require('../platform');

function codexCatalog() {
  try {
    const root = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'));
    const models = root && Array.isArray(root.models) ? root.models : [];
    const catalog = [];
    for (const model of models) {
      if (!model || typeof model !== 'object') continue;
      const slug = model.slug;
      if (typeof slug !== 'string' || !slug) continue;
      const efforts = [];
      for (const level of (Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : [])) {
        if (level && typeof level.effort === 'string') efforts.push(level.effort);
      }
      const tiers = model.additional_speed_tiers;
      catalog.push({
        slug,
        name: model.display_name || slug,
        efforts,
        defaultEffort: model.default_reasoning_level || 'medium',
        supportsFast: Array.isArray(tiers) && tiers.includes('fast'),
      });
    }
    return catalog;
  } catch {
    return [];
  }
}

function claudeCatalog(executable) {
  const defaults = [
    { slug: 'default', name: 'Default (계정 권장)' },
    { slug: 'best', name: 'Best' },
    { slug: 'sonnet', name: 'Sonnet' },
    { slug: 'opus', name: 'Opus' },
    { slug: 'haiku', name: 'Haiku' },
    { slug: 'sonnet[1m]', name: 'Sonnet · 1M' },
    { slug: 'opus[1m]', name: 'Opus · 1M' },
    { slug: 'opusplan', name: 'Opus Plan' },
    { slug: 'fable', name: 'Fable' },
  ];
  const catalog = defaults.slice();
  const seen = new Set(defaults.map((m) => m.slug));
  if (!executable || !platform.isExecutable(executable)) return catalog;

  let help = '';
  try {
    help = execFileSync(executable, ['--help'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    help = error && error.stdout ? String(error.stdout) : '';
  }
  const start = help.indexOf('--model <model>');
  if (start === -1) return catalog;
  const next = help.indexOf('\n  -n,', start);
  const section = help.slice(start, next === -1 ? help.length : next);
  const quoted = /'([^']+)'/g;
  let match;
  while ((match = quoted.exec(section))) {
    const slug = match[1];
    if (!slug || seen.has(slug)) continue;
    const plausible = slug.startsWith('claude-') || !slug.includes(' ');
    if (!plausible) continue;
    seen.add(slug);
    catalog.push({ slug, name: slug.startsWith('claude-') ? slug : (slug.charAt(0).toUpperCase() + slug.slice(1)) });
  }
  return catalog;
}

module.exports = { codexCatalog, claudeCatalog };
