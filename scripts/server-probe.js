// Identify a server by what its API answers rather than by its address: the mobile
// customer list is served without a login, so a single call says whether an address
// is an EWA app, and the identities it returns say which backend it is wired to.
(function (root) {
  'use strict';

  async function readList(server, { signal } = {}) {
    let response;
    try {
      response = await fetch(AwaServerUrl.url(server, AwaSuperAppUsers.LIST_PATH), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      });
    } catch (error) {
      return { reachable: false, error: error.message };
    }
    if (!response.ok) return { reachable: true, mobile: false, status: response.status };
    try {
      const data = await response.json();
      const customers = AwaSuperAppUsers.normalize(Array.isArray(data) ? data : (data.data || []));
      return { reachable: true, mobile: true, ids: new Set(customers.map((c) => c.cstmrNo)) };
    } catch (_) {
      return { reachable: true, mobile: false, status: response.status };
    }
  }

  const sameBackend = (a, b) =>
    a && b && a.size > 0 && a.size === b.size && [...a].every((id) => b.has(id));

  // Servers of one family can serve byte-identical pages and bundles and answer every
  // unauthenticated call the same way, so nothing but the address tells them apart.
  // Where the address is one the extension ships, that IS the identification.
  function identifyAddress(server, shipped) {
    const host = AwaServerUrl.normalizeHost(server);
    if (!host) return null;
    const hits = Object.entries(shipped || {}).filter(([, s]) => AwaServerUrl.normalizeHost(s) === host);
    // An address several shipped servers share names none of them — the LOCAL set
    // all sits on one port — so that case belongs to the API probe.
    if (hits.length !== 1) return null;
    const [key, known] = hits[0];
    return { key, name: known.name, type: AwaServerTypes.of(known), env: AwaEnvStore.envOf(known, key) };
  }

  // `candidates` are the other configured mobile servers to fingerprint against.
  async function identify(server, candidates = [], options = {}) {
    const probe = await readList(server, options);
    if (!probe.reachable) return { status: 'unreachable', detail: probe.error };

    const known = identifyAddress(server, options.shipped || root.AwaDefaultServers?.ALL);
    if (known) {
      return { status: 'identified', by: 'address', type: known.type, env: known.env, name: known.name };
    }

    if (!probe.mobile) {
      // The admin family answers this path with 401 — a reply, so the server is live.
      return { status: 'identified', by: 'api', type: 'awa', env: null, exact: false };
    }

    const probedHost = AwaServerUrl.normalizeHost(server);
    for (const candidate of candidates) {
      // A candidate on the same address returns the same list by definition, so it
      // would "match" whatever bank it happens to be labelled — the fingerprint only
      // means something against a different address.
      if (AwaServerUrl.normalizeHost(candidate.server) === probedHost) continue;
      const other = await readList(candidate.server, options);
      if (other.mobile && sameBackend(probe.ids, other.ids)) {
        return {
          status: 'identified', by: 'api', type: 'ewa', exact: true,
          env: candidate.env, bank: candidate.bank, matched: candidate.name,
        };
      }
    }
    return { status: 'identified', by: 'api', type: 'ewa', env: null, exact: true };
  }

  // Which of the servers sharing an address the probe says it is. What the address
  // serves rules out every server of another family outright, so the choice only
  // ever survives among servers the probe cannot tell apart.
  function resolveShared(environments, host, detected, currentKey) {
    const sharing = AwaServerUrl.matchingKeys(environments, host);
    if (sharing.length < 2) return { key: sharing[0] || null, candidates: sharing, decided: true };

    const sameType = sharing.filter((key) => AwaServerTypes.of(environments[key]) === detected.type);
    if (!sameType.length) return { key: null, candidates: [], decided: false };

    // A backend we recognised narrows it further.
    const sameEnv = detected.env
      ? sameType.filter((key) => AwaEnvStore.envOf(environments[key], key) === detected.env)
      : [];
    let candidates = sameEnv.length ? sameEnv : sameType;

    // The bank's own customer list is what identified the backend, so it narrows
    // the remaining copies the way nothing else can.
    if (detected.bank) {
      const sameBank = candidates.filter((key) => AwaServerTypes.bankOf(environments[key]) === detected.bank);
      if (sameBank.length) candidates = sameBank;
    }

    if (candidates.includes(currentKey)) return { key: currentKey, candidates, decided: true };
    return { key: candidates[0], candidates, decided: candidates.length === 1 };
  }

  root.AwaServerProbe = { identify, identifyAddress, readList, sameBackend, resolveShared };
})(globalThis);
