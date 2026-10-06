/* The public build's copy of config/servers.js: no servers, no accounts, no hosts.
 * The extension runs exactly the same; the settings page is where servers are added,
 * and a private build replaces this file with the real list. */
globalThis.AwaShippedServers = {
  UPDATE_DOWNLOAD_URL: "",
  SUPERAPP_PATH: "",
  SUPERAPP_LIST_PATH: "",
  DEFAULT_SUPERAPP_USER: "",
  NEW_SERVER: {},
  LEGACY_KEYS: {},
  SERVERS: {},
};
