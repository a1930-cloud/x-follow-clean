(function(root) {
  const normalize = value => typeof value === 'string' && /^@?[a-zA-Z0-9_]{1,15}$/.test(value.trim()) ? value.trim().replace(/^@/, '').toLowerCase() : null;
  function route(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/(following|followers)\/?$/);
      return match ? {owner: normalize(match[1]), kind: match[2], path: url.pathname} : null;
    } catch { return null; }
  }
  function blank(owner) {
    return {owner, createdAt: Date.now(), following:{}, followers:{}, review:{}, expected:{}, notes:{}};
  }
  function merge(state, kind, rows, now = Date.now()) {
    if (!['following','followers'].includes(kind)) throw new Error('不支持这个列表');
    for (const row of rows) {
      const handle = normalize(row.handle);
      if (!handle || handle === state.owner) continue;
      const old = Object.hasOwn(state[kind],handle) ? state[kind][handle] : null;
      const record = { handle, name: typeof row.name === 'string' ? row.name.slice(0,120) : handle,
        positiveFollow: old?.positiveFollow === true || row.positiveFollow === true,
        firstSeen: old?.firstSeen || now, lastSeen: now };
      Object.defineProperty(state[kind],handle,{value:record,enumerable:true,writable:true,configurable:true});
    }
    state.updatedAt = now;
    return state;
  }
  function compare(state) {
    return Object.values(state.following).map(row => ({...row,
      relationship: Object.hasOwn(state.followers, row.handle) || row.positiveFollow ? 'observed' : 'unknown',
      review: Object.hasOwn(state.review,row.handle) ? state.review[row.handle] : 'pending'}));
  }
  function cellRows(doc) {
    // Only the primary list timeline, never the sidebar / recommended accounts outside it.
    const primary = doc.querySelector('[data-testid="primaryColumn"]');
    if (!primary) return [];
    const timeline = primary.querySelector('[aria-label^="Timeline:"], [aria-label^="时间线"], [aria-label^="時間軸"], [aria-label^="時間線"]');
    if (!timeline) return [];
    const output = [];
    for (const cell of timeline.querySelectorAll('[data-testid="UserCell"]')) {
      if (cell.closest('aside, [data-testid="sidebarColumn"]')) continue;
      let handle = null, name = '';
      const identity = cell.querySelector('[data-testid="User-Name"]') || cell;
      for (const a of identity.querySelectorAll('a[href]')) {
        try {
          const url = new URL(a.getAttribute('href'), 'https://x.com');
          if (!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)) continue;
          const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
          if (!match || ['home','explore','settings','messages','i','notifications','search'].includes(match[1].toLowerCase())) continue;
          const candidate = normalize(match[1]);
          // A profile link with an exact @handle establishes identity; ignore mentions in bio.
          const hasHandle = [...a.querySelectorAll('span')].some(span => span.textContent.trim().toLowerCase() === '@'+candidate)
            || a.textContent.trim().toLowerCase() === '@'+candidate;
          if (!hasHandle) continue;
          handle = candidate;
          break;
        } catch {}
      }
      if (!handle) continue;
      for (const a of identity.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href').replace(/^https:\/\/(www\.)?(x|twitter)\.com/i, '').replace(/\/$/, '');
        const text = a.textContent.trim();
        if (href.toLowerCase() === '/'+handle && text && !text.startsWith('@')) { name = text.split('\n')[0]; break; }
      }
      const badge = cell.querySelector('[data-testid="userFollowIndicator"]');
      const positiveFollow = Boolean(badge && /^(follows you|关注了你|關注你|正在关注你|跟隨你|跟随你)$/i.test(badge.textContent.trim()));
      output.push({handle, name:name || handle, positiveFollow});
    }
    return output;
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r\n]/.test(text)) text = "'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  root.FollowReview = {normalize, route, blank, merge, compare, cellRows, csvCell};
})(globalThis);
