// Single owner of "what servers are configured?": the merge of stored settings over
// the built-in defaults, the normalization the popup and the settings page used to
// each carry their own copy of, and the digest that tells an open page whether a
// storage write actually changed anything it renders.
(function (root) {
  'use strict';

  const FALLBACK = { group: 'DEV', enabled: true, keypadMode: 'virtual', useVirtualKeypad: true };

  const ENVIRONMENTS = ['DEV', 'STG'];

  // Which deployment a server points at, independent of the tab it is filed under.
  function envOf(server, key = '') {
    const explicit = String(server?.env || '').toUpperCase();
    if (ENVIRONMENTS.includes(explicit)) return explicit;
    const group = String(server?.group || '').toUpperCase();
    if (ENVIRONMENTS.includes(group)) return group;
    return String(key).toLowerCase().startsWith('stg') ? 'STG' : 'DEV';
  }

  function build(storedEnvironments, defaults) {
    const environments = {};
    for (const [key, value] of Object.entries(defaults || {})) {
      environments[key] = JSON.parse(JSON.stringify(value));
    }
    for (const [key, value] of Object.entries(storedEnvironments || {})) {
      const targetKey = AwaDefaultServers.LEGACY_KEYS[key] || key;
      // A shipped server that was deleted is recorded rather than simply absent —
      // otherwise the seeding above would hand it straight back on the next load.
      if (value?.deleted) {
        delete environments[targetKey];
        continue;
      }
      environments[targetKey] = { ...(defaults?.[targetKey] || FALLBACK), ...value, id: targetKey };
    }

    for (const [key, server] of Object.entries(environments)) {
      if (!server.group) server.group = key.startsWith('stg') ? 'STG' : 'DEV';
      if (!Array.isArray(server.accounts) || server.accounts.length === 0) {
        // A server logged into with a personal account ships without one.
        // Inventing one would file the user's password under an ID that does not exist.
        server.accounts = server.username ? [server.username] : [];
      }
      if (server.username && !server.accounts.includes(server.username)) {
        server.accounts.unshift(server.username);
      }
      if (!server.keypadMode) server.keypadMode = server.useVirtualKeypad === false ? 'direct' : 'virtual';
      if (server.useVirtualKeypad === undefined) server.useVirtualKeypad = server.keypadMode !== 'direct';
      // An address pasted whole into the host field is stored split, once, here.
      const address = AwaServerUrl.resolve(server);
      server.protocol = address.protocol;
      server.host = address.host;
      server.path = address.path;
      server.type = AwaServerTypes.of(server);
      // Only the servers deployed per environment and per bank carry those.
      const deployed = AwaServerTypes.inDeployment(server);
      server.env = deployed ? envOf(server, key) : '';
      server.bank = deployed ? AwaServerTypes.bankOf(server) : '';
      // A mobile server never used the admin password; the one it should have is
      // shipped with the servers, not written here.
      const mobileDefault = AwaDefaultServers.NEW_SERVER.mobilePassword;
      if (AwaServerTypes.isMobile(server) && mobileDefault && server.password === AwaDefaultServers.NEW_SERVER.password) {
        server.password = mobileDefault;
      }
    }
    return environments;
  }

  // Everything a tab bar and a server list put on screen. A write that leaves this
  // unchanged (a password edit, say) must not yank the page out from under the user.
  function shape(environments) {
    return Object.entries(environments || {})
      .map(([key, s]) => [key, s.group, s.env, s.bank, s.name, s.host, (s.hosts || []).join(','), s.path, s.protocol, s.enabled !== false].join('\u0000'))
      .sort()
      .join('\u0001');
  }

  // What to write back: the configuration as it stands, plus a marker for every
  // shipped server it no longer contains. Derived, so nothing has to be tracked.
  function toStorage(environments, defaults) {
    const payload = { ...environments };
    for (const key of Object.keys(defaults || {})) {
      if (!(key in payload)) payload[key] = { deleted: true };
    }
    return payload;
  }

  root.AwaEnvStore = { build, shape, envOf, toStorage, ENVIRONMENTS };
})(globalThis);
