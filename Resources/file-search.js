(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadFileSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function itemsFor(catalogs) {
    const merged = new Map();
    for (const catalog of catalogs || []) {
      const workspace = String(catalog?.workspace || '').replace(/\/$/, '');
      for (const file of catalog?.files || []) {
        const relative = String(file.path || '').replace(/^\.\//, '');
        if (!relative) continue;
        const absolute = relative.startsWith('/') ? relative : `${workspace}/${relative}`;
        const existing = merged.get(absolute) || { absolute, relative, status: '', agents: [] };
        if (file.status && !existing.status) existing.status = file.status;
        if (catalog.agent && !existing.agents.includes(catalog.agent)) existing.agents.push(catalog.agent);
        merged.set(absolute, existing);
      }
    }
    return [...merged.values()].map(item => {
      const pieces = item.relative.split('/');
      return { ...item, name: pieces.pop() || item.relative, parent: pieces.join('/') };
    });
  }

  function search(query, catalogs, limit = 12) {
    const needle = String(query || '').toLowerCase();
    return itemsFor(catalogs).map(item => {
      const name = item.name.toLowerCase();
      const path = item.relative.toLowerCase();
      let score = item.status ? -3 : 0;
      if (needle) {
        if (name.startsWith(needle)) score += 0;
        else if (name.includes(needle)) score += 10 + name.indexOf(needle);
        else if (path.includes(needle)) score += 30 + path.indexOf(needle);
        else return null;
      }
      return { ...item, score };
    }).filter(Boolean).sort((left, right) => left.score - right.score || left.relative.localeCompare(right.relative)).slice(0, limit);
  }

  return { itemsFor, search };
});
