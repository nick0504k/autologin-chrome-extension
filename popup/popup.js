// One scenario name in the popup: the saved-list row. The open card uses a
// status heading, and there is no second name field.
function scenarioPopupChrome(name, phase) {
  return {
    heading: phase === 'run' ? '테스트 실행' : '단계 미리보기',
    listLabel: name || '테스트 플로우',
    saveNameField: null,
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const envTabsContainer = document.getElementById('env-tabs-container');
  const serverSaveIndicator = document.getElementById('server-save-indicator');
  const accountCard = document.querySelector('.account-card');
  const popupUserSelect = document.getElementById('popup-user-select');
  const accountPassword = document.getElementById('popup-account-password');
  const accountPasswordLabel = document.getElementById('account-password-label');
  const btnSavePassword = document.getElementById('btn-save-password');
  const passwordSaveIndicator = document.getElementById('password-save-indicator');
  let passwordServerKey;
  let passwordUsername;

  function syncAccountPassword() {
    const cur = environments[activeServerKey];
    passwordServerKey = activeServerKey;
    passwordUsername = cur.username;
    accountPassword.value = AwaAccounts.getPassword(cur);
    accountPasswordLabel.textContent = cur.username
      ? `비밀번호 · ${cur.username}`
      : '비밀번호 · 먼저 + 새 ID 추가로 ID를 등록하세요';
    accountPassword.disabled = !cur.username;
    passwordSaveIndicator.classList.remove('show');
  }

  async function saveAccountPassword() {
    const cur = environments[passwordServerKey];
    if (!cur || !passwordUsername) return;
    AwaAccounts.setPassword(cur, passwordUsername, accountPassword.value);
    await persistConfig();
    showIndicator(passwordSaveIndicator);
  }

  accountPassword.addEventListener('change', saveAccountPassword);
  btnSavePassword.addEventListener('click', saveAccountPassword);
  const btnToggleAdd = document.getElementById('btn-toggle-add');
  const btnDeleteAccount = document.getElementById('btn-delete-account');
  const accountAddBox = document.getElementById('account-add-box');
  const newUsernameInput = document.getElementById('new-username-input');
  const btnConfirmAdd = document.getElementById('btn-confirm-add');
  const btnCancelAdd = document.getElementById('btn-cancel-add');
  const userSaveIndicator = document.getElementById('user-save-indicator');
  const btnTrigger = document.getElementById('btn-trigger');
  const btnOptions = document.getElementById('btn-options');
  const superappCard = document.getElementById('superapp-card');
  const superappUserSearch = document.getElementById('superapp-user-search');
  const superappUserSelect = document.getElementById('superapp-user-select');
  const btnRefreshSuperapp = document.getElementById('btn-refresh-superapp');
  const superappNote = document.getElementById('superapp-note');
  const superappSaveIndicator = document.getElementById('superapp-save-indicator');
  const serverSwitchList = document.getElementById('server-switch-list');
  let currentSuperAppCustomers = [];
  const appVersionEl = document.getElementById('app-version');

  if (appVersionEl && chrome.runtime?.getManifest) {
    const v = chrome.runtime.getManifest()?.version;
    if (v) appVersionEl.textContent = `v${v}`;
  }

  // Pre-configured servers from Gabia document
  const DEFAULT_SERVERS = AwaDefaultServers.ALL;

  // Load stored settings with migration fallback
  const stored = await chrome.storage.local.get([
    'environments',
    'autoLoginEnabled',
    'activeGroup',
    'activeServerKey',
    'detectionOff',
    'detectedOwners'
  ]);

  let masterEnabled = stored.autoLoginEnabled !== false;
  let environments = AwaEnvStore.build(stored.environments, DEFAULT_SERVERS);

  // Extract distinct groups
  function getGroups() {
    const set = new Set();
    Object.values(environments).forEach((s) => {
      if (s.group) set.add(s.group);
    });
    return Array.from(set);
  }

  let groups = getGroups();
  let activeGroup = stored.activeGroup && groups.includes(stored.activeGroup) ? stored.activeGroup : (groups[0] || 'DEV');
  let activeServerKey = stored.activeServerKey && environments[stored.activeServerKey] ? stored.activeServerKey : 'dev_awa_b';
  let detectedServerKey = null;
  let detectedTabHost = '';
  let detectedCertain = false;
  let pendingDetection = null;
  let detectionOff = stored.detectionOff || {};
  let detectedOwners = stored.detectedOwners || {};

  // Auto-detect based on current active tab
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url) {
      const url = new URL(activeTab.url);
      const tabHost = url.host.toLowerCase();
      const tabHostname = url.hostname.toLowerCase();

      const detection = { detected: detectedOwners, detectionOff };
      const matched = AwaServerUrl.matchHost(environments, tabHost, detection)
        || AwaServerUrl.matchHost(environments, tabHostname, detection);
      if (matched) {
        // Which server this page belongs to — worth showing, because an address
        // several servers share resolves to exactly one of them.
        detectedServerKey = matched;
        detectedTabHost = tabHost;
        pendingDetection = activeTab.url;
        activeServerKey = matched;
        activeGroup = environments[matched].group || 'DEV';
      }
    }
  } catch (e) {
    console.debug('Tab query failed, using stored active:', e);
  }

  // Ensure activeServerKey belongs to activeGroup
  const serversInGroup = Object.entries(environments).filter(([_, s]) => s.group === activeGroup);
  if (!serversInGroup.some(([k]) => k === activeServerKey)) {
    activeServerKey = serversInGroup[0]?.[0] || Object.keys(environments)[0];
  }

  // Opening a server waits for any preceding switch changes to be saved.
  let pendingConfig = Promise.resolve();
  // "Does this write change anything I am showing?", asked through the same build
  // both pages load with — so a write this page made itself never redraws the form
  // out from under someone mid-edit, whoever stamped it.
  const renderedShape = (storedEnvironments) => AwaEnvStore.shape(AwaEnvStore.build(storedEnvironments, DEFAULT_SERVERS));
  function persistConfig() {
    pendingConfig = pendingConfig.then(() => chrome.storage.local.set({
      environments: AwaEnvStore.toStorage(environments, DEFAULT_SERVERS),
      autoLoginEnabled: masterEnabled,
      activeGroup,
      activeServerKey
    }));
    return pendingConfig;
  }

  // The settings page writes every structural edit straight to storage. Pick those
  // up live, so a tab renamed or a server added over there shows here immediately.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.environments) return;
    const incoming = AwaEnvStore.build(changes.environments.newValue, DEFAULT_SERVERS);
    if (AwaEnvStore.shape(incoming) === renderedShape(environments)) return;
    environments = incoming;
    groups = getGroups();
    if (!groups.includes(activeGroup)) activeGroup = groups[0] || 'DEV';
    if (!environments[activeServerKey] || environments[activeServerKey].group !== activeGroup) {
      activeServerKey = Object.entries(environments).find(([_, s]) => s.group === activeGroup)?.[0] || activeServerKey;
    }
    renderCategoryTabs();
    renderServerSwitches();
    syncForm();
  });

  // The pin is meant to say what the open page actually is, which is not the same
  // question as which server was given priority for its address. Ask the API.
  async function markDetectedServer(tabUrl) {
    if (!tabUrl || typeof AwaServerProbe === 'undefined') return;
    let probed;
    try {
      const url = new URL(tabUrl);
      probed = { protocol: `${url.protocol}//`, host: url.host };
    } catch (_) {
      return;
    }
    if (!AwaServerUrl.matchingKeys(environments, probed).length) return;
    detectedTabHost = AwaServerUrl.normalizeHost(probed);

    const candidates = Object.entries(environments)
      .filter(([, s]) => s.host && AwaAccounts.isMobile(s))
      .map(([k, s]) => ({ server: s, env: AwaEnvStore.envOf(s, k), bank: AwaServerTypes.bankOf(s), name: s.name }));

    const result = await AwaServerProbe.identify(probed, candidates);
    if (result.status !== 'identified') return;
    const resolved = AwaServerProbe.resolveShared(environments, probed, result, null);
    if (!resolved.key) return;

    detectedServerKey = resolved.key;
    detectedCertain = resolved.decided;
    await applyDetection();
    renderServerSwitches();
    updateSuperAppNote(environments[activeServerKey]);
  }

  // Recorded, not applied: the tick stays where it was put, and matchHost ranks
  // this above it — here, in the content script, everywhere.
  async function applyDetection() {
    detectedOwners[detectedTabHost] = detectedServerKey;
    await chrome.storage.local.set({ detectedOwners });
  }

  async function toggleDetection() {
    detectionOff[detectedTabHost] = !detectionOff[detectedTabHost];
    await chrome.storage.local.set({ detectionOff });
    renderServerSwitches();
  }

  const ownerOf = (server) =>
    AwaServerUrl.matchHost(environments, server, { detected: detectedOwners, detectionOff });

  function renderServerSwitches() {
    serverSwitchList.replaceChildren();
    for (const [key, server] of Object.entries(environments)) {
      if (server.group !== activeGroup) continue;
      const row = document.createElement('div');
      row.className = `server-switch-row${key === activeServerKey ? ' active' : ''}`;
      row.dataset.serverKey = key;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'server-switch-name';
      select.textContent = `${getServerIcon(server)} ${AwaServerTypes.label(server, key)}`;
      select.title = server.host || '';
      select.setAttribute('aria-pressed', String(key === activeServerKey));
      select.addEventListener('click', async () => {
        activeServerKey = key;
        await persistConfig();
        renderServerSwitches();
        syncForm();
        if (typeof renderSavedTestsPopup === 'function') {
          renderSavedTestsPopup();
        }
      });
      let current = null;
      if (key === detectedServerKey) {
        current = document.createElement('span');
        const off = !!detectionOff[detectedTabHost];
        const ticked = AwaServerUrl.matchHost(environments, environments[key]);
        current.className = `server-switch-current${off ? ' off' : ''}`;
        current.textContent = off ? '📍' : (ticked === key ? '📍' : '⚠️');
        current.title = off
          ? `감지 결과를 껐습니다 — 체크한 '${AwaServerTypes.label(environments[ticked], ticked)}'를 사용합니다. 다시 켜려면 클릭하세요`
          : ticked === key
            ? `현재 탭(${detectedTabHost})은 이 서버로 확인되어 적용 중입니다${detectedCertain ? '' : ' (후보 중 추정)'}. 끄려면 클릭하세요`
            : `현재 탭(${detectedTabHost})은 이 서버로 확인되어 우선 적용 중입니다. 체크된 '${AwaServerTypes.label(environments[ticked], ticked)}'보다 앞섭니다 — 끄려면 클릭하세요`;
        current.setAttribute('role', 'button');
        current.addEventListener('click', toggleDetection);
        current.setAttribute('aria-label', current.title);
      }

      const state = document.createElement('span');
      state.className = 'server-switch-state';
      state.textContent = server.enabled === false ? 'OFF' : '';
      const label = document.createElement('label');
      label.className = 'switch';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = server.enabled !== false;
      toggle.setAttribute('aria-label', `${AwaServerTypes.label(server, key)} 자동 로그인`);
      toggle.addEventListener('change', async () => {
        server.enabled = toggle.checked;
        state.textContent = toggle.checked ? '' : 'OFF';
        await persistConfig();
        syncForm();
        showIndicator(serverSaveIndicator);
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.append(toggle, slider);

      // When several servers share an address, which one a page there logs in as is
      // a choice — so it is shown and changed right here, not only in the settings.
      const sharing = AwaServerUrl.matchingKeys(environments, server);
      let priority = null;
      if (sharing.length > 1) {
        const winner = AwaServerUrl.matchHost(environments, server);
        priority = document.createElement('button');
        priority.type = 'button';
        priority.className = `btn-row-priority${winner === key ? ' is-primary' : ''}`;
        priority.textContent = winner === key ? '✅' : '☐';
        priority.title = `${AwaServerUrl.origin(server)} 주소를 공유하는 서버 ${sharing.length}개 — 이 서버를 우선 적용`;
        priority.setAttribute('aria-label', priority.title);
        priority.setAttribute('aria-pressed', String(winner === key));
        priority.addEventListener('click', async () => {
          for (const other of sharing) environments[other].primary = false;
          environments[key].primary = true;
          await persistConfig();
          renderServerSwitches();
          showIndicator(serverSaveIndicator);
        });
      }
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn-url-open';
      open.textContent = '↗';
      open.title = `${AwaServerTypes.label(server, key)} 새 탭으로 열기`;
      open.setAttribute('aria-label', open.title);
      open.disabled = !server.host;
      open.addEventListener('click', async () => {
        await persistConfig();
        chrome.tabs.create({ url: AwaServerUrl.entry(server) });
      });
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'btn-settings server-settings';
      settings.title = `${AwaServerTypes.label(server, key)} 설정`;
      settings.setAttribute('aria-label', settings.title);
      const icon = btnOptions.querySelector('svg');
      if (icon) settings.appendChild(icon.cloneNode(true));
      else settings.textContent = '⚙';
      settings.addEventListener('click', async () => {
        activeServerKey = key;
        await persistConfig();
        chrome.tabs.create({ url: `${chrome.runtime.getURL('options/options.html')}?server=${encodeURIComponent(key)}` });
      });
      row.append(select, state, ...(current ? [current] : []), ...(priority ? [priority] : []), label, open, settings);
      serverSwitchList.appendChild(row);
    }
    renderEmptyState();
    renderPermissionWarning();
  }

  function showIndicator(el) {
    if (!el) return;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1500);
  }

  function getServerIcon(server) {
    return AwaServerTypes.icon(server);
  }

  // =========================================================================
  // SUPER APP / MOBILE USER SELECTION INTEGRATION
  // =========================================================================
  let customerLoad = null;
  let customerLoadKey = null;
  let customerLoadedKey = null;
  let customerLoadController = null;
  let customerLoadVersion = 0;
  const normalizedHost = (host) => AwaServerUrl.normalizeHost(host);

  function loadSuperAppUsers(targetServer, force = false) {
    if (!superappUserSelect) return Promise.resolve();
    // accepts a server object or a bare host string
    const server = targetServer || environments[activeServerKey];
    const host = normalizedHost(server);
    if (!host) return Promise.resolve();

    // Servers can share an address and still read their users from different
    // places — the LOCAL copies all sit on one port but each lists its own
    // deployment — so the endpoint, not the host, is what identifies a list.
    const endpoint = AwaSuperAppUsers.listUrl(server);
    if (customerLoad && customerLoadKey === endpoint) return customerLoad;
    if (!force && customerLoadedKey === endpoint) {
      renderSuperAppUserDropdown(currentSuperAppCustomers, superappUserSearch?.value || '', server?.superAppUser);
      return Promise.resolve();
    }
    customerLoadController?.abort();
    const controller = new AbortController();
    const version = ++customerLoadVersion;
    customerLoadController = controller;
    customerLoadKey = endpoint;
    const current = () => version === customerLoadVersion && !controller.signal.aborted &&
      AwaSuperAppUsers.listUrl(environments[activeServerKey]) === endpoint;
    superappUserSelect.innerHTML = '<option value="">(고객 목록을 불러오는 중...)</option>';
    const timeout = setTimeout(() => {
      controller.abort();
      // current() also demands the request not be aborted, which this just did.
      if (version === customerLoadVersion && AwaSuperAppUsers.listUrl(environments[activeServerKey]) === endpoint) {
        superappUserSelect.innerHTML = '<option value="">❌ 고객 목록 요청 시간 초과 (새로고침 필요)</option>';
      }
    }, 10000);
    const request = (async () => {
      try {
        let customers = null;
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (controller.signal.aborted) return;
          const endpointHost = new URL(endpoint, 'http://x').host.toLowerCase();
          if (tab?.id && tab.url && new URL(tab.url).host.toLowerCase() === endpointHost) {
            const res = await new Promise((resolve) => {
              const aborted = () => resolve(null);
              controller.signal.addEventListener('abort', aborted, { once: true });
              chrome.tabs.sendMessage(tab.id, { action: 'FETCH_SUPERAPP_CUSTOMERS' }, (result) => {
                controller.signal.removeEventListener('abort', aborted);
                resolve(chrome.runtime.lastError ? null : result);
              });
            });
            if (res?.success && Array.isArray(res.customers)) customers = res.customers;
          }
        } catch (e) {}
        if (controller.signal.aborted) return;
        if (customers === null) {
          customers = await AwaSuperAppUsers.fetchAll(server, { signal: controller.signal });
        }
        if (!current()) return;
        currentSuperAppCustomers = AwaSuperAppUsers.normalize(customers);
        customerLoadedKey = endpoint;
        if (current()) {
          renderSuperAppUserDropdown(currentSuperAppCustomers, superappUserSearch?.value || '', server?.superAppUser);
        }
      } catch (err) {
        if (!controller.signal.aborted && version === customerLoadVersion && normalizedHost(environments[activeServerKey]?.host) === host) {
          superappUserSelect.innerHTML = '<option value="">❌ 고객 목록 로드 실패 (새로고침 필요)</option>';
        }
      } finally {
        clearTimeout(timeout);
      }
    })();
    customerLoad = request;
    request.finally(() => {
      if (customerLoad === request) {
        customerLoad = null;
        customerLoadController = null;
      }
    });
    return request;
  }
  window.addEventListener('pagehide', () => {
    customerLoadVersion++;
    customerLoadController?.abort();
  });

  function updateSuperAppNote(server) {
    if (!superappNote) return;
    const detected = detectedServerKey && environments[detectedServerKey];
    const sharesAddress = detected && server &&
      AwaServerUrl.normalizeHost(detected) === AwaServerUrl.normalizeHost(server);
    const mismatched = sharesAddress && environments[detectedServerKey] !== server;
    superappNote.style.display = mismatched ? 'block' : 'none';
    if (mismatched) {
      superappNote.textContent =
        `이 주소는 '${AwaServerTypes.label(detected, detectedServerKey)}'로 확인되었습니다 — 아래 목록은 그 서버의 사용자입니다.`;
    }
  }

  function renderSuperAppUserDropdown(customers, filterText = '', selectedUser = '') {
    if (!superappUserSelect) return;
    superappUserSelect.innerHTML = '';

    const filtered = AwaSuperAppUsers.filter(customers, filterText);

    if (filtered.length === 0) {
      superappUserSelect.innerHTML = '<option value="">(일치하는 사용자가 없습니다)</option>';
      return;
    }

    filtered.forEach((c) => {
      const opt = document.createElement('option');
      const val = AwaSuperAppUsers.valueOf(c);
      opt.value = val;
      opt.textContent = AwaSuperAppUsers.labelOf(c);
      if (selectedUser && (selectedUser === val || selectedUser === c.cstmrNo || selectedUser === c.koreanNm)) {
        opt.selected = true;
      }
      superappUserSelect.appendChild(opt);
    });

    if (!superappUserSelect.value && filtered.length > 0) {
      superappUserSelect.value = AwaSuperAppUsers.valueOf(filtered[0]);
    }
  }

  if (superappUserSelect) {
    superappUserSelect.addEventListener('change', () => {
      const val = superappUserSelect.value;
      const server = environments[activeServerKey];
      if (val && server) {
        server.superAppUser = val;
        server.superAppCustomerData = AwaSuperAppUsers.find(currentSuperAppCustomers, val);
        persistConfig().then(() => showIndicator(superappSaveIndicator));
      }
    });
  }

  if (superappUserSearch) {
    superappUserSearch.addEventListener('input', (e) => {
      renderSuperAppUserDropdown(currentSuperAppCustomers, e.target.value, environments[activeServerKey]?.superAppUser);
    });
  }

  if (btnRefreshSuperapp) {
    btnRefreshSuperapp.addEventListener('click', async () => {
      const cur = environments[activeServerKey];
      loadSuperAppUsers(cur, true);
    });
  }

  // Render Category Tabs (DEV / STG / ...)
  // Nothing configured: the cards below have no server to describe, so they give way
  // to the one action that helps.
  function renderEmptyState() {
    const empty = document.getElementById('empty-state');
    if (!empty) return;
    const hasServers = Object.keys(environments).length > 0;
    empty.style.display = hasServers ? 'none' : 'block';
    for (const selector of ['#account-card', '.env-tabs-bar', '.server-card']) {
      const el = document.querySelector(selector);
      if (el) el.style.display = hasServers ? '' : 'none';
    }
    if (btnTrigger) btnTrigger.style.display = hasServers ? '' : 'none';
  }

  document.getElementById('btn-empty-open-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  function renderCategoryTabs() {
    envTabsContainer.innerHTML = '';
    groups = getGroups();
    let activeTab = null;

    groups.forEach((grp) => {
      const tabBtn = document.createElement('div');
      tabBtn.className = `env-tab ${grp === activeGroup ? 'active' : ''}`;
      tabBtn.dataset.group = grp;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = grp === 'DEV' ? '🛠️ DEV (개발)'
        : (grp === 'STG' ? '🚀 STG (스테이징)' : (grp === 'LOCAL' ? '💻 LOCAL' : `📁 ${grp}`));
      tabBtn.appendChild(titleSpan);

      {
        const btnClose = document.createElement('button');
        btnClose.type = 'button';
        btnClose.className = 'btn-tab-close';
        btnClose.textContent = '✕';
        btnClose.title = '이 탭 삭제';
        btnClose.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`'${grp}' 그룹과 포함된 서버들을 삭제하시겠습니까?`)) {
            Object.keys(environments).forEach((k) => {
              if (environments[k].group === grp) {
                delete environments[k];
              }
            });
            const remaining = getGroups().filter((g) => g !== grp);
            activeGroup = remaining[0] || '';
            activeServerKey = Object.keys(environments).find((k) => environments[k].group === activeGroup) || '';
            await persistConfig();
            renderCategoryTabs();
            renderServerSwitches();
            syncForm();
          }
        });
        tabBtn.appendChild(btnClose);
      }

      tabBtn.addEventListener('click', async () => {
        if (activeGroup === grp) return;
        activeGroup = grp;

        const inGrp = Object.entries(environments).filter(([_, s]) => s.group === activeGroup);
        if (inGrp.length > 0) {
          activeServerKey = inGrp[0][0];
        }

        await persistConfig();
        renderCategoryTabs();
        renderServerSwitches();
        syncForm();
      });

      envTabsContainer.appendChild(tabBtn);
      if (grp === activeGroup) activeTab = tabBtn;
    });

    // The strip overflows 330px at three tabs, so keep the selected one in view.
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // A popup has no room for a wide tab bar and a mouse wheel only scrolls
  // vertically, so turn a vertical wheel over the strip into horizontal scroll.
  envTabsContainer.addEventListener('wheel', (e) => {
    if (e.deltaX !== 0 || e.deltaY === 0) return;
    if (envTabsContainer.scrollWidth <= envTabsContainer.clientWidth) return;
    e.preventDefault();
    envTabsContainer.scrollLeft += e.deltaY;
  }, { passive: false });

  // Render Account Options for Active Server
  function renderAccountOptions(accounts, currentUsername) {
    const list = Array.isArray(accounts) && accounts.length > 0 ? accounts : (currentUsername ? [currentUsername] : []);
    // A server logged into with a personal account starts without one.
    // Offering a shipped default there files the password under an ID that does
    // not exist.
    if (list.length === 0) return '<option value="" selected>ID를 추가하세요</option>';
    return list
      .map((acc) => `<option value="${escapeHtml(acc)}" ${acc === currentUsername ? 'selected' : ''}>👤 ${escapeHtml(acc)}</option>`)
      .join('');
  }

  // Sync Form Controls with Active Server
  function syncForm() {
    const cur = environments[activeServerKey];
    if (!cur) return;

    const isMobile = AwaAccounts.isMobile(cur);

    toggleEnabled.checked = masterEnabled;
    toggleEnabled.title = '모든 서버 자동 로그인 켜기/끄기';
    document.getElementById('master-status').textContent = masterEnabled
      ? '서버별 자동 로그인 · OFF로 끈 뒤 ↗로 접속하세요.'
      : '전체 자동 로그인 OFF · 서버별 설정은 유지됩니다.';
    btnTrigger.disabled = !masterEnabled || cur.enabled === false;
    popupUserSelect.innerHTML = renderAccountOptions(cur.accounts, cur.username);
    syncAccountPassword();

    // Show/Hide cards depending on Mobile vs PC Admin
    if (accountCard) {
      accountCard.style.display = isMobile ? 'none' : 'block';
    }
    if (superappCard) {
      superappCard.style.display = isMobile ? 'flex' : 'none';
      if (isMobile) {
        updateSuperAppNote(cur);
        loadSuperAppUsers(cur);
      }
    }

    if (btnTrigger) {
      btnTrigger.textContent = isMobile ? '⚡ 모바일 로그인 실행' : '⚡ 선택한 서버에서 로그인';
    }

    // Account delete button visibility
    btnDeleteAccount.style.display = !isMobile && cur.accounts && cur.accounts.length > 1 ? 'flex' : 'none';
  }

  // Master switch pauses every server without changing individual server choices.
  toggleEnabled.addEventListener('change', async () => {
    masterEnabled = toggleEnabled.checked;
    await persistConfig();
    syncForm();
  });

  // Account Swap selection
  popupUserSelect.addEventListener('change', async (e) => {
    const newAcc = e.target.value;
    if (environments[activeServerKey]) {
      environments[activeServerKey].username = newAcc;
      syncAccountPassword();
      await persistConfig();
      showIndicator(userSaveIndicator);
    }
  });

  // Toggle Add Account Input
  btnToggleAdd.addEventListener('click', () => {
    const isHidden = accountAddBox.style.display === 'none';
    accountAddBox.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
      newUsernameInput.value = '';
      newUsernameInput.focus();
    }
  });

  btnCancelAdd.addEventListener('click', () => {
    accountAddBox.style.display = 'none';
  });

  // Confirm Add Account
  btnConfirmAdd.addEventListener('click', async () => {
    const val = newUsernameInput.value.trim();
    if (!val) return;

    const cur = environments[activeServerKey];
    if (!cur) return;

    if (!Array.isArray(cur.accounts)) cur.accounts = [];
    if (!cur.accounts.includes(val)) {
      cur.accounts.push(val);
    }
    cur.username = val;

    await persistConfig();
    accountAddBox.style.display = 'none';
    popupUserSelect.innerHTML = renderAccountOptions(cur.accounts, cur.username);
    syncAccountPassword();
    btnDeleteAccount.style.display = cur.accounts.length > 1 ? 'flex' : 'none';
    showIndicator(userSaveIndicator);
  });

  // Delete Account
  btnDeleteAccount.addEventListener('click', async () => {
    const cur = environments[activeServerKey];
    if (!cur || !Array.isArray(cur.accounts) || cur.accounts.length <= 1) return;

    const targetUser = cur.username;
    if (confirm(`'${targetUser}' 계정을 목록에서 삭제하시겠습니까?`)) {
      cur.accounts = cur.accounts.filter((a) => a !== targetUser);
      AwaAccounts.removePassword(cur, targetUser);
      cur.username = cur.accounts[0] || '';
      await persistConfig();
      popupUserSelect.innerHTML = renderAccountOptions(cur.accounts, cur.username);
    syncAccountPassword();
      btnDeleteAccount.style.display = cur.accounts.length > 1 ? 'flex' : 'none';
      showIndicator(userSaveIndicator);
    }
  });

  // Trigger login on active tab
  btnTrigger.addEventListener('click', async () => {
    await persistConfig();
    const cur = environments[activeServerKey];
    if (!cur || !masterEnabled || cur.enabled === false) return;
    let serverUrl;
    try {
      if (!cur.host?.trim()) throw new Error('Missing server URL');
      serverUrl = new URL(AwaServerUrl.url(cur));
      if (!['http:', 'https:'].includes(serverUrl.protocol)) throw new Error('Unsupported server URL');
    } catch (_) {
      alert('선택한 서버의 접속 URL을 확인해주세요.');
      return;
    }
    const isMobile = AwaAccounts.isMobile(cur);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // The saved address may be a login page the site hands extra query parameters
    // (a returnUrl, a tab_id); it is still that page.
    const onTargetServer = AwaServerUrl.matches(cur, tab.url);
    const navigate = (url) => chrome.tabs.update(tab.id, { url }, () => {
      if (chrome.runtime.lastError) {
        btnTrigger.disabled = false;
        btnTrigger.textContent = isMobile ? '⚡ 모바일 로그인 실행' : '⚡ 선택한 서버에서 로그인';
        alert('선택한 서버를 열 수 없습니다. 접속 URL을 확인해주세요.');
      } else window.close();
    });
    btnTrigger.disabled = true;
    btnTrigger.textContent = '⏳ 로그인 진행 중...';

    if (isMobile) {
      const selectedUser = superappUserSelect?.value || cur.superAppUser || AwaDefaultServers.DEFAULT_SUPERAPP_USER;
      cur.superAppUser = selectedUser;
      cur.superAppCustomerData = AwaSuperAppUsers.find(currentSuperAppCustomers, selectedUser);
      await persistConfig();
      const customerData = cur.superAppCustomerData;

      // Which page lists the customers is the site's, so it is shipped config; a
      // build without one logs in on whatever page the tab is already on.
      const superAppPath = AwaDefaultServers.SUPERAPP_PATH;
      const targetSuperAppUrl = superAppPath ? new URL(superAppPath, serverUrl).href : '';

      if (onTargetServer && superAppPath && tab.url && tab.url.includes(superAppPath)) {
        chrome.tabs.sendMessage(
          tab.id,
          {
            action: 'SELECT_SUPERAPP_USER',
            userKeyword: selectedUser,
            customerData,
            autoNavigate: true
          },
          (res) => {
            btnTrigger.disabled = false;
            btnTrigger.textContent = '⚡ 모바일 로그인 실행';
            if (res && res.success) window.close();
          }
        );
      } else if (onTargetServer && tab.url && (tab.url.includes('/pin/login') || tab.url.includes('/pin'))) {
        chrome.tabs.sendMessage(
          tab.id,
          {
            action: 'TRIGGER_LOGIN'
          },
          (res) => {
            btnTrigger.disabled = false;
            btnTrigger.textContent = '⚡ 모바일 로그인 실행';
            if (res && res.success) window.close();
          }
        );
      } else if (targetSuperAppUrl) {
        navigate(targetSuperAppUrl);
      } else {
        chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_LOGIN' }, () => {
          btnTrigger.disabled = false;
          btnTrigger.textContent = '⚡ 모바일 로그인 실행';
        });
      }
      return;
    }

    if (!onTargetServer) {
      navigate(AwaServerUrl.entry(cur));
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      {
        action: 'TRIGGER_LOGIN',
        targetEnvKey: activeServerKey,
        force: true
      },
      (res) => {
        btnTrigger.disabled = false;
        btnTrigger.textContent = '⚡ 선택한 서버에서 로그인';
        if (chrome.runtime.lastError) {
          navigate(AwaServerUrl.entry(cur));
        } else if (res && res.success) {
          window.close();
        }
      }
    );
  });

  // The extension can only act on addresses the user has allowed. Granting is done
  // in the settings page: a permission prompt closes the popup, which would cancel it.
  async function renderPermissionWarning() {
    const bar = document.getElementById('permission-warning');
    const text = document.getElementById('permission-text');
    if (!bar || !text) return;
    const origins = AwaServerUrl.originPatterns(environments);
    if (!origins.length) return;
    const held = await Promise.all(
      origins.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
    );
    const missing = held.filter((ok) => !ok).length;
    if (!missing) {
      bar.style.display = 'none';
      return;
    }
    text.textContent = `⚠️ 사이트 접근 허용이 필요한 주소 ${missing}곳 — 허용 전에는 자동 로그인이 동작하지 않습니다`;
    bar.style.display = 'flex';
  }

  // openOptionsPage lands on whichever tab was open last, which is not the one the
  // 사이트 접근 허용 button is on. Name the tab, and the row.
  document.getElementById('btn-permission-settings')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?tab=global&focus=permissions') });
  });

  // Newer build available? The answer is whatever the last background check wrote;
  // asking for a fresh one here must not hold the popup up.
  function renderUpdateNotice(state) {
    const notice = document.getElementById('update-notice');
    const text = document.getElementById('update-text');
    if (!notice || !text) return;
    if (!state?.newer) {
      notice.style.display = 'none';
      return;
    }
    text.textContent = `🆕 새 버전 v${state.version}${state.notes ? ` · ${state.notes}` : ''}`;
    notice.style.display = 'flex';
    document.getElementById('btn-update-download').onclick = () => {
      if (state.download) chrome.tabs.create({ url: state.download });
      else alert('설치본 주소가 설정되어 있지 않습니다. 설정 ⚙에서 지정하세요.');
    };
  }

  chrome.storage.local.get(['updateState'], (stored) => renderUpdateNotice(stored.updateState));
  chrome.runtime.sendMessage({ action: 'CHECK_UPDATE' }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state) renderUpdateNotice(state);
  });

  // Open Options Page
  btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // =========================================================================
  // AI AUTOMATED E2E TESTING INTEGRATION
  // =========================================================================
  const btnModeAutologin = document.getElementById('btn-mode-autologin');
  const btnModeAi = document.getElementById('btn-mode-ai');
  const panelAutologin = document.getElementById('panel-autologin');
  const panelAiTest = document.getElementById('panel-ai-test');

  const aiFlowContainer = document.getElementById('ai-flow-container');
  const aiFlowTitle = document.getElementById('ai-flow-title');
  const aiFlowBadge = document.getElementById('ai-flow-badge');
  const aiStepsList = document.getElementById('ai-steps-list');

  const aiSavedCount = document.getElementById('ai-saved-count');
  const aiSavedList = document.getElementById('ai-saved-list');

  function setPopupMode(mode, save = true) {
    if (save) {
      chrome.storage.local.set({ lastPopupMode: mode });
    }
    if (mode === 'ai') {
      if (btnModeAutologin) btnModeAutologin.classList.remove('active');
      if (btnModeAi) btnModeAi.classList.add('active');
      if (panelAutologin) panelAutologin.style.display = 'none';
      if (panelAiTest) panelAiTest.style.display = 'flex';
      renderSavedTestsPopup();
      renderPatternSuggestions();
    } else {
      if (btnModeAutologin) btnModeAutologin.classList.add('active');
      if (btnModeAi) btnModeAi.classList.remove('active');
      if (panelAutologin) panelAutologin.style.display = 'block';
      if (panelAiTest) panelAiTest.style.display = 'none';
    }
  }

  if (btnModeAutologin) btnModeAutologin.addEventListener('click', () => setPopupMode('autologin', true));
  if (btnModeAi) btnModeAi.addEventListener('click', () => setPopupMode('ai', true));



  // Cancel & Close flow control
  let activeFlowTabId = null;
  let isFlowAborted = false;
  let currentPreviewFlow = null;
  const btnCancelFlow = document.getElementById('btn-cancel-flow');
  const btnCloseFlow = document.getElementById('btn-close-flow');
  const btnRunPreviewFlow = document.getElementById('btn-run-preview-flow');
  const btnOpenOptionsEditor = document.getElementById('btn-open-options-editor');
  const aiFlowFooterHint = document.getElementById('ai-flow-footer-hint');

  if (btnOpenOptionsEditor) {
    btnOpenOptionsEditor.addEventListener('click', () => {
      chrome.runtime.openOptionsPage(() => {});
    });
  }

  if (btnRunPreviewFlow) {
    btnRunPreviewFlow.addEventListener('click', async () => {
      if (!currentPreviewFlow) return;
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id) {
        alert('활성화된 웹페이지 탭을 찾을 수 없습니다.');
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['scripts/flow-runner.js']
        });
      } catch (_) {}

      try {
        btnRunPreviewFlow.disabled = true;
        btnRunPreviewFlow.textContent = '실행중';
        await executeFlowSteps(currentPreviewFlow, activeTab.id);
      } finally {
        btnRunPreviewFlow.disabled = false;
        btnRunPreviewFlow.textContent = '▶ 실행';
      }
    });
  }

  function parkFlowContainer() {
    if (!aiFlowContainer || !panelAiTest) return;
    if (aiFlowContainer.parentElement !== panelAiTest) {
      panelAiTest.appendChild(aiFlowContainer);
    }
  }

  function syncFlowMount() {
    if (!aiFlowContainer || !panelAiTest) return;
    const open = aiFlowContainer.style.display !== 'none' && currentPreviewFlow && currentPreviewFlow.id;
    const item = open
      ? document.querySelector(`.ai-saved-item[data-id="${CSS.escape(String(currentPreviewFlow.id))}"]`)
      : null;
    if (item) {
      item.appendChild(aiFlowContainer);
      aiFlowContainer.classList.add('is-nested');
      return;
    }
    parkFlowContainer();
    aiFlowContainer.classList.remove('is-nested');
  }

  function closeFlowPreview() {
    chrome.storage.local.remove('lastPreviewFlowId');
    currentPreviewFlow = null;
    if (aiFlowContainer) aiFlowContainer.style.display = 'none';
    if (aiFlowFooterHint) aiFlowFooterHint.style.display = 'none';
    syncFlowMount();
    markActiveSavedItem();
  }

  function displayFlowPreview(flow) {
    if (!flow || !Array.isArray(flow.steps)) return;
    currentPreviewFlow = flow;
    if (flow.id && !flow.suggestion) {
      chrome.storage.local.set({ lastPreviewFlowId: flow.id });
    }

    if (aiFlowContainer) aiFlowContainer.style.display = 'flex';
    if (aiFlowTitle) aiFlowTitle.textContent = scenarioPopupChrome(flow.name, 'preview').heading;
    if (aiFlowBadge) {
      aiFlowBadge.textContent = `미리보기 (${flow.steps.length}단계)`;
      aiFlowBadge.className = 'badge';
      aiFlowBadge.style.backgroundColor = '#f1f5f9';
      aiFlowBadge.style.color = '#334155';
    }
    if (btnRunPreviewFlow) btnRunPreviewFlow.style.display = 'inline-block';
    if (btnCancelFlow) btnCancelFlow.style.display = 'none';
    if (btnCloseFlow) btnCloseFlow.style.display = 'inline-block';
    if (aiFlowFooterHint) aiFlowFooterHint.style.display = 'none';
    markActiveSavedItem();

    if (aiStepsList) {
      aiStepsList.innerHTML = flow.steps.map((s, idx) => {
        let actionBadge = '⚡ 동작';
        let detail = '';
        if (s.action === 'click') {
          actionBadge = '👆 클릭';
          detail = s.selector || s.text || '';
        } else if (s.action === 'fill') {
          actionBadge = '✏️ 입력';
          detail = `"${s.value || ''}" ➔ ${s.selector || ''}`;
        } else if (s.action === 'navigate') {
          actionBadge = '🌐 이동';
          detail = s.target || s.url || '';
        } else {
          actionBadge = s.action;
          detail = s.selector || s.target || '';
        }
        return `
          <div class="ai-step-item" style="cursor: default; padding: 6px 8px;">
            <span style="font-weight: 700; color: #64748b; font-size: 11px;">${idx + 1}.</span>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="badge" style="background: #e2e8f0; color: #1e293b; font-size: 9.5px; padding: 1px 5px;">${actionBadge}</span>
                <span style="font-weight: 600; font-size: 11px; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.description || s.action)}</span>
              </div>
              ${detail ? `<span style="font-family: monospace; font-size: 10px; color: #64748b; word-break: break-all;">${escapeHtml(detail)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    if (aiFlowFooterHint) aiFlowFooterHint.style.display = flow.suggestion ? 'none' : 'flex';
    syncFlowMount();
    const openItem = flow.id
      ? document.querySelector(`.ai-saved-item[data-id="${CSS.escape(String(flow.id))}"]`)
      : null;
    if (openItem) openItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (btnCancelFlow) {
    btnCancelFlow.addEventListener('click', () => {
      isFlowAborted = true;
      if (activeFlowTabId) {
        try {
          chrome.tabs.sendMessage(activeFlowTabId, { action: 'CANCEL_TEST_FLOW' }, () => {});
        } catch (_) {}
      }
      if (aiFlowBadge) {
        aiFlowBadge.textContent = '중단됨';
        aiFlowBadge.style.backgroundColor = '#fee2e2';
        aiFlowBadge.style.color = '#ef4444';
      }
      if (btnCancelFlow) btnCancelFlow.style.display = 'none';
      if (btnCloseFlow) btnCloseFlow.style.display = 'inline-block';
    });
  }

  if (btnCloseFlow) {
    btnCloseFlow.addEventListener('click', () => {
      closeFlowPreview();
      if (activeFlowTabId) {
        try {
          chrome.tabs.sendMessage(activeFlowTabId, { action: 'CANCEL_TEST_FLOW' }, () => {});
        } catch (_) {}
      }
    });
  }

  // Step runner against active tab with instant abort support
  async function executeFlowSteps(flow, tabId) {
    if (!flow || !Array.isArray(flow.steps) || flow.steps.length === 0) return false;

    activeFlowTabId = tabId;
    isFlowAborted = false;

    currentPreviewFlow = flow;
    if (flow.id && !flow.suggestion) {
      chrome.storage.local.set({ lastPreviewFlowId: flow.id });
    }
    markActiveSavedItem();
    if (aiFlowContainer) aiFlowContainer.style.display = 'flex';
    syncFlowMount();
    if (btnRunPreviewFlow) btnRunPreviewFlow.style.display = 'none';
    if (btnCancelFlow) btnCancelFlow.style.display = 'inline-block';
    if (btnCloseFlow) btnCloseFlow.style.display = 'none';
    if (aiFlowTitle) aiFlowTitle.textContent = scenarioPopupChrome(flow.name, 'run').heading;
    if (aiFlowBadge) {
      aiFlowBadge.textContent = '실행 중';
      aiFlowBadge.className = 'badge';
      aiFlowBadge.style.backgroundColor = '#eff6ff';
      aiFlowBadge.style.color = '#2563eb';
    }
    if (aiFlowFooterHint) aiFlowFooterHint.style.display = 'none';

    if (aiStepsList) {
      aiStepsList.innerHTML = flow.steps.map((s, idx) => `
        <div class="ai-step-item" id="ai-step-${idx}">
          <span style="font-weight: 700; color: #64748b;">${idx + 1}.</span>
          <span style="flex: 1;">${escapeHtml(s.description || s.action)}</span>
          <span id="ai-step-status-${idx}" style="font-size: 10px; color: #64748b;">⏳ 대기</span>
        </div>
      `).join('');
    }

    let allSucceeded = true;
    for (let i = 0; i < flow.steps.length; i++) {
      if (isFlowAborted) {
        allSucceeded = false;
        break;
      }

      const step = flow.steps[i];
      const row = document.getElementById(`ai-step-${i}`);
      const statusEl = document.getElementById(`ai-step-status-${i}`);

      if (row) row.className = 'ai-step-item running';
      if (statusEl) statusEl.textContent = '🔄 실행 중...';

      let stepResult = null;
      try {
        stepResult = await new Promise((resolve) => {
          chrome.tabs.sendMessage(
            tabId,
            { action: 'EXECUTE_TEST_STEP', step, index: i, total: flow.steps.length },
            (res) => {
              if (chrome.runtime.lastError) {
                let err = chrome.runtime.lastError.message || '';
                if (err.includes('Extension context invalidated') || err.includes('Receiving end does not exist')) {
                  err = '웹페이지를 새로고침(F5)해주세요. (확장 프로그램 업데이트 반영 필요)';
                }
                resolve({ success: false, error: err });
              } else {
                resolve(res || { success: false, error: '응답 없음' });
              }
            }
          );
        });
      } catch (err) {
        stepResult = { success: false, error: err.message };
      }

      if (isFlowAborted) {
        if (row) row.className = 'ai-step-item error';
        if (statusEl) statusEl.textContent = '⏹️ 사용자가 중단함';
        allSucceeded = false;
        break;
      }

      if (stepResult && stepResult.success) {
        if (row) row.className = 'ai-step-item success';
        if (statusEl) statusEl.textContent = '✅ 완료';
      } else {
        if (row) row.className = 'ai-step-item error';
        if (statusEl) statusEl.textContent = `❌ 실패: ${escapeHtml(stepResult?.error || '알 수 없는 오류')}`;
        allSucceeded = false;
        try {
          chrome.tabs.sendMessage(tabId, { action: 'TEST_FLOW_FINISHED', success: false, error: stepResult?.error });
        } catch (_) {}
        break;
      }
    }

    if (btnCancelFlow) btnCancelFlow.style.display = 'none';
    if (btnCloseFlow) btnCloseFlow.style.display = 'inline-block';

    if (allSucceeded) {
      try {
        chrome.tabs.sendMessage(tabId, { action: 'TEST_FLOW_FINISHED', success: true });
      } catch (_) {}
      if (aiFlowBadge) {
        aiFlowBadge.textContent = '완료 (100%)';
        aiFlowBadge.style.backgroundColor = '#dcfce7';
        aiFlowBadge.style.color = '#15803d';
      }
      return true;
    } else {
      if (aiFlowBadge) {
        aiFlowBadge.textContent = isFlowAborted ? '중단됨' : '실패';
        aiFlowBadge.style.backgroundColor = '#fee2e2';
        aiFlowBadge.style.color = '#ef4444';
      }
      return false;
    }
  }

  // ==========================================
  // E2E Test Recorder Controller
  // ==========================================
  const btnToggleRecord = document.getElementById('btn-toggle-record');
  const btnRecordText = document.getElementById('btn-record-text');
  const recorderStatusBadge = document.getElementById('recorder-status-badge');
  const recordingLiveInfo = document.getElementById('recording-live-info');
  const recordingLiveCount = document.getElementById('recording-live-count');

  let recordPollInterval = null;

  async function updateRecorderUI(isRecording, count = 0) {
    if (!btnToggleRecord) return;
    if (isRecording) {
      btnToggleRecord.className = 'btn-record recording';
      if (btnRecordText) btnRecordText.textContent = '⏹️ 기록 중지 및 저장 (Stop & Save)';
      if (recorderStatusBadge) {
        recorderStatusBadge.textContent = '🔴 녹화 중';
        recorderStatusBadge.style.backgroundColor = '#fee2e2';
        recorderStatusBadge.style.color = '#991b1b';
      }
      if (recordingLiveInfo) recordingLiveInfo.style.display = 'flex';
      if (recordingLiveCount) recordingLiveCount.textContent = `${count}개 동작 감지됨 (클릭/입력 중)`;
    } else {
      btnToggleRecord.className = 'btn-record start';
      if (btnRecordText) btnRecordText.textContent = '동작 기록 시작 (Record)';
      if (recorderStatusBadge) {
        recorderStatusBadge.textContent = '대기 중';
        recorderStatusBadge.style.backgroundColor = '#f1f5f9';
        recorderStatusBadge.style.color = '#475569';
      }
      if (recordingLiveInfo) recordingLiveInfo.style.display = 'none';
      if (recordPollInterval) {
        clearInterval(recordPollInterval);
        recordPollInterval = null;
      }
    }
  }

  // Check initial recording state on popup open
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['awa_is_recording', 'awa_recording_tab_id'], async (res) => {
      if (res && res.awa_is_recording && res.awa_recording_tab_id) {
        chrome.tabs.sendMessage(res.awa_recording_tab_id, { action: 'GET_RECORDING_STATUS' }, (statusRes) => {
          if (chrome.runtime.lastError || !statusRes?.isRecording) {
            chrome.storage.local.set({ awa_is_recording: false, awa_recording_tab_id: null });
            updateRecorderUI(false);
          } else {
            updateRecorderUI(true, statusRes.count || 0);
            startStatusPolling(res.awa_recording_tab_id);
          }
        });
      } else {
        updateRecorderUI(false);
      }
    });
  }

  function startStatusPolling(tabId) {
    if (recordPollInterval) clearInterval(recordPollInterval);
    recordPollInterval = setInterval(() => {
      chrome.tabs.sendMessage(tabId, { action: 'GET_RECORDING_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res?.isRecording) {
          clearInterval(recordPollInterval);
          recordPollInterval = null;
          updateRecorderUI(false);
        } else {
          if (recordingLiveCount) recordingLiveCount.textContent = `${res.count || 0}개 동작 감지됨 (클릭/입력 중)`;
        }
      });
    }, 1000);
  }

  if (btnToggleRecord) {
    btnToggleRecord.addEventListener('click', async () => {
      const storageState = await new Promise((r) => {
        chrome.storage.local.get(['awa_is_recording', 'awa_recording_tab_id'], r);
      });

      const isCurrentlyRecording = !!storageState?.awa_is_recording;

      if (!isCurrentlyRecording) {
        // START RECORDING
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          alert('기록을 시작할 웹페이지 탭을 찾을 수 없습니다.');
          return;
        }

        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['scripts/flow-runner.js']
          });
        } catch (_) {}

        let detectedKey = activeServerKey;
        if (activeTab.url) {
          try {
            const h = (new URL(activeTab.url).host || '').toLowerCase();
            for (const [k, s] of Object.entries(environments)) {
              if (s.host && normalizedHost(s.host) === h) {
                detectedKey = k;
                break;
              }
            }
          } catch (_) {}
        }

        chrome.tabs.sendMessage(activeTab.id, { action: 'START_RECORDING' }, async (res) => {
          if (chrome.runtime.lastError || !res?.success) {
            alert('기록 시작에 실패했습니다. 웹페이지를 새로고침한 후 다시 시도해주세요.');
            return;
          }

          await chrome.storage.local.set({
            awa_is_recording: true,
            awa_recording_tab_id: activeTab.id,
            awa_recording_server_key: detectedKey,
            awa_recording_url: activeTab.url || ''
          });
          updateRecorderUI(true, 0);
          startStatusPolling(activeTab.id);
        });

      } else {
        // STOP RECORDING & SAVE
        const tabId = storageState.awa_recording_tab_id;
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTabId = tabId || (activeTab && activeTab.id);

        if (!targetTabId) {
          await chrome.storage.local.set({ awa_is_recording: false, awa_recording_tab_id: null });
          updateRecorderUI(false);
          return;
        }

        chrome.tabs.sendMessage(targetTabId, { action: 'STOP_RECORDING' }, async (res) => {
          await chrome.storage.local.set({ awa_is_recording: false, awa_recording_tab_id: null });
          updateRecorderUI(false);

          const steps = (res && res.steps) || [];
          if (steps.length === 0) {
            alert('기록된 동작이 없습니다. 웹페이지에서 버튼을 클릭하거나 텍스트를 입력해주세요.');
            return;
          }

          const savedServerKey = storageState?.awa_recording_server_key || activeServerKey;
          const sObj = environments[savedServerKey];
          const hostUrl = storageState?.awa_recording_url || (activeTab && activeTab.url) || '';

          const fallbackName = `사용자 동작 시나리오 (${steps.length}단계)`;
          if (btnRecordText) btnRecordText.textContent = '시나리오 이름 만드는 중…';
          const defaultName = await suggestKoreanScenarioName(steps, fallbackName);
          updateRecorderUI(false);
          const testName = prompt('기록된 테스트 시나리오 이름을 입력하세요:', defaultName);
          if (testName && testName.trim()) {
            let tHost = '';
            try {
              if (sObj?.host) tHost = normalizedHost(sObj.host);
              else if (hostUrl) tHost = normalizedHost(new URL(hostUrl).host);
            } catch (_) {}

            const flow = {
              id: 'rec_' + Date.now(),
              name: testName.trim(),
              serverKey: savedServerKey || null,
              serverName: sObj ? AwaServerTypes.label(sObj) : '',
              group: sObj?.group || '',
              targetHost: tHost,
              startUrl: hostUrl,
              description: `${steps.length}개 동작 자동 기록됨 (${sObj ? `[${sObj.group}] ${sObj.name}` : '공통'})`,
              steps,
              createdAt: new Date().toISOString()
            };
            if (window.AiService) {
              await window.AiService.saveTestFlow(flow);
              renderSavedTestsPopup();
              alert(`'${flow.name}' 테스트가 [${sObj ? `${sObj.group} ${sObj.name}` : '공통'}] 서버에 매칭되어 저장되었습니다!\n아래 목록에서 [▶ 실행] 버튼을 누르면 언제든지 원클릭으로 재현됩니다.`);
            }
          }
        });
      }
    });
  }



  async function suggestKoreanScenarioName(steps, fallback) {
    if (!window.ScenarioNamer || typeof window.ScenarioNamer.koreanName !== 'function') return fallback;
    try {
      const named = await window.ScenarioNamer.koreanName(steps);
      return named || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function serverForHost(host) {
    const want = normalizedHost(host);
    for (const [key, server] of Object.entries(environments)) {
      if (server.host && normalizedHost(server.host) === want) {
        return { key, server };
      }
    }
    return null;
  }

  async function readPatternState() {
    const stored = await chrome.storage.local.get(['patternSuggestState', 'patternWatchEnabled']);
    return {
      enabled: window.PatternSuggest
        ? window.PatternSuggest.watchEnabled(stored.patternWatchEnabled)
        : stored.patternWatchEnabled !== false,
      state: stored.patternSuggestState || { hosts: {}, suggestions: [] },
    };
  }

  async function writePatternSuggestionStatus(id, status) {
    const { state } = await readPatternState();
    const suggestions = Array.isArray(state.suggestions) ? state.suggestions : [];
    const next = {
      ...state,
      suggestions: suggestions.map((item) => (item.id === id ? { ...item, status } : item)),
    };
    await chrome.storage.local.set({ patternSuggestState: next });
    return next;
  }

  async function renderPatternSuggestions() {
    parkFlowContainer();
    const list = document.getElementById('pattern-suggest-list');
    const toggle = document.getElementById('toggle-pattern-watch');
    if (!list) return;
    const { enabled, state } = await readPatternState();
    if (toggle) toggle.checked = enabled;
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('change', () => {
        chrome.storage.local.set({ patternWatchEnabled: toggle.checked });
        renderPatternSuggestions();
      });
    }

    const selectTestServerFilter = document.getElementById('select-test-server-filter');
    const filterMode = selectTestServerFilter ? selectTestServerFilter.value : 'current';
    const curActiveHost = environments[activeServerKey]?.host
      ? normalizedHost(environments[activeServerKey].host)
      : '';
    const pending = (state.suggestions || []).filter((item) => item.status === 'pending').filter((item) => {
      if (filterMode === 'all') return true;
      if (filterMode === 'current') return normalizedHost(item.host) === curActiveHost;
      const target = environments[filterMode];
      return !!(target && normalizedHost(item.host) === normalizedHost(target.host));
    });

    if (pending.length === 0) {
      list.innerHTML = `<div class="pattern-suggest-empty">${enabled
        ? '같은 동작이 3번 반복되면 여기에 쌓입니다. 다음 제안이 이전 제안을 지우지 않습니다.'
        : '감지를 켜면 클릭, 입력, 화면 이동만 기억합니다.'}</div>`;
      syncFlowMount();
      return;
    }

    list.innerHTML = pending.map((item) => {
      const matched = serverForHost(item.host);
      const badge = matched
        ? `[${escapeHtml(matched.server.group)} ${escapeHtml(AwaServerTypes.label(matched.server))}]`
        : `[${escapeHtml(item.host || '공통')}]`;
      const activeClass = currentPreviewFlow && currentPreviewFlow.id === item.id ? ' is-active' : '';
      const seen = item.seenCount || 3;
      return `
        <div class="ai-saved-item${activeClass}" data-id="${escapeHtml(item.id)}" data-suggestion-id="${escapeHtml(item.id)}">
          <div class="ai-saved-item-row">
            <div class="ai-saved-item-info" data-id="${escapeHtml(item.id)}" title="클릭하여 플로우 단계 미리보기">
              <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                <span class="badge" style="background: #eff6ff; color: #1d4ed8; font-size: 9.5px; padding: 1px 4px; font-weight: 700;">${badge}</span>
                <span class="ai-saved-item-title">${escapeHtml(item.label || '반복 동작')}</span>
              </div>
              <span class="ai-saved-item-meta">${item.steps?.length || 0}단계 · ${seen}회 반복 <span style="color: #2563eb; font-weight: 600;">(단계 보기 👁️)</span></span>
            </div>
            <div class="ai-saved-actions">
              <button type="button" class="btn-small primary btn-icon-act btn-run-suggestion" data-id="${escapeHtml(item.id)}" title="실행" aria-label="실행">▶</button>
              <button type="button" class="btn-small outline btn-icon-act btn-save-suggestion" data-id="${escapeHtml(item.id)}" title="저장" aria-label="저장">💾</button>
              <button type="button" class="btn-icon-del btn-dismiss-suggestion" data-id="${escapeHtml(item.id)}" title="제안에서 지우기">✕</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.ai-saved-item-info').forEach((infoEl) => {
      infoEl.addEventListener('click', async () => {
        const id = infoEl.dataset.id;
        if (currentPreviewFlow && currentPreviewFlow.id === id && aiFlowContainer && aiFlowContainer.style.display !== 'none') {
          closeFlowPreview();
          return;
        }
        const { state: fresh } = await readPatternState();
        const item = (fresh.suggestions || []).find((entry) => entry.id === id);
        if (item) displayFlowPreview(suggestionAsFlow(item));
      });
    });

    list.querySelectorAll('.btn-run-suggestion').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { state: fresh } = await readPatternState();
        const item = (fresh.suggestions || []).find((entry) => entry.id === btn.dataset.id);
        if (!item) return;
        const flow = suggestionAsFlow(item);
        displayFlowPreview(flow);
        await runFlowInActiveTab(flow, btn);
      });
    });

    list.querySelectorAll('.btn-dismiss-suggestion').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await writePatternSuggestionStatus(btn.dataset.id, 'dismissed');
        renderPatternSuggestions();
      });
    });

    list.querySelectorAll('.btn-save-suggestion').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { state: fresh } = await readPatternState();
        const item = (fresh.suggestions || []).find((entry) => entry.id === btn.dataset.id);
        if (!item || !window.AiService) return;
        const fallback = item.label || '반복 동작';
        btn.disabled = true;
        const previousIcon = btn.textContent;
        btn.textContent = '…';
        let suggested = fallback;
        try {
          suggested = await suggestKoreanScenarioName(item.steps, fallback);
        } finally {
          btn.disabled = false;
          btn.textContent = previousIcon || '💾';
        }
        const name = prompt('시나리오 이름을 입력하세요:', suggested);
        if (!name || !name.trim()) return;
        const matched = serverForHost(item.host);
        await window.AiService.saveTestFlow({
          id: `rec_${Date.now()}`,
          name: name.trim(),
          serverKey: matched?.key || null,
          serverName: matched ? AwaServerTypes.label(matched.server) : '',
          group: matched?.server.group || '',
          targetHost: normalizedHost(item.host),
          startUrl: item.startUrl || '',
          description: '반복 동작 제안에서 저장',
          steps: item.steps || [],
          createdAt: new Date().toISOString(),
        });
        await writePatternSuggestionStatus(item.id, 'saved');
        renderSavedTestsPopup();
        renderPatternSuggestions();
      });
    });
    syncFlowMount();
  }

  function markActiveSavedItem() {
    const activeId = currentPreviewFlow && currentPreviewFlow.id;
    document.querySelectorAll('.ai-saved-item').forEach((el) => {
      el.classList.toggle('is-active', !!(activeId && el.dataset.id === activeId));
    });
  }

  function suggestionAsFlow(item) {
    const matched = serverForHost(item.host);
    return {
      id: item.id,
      name: item.label || '반복 동작',
      suggestion: true,
      serverKey: matched?.key || null,
      serverName: matched ? AwaServerTypes.label(matched.server) : '',
      group: matched?.server.group || '',
      targetHost: normalizedHost(item.host),
      startUrl: item.startUrl || '',
      steps: item.steps || [],
    };
  }

  async function runFlowInActiveTab(flow, btn) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) {
      alert('활성화된 웹페이지 탭을 찾을 수 없습니다.');
      return;
    }

    let targetHost = flow.targetHost;
    if (!targetHost && flow.serverKey && environments[flow.serverKey]?.host) {
      targetHost = normalizedHost(environments[flow.serverKey].host);
    }

    let tabHost = '';
    try {
      if (activeTab.url) tabHost = normalizedHost(new URL(activeTab.url).host);
    } catch (_) {}

    if (targetHost && tabHost && targetHost !== tabHost) {
      const sObj = flow.serverKey ? environments[flow.serverKey] : null;
      const sName = flow.serverName || sObj?.name || targetHost;
      const destUrl = flow.startUrl || (sObj ? AwaServerUrl.url(sObj) : AwaServerUrl.url(targetHost));
      const willMove = confirm(`이 시나리오는 [${flow.group || ''} ${sName}] 전용 테스트입니다.\n현재 탭(${tabHost || '알 수 없음'})을 해당 서버(${destUrl})로 이동한 후 실행하시겠습니까?`);
      if (!willMove) return;

      await chrome.tabs.update(activeTab.id, { url: destUrl });
      await new Promise((resolve) => {
        const onUpdated = (tabId, changeInfo) => {
          if (tabId === activeTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            setTimeout(resolve, 800);
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }, 6000);
      });
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['scripts/flow-runner.js']
      });
    } catch (_) {}

    const label = btn.textContent;
    const iconOnly = btn.classList.contains('btn-icon-act');
    try {
      btn.disabled = true;
      btn.textContent = iconOnly ? '…' : '실행중';
      await executeFlowSteps(flow, activeTab.id);
    } finally {
      btn.disabled = false;
      btn.textContent = label || (iconOnly ? '▶' : '▶ 실행');
    }
  }

  // Render Saved Tests in Popup (Matched to Servers)
  async function renderSavedTestsPopup() {
    parkFlowContainer();
    if (!aiSavedList || !window.AiService) {
      renderPatternSuggestions();
      return;
    }
    const tests = await window.AiService.getSavedTests();

    const selectTestServerFilter = document.getElementById('select-test-server-filter');
    const curActiveObj = environments[activeServerKey];
    const curActiveLabel = curActiveObj ? `[${curActiveObj.group}] ${curActiveObj.name}` : activeServerKey;

    if (selectTestServerFilter) {
      const curSelected = selectTestServerFilter.value || 'current';
      let optsHtml = `
        <option value="current">📍 현재 선택된 서버 (${escapeHtml(curActiveLabel)})</option>
        <option value="all">🌐 모든 서버 시나리오 보기</option>
      `;

      const groups = {};
      for (const [k, s] of Object.entries(environments)) {
        const g = s.group || 'OTHER';
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key: k, ...s });
      }

      for (const [gName, sList] of Object.entries(groups)) {
        optsHtml += `<optgroup label="[${escapeHtml(gName)}]">`;
        for (const s of sList) {
          optsHtml += `<option value="${escapeHtml(s.key)}">${escapeHtml(AwaServerTypes.label(s, s.key))} (${escapeHtml(s.host)})</option>`;
        }
        optsHtml += `</optgroup>`;
      }

      selectTestServerFilter.innerHTML = optsHtml;
      if (curSelected && Array.from(selectTestServerFilter.options).some((o) => o.value === curSelected)) {
        selectTestServerFilter.value = curSelected;
      } else {
        selectTestServerFilter.value = 'current';
      }

      if (!selectTestServerFilter.dataset.bound) {
        selectTestServerFilter.dataset.bound = 'true';
        selectTestServerFilter.addEventListener('change', () => {
          renderSavedTestsPopup();
        });
      }
    }

    const filterMode = selectTestServerFilter ? selectTestServerFilter.value : 'current';
    const curActiveHost = curActiveObj?.host ? normalizedHost(curActiveObj.host) : '';

    const filteredTests = tests.filter((t) => {
      if (filterMode === 'all') return true;
      if (filterMode === 'current') {
        if (!t.serverKey && !t.targetHost) return true;
        if (t.serverKey === activeServerKey) return true;
        if (t.targetHost && curActiveHost && normalizedHost(t.targetHost) === curActiveHost) return true;
        return false;
      }
      if (!t.serverKey && !t.targetHost) return true;
      if (t.serverKey === filterMode) return true;
      const targetObj = environments[filterMode];
      if (targetObj && t.targetHost && normalizedHost(t.targetHost) === normalizedHost(targetObj.host)) return true;
      return false;
    });

    if (aiSavedCount) {
      if (tests.length === filteredTests.length) {
        aiSavedCount.textContent = `${tests.length}개`;
      } else {
        aiSavedCount.textContent = `${filteredTests.length}개 (전체 ${tests.length}개)`;
      }
    }

    if (filteredTests.length === 0) {
      const serverDesc = filterMode === 'current'
        ? (curActiveObj ? `[${curActiveObj.group} ${curActiveObj.name}]` : '현재 서버')
        : (environments[filterMode] ? `[${environments[filterMode].group} ${environments[filterMode].name}]` : '선택된 서버');
      aiSavedList.innerHTML = `
        <div style="text-align: center; padding: 12px; color: #94a3b8; font-size: 11px; background: #f8fafc; border-radius: 6px; border: 1px dashed #cbd5e1;">
          ${filterMode === 'all'
            ? '저장된 테스트가 없습니다.<br>상단에서 테스트 녹화 후 등록할 수 있습니다.'
            : `${escapeHtml(serverDesc)}에 등록된 시나리오가 없습니다.<br><span style="color: #64748b; font-size: 10px;">(상단 필터를 '🌐 모든 서버 시나리오'로 변경하거나 새 시나리오를 녹화해보세요)</span>`}
        </div>
      `;
      renderPatternSuggestions();
      return;
    }

    aiSavedList.innerHTML = filteredTests.map((t) => {
      let serverTag = '';
      if (t.serverKey && environments[t.serverKey]) {
        serverTag = `<span class="badge" style="background: #eff6ff; color: #1d4ed8; font-size: 9.5px; padding: 1px 4px; font-weight: 700;">[${escapeHtml(environments[t.serverKey].group)} ${escapeHtml(environments[t.serverKey].name)}]</span>`;
      } else if (t.group || t.serverName) {
        serverTag = `<span class="badge" style="background: #eff6ff; color: #1d4ed8; font-size: 9.5px; padding: 1px 4px; font-weight: 700;">[${escapeHtml(t.group || '')} ${escapeHtml(t.serverName || '')}]</span>`;
      } else {
        serverTag = `<span class="badge" style="background: #f1f5f9; color: #64748b; font-size: 9.5px; padding: 1px 4px;">[공통]</span>`;
      }

      const rowLabel = scenarioPopupChrome(t.name, 'list').listLabel;
      const activeClass = currentPreviewFlow && currentPreviewFlow.id === t.id ? ' is-active' : '';
      return `
      <div class="ai-saved-item${activeClass}" data-id="${escapeHtml(t.id)}">
        <div class="ai-saved-item-row">
          <div class="ai-saved-item-info" data-id="${escapeHtml(t.id)}" title="클릭하여 플로우 단계 미리보기">
            <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
              ${serverTag}
              <span class="ai-saved-item-title">🧪 ${escapeHtml(rowLabel)}</span>
            </div>
            <span class="ai-saved-item-meta">${t.steps?.length || 0}단계 · ${escapeHtml((t.createdAt || '').slice(0, 10))} <span style="color: #2563eb; font-weight: 600;">(단계 보기 👁️)</span></span>
          </div>
          <div class="ai-saved-actions">
            <button type="button" class="btn-small primary btn-run-saved" data-id="${escapeHtml(t.id)}" title="원클릭으로 즉시 실행">▶ 실행</button>
            <button type="button" class="btn-icon-del btn-del-saved-popup" data-id="${escapeHtml(t.id)}" title="삭제" style="width: 22px; height: 22px; font-size: 10px;">✕</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    aiSavedList.querySelectorAll('.ai-saved-item-info').forEach((infoEl) => {
      infoEl.addEventListener('click', () => {
        const id = infoEl.dataset.id;
        if (currentPreviewFlow && currentPreviewFlow.id === id && aiFlowContainer && aiFlowContainer.style.display !== 'none') {
          closeFlowPreview();
          return;
        }
        const found = tests.find((x) => x.id === id);
        if (found) {
          displayFlowPreview(found);
        }
      });
    });

    const { lastPreviewFlowId } = await chrome.storage.local.get(['lastPreviewFlowId']);
    if (lastPreviewFlowId && (!currentPreviewFlow || currentPreviewFlow.id !== lastPreviewFlowId)) {
      const found = tests.find((x) => x.id === lastPreviewFlowId);
      if (found) {
        displayFlowPreview(found);
      }
    }

    aiSavedList.querySelectorAll('.btn-run-saved').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const found = tests.find((x) => x.id === id);
        if (!found) return;

        await runFlowInActiveTab(found, btn);
      });
    });

    aiSavedList.querySelectorAll('.btn-del-saved-popup').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 테스트 시나리오를 삭제하시겠습니까?')) return;
        if (currentPreviewFlow && currentPreviewFlow.id === btn.dataset.id) {
          closeFlowPreview();
        }
        await window.AiService.deleteSavedTest(btn.dataset.id);
        renderSavedTestsPopup();
      });
    });
    renderPatternSuggestions();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial render
  renderCategoryTabs();
  renderServerSwitches();
  markDetectedServer(pendingDetection);
  syncForm();

  // Restore last selected tab mode and preview state
  const { lastPopupMode } = await chrome.storage.local.get(['lastPopupMode']);
  if (lastPopupMode === 'ai') {
    setPopupMode('ai', false);
  } else {
    setPopupMode('autologin', false);
  }
});
