// Saved login passwords belong to an ID within a server. Mobile PINs remain server settings.
(function () {
  'use strict';
  // Mobile is one of the server families; AwaServerTypes owns that question.
  function isMobile(server) {
    return AwaServerTypes.isMobile(server);
  }
  function getPassword(server, username = server.username) {
    if (!isMobile(server) && Object.hasOwn(server.accountPasswords || {}, username)) {
      return server.accountPasswords[username];
    }
    return server.password || '';
  }
  function setPassword(server, username, password) {
    if (isMobile(server)) server.password = password;
    else server.accountPasswords = { ...server.accountPasswords, [username]: password };
  }
  function removePassword(server, username) {
    if (server.accountPasswords) delete server.accountPasswords[username];
  }
  globalThis.AwaAccounts = Object.freeze({ isMobile, getPassword, setPassword, removePassword });
})();
