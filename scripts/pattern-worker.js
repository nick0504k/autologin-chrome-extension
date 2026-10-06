/* Persist repeated-flow notes outside the page so a refresh keeps the count. */
importScripts('../config/servers.js', 'pattern-suggest.js', 'server-url.js', 'server-types.js', 'default-servers.js', 'env-store.js', 'accounts.js', 'custom-host-injection.js', 'updates.js');

let queue = Promise.resolve();

function remember(event) {
  queue = queue.then(() => new Promise((resolve) => {
    chrome.storage.local.get(['patternSuggestState'], (stored) => {
      const state = stored.patternSuggestState || PatternSuggest.emptyState();
      const result = PatternSuggest.observe(state, event);
      chrome.storage.local.set({ patternSuggestState: result.state }, () => resolve());
    });
  })).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.action !== 'PATTERN_NOTE' || !message.event) return;
  remember(message.event);
  sendResponse({ ok: true });
});

/* The build cannot update itself — it is installed unpacked — so the only thing to
 * automate is noticing that a newer one exists. Checked on startup and once a day;
 * a failed check is silent and changes nothing. */
const UPDATE_ALARM = 'awa-update-check';

function scheduleUpdateCheck() {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 12 * 60 });
  AwaUpdates.refresh().catch(() => {});
}

chrome.runtime.onInstalled.addListener(scheduleUpdateCheck);
chrome.runtime.onStartup.addListener(scheduleUpdateCheck);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) AwaUpdates.refresh().catch(() => {});
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.action !== 'CHECK_UPDATE') return;
  // Not forced: opening the popup must not cost a request. The alarm keeps it fresh,
  // and 설정의 "지금 확인" is the button for asking again right now.
  AwaUpdates.refresh().then(sendResponse).catch(() => sendResponse(null));
  return true;
});
