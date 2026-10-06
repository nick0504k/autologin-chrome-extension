/* Where the content scripts go.
 *
 * The manifest names no site: it would have to name the internal ones, and the
 * extension is meant to disclose nothing. Every address comes from the configured
 * servers instead, and which set of scripts an address needs is exactly the
 * 서버 유형 chosen for it in the settings page. Injection follows the configuration,
 * and an origin the user has not allowed is simply skipped until they do. */

const ADMIN_SCRIPTS = [
  'config/servers.js',
  'scripts/server-url.js',
  'scripts/server-types.js',
  'scripts/default-servers.js',
  'scripts/env-store.js',
  'scripts/totp.js',
  'scripts/accounts.js',
  'scripts/content.js',
  'scripts/pattern-suggest.js',
  'scripts/flow-runner.js',
];
const MOBILE_SCRIPTS = [
  'scripts/mobile-pin.js',
  'scripts/pattern-suggest.js',
  'scripts/flow-runner.js',
];
// Runs in the page's own world at document_start, like the manifest entry it mirrors.
const MOBILE_BRIDGE_SCRIPTS = ['scripts/superapp-fast.js'];

const REGISTRATION_IDS = ['awa-custom-admin', 'awa-custom-mobile', 'awa-custom-mobile-bridge'];

// A match pattern cannot carry a port, and matches every port of its host.
function matchPatternFor(host) {
  const hostname = AwaServerUrl.normalizeHost(host).split(':')[0];
  if (!hostname) return null;
  return `*://${hostname}/*`;
}

function patternsByType(environments) {
  const admin = new Set();
  const mobile = new Set();
  for (const server of Object.values(environments || {})) {
    for (const host of AwaServerUrl.hostsOf(server)) {
      const pattern = matchPatternFor(host);
      if (!pattern) continue;
      (AwaAccounts.isMobile(server) ? mobile : admin).add(pattern);
    }
  }
  // One origin cannot host both pipelines at once; a server typed mobile wins, since
  // the admin pipeline is what a misconfigured mobile host silently falls back to.
  for (const pattern of mobile) admin.delete(pattern);
  return { admin: [...admin], mobile: [...mobile] };
}

async function allowed(patterns) {
  const checks = await Promise.all(
    patterns.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
  );
  return patterns.filter((_, index) => checks[index]);
}

async function syncCustomHostScripts() {
  const stored = await chrome.storage.local.get(['environments']);
  // Through AwaEnvStore, not raw: a server saved by an older build is missing every
  // field added since — including the other hosts of a login that crosses them, whose
  // pages would then get no scripts at all.
  const environments = AwaEnvStore.build(stored.environments, AwaDefaultServers.ALL);
  const buckets = patternsByType(environments);
  const admin = await allowed(buckets.admin);
  const mobile = await allowed(buckets.mobile);

  const registrations = [];
  if (admin.length) {
    registrations.push({ id: 'awa-custom-admin', matches: admin, js: ADMIN_SCRIPTS, runAt: 'document_idle' });
  }
  if (mobile.length) {
    registrations.push(
      { id: 'awa-custom-mobile-bridge', matches: mobile, js: MOBILE_BRIDGE_SCRIPTS, runAt: 'document_start', world: 'MAIN' },
      { id: 'awa-custom-mobile', matches: mobile, js: MOBILE_SCRIPTS, runAt: 'document_idle' },
    );
  }

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: REGISTRATION_IDS }).catch(() => []);
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) }).catch(() => {});
  }
  if (!registrations.length) return;

  try {
    await chrome.scripting.registerContentScripts(registrations);
  } catch (error) {
    console.warn('[AWA] content scripts not registered:', error.message, { admin, mobile });
  }
}

chrome.runtime.onInstalled.addListener(syncCustomHostScripts);
chrome.runtime.onStartup.addListener(syncCustomHostScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.environments) syncCustomHostScripts();
});
syncCustomHostScripts();

// A site granted or revoked takes effect without reopening anything.
chrome.permissions.onAdded.addListener(syncCustomHostScripts);
chrome.permissions.onRemoved.addListener(syncCustomHostScripts);

globalThis.AwaHostScripts = { syncCustomHostScripts };
