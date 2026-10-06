// A mobile server does not log in with an account ID — it picks a super app customer
// off the server's own list. Both the popup and the settings page need that list, so
// fetching, filtering and labelling live here once.
(function (root) {
  'use strict';

  // Which path serves the list is the site's business, so it is shipped config.
  const LIST_PATH = AwaDefaultServers.SUPERAPP_LIST_PATH;

  // The endpoint can be overridden per server — a path, or a whole URL when the list
  // lives somewhere other than the server being logged into.
  function listUrl(server) {
    const custom = String(server?.superAppListUrl || '').trim();
    if (/^https?:\/\//i.test(custom)) return custom;
    return AwaServerUrl.url(server, custom || LIST_PATH);
  }

  async function fetchAll(server, { signal } = {}) {
    const response = await fetch(listUrl(server), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return normalize(Array.isArray(data) ? data : (data.data || []));
  }

  // A customer with no CI cannot be selected into the wallet.
  function normalize(customers) {
    return (customers || []).filter((customer) => !!customer.ci);
  }

  function filter(customers, keyword) {
    const needle = String(keyword || '').toUpperCase().trim();
    if (!needle) return [...(customers || [])];
    return (customers || []).filter((c) =>
      `${c.koreanNm || ''} ${c.cstmrNo || ''} ${c.acnutno || ''}`.toUpperCase().includes(needle));
  }

  // The stored value is the name when there is one, so the two pages agree.
  const valueOf = (customer) => customer.koreanNm || customer.cstmrNo || '';
  const labelOf = (customer) =>
    `👤 ${customer.koreanNm || '이름없음'} (${customer.cstmrNo || ''}) - ${customer.acnutno || '계좌미등록'}`;

  function find(customers, value) {
    return (customers || []).find((c) => c.koreanNm === value || c.cstmrNo === value) || null;
  }

  root.AwaSuperAppUsers = { fetchAll, normalize, filter, valueOf, labelOf, find, listUrl, LIST_PATH };
})(globalThis);
