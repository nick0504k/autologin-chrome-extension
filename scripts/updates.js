// Single owner of "is there a newer build than the one running?".
//
// The extension is installed unpacked, which Chrome never auto-updates, and the
// installer cannot be published: it ships the default accounts and OTP secrets.
// So the version is announced publicly and the installer stays private — the feed
// says what the latest version is, the download link opens in a tab, where the
// browser's own GitHub session is what grants access to the private file.
(function (root) {
  'use strict';

  // Checked at most this often; the answer is cached in storage between checks.
  const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

  const DEFAULTS = {
    feedUrl: 'https://raw.githubusercontent.com/nick0504k/awa-autologin-updates/main/version.json',
    // Where this build's installer lives, shipped with its servers: one feed serves
    // builds whose installers are in different places.
    get downloadUrl() {
      return globalThis.AwaDefaultServers?.UPDATE_DOWNLOAD_URL || '';
    },
  };

  // "1.10.0" is newer than "1.9.0": compare the numbers, not the strings.
  function compare(a, b) {
    const left = String(a || '').split('.').map((part) => parseInt(part, 10) || 0);
    const right = String(b || '').split('.').map((part) => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff) return diff < 0 ? -1 : 1;
    }
    return 0;
  }

  function config(stored) {
    return {
      feedUrl: (stored?.global?.updateFeedUrl ?? DEFAULTS.feedUrl).trim(),
      downloadUrl: (stored?.global?.updateDownloadUrl ?? DEFAULTS.downloadUrl).trim(),
    };
  }

  // The running version, as the manifest states it.
  function currentVersion() {
    return chrome.runtime.getManifest().version;
  }

  // One check. Never throws: a feed that is unreachable — off the network, blocked,
  // not published yet — must leave the extension working exactly as it did.
  async function check({ feedUrl, downloadUrl } = {}) {
    const current = currentVersion();
    const url = (feedUrl || DEFAULTS.feedUrl).trim();
    if (!url) return { checkedAt: Date.now(), current, reachable: false, reason: '주소가 비어 있습니다.' };

    try {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await response.json();
      const version = String(feed.version || '').trim();
      return {
        checkedAt: Date.now(),
        current,
        reachable: true,
        version,
        notes: String(feed.notes || '').slice(0, 200),
        // This build's own channel outranks the one the feed names: the feed is shared
        // by builds that are not downloaded from the same place.
        download: String(downloadUrl || DEFAULTS.downloadUrl || feed.download || '').trim(),
        newer: !!version && compare(version, current) > 0,
      };
    } catch (error) {
      return { checkedAt: Date.now(), current, reachable: false, reason: error.message };
    }
  }

  // The check, its result in storage, and the badge that carries it to the user.
  async function refresh({ force = false } = {}) {
    const stored = await chrome.storage.local.get(['global', 'updateState']);
    const previous = stored.updateState;
    if (!force && previous && Date.now() - (previous.checkedAt || 0) < CHECK_INTERVAL_MS) {
      return previous;
    }
    const state = await check(config(stored));
    await chrome.storage.local.set({ updateState: state });
    await showBadge(state);
    return state;
  }

  async function showBadge(state) {
    if (!chrome.action?.setBadgeText) return;
    const show = !!state?.newer;
    await chrome.action.setBadgeText({ text: show ? 'NEW' : '' });
    if (show) {
      await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
      await chrome.action.setTitle({ title: `새 버전 v${state.version} 설치본이 있습니다` });
    }
  }

  root.AwaUpdates = { DEFAULTS, CHECK_INTERVAL_MS, compare, config, currentVersion, check, refresh, showBadge };
})(globalThis);
