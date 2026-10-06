// The customer picker a mobile server logs in through belongs to a specific
// site. This build ships no such site, so the list is always empty and every
// caller keeps working.
(function (root) {
  'use strict';
  const LIST = [];
  root.AwaSuperAppUsers = {
    LIST,
    LIST_PATH: '',
    listUrl: () => '',
    fetchAll: async () => [],
    normalize: (rows) => (Array.isArray(rows) ? rows : []),
    filter: (rows) => (Array.isArray(rows) ? rows : []),
    valueOf: (row) => String(row?.name || row || ''),
    labelOf: (row) => String(row?.name || row || ''),
    find: () => null,
  };
})(globalThis);
