// The server families this extension logs into. The type decides which login
// pipeline a server gets, which content scripts a custom host needs, and the icon
// the lists show — so it is answered here rather than guessed from names in five
// different places.
(function (root) {
  'use strict';

  const TYPES = [
    { id: 'awa', icon: '🏢', label: '🏢 AWA (관리자 웹)' },
    { id: 'ewa', icon: '📱', label: '📱 EWA (모바일 / 슈퍼앱)' },
    { id: 'pdm', icon: '⚙️', label: '⚙️ PDM' },
    { id: 'pdv', icon: '🔒', label: '🔒 PDV' },
    { id: 'sso', icon: '🔐', label: '🔐 SSO (통합 인증)' },
  ];

  // Written before the families had names, when the choice was only admin vs mobile.
  const LEGACY = { admin: 'awa', mobile: 'ewa' };

  // What a server configured before the selector existed must be.
  function infer(server) {
    const name = (server?.name || '').toUpperCase();
    const host = (server?.host || '').toLowerCase();
    if (host.includes('ewa') || name.includes('EWA') || name.includes('모바일')) return 'ewa';
    if (name.includes('PDV')) return 'pdv';
    if (name.includes('PDM')) return 'pdm';
    if (name.includes('AWA')) return 'awa';
    if (name.includes('SSO')) return 'sso';
    // The PDM and PDV hosts differ only by port, so the name is the better signal.
    if (host.includes('pod') || host.includes('pos')) return 'pdm';
    return 'awa';
  }

  function of(server) {
    const raw = String(server?.type || '').toLowerCase();
    const id = LEGACY[raw] || raw;
    return TYPES.some((type) => type.id === id) ? id : infer(server);
  }

  // The participating institutions a server family can be deployed for. The letter
  // in a name like "서버-B" is the institution, which is why those instances talk to
  // different backends.
  const BANKS = ['A', 'B', 'C'];

  function bankOf(server) {
    const explicit = String(server?.bank || '').trim().toUpperCase();
    if (BANKS.includes(explicit)) return explicit;
    const match = String(server?.name || '').toUpperCase().match(/-\s*([ABC])(?![A-Z0-9])/);
    return match ? match[1] : '';
  }

  // How a server reads in a list. The bank is appended because the shipped names
  // no longer carry it — unless a name written before that still does, in which
  // case repeating it would just read as "서버-B · B".
  function label(server, fallback = '') {
    const name = server?.name || fallback;
    const bank = bankOf(server);
    if (!bank) return name;
    return new RegExp(`-\\s*${bank}(?![A-Za-z0-9])`).test(name) ? name : `${name} · ${bank}`;
  }

  // Some server families are deployed per environment (DEV/STG) and per participating
  // bank (A/B/C). A single-sign-on login is in neither matrix, so it is not asked
  // which cell of it it sits in.
  const DEPLOYED_TYPES = ['awa', 'ewa', 'pdm', 'pdv'];
  const inDeployment = (server) => DEPLOYED_TYPES.includes(of(server));

  const isMobile = (server) => of(server) === 'ewa';
  const icon = (server) => TYPES.find((type) => type.id === of(server))?.icon || '🌐';

  root.AwaServerTypes = { TYPES, BANKS, of, infer, isMobile, inDeployment, icon, bankOf, label };
})(globalThis);
