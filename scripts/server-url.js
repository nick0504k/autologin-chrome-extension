// Single owner of "what address is this server?".
// Storage keeps `protocol`, `host` and `path` separate; every place that reads a
// typed URL or builds one back goes through here so a typed http:// is never
// silently upgraded to https://, and so the rest of a typed address — its path and
// its query string — survives the round trip instead of being cut off at the host.
(function (root) {
  'use strict';

  const SCHEME = /^(https?):\/\//i;
  // Loopback dev servers and the two PDM web ports are served without TLS.
  const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;
  const PLAIN_PORT = /:(8081|8082)$/;

  // Protocol to assume when the user typed a bare host.
  function defaultProtocol(host) {
    const h = String(host || '').trim().toLowerCase();
    if (LOOPBACK.test(h) || /^[^:/]+\.localhost(:\d+)?$/.test(h) || PLAIN_PORT.test(h)) return 'http://';
    return 'https://';
  }

  // "http://localhost:3000/app"      -> { protocol: 'http://',  host: 'localhost:3000', path: '/app' }
  // "example.internal"              -> { protocol: 'https://', host: 'example.internal', path: '' }
  // "host/auth/login?client_id=app"  -> { ..., path: '/auth/login?client_id=app' }
  function split(input) {
    const raw = String(input || '').trim();
    const scheme = raw.match(SCHEME);
    const rest = raw.replace(SCHEME, '');
    // The host ends at the first of / ? # — a query may follow the host directly.
    const cut = rest.search(/[/?#]/);
    const host = cut === -1 ? rest : rest.slice(0, cut);
    const path = cut === -1 ? '' : rest.slice(cut);
    return { protocol: scheme ? `${scheme[1].toLowerCase()}://` : defaultProtocol(host), host, path };
  }

  // Accepts a stored server object or a raw string; a scheme inside `host`
  // (older stored values) wins over the stored `protocol`, and a path inside it wins
  // over the stored `path` — it was typed as part of the address more recently.
  function resolve(server) {
    if (!server || typeof server === 'string') return split(server);
    const raw = String(server.host || '').trim();
    const typed = split(raw);
    const path = typed.path || String(server.path || '');
    if (SCHEME.test(raw)) return { ...typed, path };
    return { protocol: server.protocol || defaultProtocol(typed.host), host: typed.host, path };
  }

  function normalizeHost(server) {
    return resolve(server).host.toLowerCase();
  }

  // Every configured server whose address is this one.
  function matchingKeys(environments, host) {
    const target = normalizeHost(host);
    if (!target) return [];
    return Object.entries(environments || {})
      .filter(([, server]) => normalizeHost(server) === target)
      .map(([key]) => key);
  }

  // The one a page on that address should be logged in as. Storage does not promise
  // to hand keys back in the order they were written — a server added later can come
  // back first — so an unmarked tie falls to the shipped server rather than to
  // whichever copy the round trip happened to put first.
  function matchHost(environments, host, { detected, detectionOff } = {}) {
    const keys = matchingKeys(environments, host);
    const shipped = root.AwaDefaultServers?.ALL || {};
    const address = normalizeHost(host);

    // What the address answered when it was probed beats what someone ticked for
    // it — switching the detection off for that address hands the tick back.
    const found = detected?.[address];
    if (found && keys.includes(found) && !detectionOff?.[address]) return found;

    return keys.find((key) => environments[key]?.primary)
      || keys.find((key) => key in shipped)
      || keys[0]
      || null;
  }

  function origin(server) {
    const { protocol, host } = resolve(server);
    return host ? `${protocol}${host}` : '';
  }

  // The server's own address. An explicit `path` is for callers that want a specific
  // page of it; without one the address keeps whatever path and query it was saved with.
  function url(server, path) {
    const base = origin(server);
    if (!base) return '';
    const suffix = path === undefined ? resolve(server).path : path;
    if (!suffix) return `${base}/`;
    return base + (/^[/?#]/.test(suffix) ? suffix : `/${suffix}`);
  }

  // The address as the user typed it, for the settings field: no trailing slash added
  // to a bare host, nothing cut off one that carries a path or a query.
  function display(server) {
    const { path } = resolve(server);
    return origin(server) + (path === '/' ? '' : path);
  }

  // Every address this server's pages are served from. A login that walks across
  // hosts — an SSO flow — lists the others in `hosts`; everything else has just one.
  function hostsOf(server) {
    const extra = (typeof server === 'object' && Array.isArray(server?.hosts) ? server.hosts : [])
      .map((host) => normalizeHost(host))
      .filter(Boolean);
    return [normalizeHost(server), ...extra].filter(Boolean);
  }

  // Does this server own the page at `url`?
  function owns(server, url) {
    const target = normalizeHost(url);
    return !!target && hostsOf(server).includes(target);
  }

  // Is `url` the address saved for this server? A saved address that carries a path
  // and a query must find both on the page — but the page may carry more query
  // parameters of its own (a returnUrl, a state) and still be that address.
  function matches(server, url) {
    if (!owns(server, url)) return false;
    const saved = resolve(server);
    if (!saved.path || saved.path === '/') return true;
    let savedUrl;
    let pageUrl;
    try {
      savedUrl = new URL(`${saved.protocol}${saved.host}${saved.path.startsWith('/') ? '' : '/'}${saved.path}`);
      pageUrl = new URL(url);
    } catch (_) {
      return false;
    }
    if (savedUrl.pathname.replace(/\/$/, '') !== pageUrl.pathname.replace(/\/$/, '')) return false;
    for (const [key, value] of savedUrl.searchParams) {
      if (!pageUrl.searchParams.getAll(key).includes(value)) return false;
    }
    return true;
  }

  // Every origin a set of servers is served from, as Chrome match patterns. A match
  // pattern cannot carry a port, and matches every port of its host.
  function originPatterns(servers) {
    const list = Array.isArray(servers) ? servers : Object.values(servers || {});
    const patterns = list.flatMap((server) =>
      hostsOf(server)
        .map((host) => host.split(':')[0])
        .filter(Boolean)
        .map((hostname) => `*://${hostname}/*`)
    );
    return [...new Set(patterns)];
  }

  // The 접속 주소 field as text: the server's own address first — with its path and
  // query — then every other address its pages are served from, one per line.
  function addressText(server) {
    const own = normalizeHost(server);
    const extra = (typeof server === 'object' && Array.isArray(server?.hosts) ? server.hosts : [])
      .map((host) => normalizeHost(host))
      .filter((host) => host && host !== own);
    return [display(server), ...extra].filter(Boolean).join('\n');
  }

  // The same field, read back. The primary address keeps its path and query; the
  // rest contribute their host, which is all ownership of a page depends on. The
  // primary host is kept in the list too, so changing it later cannot drop a page
  // of the flow out of the server that handles it.
  function parseAddresses(text) {
    const lines = String(text || '').split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
    const [first = '', ...rest] = lines;
    const primary = split(first);
    const hosts = [primary.host, ...rest.map((line) => normalizeHost(line))].filter(Boolean);
    return { ...primary, hosts: [...new Set(hosts)] };
  }

  // Where a tab is sent to reach this server. Normally its own address — but a server
  // behind single sign-on is entered through the service that redirects into it, and
  // its own address answers nothing useful.
  function entry(server) {
    const { path } = resolve(server);
    // An address typed down to a page is a deliberate destination; it outranks the
    // shipped entry point.
    if (path && path !== '/') return url(server);
    return (typeof server === 'object' && server?.entryUrl) || url(server);
  }

  root.AwaServerUrl = { defaultProtocol, split, resolve, normalizeHost, origin, url, display, addressText, parseAddresses, entry, hostsOf, originPatterns, owns, matches, matchingKeys, matchHost };
})(globalThis);
