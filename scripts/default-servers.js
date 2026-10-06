// What the extension ships with, as the rest of the code sees it.
//
// The list itself is data and lives in config/servers.js, which a build may ship
// empty: nothing here names a host or holds an account, so this file — and every
// other script — can be published without disclosing anything. A build with no
// config starts with no servers, and the settings page is where they are added.
(function (root) {
  'use strict';

  const shipped = root.AwaShippedServers || {};

  // Virtual-keypad typing delay and whether the form is submitted automatically.
  const DEFAULT_GLOBAL = {
    autoSubmit: true,
    keyDelay: 40
  };

  // What a server added by hand starts with. A build that ships nothing starts it
  // blank — an address and an account are what the settings page is for.
  const BLANK_SERVER = {
    enabled: true,
    keypadMode: 'virtual',
    useVirtualKeypad: true,
    username: '',
    accounts: [],
    password: '',
    otpSecret: ''
  };

  root.AwaDefaultServers = {
    ALL: shipped.SERVERS || {},
    NEW_SERVER: { ...BLANK_SERVER, ...(shipped.NEW_SERVER || {}) },
    DEFAULT_SUPERAPP_USER: shipped.DEFAULT_SUPERAPP_USER || '',
    SUPERAPP_LIST_PATH: shipped.SUPERAPP_LIST_PATH || '',
    SUPERAPP_PATH: shipped.SUPERAPP_PATH || '',
    PIN_PATH: shipped.PIN_PATH || '',
    WALLET_BUTTON_LABEL: shipped.WALLET_BUTTON_LABEL || '',
    UPDATE_DOWNLOAD_URL: shipped.UPDATE_DOWNLOAD_URL || '',
    // Storage keys written by older versions, mapped to the ones in use. Ship with
    // the servers they rename, because that is what they are about.
    LEGACY_KEYS: shipped.LEGACY_KEYS || {},
    GLOBAL: DEFAULT_GLOBAL
  };
})(globalThis);
