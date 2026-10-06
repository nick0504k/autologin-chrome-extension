document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_SERVERS = AwaDefaultServers.ALL;

  const DEFAULT_GLOBAL = AwaDefaultServers.GLOBAL;

  const tabsNav = document.getElementById('tabs-nav');
  const btnAddEnvTab = document.getElementById('btn-add-env-tab');
  const envTabsContentContainer = document.getElementById('env-tabs-content-container');
  const form = document.getElementById('settings-form');
  const btnReset = document.getElementById('btn-reset');
  const btnResetAll = document.getElementById('btn-reset-all');
  const btnDeleteServer = document.getElementById('btn-delete-server');
  const saveStatus = document.getElementById('save-status');
  const keyDelayInput = document.getElementById('keyDelay');
  const keyDelaySlider = document.getElementById('keyDelaySlider');
  const speedDisplay = document.getElementById('speed-display');
  const presetBtns = document.querySelectorAll('.btn-preset');
  const appVersionEl = document.getElementById('app-version');

  if (appVersionEl && chrome.runtime?.getManifest) {
    const v = chrome.runtime.getManifest()?.version;
    if (v) appVersionEl.textContent = `v${v}`;
  }

  // Load from chrome.storage
  const stored = await chrome.storage.local.get([
    'environments',
    'global',
    'keyDelay',
    'autoSubmit',
    'activeGroup',
    'groupOrder',
    'aiConfig'
  ]);

  let environments = AwaEnvStore.build(stored.environments, DEFAULT_SERVERS);

  const resolvedDelay = Number(stored.global?.keyDelay ?? stored.keyDelay ?? DEFAULT_GLOBAL.keyDelay);
  document.getElementById('updateFeedUrl').value = AwaUpdates.config(stored).feedUrl;
  document.getElementById('updateDownloadUrl').value = AwaUpdates.config(stored).downloadUrl;
  const resolvedAutoSubmit = stored.global?.autoSubmit ?? stored.autoSubmit ?? DEFAULT_GLOBAL.autoSubmit;

  document.getElementById('autoSubmit').checked = !!resolvedAutoSubmit;

  function setSpeedValue(val) {
    const num = Math.max(20, Math.min(500, parseInt(val, 10) || 120));
    keyDelayInput.value = num;
    keyDelaySlider.value = num;
    speedDisplay.textContent = `${num}ms`;
  }

  keyDelaySlider.addEventListener('input', (e) => setSpeedValue(e.target.value));
  keyDelayInput.addEventListener('input', (e) => setSpeedValue(e.target.value));

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSpeedValue(btn.getAttribute('data-speed'));
    });
  });

  setSpeedValue(resolvedDelay);

  // E2E Test Scenarios Management
  const normalizedHost = (host) => AwaServerUrl.normalizeHost(host);
  const savedTestsListContainer = document.getElementById('saved-tests-list-container');
  const savedTestsCount = document.getElementById('saved-tests-count');
  const btnExportTests = document.getElementById('btn-export-tests');
  const btnImportTests = document.getElementById('btn-import-tests');
  const inputImportTests = document.getElementById('input-import-tests');

  const expandedEditorIds = new Set();

  async function renderSavedTestsList() {
    if (!savedTestsListContainer || !window.AiService) return;
    const tests = await window.AiService.getSavedTests();

    const optionsServerFilter = document.getElementById('options-server-filter');
    if (optionsServerFilter) {
      const curFilterVal = optionsServerFilter.value || 'all';
      let filterOptsHtml = `<option value="all">🌐 모든 서버 시나리오</option>`;
      const groups = {};
      for (const [k, s] of Object.entries(environments)) {
        const g = s.group || 'OTHER';
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key: k, ...s });
      }
      for (const [gName, sList] of Object.entries(groups)) {
        filterOptsHtml += `<optgroup label="[${escapeHtml(gName)}]">`;
        for (const s of sList) {
          filterOptsHtml += `<option value="${escapeHtml(s.key)}">[${escapeHtml(s.group)}] ${escapeHtml(s.name)} (${escapeHtml(s.host)})</option>`;
        }
        filterOptsHtml += `</optgroup>`;
      }
      optionsServerFilter.innerHTML = filterOptsHtml;
      if (curFilterVal && Array.from(optionsServerFilter.options).some((o) => o.value === curFilterVal)) {
        optionsServerFilter.value = curFilterVal;
      } else {
        optionsServerFilter.value = 'all';
      }

      if (!optionsServerFilter.dataset.bound) {
        optionsServerFilter.dataset.bound = 'true';
        optionsServerFilter.addEventListener('change', () => {
          renderSavedTestsList();
        });
      }
    }

    const filterVal = optionsServerFilter ? optionsServerFilter.value : 'all';
    const filteredTests = tests.filter((t) => {
      if (filterVal === 'all') return true;
      if (!t.serverKey && !t.targetHost) return true;
      if (t.serverKey === filterVal) return true;
      const targetObj = environments[filterVal];
      if (targetObj && t.targetHost && normalizedHost(t.targetHost) === normalizedHost(targetObj.host)) return true;
      return false;
    });

    if (savedTestsCount) {
      if (tests.length === filteredTests.length) {
        savedTestsCount.textContent = `${tests.length}개`;
      } else {
        savedTestsCount.textContent = `${filteredTests.length}개 / 전체 ${tests.length}개`;
      }
    }

    if (filteredTests.length === 0) {
      savedTestsListContainer.innerHTML = `
        <div style="text-align: center; padding: 24px; color: #94a3b8; font-size: 13px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
          ${filterVal === 'all'
            ? '저장된 E2E 테스트 시나리오가 없습니다.<br>확장 프로그램 팝업의 [🎬 E2E 녹화 & 실행] 탭에서 [동작 기록 시작]을 통해 손쉽게 시나리오를 생성할 수 있습니다.'
            : '선택된 서버 환경에 매칭된 시나리오가 없습니다.<br><span style="color: #64748b; font-size: 11px;">(상단 필터를 \'🌐 모든 서버 시나리오\'로 변경하거나 새 시나리오를 녹화해보세요)</span>'}
        </div>
      `;
      return;
    }

    savedTestsListContainer.innerHTML = filteredTests
      .map((t) => {
        const isExpanded = expandedEditorIds.has(t.id);
        let serverBadge = '';
        if (t.serverKey && environments[t.serverKey]) {
          serverBadge = `<span class="badge" style="background: #eff6ff; color: #1d4ed8; font-weight: 700; font-size: 11px;">[${escapeHtml(environments[t.serverKey].group)} ${escapeHtml(environments[t.serverKey].name)}]</span>`;
        } else if (t.group || t.serverName) {
          serverBadge = `<span class="badge" style="background: #eff6ff; color: #1d4ed8; font-weight: 700; font-size: 11px;">[${escapeHtml(t.group || '')} ${escapeHtml(t.serverName || '')}]</span>`;
        } else {
          serverBadge = `<span class="badge" style="background: #f1f5f9; color: #64748b; font-size: 11px;">[공통]</span>`;
        }

        const stepsHtml = (t.steps || []).map((s, idx) => {
          let badge = '⚡ 동작';
          if (s.action === 'click') badge = '👆 클릭';
          else if (s.action === 'fill') badge = '✏️ 입력';
          else if (s.action === 'navigate') badge = '🌐 이동';
          else if (s.action === 'sleep') badge = '⏱️ 대기';
          else if (s.action === 'waitfor') badge = '🔍 탐색';
          else badge = s.action || '동작';

          return `
            <div class="step-editor-row" data-step-idx="${idx}">
              <span class="step-editor-num">${idx + 1}.</span>
              <span class="step-editor-badge">${badge}</span>
              <div class="step-editor-inputs">
                <input type="text" class="step-input-desc" value="${escapeHtml(s.description || '')}" placeholder="단계 설명" title="단계 설명">
                <input type="text" class="step-input-target" value="${escapeHtml(s.selector || s.target || s.url || '')}" placeholder="선택자 / URL" title="CSS 선택자 또는 URL">
                ${s.action === 'fill' ? `<input type="text" class="step-input-val" value="${escapeHtml(s.value || '')}" placeholder="입력할 값" title="입력값">` : ''}
              </div>
              <div class="step-editor-btns">
                <button type="button" class="step-btn-action btn-opt-move-up" data-test-id="${escapeHtml(t.id)}" data-idx="${idx}" title="위로 이동" ${idx === 0 ? 'disabled style="opacity: 0.3; cursor: default;"' : ''}>▲</button>
                <button type="button" class="step-btn-action btn-opt-move-down" data-test-id="${escapeHtml(t.id)}" data-idx="${idx}" title="아래로 이동" ${idx === (t.steps || []).length - 1 ? 'disabled style="opacity: 0.3; cursor: default;"' : ''}>▼</button>
                <button type="button" class="step-btn-action del btn-opt-del-step" data-test-id="${escapeHtml(t.id)}" data-idx="${idx}" title="이 단계 삭제">✕</button>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="saved-test-card" data-id="${escapeHtml(t.id)}">
            <div class="saved-test-header">
              <div class="saved-test-info">
                <div style="display: flex; align-items: center; gap: 8px;">
                  ${serverBadge}
                  <span class="saved-test-title">🧪 ${escapeHtml(t.name)}</span>
                  <span class="badge" style="background: #e2e8f0; color: #334155; font-size: 11px;">${t.steps?.length || 0}단계</span>
                </div>
                <span class="saved-test-meta">생성일: ${escapeHtml((t.createdAt || '').slice(0, 10))} ${t.description ? `· ${escapeHtml(t.description)}` : ''}</span>
              </div>
              <div class="saved-test-actions">
                <button type="button" class="btn secondary btn-toggle-steps" data-id="${escapeHtml(t.id)}" style="padding: 5px 10px; font-size: 11.5px;">
                  ${isExpanded ? '▲ 단계 접기' : '✏️ 단계 편집 / 순서 변경'}
                </button>
                <button type="button" class="btn secondary btn-view-test-json" data-id="${escapeHtml(t.id)}" style="padding: 5px 8px; font-size: 11px;">JSON</button>
                <button type="button" class="btn-delete-env btn-del-saved-test" data-id="${escapeHtml(t.id)}" title="시나리오 삭제">✕</button>
              </div>
            </div>

            <!-- Expanded Step Editor Panel -->
            <div class="saved-test-steps-editor" id="steps-editor-${escapeHtml(t.id)}" style="${isExpanded ? '' : 'display: none;'}">
              <div class="step-editor-list" id="step-list-${escapeHtml(t.id)}">
                ${stepsHtml || '<div style="color: #94a3b8; font-size: 12px; padding: 8px;">단계가 없습니다.</div>'}
              </div>
              <div class="step-editor-footer" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #475569;">
                  <span>매칭 서버:</span>
                  <select class="step-server-select" id="step-server-select-${escapeHtml(t.id)}" style="font-size: 11px; padding: 3px 6px; border-radius: 5px; border: 1px solid #cbd5e1; background: #fff;">
                    <option value="">[공통] 모든 서버</option>
                    ${Object.entries(environments).map(([k, s]) => `
                      <option value="${escapeHtml(k)}" ${t.serverKey === k ? 'selected' : ''}>[${escapeHtml(s.group)}] ${escapeHtml(s.name)} (${escapeHtml(s.host)})</option>
                    `).join('')}
                  </select>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="btn secondary btn-add-step-opt" data-test-id="${escapeHtml(t.id)}" style="font-size: 11px; padding: 4px 8px;">+ 새 단계 추가</button>
                  <button type="button" class="btn primary btn-save-steps-opt" data-test-id="${escapeHtml(t.id)}" style="font-size: 11.5px; padding: 4px 12px;">💾 변경사항 저장</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Toggle expand/collapse
    savedTestsListContainer.querySelectorAll('.btn-toggle-steps').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (expandedEditorIds.has(id)) {
          expandedEditorIds.delete(id);
        } else {
          expandedEditorIds.add(id);
        }
        renderSavedTestsList();
      });
    });

    // Move step up
    savedTestsListContainer.querySelectorAll('.btn-opt-move-up').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const testId = btn.dataset.testId;
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx <= 0) return;
        const tests = await window.AiService.getSavedTests();
        const found = tests.find((x) => x.id === testId);
        if (!found || !found.steps) return;
        const temp = found.steps[idx];
        found.steps[idx] = found.steps[idx - 1];
        found.steps[idx - 1] = temp;
        await window.AiService.saveTestFlow(found);
        renderSavedTestsList();
      });
    });

    // Move step down
    savedTestsListContainer.querySelectorAll('.btn-opt-move-down').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const testId = btn.dataset.testId;
        const idx = parseInt(btn.dataset.idx, 10);
        const tests = await window.AiService.getSavedTests();
        const found = tests.find((x) => x.id === testId);
        if (!found || !found.steps || idx >= found.steps.length - 1) return;
        const temp = found.steps[idx];
        found.steps[idx] = found.steps[idx + 1];
        found.steps[idx + 1] = temp;
        await window.AiService.saveTestFlow(found);
        renderSavedTestsList();
      });
    });

    // Delete step
    savedTestsListContainer.querySelectorAll('.btn-opt-del-step').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const testId = btn.dataset.testId;
        const idx = parseInt(btn.dataset.idx, 10);
        const tests = await window.AiService.getSavedTests();
        const found = tests.find((x) => x.id === testId);
        if (!found || !found.steps) return;
        if (found.steps.length <= 1) {
          alert('시나리오에는 최소 1개의 단계가 필요합니다. 시나리오 전체를 삭제하려면 상단의 ✕ 버튼을 이용해주세요.');
          return;
        }
        found.steps.splice(idx, 1);
        await window.AiService.saveTestFlow(found);
        renderSavedTestsList();
      });
    });

    // Add new step
    savedTestsListContainer.querySelectorAll('.btn-add-step-opt').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const testId = btn.dataset.testId;
        const tests = await window.AiService.getSavedTests();
        const found = tests.find((x) => x.id === testId);
        if (!found) return;
        found.steps = found.steps || [];
        found.steps.push({
          action: 'click',
          selector: '',
          description: '새 클릭 동작'
        });
        await window.AiService.saveTestFlow(found);
        renderSavedTestsList();
      });
    });

    // Save edited step inputs
    savedTestsListContainer.querySelectorAll('.btn-save-steps-opt').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const testId = btn.dataset.testId;
        const tests = await window.AiService.getSavedTests();
        const found = tests.find((x) => x.id === testId);
        if (!found || !found.steps) return;

        const editorCard = document.getElementById(`steps-editor-${testId}`);
        if (!editorCard) return;

        const rows = editorCard.querySelectorAll('.step-editor-row');
        rows.forEach((row, i) => {
          if (!found.steps[i]) return;
          const descInput = row.querySelector('.step-input-desc');
          const targetInput = row.querySelector('.step-input-target');
          const valInput = row.querySelector('.step-input-val');
          if (descInput) found.steps[i].description = descInput.value.trim();
          if (targetInput) {
            const val = targetInput.value.trim();
            if (found.steps[i].action === 'navigate') {
              found.steps[i].target = val;
              found.steps[i].url = val;
            } else {
              found.steps[i].selector = val;
            }
          }
          if (valInput) found.steps[i].value = valInput.value;
        });

        const serverSelect = document.getElementById(`step-server-select-${testId}`);
        if (serverSelect) {
          const selectedKey = serverSelect.value;
          found.serverKey = selectedKey || null;
          if (selectedKey && environments[selectedKey]) {
            found.serverName = environments[selectedKey].name || '';
            found.group = environments[selectedKey].group || '';
            found.targetHost = normalizedHost(environments[selectedKey].host);
          } else {
            found.serverName = '';
            found.group = '';
          }
        }

        await window.AiService.saveTestFlow(found);
        alert('시나리오 단계 및 매칭 서버 설정이 저장되었습니다!');
        renderSavedTestsList();
      });
    });

    // Delete whole scenario
    savedTestsListContainer.querySelectorAll('.btn-del-saved-test').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 테스트 시나리오 전체를 삭제하시겠습니까?')) return;
        await window.AiService.deleteSavedTest(btn.dataset.id);
        expandedEditorIds.delete(btn.dataset.id);
        renderSavedTestsList();
      });
    });

    // View JSON
    savedTestsListContainer.querySelectorAll('.btn-view-test-json').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tests = await window.AiService.getSavedTests();
        const found = tests.find((x) => x.id === btn.dataset.id);
        if (found) {
          alert(JSON.stringify(found, null, 2));
        }
      });
    });
  }

  if (btnExportTests) {
    btnExportTests.addEventListener('click', async () => {
      if (!window.AiService) return;
      const tests = await window.AiService.getSavedTests();
      const blob = new Blob([JSON.stringify(tests, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `awa-e2e-tests-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (btnImportTests && inputImportTests) {
    btnImportTests.addEventListener('click', () => inputImportTests.click());
    inputImportTests.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          if (item && item.steps) {
            await window.AiService.saveTestFlow(item);
          }
        }
        alert(`${list.length}개의 테스트 시나리오를 가져왔습니다.`);
        renderSavedTestsList();
      } catch (err) {
        alert('올바른 JSON 파일이 아닙니다: ' + err.message);
      }
      inputImportTests.value = '';
    });
  }

  // Group Management
  let groupOrder = Array.isArray(stored.groupOrder) ? stored.groupOrder : [];

  function getGroups() {
    return AwaEnvStore.groupsOf(environments, groupOrder);
  }

  let groups = getGroups();
  let activeTabId = 'tab-DEV';

  const urlParams = new URLSearchParams(window.location.search);
  if (
    window.location.hash === '#speed' ||
    window.location.hash === '#tab-global' ||
    urlParams.get('tab') === 'speed' ||
    urlParams.get('tab') === 'global'
  ) {
    activeTabId = 'tab-global';
  } else if (
    window.location.hash === '#ai' ||
    window.location.hash === '#tab-ai' ||
    urlParams.get('tab') === 'ai'
  ) {
    activeTabId = 'tab-ai';
  }

  // Selected server per group
  const selectedServerInGroup = {};
  groups.forEach((grp) => {
    const inGrp = Object.entries(environments).filter(([_, s]) => s.group === grp);
    selectedServerInGroup[grp] = inGrp[0]?.[0] || '';
  });

  // A tab for a group this build has no servers in leaves the page with no panel
  // showing at all, which is what a build that ships none would open on.
  if (inServersSection(activeTabId)) {
    const group = activeTabId.slice(4);
    if (!groups.includes(group)) activeTabId = groups.length ? `tab-${groups[0]}` : 'tab-servers';
  }

  // A server-row settings button opens this server's group and form directly.
  const requestedServerKey = urlParams.get('server');
  if (requestedServerKey && Object.prototype.hasOwnProperty.call(environments, requestedServerKey)) {
    const group = environments[requestedServerKey].group;
    selectedServerInGroup[group] = requestedServerKey;
    activeTabId = `tab-${group}`;
  }

  function getServerIcon(server) {
    return AwaServerTypes.icon(server);
  }

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

  // Structural edits reach storage immediately: the popup reads storage when it
  // opens, so waiting for 저장 is what made a renamed tab look unsynced. Form fields
  // ride along, so typing a host and then renaming a tab keeps both.
  function saveEnvironments() {
    return chrome.storage.local.set({ environments: AwaEnvStore.toStorage(environments, DEFAULT_SERVERS) });
  }

  function persistEnvironments() {
    readCurrentFormIntoEnvironments();
    return saveEnvironments();
  }

  // A tab is just the group label its servers carry, so renaming relabels them.
  function renameGroup(grp) {
    const input = prompt(`'${grp}' 탭의 새 이름을 입력하세요:`, grp);
    if (input === null) return;
    const next = input.trim().toUpperCase();
    if (!next || next === grp) return;
    if (groups.includes(next)) {
      alert(`'${next}' 탭이 이미 있습니다. 다른 이름을 입력해주세요.`);
      return;
    }
    readCurrentFormIntoEnvironments();
    Object.values(environments).forEach((s) => {
      if (s.group === grp) s.group = next;
    });
    selectedServerInGroup[next] = selectedServerInGroup[grp];
    delete selectedServerInGroup[grp];
    if (activeTabId === `tab-${grp}`) activeTabId = `tab-${next}`;
    saveEnvironments();
    renderAllTabs();
  }

  // A custom group exists only through the servers that carry it, so removing the
  // tab removes those servers. Takes effect in storage on 저장, like 서버 삭제.
  function deleteGroup(grp) {
    const keys = Object.keys(environments).filter((k) => environments[k].group === grp);
    if (!confirm(`'${grp}' 탭과 포함된 서버 ${keys.length}개를 삭제하시겠습니까?\n(하단 저장 버튼을 눌러야 최종 반영됩니다.)`)) return;
    readCurrentFormIntoEnvironments();
    keys.forEach((k) => delete environments[k]);
    delete selectedServerInGroup[grp];
    saveEnvironments();
    const remaining = getGroups().filter((g) => g !== grp);
    activeTabId = remaining.length ? `tab-${remaining[0]}` : 'tab-servers';
    renderAllTabs();
    switchTab(activeTabId);
  }

  // A renamed tab shows exactly the name that was typed, as the popup does.
  function tabLabel(grp) {
    if (grp === 'DEV') return '🛠️ DEV (개발 서버)';
    if (grp === 'STG') return '🚀 STG (스테이징 서버)';
    if (grp === 'LOCAL') return '💻 LOCAL (로컬 개발)';
    return `📁 ${grp}`;
  }

  // Adding and removing a server both move the selection, and the open form still
  // belongs to the server being left — so it is captured before anything moves.
  // Writing it afterwards would file the old panel's values under the new server.
  function addServer(grp, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    readCurrentFormIntoEnvironments();

    const newKey = `${grp.toLowerCase()}_${Date.now()}`;
    environments[newKey] = {
      id: newKey,
      group: grp,
      name: cleanName,
      protocol: 'https://',
      // No address: seeding one would hand the new server an address another
      // server already holds and raise a duplicate warning you never asked for.
      host: '',
      ...(() => {
        // The starting account is shipped config, so this file carries none.
        const { mobilePassword, ...base } = AwaDefaultServers.NEW_SERVER;
        return AwaServerTypes.infer({ name: cleanName }) === 'ewa' && mobilePassword
          ? { ...base, password: mobilePassword }
          : base;
      })()
    };

    selectedServerInGroup[grp] = newKey;
    saveEnvironments();
    return newKey;
  }

  function deleteServer(grp) {
    const key = selectedServerInGroup[grp];
    const server = environments[key];
    if (!server) return false;
    if (!confirm(`'${server.name || key}' 서버 설정을 삭제하시겠습니까?`)) return false;

    readCurrentFormIntoEnvironments();
    delete environments[key];
    const remaining = Object.entries(environments).filter(([, s]) => s.group === grp);
    selectedServerInGroup[grp] = remaining[0]?.[0] || '';
    saveEnvironments();
    return true;
  }

  // Render All Tabs
  function renderAllTabs() {
    tabsNav.innerHTML = '';
    envTabsContentContainer.innerHTML = '';
    groups = getGroups();

    // 1. Group Navigation Buttons
    groups.forEach((grp) => {
      const tabId = `tab-${grp}`;
      const btn = document.createElement('div');
      btn.className = `tab-btn ${activeTabId === tabId ? 'active' : ''}`;
      btn.dataset.tab = tabId;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(activeTabId === tabId));
      btn.tabIndex = 0;

      // Dragged to rearrange. The order is the user's, so it is saved as its own
      // thing rather than inferred from whatever order the servers were written in.
      btn.draggable = true;
      btn.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', grp);
        event.dataTransfer.effectAllowed = 'move';
        btn.classList.add('dragging');
      });
      btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        tabsNav.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
      });
      btn.addEventListener('dragover', (event) => {
        if (!tabsNav.querySelector('.dragging')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drop-target'));
      btn.addEventListener('drop', (event) => {
        event.preventDefault();
        btn.classList.remove('drop-target');
        const moved = event.dataTransfer.getData('text/plain');
        if (!moved || moved === grp) return;
        const order = getGroups().filter((name) => name !== moved);
        order.splice(order.indexOf(grp), 0, moved);
        groupOrder = order;
        chrome.storage.local.set({ groupOrder });
        renderAllTabs();
      });

      const label = document.createElement('span');
      label.textContent = tabLabel(grp);
      btn.appendChild(label);
      btn.addEventListener('click', () => switchTab(tabId));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchTab(tabId);
        }
      });
      {
        const btnRename = document.createElement('button');
        btnRename.type = 'button';
        btnRename.className = 'btn-tab-rename';
        btnRename.textContent = '✎';
        btnRename.title = `'${grp}' 그룹 이름 변경`;
        btnRename.setAttribute('aria-label', btnRename.title);
        btnRename.addEventListener('click', (e) => {
          e.stopPropagation();
          renameGroup(grp);
        });
        btn.appendChild(btnRename);

        const btnClose = document.createElement('button');
        btnClose.type = 'button';
        btnClose.className = 'btn-tab-close';
        btnClose.textContent = '✕';
        btnClose.title = `'${grp}' 그룹 삭제`;
        btnClose.setAttribute('aria-label', btnClose.title);
        btnClose.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteGroup(grp);
        });
        btn.appendChild(btnClose);
      }
      tabsNav.appendChild(btn);

      // Tab Content Panel
      const panel = document.createElement('div');
      panel.className = `tab-content ${activeTabId === tabId ? 'active' : ''}`;
      panel.id = tabId;

      // Ensure active server for group
      const inGrp = Object.entries(environments).filter(([_, s]) => s.group === grp);
      if (!selectedServerInGroup[grp] || !environments[selectedServerInGroup[grp]]) {
        selectedServerInGroup[grp] = inGrp[0]?.[0] || '';
      }
      const activeKey = selectedServerInGroup[grp];
      const curServer = environments[activeKey] || inGrp[0]?.[1] || {};

      panel.innerHTML = `
        <div class="card">
          <section class="panel-section">
            <h4 class="panel-section-title">🖥️ 서버 <span>어느 주소를, 어느 그룹에서</span></h4>
          <div class="form-row">
            <label for="${grp}-serverTab">그룹 이동 <span class="label-hint">이 서버를 다른 그룹 탭으로 옮깁니다</span></label>
            <div class="tab-move-row">
              <select id="${grp}-serverTab">
                ${groups.map((g) => `<option value="${escapeHtml(g)}" ${g === grp ? 'selected' : ''}>${escapeHtml(tabLabel(g))}</option>`).join('')}
              </select>
              <button type="button" class="btn secondary btn-move-tab" data-group="${grp}">옮기기</button>
            </div>
          </div>

          <!-- Server Picker Header -->
          <div class="server-picker-row">
            <span class="server-picker-label">🌐 대상 서버:</span>
            <select class="options-server-select" id="${grp}-serverSelect">
              ${inGrp
                .map(([k, s]) => `<option value="${k}" ${k === activeKey ? 'selected' : ''}>${getServerIcon(s)} ${escapeHtml(AwaServerTypes.label(s, k))} (${escapeHtml(s.host || '')})</option>`)
                .join('')}
            </select>
            <button type="button" class="btn secondary btn-add-server" data-group="${grp}" style="padding: 7px 12px; font-size: 12px;">+ 새 서버 추가</button>
            ${inGrp.length > 1 ? `<button type="button" class="btn-icon-del btn-del-server" data-group="${grp}" data-key="${activeKey}" title="선택된 서버 삭제">✕</button>` : ''}
          </div>

          <!-- Server Details Form -->
          <div class="card-header">
            <div class="card-header-left">
              <label for="${grp}-name" style="font-size:12px; font-weight:700; color:#64748b; white-space:nowrap;">서버 이름</label>
              <input type="text" class="card-name-input" id="${grp}-name" value="${escapeHtml(curServer.name || '')}" placeholder="예: 운영 서버" spellcheck="false">
              <a href="${escapeHtml(AwaServerUrl.url(curServer) || '#')}" target="_blank" class="card-link" id="${grp}-link" title="새 탭으로 열기" style="white-space:nowrap;">↗ 열기</a>
            </div>
            <div class="card-header-right">
              <label class="switch-inline">
                <input type="checkbox" id="${grp}-enabled" ${curServer.enabled !== false ? 'checked' : ''}>
                <span>자동 로그인 활성화</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <label for="${grp}-host">접속 주소 (한 줄에 하나 · 첫 줄이 기본 주소, 경로·쿼리까지 저장됩니다)</label>
            <div class="host-row">
              <textarea id="${grp}-host" rows="${Math.max(1, AwaServerUrl.addressText(curServer).split('\n').length)}" placeholder="https://example.internal&#10;로그인이 여러 주소에 걸쳐 있으면 줄을 추가하세요" spellcheck="false">${escapeHtml(AwaServerUrl.addressText(curServer))}</textarea>
              ${AwaDefaultServers.SUPERAPP_LIST_PATH ? `<button type="button" class="btn secondary btn-detect-server" data-group="${grp}" title="이 주소가 어느 서버인지 API 응답으로 확인합니다">🔍 자동 감지</button>` : ''}
            </div>
          </div>

          ${(() => {
            // Every address more than one server holds, not just this server's —
            // conflicts are resolved in one place instead of by hopping between forms.
            const groupsByUrl = new Map();
            for (const [key, server] of Object.entries(environments)) {
              const url = AwaServerUrl.origin(server);
              if (!url) continue;
              if (!groupsByUrl.has(url)) groupsByUrl.set(url, []);
              groupsByUrl.get(url).push(key);
            }
            // Only this server's address: the other conflicts belong to the forms
            // they are on, and are shown there.
            const duplicates = [...groupsByUrl]
              .filter(([, keys]) => keys.length > 1 && keys.includes(activeKey));
            if (!duplicates.length) return '';

            const blocks = duplicates.map(([url, keys], index) => {
              const winner = AwaServerUrl.matchHost(environments, url);
              const rows = keys.map((k) => {
                const server = environments[k];
                const here = k === activeKey ? ' <strong>(현재)</strong>' : '';
                return `<li><label class="duplicate-host-pick">
                  <input type="radio" name="${grp}-primary-${index}" value="${escapeHtml(k)}" ${k === winner ? 'checked' : ''}>
                  <span>${escapeHtml(server.group || '')} / ${escapeHtml(server.name || k)}${here}</span>
                </label></li>`;
              }).join('');
              return `<p class="duplicate-host-url">${escapeHtml(url)}</p><ul class="duplicate-host-list">${rows}</ul>`;
            }).join('');

            return `
          <div class="form-row duplicate-host-row" data-duplicate-root="${grp}">
            <p class="duplicate-host-title">⚠️ 이 주소를 함께 쓰는 서버가 있습니다 — 우선 적용할 서버를 선택하세요</p>
            ${blocks}
            <p class="duplicate-host-note">이 주소를 열면 선택된 서버의 설정으로 로그인합니다.</p>
          </div>`;
          })()}

          ${AwaServerTypes.inDeployment(curServer) ? `
          <div class="form-row">
            <label for="${grp}-serverEnv">서버 환경 (실제 배포 환경)</label>
            <select id="${grp}-serverEnv">
              ${AwaEnvStore.ENVIRONMENTS.map((e) => `<option value="${e}" ${AwaEnvStore.envOf(curServer, activeKey) === e ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
          </div>

          <div class="form-row">
            <label for="${grp}-bank">은행 (참가기관)</label>
            <select id="${grp}-bank">
              <option value="" ${AwaServerTypes.bankOf(curServer) ? '' : 'selected'}>(지정 안 함)</option>
              ${AwaServerTypes.BANKS.map((bank) => `<option value="${bank}" ${AwaServerTypes.bankOf(curServer) === bank ? 'selected' : ''}>${bank}</option>`).join('')}
            </select>
          </div>` : ''}

          <div class="form-row">
            <label for="${grp}-serverType">서버 유형</label>
            <select id="${grp}-serverType">
              ${AwaServerTypes.TYPES.map((t) => `<option value="${t.id}" ${AwaServerTypes.of(curServer) === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
            </select>
          </div>

          </section>

          <section class="panel-section">
            <h4 class="panel-section-title">👤 계정 <span>무엇으로 로그인하는지</span></h4>
          <!-- A mobile server logs in as a super app customer, not an account ID -->
          ${AwaAccounts.isMobile(curServer) ? `
          <div class="form-row">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label for="${grp}-superappSelect" style="margin-bottom: 0;">로그인 슈퍼앱 사용자 (서버에서 조회)</label>
              <button type="button" class="btn-text-action btn-refresh-superapp" data-group="${grp}">↻ 목록 새로고침</button>
            </div>
            <input type="text" id="${grp}-superappUrl" class="superapp-url-input" value="${escapeHtml(AwaSuperAppUsers.listUrl(curServer))}" placeholder="${escapeHtml(AwaSuperAppUsers.LIST_PATH)}" spellcheck="false" autocomplete="off" title="사용자 목록을 조회하는 주소 — 경로만 입력하면 접속 주소에 붙습니다">
            <input type="text" id="${grp}-superappSearch" placeholder="이름 / 고객번호 / 계좌번호로 검색" spellcheck="false" autocomplete="off" style="margin-bottom: 6px;">
            <select id="${grp}-superappSelect" class="options-user-select" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 600; outline: none; background: #ffffff;">
              <option value="">(목록을 불러오는 중...)</option>
            </select>
          </div>
          ` : `
          <div class="form-row">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label for="${grp}-userSelect" style="margin-bottom: 0;">로그인 사용자 계정 ID (드롭다운 / 스왑)</label>
              <button type="button" class="btn-text-action btn-add-user-toggle" data-group="${grp}">+ 새 ID 추가</button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <select id="${grp}-userSelect" class="options-user-select" style="flex: 1; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 600; outline: none; background: #ffffff;">
                ${renderAccountOptions(curServer.accounts, curServer.username)}
              </select>
              <button type="button" class="btn-icon-del btn-delete-user" id="${grp}-btn-del-user" data-group="${grp}" title="선택된 ID 삭제" style="display: ${curServer.accounts && curServer.accounts.length > 1 ? 'flex' : 'none'};">✕</button>
            </div>

            <!-- Inline Add ID box -->
            <div id="${grp}-add-user-box" class="account-add-inline" style="display: none;">
              <input type="text" id="${grp}-new-username" placeholder="새 계정 ID 입력" style="flex: 1; padding: 7px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none;" spellcheck="false" autocomplete="off">
              <button type="button" class="btn primary btn-confirm-add-user" data-group="${grp}" style="padding: 6px 14px; font-size: 12px;">추가</button>
              <button type="button" class="btn secondary btn-cancel-add-user" data-group="${grp}" style="padding: 6px 12px; font-size: 12px;">취소</button>
            </div>
          </div>

          `}

          <div class="form-row">
            <label for="${grp}-password">${AwaAccounts.isMobile(curServer) ? '모바일 PIN 번호' : '선택 ID 비밀번호'}</label>
            <input type="password" id="${grp}-password" value="${escapeHtml(AwaAccounts.getPassword(curServer))}" placeholder="비밀번호 또는 PIN" required>
          </div>



          </section>

          <section class="panel-section">
            <h4 class="panel-section-title">🔑 로그인 방식 <span>어떻게 입력하고 인증하는지</span></h4>
          <div class="form-row">
            <label for="${grp}-keypadMode">비밀번호 입력 방식 (가상 키보드 선택)</label>
            <select id="${grp}-keypadMode">
              <option value="virtual" ${curServer.keypadMode !== 'direct' ? 'selected' : ''}>⌨️ 가상 키패드 마우스 클릭 (기본 - 화면 보안키보드 클릭 / 모바일 PIN)</option>
              <option value="direct" ${curServer.keypadMode === 'direct' ? 'selected' : ''}>✍️ 직접 텍스트 입력 (Input 필드 직접 주입)</option>
            </select>
          </div>

          <div class="form-row">
            <label for="${grp}-otpSecret">2차 인증 OTP Secret Key (Base32)</label>
            <input type="text" id="${grp}-otpSecret" value="${escapeHtml(curServer.otpSecret || '')}" placeholder="Base32 Secret (예: JBSWY3DPEHPK3PXP)" spellcheck="false">
            <div class="otp-test-box">
              <div class="otp-test-info">
                <span>현재 실시간 테스트 OTP:</span>
                <strong id="${grp}-otp-display">------</strong>
                <span class="badge" id="${grp}-otp-timer">30s</span>
              </div>
            </div>
          </div>
          </section>
        </div>
      `;

      envTabsContentContainer.appendChild(panel);
    });

    const tabsSections = document.getElementById('tabs-sections');
    tabsSections.replaceChildren();

    // 1. The servers section. Which group is open inside it is the group tab strip's
    // business, so this button just returns to whichever one was last open.
    const serversBtn = document.createElement('button');
    serversBtn.type = 'button';
    serversBtn.className = `tab-btn section ${inServersSection(activeTabId) ? 'active' : ''}`;
    serversBtn.dataset.tab = 'tab-servers';
    serversBtn.textContent = '🖥️ 서버 설정';
    serversBtn.addEventListener('click', () => {
      const group = activeTabId.startsWith('tab-') ? activeTabId.slice(4) : '';
      switchTab(groups.includes(group) ? activeTabId : (groups.length ? `tab-${groups[0]}` : 'tab-servers'));
    });
    tabsSections.appendChild(serversBtn);

    // 2. Global Speed Tab Nav Button
    const globalBtn = document.createElement('button');
    globalBtn.type = 'button';
    globalBtn.className = `tab-btn section ${activeTabId === 'tab-global' ? 'active' : ''}`;
    globalBtn.dataset.tab = 'tab-global';
    globalBtn.textContent = '⚡ 동작 및 속도 설정';
    globalBtn.addEventListener('click', () => switchTab('tab-global'));
    tabsSections.appendChild(globalBtn);

    // 3. E2E Scenario Management Tab Nav Button
    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = `tab-btn section ${activeTabId === 'tab-ai' ? 'active' : ''}`;
    aiBtn.dataset.tab = 'tab-ai';
    aiBtn.textContent = '🎬 E2E 시나리오 관리';
    aiBtn.addEventListener('click', () => switchTab('tab-ai'));
    tabsSections.appendChild(aiBtn);

    // Attach Event Listeners for Dynamic Elements
    attachTabEventListeners();
    renderResetButton();
  }

  // Fetched super app customer lists, per tab, so a redraw does not refetch.
  const superappCustomers = {};

  function attachTabEventListeners() {
    groups.forEach((grp) => {
      const serverSelect = document.getElementById(`${grp}-serverSelect`);
      if (serverSelect) {
        serverSelect.addEventListener('change', (e) => {
          // Re-rendering rebuilds every panel from `environments`, so whatever is
          // typed into the server we are leaving has to be captured first — the
          // dropdown is the only way to reach the mobile server's form.
          persistEnvironments();
          selectedServerInGroup[grp] = e.target.value;
          renderAllTabs();
        });
      }

      // Add server button
      const btnAddServer = document.querySelector(`.btn-add-server[data-group="${grp}"]`);
      if (btnAddServer) {
        btnAddServer.addEventListener('click', () => {
          const sName = prompt(`'${grp}' 그룹에 추가할 서버 이름을 입력하세요 (예: AWA-D, 모바일-B, PDV-D):`);
          if (sName && addServer(grp, sName)) renderAllTabs();
        });
      }

      // This page can call any address it has permission for — no tab on the server
      // and no content script needed — so a server can be classified the moment its
      // address is typed, which is the one thing the popup cannot do for you.
      const btnDetect = document.querySelector(`.btn-detect-server[data-group="${grp}"]`);
      if (btnDetect) {
        btnDetect.addEventListener('click', async () => {
          readCurrentFormIntoEnvironments();
          const key = selectedServerInGroup[grp];
          const server = environments[key];
          if (!server?.host) {
            reportSaveProblem('접속 주소를 먼저 입력해주세요.');
            return;
          }

          btnDetect.disabled = true;
          btnDetect.textContent = '감지 중...';
          try {
            const candidates = Object.entries(environments)
              .filter(([k, s]) => k !== key && s.host && AwaAccounts.isMobile(s))
              .map(([k, s]) => ({ server: s, env: AwaEnvStore.envOf(s, k), bank: AwaServerTypes.bankOf(s), name: s.name }));
            const result = await AwaServerProbe.identify(server, candidates);

            if (result.status !== 'identified') {
              reportSaveProblem(`응답이 없습니다 (${result.detail || '연결 실패'}). 주소를 확인해주세요.`);
              return;
            }

            const resolved = AwaServerProbe.resolveShared(environments, server, result, key);
            // Recorded the way the popup records it, so the ✅ someone set by hand
            // stays put and the 📍 off-switch governs both pages alike.
            if (resolved.key) {
              const { detectedOwners = {} } = await chrome.storage.local.get(['detectedOwners']);
              detectedOwners[AwaServerUrl.normalizeHost(server)] = resolved.key;
              await chrome.storage.local.set({ detectedOwners });
            }

            const isThisServer = !resolved.key || resolved.key === key;
            if (isThisServer) {
              server.type = result.type;
              if (result.env) server.env = result.env;
              if (result.bank) server.bank = result.bank;
            }
            saveEnvironments();
            renderAllTabs();

            saveStatus.style.opacity = '1';
            const chosen = resolved.key ? environments[resolved.key] : null;
            if (chosen && !isThisServer) {
              saveStatus.textContent = `✓ 이 주소는 '${AwaServerTypes.label(chosen, resolved.key)}'로 확인되었습니다. 현재 서버는 해당하지 않습니다.`;
            } else if (result.by === 'address') {
              saveStatus.textContent = `✓ ${result.name} (${result.env}) 서버로 확인되었습니다.`;
            } else if (result.matched) {
              saveStatus.textContent = `✓ ${result.matched}와 같은 백엔드입니다 (환경 ${result.env}${result.bank ? `, 은행 ${result.bank}` : ''}).`;
            } else if (result.type === 'ewa') {
              saveStatus.textContent = '✓ EWA(모바일) 서버입니다. 알려진 백엔드와 달라 환경·은행은 직접 선택해주세요.';
            } else {
              saveStatus.textContent = '✓ 관리자 계열(AWA/PDM/PDV) 서버입니다. 로그인 전에는 A/B/C 구분이 불가능해 직접 선택해주세요.';
            }
            setTimeout(() => { saveStatus.style.opacity = '0'; }, 5000);
          } finally {
            btnDetect.disabled = false;
            btnDetect.textContent = '🔍 자동 감지';
          }
        });
      }

      // Super app user picker — a mobile server's real "login ID".
      const superappSelect = document.getElementById(`${grp}-superappSelect`);
      if (superappSelect) {
        const search = document.getElementById(`${grp}-superappSearch`);
        const refresh = document.querySelector(`.btn-refresh-superapp[data-group="${grp}"]`);
        const server = environments[selectedServerInGroup[grp]];

        const draw = (customers, selected) => {
          const matching = AwaSuperAppUsers.filter(customers, search?.value);
          superappSelect.replaceChildren();
          if (!matching.length) {
            superappSelect.append(new Option('(일치하는 사용자가 없습니다)', ''));
            return;
          }
          for (const customer of matching) {
            const value = AwaSuperAppUsers.valueOf(customer);
            superappSelect.append(new Option(AwaSuperAppUsers.labelOf(customer), value, false, value === selected));
          }
          if (!superappSelect.value) superappSelect.value = AwaSuperAppUsers.valueOf(matching[0]);
        };

        const load = async () => {
          superappSelect.replaceChildren(new Option('(목록을 불러오는 중...)', ''));
          try {
            superappCustomers[grp] = await AwaSuperAppUsers.fetchAll(server);
          } catch (error) {
            superappSelect.replaceChildren(new Option(`❌ 목록을 불러오지 못했습니다 (${error.message})`, ''));
            return;
          }
          draw(superappCustomers[grp], server.superAppUser);
        };

        search?.addEventListener('input', () => draw(superappCustomers[grp] || [], superappSelect.value));

        // Editing where the list comes from re-reads it from there.
        const urlInput = document.getElementById(`${grp}-superappUrl`);
        urlInput?.addEventListener('change', () => {
          const typed = urlInput.value.trim();
          const origin = AwaServerUrl.origin(server);
          // Keep it as a path while it points at this server, so changing the
          // 접속 주소 later carries the endpoint with it.
          server.superAppListUrl = typed.startsWith(origin) ? typed.slice(origin.length) : typed;
          persistEnvironments();
          load();
        });
        refresh?.addEventListener('click', load);
        // Stored on the server itself, so each environment keeps its own user.
        superappSelect.addEventListener('change', () => {
          server.superAppUser = superappSelect.value;
          server.superAppCustomerData = AwaSuperAppUsers.find(superappCustomers[grp], superappSelect.value);
          persistEnvironments();
        });
        load();
      }

      // Exactly one server may be primary for an address, so picking one clears
      // the rest that share it.
      const duplicateRoot = document.querySelector(`[data-duplicate-root="${grp}"]`);
      if (duplicateRoot) {
        duplicateRoot.addEventListener('change', (e) => {
          const chosen = e.target.value;
          if (!e.target.checked || !environments[chosen]) return;
          readCurrentFormIntoEnvironments();
          for (const other of AwaServerUrl.matchingKeys(environments, environments[chosen])) {
            environments[other].primary = false;
          }
          environments[chosen].primary = true;
          saveEnvironments();
          renderAllTabs();
        });
      }

      // The tab is only a label, so moving a server between tabs leaves its env alone.
      const tabSelect = document.getElementById(`${grp}-serverTab`);
      const btnMoveTab = document.querySelector(`.btn-move-tab[data-group="${grp}"]`);
      if (tabSelect && btnMoveTab) {
        btnMoveTab.addEventListener('click', () => {
          const key = selectedServerInGroup[grp];
          const target = tabSelect.value;
          if (!environments[key] || !groups.includes(target)) return;
          if (target === grp) {
            reportSaveProblem('이미 이 그룹에 있는 서버입니다.');
            return;
          }

          readCurrentFormIntoEnvironments();
          environments[key].group = target;
          const remaining = Object.entries(environments).filter(([_, s]) => s.group === grp);
          selectedServerInGroup[grp] = remaining[0]?.[0] || '';
          selectedServerInGroup[target] = key;
          activeTabId = `tab-${target}`;
          saveEnvironments();
          renderAllTabs();
        });
      }

      // Switching type changes the PIN/password wording and what the popup shows,
      // so redraw once it is picked instead of waiting for 저장.
      const typeSelect = document.getElementById(`${grp}-serverType`);
      if (typeSelect) {
        typeSelect.addEventListener('change', () => {
          persistEnvironments();
          renderAllTabs();
        });
      }

      // Delete server button
      const btnDelServer = document.querySelector(`.btn-del-server[data-group="${grp}"]`);
      if (btnDelServer) {
        btnDelServer.addEventListener('click', () => {
          if (deleteServer(grp)) renderAllTabs();
        });
      }

      // Live update host link
      const hostInput = document.getElementById(`${grp}-host`);
      const linkEl = document.getElementById(`${grp}-link`);
      if (hostInput && linkEl) {
        hostInput.addEventListener('input', (e) => {
          // The link opens the server's own address: the first line.
          linkEl.href = AwaServerUrl.url(AwaServerUrl.parseAddresses(e.target.value)) || '#';
        });
      }

      // Account Selection change
      const userSelect = document.getElementById(`${grp}-userSelect`);
      const btnDelUser = document.getElementById(`${grp}-btn-del-user`);
      if (userSelect) {
        userSelect.addEventListener('change', (e) => {
          const activeKey = selectedServerInGroup[grp];
          if (environments[activeKey]) {
            const server = environments[activeKey];
            const passEl = document.getElementById(`${grp}-password`);
            if (passEl) AwaAccounts.setPassword(server, server.username, passEl.value);
            server.username = e.target.value;
            if (passEl) passEl.value = AwaAccounts.getPassword(server);
          }
        });
      }

      // Inline Add User Toggle
      const btnAddUserToggle = document.querySelector(`.btn-add-user-toggle[data-group="${grp}"]`);
      const addUserBox = document.getElementById(`${grp}-add-user-box`);
      const newUsernameInput = document.getElementById(`${grp}-new-username`);
      const btnConfirmAddUser = document.querySelector(`.btn-confirm-add-user[data-group="${grp}"]`);
      const btnCancelAddUser = document.querySelector(`.btn-cancel-add-user[data-group="${grp}"]`);

      if (btnAddUserToggle && addUserBox) {
        btnAddUserToggle.addEventListener('click', () => {
          const isHidden = addUserBox.style.display === 'none';
          addUserBox.style.display = isHidden ? 'flex' : 'none';
          if (isHidden && newUsernameInput) {
            newUsernameInput.value = '';
            newUsernameInput.focus();
          }
        });
      }

      if (btnCancelAddUser && addUserBox) {
        btnCancelAddUser.addEventListener('click', () => {
          addUserBox.style.display = 'none';
          if (newUsernameInput) newUsernameInput.value = '';
        });
      }

      if (btnConfirmAddUser && newUsernameInput) {
        const handleAdd = () => {
          const val = newUsernameInput.value.trim();
          if (!val) return;
          const activeKey = selectedServerInGroup[grp];
          const curServer = environments[activeKey];
          if (!curServer) return;

          if (!Array.isArray(curServer.accounts)) curServer.accounts = curServer.username ? [curServer.username] : [];
          if (!curServer.accounts.includes(val)) curServer.accounts.push(val);
          const passEl = document.getElementById(`${grp}-password`);
          if (passEl) AwaAccounts.setPassword(curServer, curServer.username, passEl.value);
          curServer.username = val;
          if (passEl) passEl.value = AwaAccounts.getPassword(curServer);

          userSelect.innerHTML = renderAccountOptions(curServer.accounts, curServer.username);
          if (btnDelUser) btnDelUser.style.display = curServer.accounts.length > 1 ? 'flex' : 'none';
          addUserBox.style.display = 'none';
          newUsernameInput.value = '';
        };

        btnConfirmAddUser.addEventListener('click', handleAdd);
        newUsernameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
          if (e.key === 'Escape') {
            addUserBox.style.display = 'none';
          }
        });
      }

      // Delete User Button
      if (btnDelUser) {
        btnDelUser.addEventListener('click', () => {
          const activeKey = selectedServerInGroup[grp];
          const curServer = environments[activeKey];
          if (!curServer || !curServer.accounts || curServer.accounts.length <= 1) return;
          const toDelete = userSelect.value;
          if (confirm(`'${toDelete}' 계정을 삭제하시겠습니까?`)) {
            curServer.accounts = curServer.accounts.filter((a) => a !== toDelete);
            AwaAccounts.removePassword(curServer, toDelete);
            curServer.username = curServer.accounts[0];
            const passEl = document.getElementById(`${grp}-password`);
            if (passEl) passEl.value = AwaAccounts.getPassword(curServer);
            userSelect.innerHTML = renderAccountOptions(curServer.accounts, curServer.username);
            btnDelUser.style.display = curServer.accounts.length > 1 ? 'flex' : 'none';
          }
        });
      }
    });

    updateOtpPreviews();
  }

  // Every tab that is not one of the program's other sections is inside 서버 설정 —
  // a group's tab, or the section itself when there are no groups yet.
  function inServersSection(tabId) {
    return !['tab-global', 'tab-ai'].includes(tabId);
  }

  // Restoring a server to its shipped settings only means anything for a server that
  // was shipped. A build that ships none — or a server someone added here — has
  // nothing to restore, so the button is not offered.
  function renderResetButton() {
    if (!btnReset) return;
    const group = inServersSection(activeTabId) ? activeTabId.slice(4) : '';
    const key = selectedServerInGroup[group];
    const original = key && DEFAULT_SERVERS[key];
    btnReset.style.display = original ? '' : 'none';
    if (original) btnReset.textContent = `'${environments[key]?.name || key}' 서버를 배포 기본값으로 복원`;
  }

  function switchTab(tabId) {
    activeTabId = tabId;
    const box = document.getElementById('servers-box');
    if (box) box.style.display = inServersSection(tabId) ? '' : 'none';
    const empty = document.getElementById('servers-empty');
    if (empty) empty.style.display = inServersSection(tabId) && !groups.length ? 'block' : 'none';
    refreshOtpTimer();
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const isServersButton = b.dataset.tab === 'tab-servers';
      b.classList.toggle('active', isServersButton ? inServersSection(tabId) : b.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach((p) => {
      p.classList.toggle('active', p.id === tabId);
    });
    if (tabId === 'tab-ai') {
      renderSavedTestsList();
    }
    renderResetButton();
  }

  // Add new tab/group button
  btnAddEnvTab.addEventListener('click', () => {
    const groupName = prompt('새 환경 그룹명을 입력하세요 (예: QA, PROD, TEST):');
    if (!groupName) return;
    const cleanGroup = groupName.trim().toUpperCase();
    const newKey = `${cleanGroup.toLowerCase()}_default`;

    environments[newKey] = {
      id: newKey,
      group: cleanGroup,
      name: `${cleanGroup}-서버1`,
      protocol: 'https://',
      // No address: one is typed in below, and seeding another server's would raise
      // a duplicate warning nobody asked for.
      host: '',
      ...AwaDefaultServers.NEW_SERVER
    };

    activeTabId = `tab-${cleanGroup}`;
    persistEnvironments();
    renderAllTabs();
  });

  // Sync Form values back into active server objects
  function readCurrentFormIntoEnvironments() {
    groups.forEach((grp) => {
      const activeKey = selectedServerInGroup[grp];
      if (!activeKey || !environments[activeKey]) return;

      const nameEl = document.getElementById(`${grp}-name`);
      const hostEl = document.getElementById(`${grp}-host`);
      const userSelect = document.getElementById(`${grp}-userSelect`);
      const passEl = document.getElementById(`${grp}-password`);
      const bankEl = document.getElementById(`${grp}-bank`);
      const envEl = document.getElementById(`${grp}-serverEnv`);
      const typeEl = document.getElementById(`${grp}-serverType`);
      const modeEl = document.getElementById(`${grp}-keypadMode`);
      const otpEl = document.getElementById(`${grp}-otpSecret`);
      const enabledEl = document.getElementById(`${grp}-enabled`);

      if (nameEl) environments[activeKey].name = nameEl.value.trim() || environments[activeKey].name;
      if (hostEl) {
        const { protocol, host, path, hosts } = AwaServerUrl.parseAddresses(hostEl.value);
        environments[activeKey].host = host;
        environments[activeKey].protocol = protocol;
        environments[activeKey].path = path;
        environments[activeKey].hosts = hosts;
      }
      if (userSelect && userSelect.value) environments[activeKey].username = userSelect.value;
      if (passEl) AwaAccounts.setPassword(environments[activeKey], environments[activeKey].username, passEl.value);
      if (bankEl) environments[activeKey].bank = bankEl.value;
      if (envEl) environments[activeKey].env = envEl.value;
      if (typeEl) environments[activeKey].type = typeEl.value;
      if (modeEl) {
        environments[activeKey].keypadMode = modeEl.value;
        environments[activeKey].useVirtualKeypad = modeEl.value === 'virtual';
      }
      if (otpEl) environments[activeKey].otpSecret = otpEl.value.trim();
      if (enabledEl) environments[activeKey].enabled = enabledEl.checked;
    });
  }

  // Compute OTP only when its 30-second window or secret changes.
  const otpCache = new WeakMap();
  function updateOtpPreviews() {
    if (document.hidden || typeof window.generateTOTP !== 'function') return;

    const now = Math.floor(Date.now() / 1000);
    const timeLeft = 30 - (now % 30);

    groups.forEach((grp) => {
      if (activeTabId !== `tab-${grp}`) return;
      const activeKey = selectedServerInGroup[grp];
      const curServer = environments[activeKey];
      if (!curServer) return;

      const otpDisplay = document.getElementById(`${grp}-otp-display`);
      const otpTimer = document.getElementById(`${grp}-otp-timer`);

      if (otpDisplay && otpTimer) {
        const secret = (document.getElementById(`${grp}-otpSecret`)?.value || curServer.otpSecret || '').trim();
        if (secret) {
          try {
            const period = Math.floor(now / 30);
            let cached = otpCache.get(otpDisplay);
            if (!cached || cached.secret !== secret || cached.period !== period) {
              cached = { secret, period, code: window.generateTOTP(secret) };
              otpCache.set(otpDisplay, cached);
            }
            if (otpDisplay.textContent !== cached.code) otpDisplay.textContent = cached.code;
          } catch (e) {
            otpDisplay.textContent = 'ERROR';
          }
        } else {
          otpDisplay.textContent = '------';
        }
        otpTimer.textContent = `${timeLeft}s`;
      }
    });
  }

  // A one-second timer is needed only for the visible OTP countdown.
  let otpTimer = null;
  function refreshOtpTimer() {
    if (otpTimer !== null) clearTimeout(otpTimer);
    otpTimer = null;
    if (document.hidden || activeTabId === 'tab-global' || activeTabId === 'tab-ai') return;
    updateOtpPreviews();
    otpTimer = setTimeout(refreshOtpTimer, 1000);
  }
  document.addEventListener('visibilitychange', refreshOtpTimer);
  window.addEventListener('pagehide', () => {
    if (otpTimer !== null) clearTimeout(otpTimer);
    otpTimer = null;
  });
  window.addEventListener('pageshow', refreshOtpTimer);

  // Every group's panel exists at once and all but one are hidden, so a `required`
  // input left empty in a hidden tab made the browser refuse the whole submit with
  // nothing on screen ("not focusable"). Check it here and say which tab is wrong.
  function findServerMissingHost() {
    for (const grp of groups) {
      const key = selectedServerInGroup[grp];
      const server = environments[key];
      if (server && !String(server.host || '').trim()) return { grp, key, server };
    }
    return null;
  }

  function reportSaveProblem(message) {
    saveStatus.style.opacity = '1';
    saveStatus.style.color = '#b45309';
    saveStatus.textContent = message;
    setTimeout(() => {
      saveStatus.style.opacity = '0';
      saveStatus.style.color = '';
    }, 4000);
  }

  // Form Submit Save
  // Servers move between installs as one file. A build that ships no config has no
  // other way in, and a build that ships one still needs a way to hand over changes.
  const CONFIG_FILE_KIND = 'awa-autologin-config';

  document.getElementById('btn-export-config')?.addEventListener('click', () => {
    readCurrentFormIntoEnvironments();
    const payload = {
      kind: CONFIG_FILE_KIND,
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      environments: AwaEnvStore.toStorage(environments, DEFAULT_SERVERS),
      global: {
        autoSubmit: document.getElementById('autoSubmit').checked,
        keyDelay: parseInt(keyDelayInput.value, 10) || DEFAULT_GLOBAL.keyDelay,
        updateFeedUrl: document.getElementById('updateFeedUrl').value.trim(),
        updateDownloadUrl: document.getElementById('updateDownloadUrl').value.trim(),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${CONFIG_FILE_KIND}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    document.getElementById('config-io-result').textContent =
      `✓ 서버 ${Object.keys(environments).length}개를 내보냈습니다. 비밀번호와 OTP Secret이 포함되어 있습니다.`;
  });

  const inputImportConfig = document.getElementById('input-import-config');
  document.getElementById('btn-import-config')?.addEventListener('click', () => inputImportConfig?.click());
  inputImportConfig?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    const result = document.getElementById('config-io-result');
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      // Accept this extension's own export, or a bare map of servers.
      const incoming = parsed?.environments ?? (parsed?.kind ? null : parsed);
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        throw new Error('서버 설정이 들어 있지 않습니다.');
      }
      const count = Object.keys(incoming).length;
      if (!confirm(`서버 ${count}개를 가져옵니다. 같은 이름의 서버는 파일 내용으로 덮어씁니다. 계속할까요?`)) {
        inputImportConfig.value = '';
        return;
      }
      // Merged, not replaced: an import that only carries one server must not take
      // the others away.
      environments = AwaEnvStore.build({ ...AwaEnvStore.toStorage(environments, DEFAULT_SERVERS), ...incoming }, DEFAULT_SERVERS);
      const payload = { environments: AwaEnvStore.toStorage(environments, DEFAULT_SERVERS) };
      if (parsed?.global && typeof parsed.global === 'object') payload.global = parsed.global;
      await chrome.storage.local.set(payload);
      result.textContent = `✓ 서버 ${count}개를 가져왔습니다. 새 주소는 아래에서 접근을 허용해 주세요.`;
      location.reload();
    } catch (error) {
      result.textContent = `✕ 가져오기 실패: ${error.message}`;
    }
    inputImportConfig.value = '';
  });

  // The extension holds no site permission of its own: every address it touches is
  // one the user configured, so it is granted here, by name, after they add it.
  async function missingOrigins() {
    const origins = AwaServerUrl.originPatterns(environments);
    const held = await Promise.all(
      origins.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
    );
    return { origins, missing: origins.filter((_, index) => !held[index]) };
  }

  async function renderPermissionState() {
    const stateEl = document.getElementById('permission-state');
    const button = document.getElementById('btn-grant-permissions');
    if (!stateEl || !button) return;
    const { origins, missing } = await missingOrigins();
    if (!origins.length) {
      stateEl.textContent = '설정된 서버가 없습니다.';
      button.style.display = 'none';
      return;
    }
    if (!missing.length) {
      stateEl.textContent = `✓ 설정된 주소 ${origins.length}곳 모두 허용되어 있습니다.`;
      button.style.display = 'none';
      return;
    }
    stateEl.textContent = `허용이 필요한 주소 ${missing.length}곳: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' 외' : ''}`;
    button.style.display = '';
  }

  document.getElementById('btn-grant-permissions')?.addEventListener('click', async () => {
    const { missing } = await missingOrigins();
    if (!missing.length) return renderPermissionState();
    try {
      await chrome.permissions.request({ origins: missing });
    } catch (error) {
      reportSaveProblem(`사이트 접근 허용에 실패했습니다: ${error.message}`);
    }
    renderPermissionState();
  });

  // Check now, with whatever is typed in the two fields — saving first would make
  // "확인" mean "save everything on this page", which is a different button.
  document.getElementById('btn-check-update')?.addEventListener('click', async () => {
    const result = document.getElementById('update-check-result');
    const button = document.getElementById('btn-check-update');
    button.disabled = true;
    result.textContent = '확인 중...';
    const state = await AwaUpdates.check({
      feedUrl: document.getElementById('updateFeedUrl').value.trim(),
      downloadUrl: document.getElementById('updateDownloadUrl').value.trim(),
    });
    button.disabled = false;
    if (!state.reachable) result.textContent = `✕ 확인 실패: ${state.reason}`;
    else if (state.newer) result.textContent = `🆕 새 버전 v${state.version} (현재 v${state.current})${state.notes ? ` · ${state.notes}` : ''}`;
    else result.textContent = `✓ 최신입니다 (v${state.current}${state.version ? `, 서버 v${state.version}` : ''})`;
    await chrome.storage.local.set({ updateState: state });
    await AwaUpdates.showBadge(state);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readCurrentFormIntoEnvironments();


    const autoSubmitVal = document.getElementById('autoSubmit').checked;
    const speedVal = parseInt(keyDelayInput.value, 10) || DEFAULT_GLOBAL.keyDelay;

    await chrome.storage.local.set({
      environments: AwaEnvStore.toStorage(environments, DEFAULT_SERVERS),
      global: {
        autoSubmit: autoSubmitVal,
        keyDelay: speedVal,
        updateFeedUrl: document.getElementById('updateFeedUrl').value.trim(),
        updateDownloadUrl: document.getElementById('updateDownloadUrl').value.trim()
      },
      keyDelay: speedVal,
      autoSubmit: autoSubmitVal
    });

    renderAllTabs();
    renderPermissionState();

    // One half-configured server must not hold the other tabs' edits hostage, so
    // this is a warning after the save, not a gate in front of it.
    const missing = findServerMissingHost();
    if (missing) {
      reportSaveProblem(`저장했습니다. '${missing.server.name || missing.key}' 서버의 접속 주소는 아직 비어 있습니다.`);
      return;
    }
    saveStatus.style.opacity = '1';
    saveStatus.textContent = '✓ 설정이 성공적으로 저장되었습니다.';
    setTimeout(() => {
      saveStatus.style.opacity = '0';
    }, 2500);
  });

  // Reset to default
  // Deletes the server whose form is open — the same one 복원 restores.
  btnDeleteServer.addEventListener('click', () => {
    const grp = activeTabId.startsWith('tab-') ? activeTabId.slice(4) : '';
    if (!environments[selectedServerInGroup[grp]]) {
      reportSaveProblem('삭제할 서버 탭을 먼저 선택해주세요.');
      return;
    }
    if (deleteServer(grp)) renderAllTabs();
  });

  // Wipes everything back to the shipped servers, custom tabs included.
  // 전체 초기화 puts the settings back to what this build ships. Format is the other
  // thing people mean by reset: leave nothing behind at all — the saved passwords,
  // the recorded scenarios, the granted site access. What a build ships comes back
  // on the next load, because that is what a fresh install looks like.
  document.getElementById('btn-format')?.addEventListener('click', async () => {
    if (!confirm('저장된 모든 데이터를 지웁니다.\n\n· 서버 설정과 계정, 비밀번호, OTP Secret\n· 녹화한 E2E 시나리오\n· 허용한 사이트 접근 권한\n\n되돌릴 수 없습니다. 계속할까요?')) return;
    if (!confirm('마지막 확인입니다. 정말 전부 지울까요?\n필요한 설정이 있다면 먼저 📤 설정 내보내기로 저장하세요.')) return;

    // Taken before the configuration that names them is gone.
    const origins = AwaServerUrl.originPatterns(environments);
    await chrome.storage.local.clear();
    if (origins.length) await chrome.permissions.remove({ origins }).catch(() => {});
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (_) {}
    alert('전체 데이터를 삭제했습니다. 설정 화면을 다시 불러옵니다.');
    location.reload();
  });

  btnResetAll.addEventListener('click', async () => {
    if (!confirm('서버 목록과 전역 설정을 배포 기본값으로 되돌립니다.\n직접 추가한 서버와 그룹은 사라집니다.\n\n녹화한 E2E 시나리오와 허용한 사이트 권한은 그대로 둡니다 — 그것까지 지우려면 전체 데이터 삭제(Format)를 쓰세요.\n\n계속하시겠습니까?')) return;

    environments = AwaEnvStore.build({}, DEFAULT_SERVERS);
    groupOrder = [];
    const [firstKey, firstServer] = Object.entries(environments)[0] || [];
    setSpeedValue(DEFAULT_GLOBAL.keyDelay);
    document.getElementById('autoSubmit').checked = DEFAULT_GLOBAL.autoSubmit;
    await chrome.storage.local.set({
      environments,
      global: DEFAULT_GLOBAL,
      keyDelay: DEFAULT_GLOBAL.keyDelay,
      autoSubmit: DEFAULT_GLOBAL.autoSubmit,
      groupOrder: [],
      activeGroup: firstServer?.group || '',
      activeServerKey: firstKey || '',
    });

    activeTabId = firstServer?.group ? `tab-${firstServer.group}` : activeTabId;
    renderAllTabs();
    saveStatus.style.opacity = '1';
    saveStatus.textContent = '✓ 전체 설정을 기본값으로 초기화했습니다.';
    setTimeout(() => { saveStatus.style.opacity = '0'; }, 2500);
  });

  // Reset belongs to the server whose form is open: wiping every server and every
  // custom tab is not what a per-server settings page implies.
  btnReset.addEventListener('click', async () => {
    const grp = activeTabId.startsWith('tab-') ? activeTabId.slice(4) : '';
    const key = selectedServerInGroup[grp];
    const current = environments[key];
    if (!current) {
      reportSaveProblem('복원할 서버 탭을 먼저 선택해주세요.');
      return;
    }

    const original = DEFAULT_SERVERS[key];
    if (!original) return;
    if (!confirm(`'${current.name || key}' 서버의 설정을 배포 기본값으로 되돌립니다. 계속하시겠습니까?`)) return;

    environments[key] = JSON.parse(JSON.stringify(original));
    await saveEnvironments();
    renderAllTabs();
    saveStatus.style.opacity = '1';
    saveStatus.textContent = `✓ '${environments[key].name || key}' 서버를 기본값으로 복원했습니다.`;
    setTimeout(() => {
      saveStatus.style.opacity = '0';
    }, 2500);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "Does this write change anything I am showing?", asked through the same build
  // both pages load with — so a write this page made itself never redraws the form
  // out from under someone mid-edit, whoever stamped it.
  const renderedShape = (storedEnvironments) => AwaEnvStore.shape(AwaEnvStore.build(storedEnvironments, DEFAULT_SERVERS));

  // The popup writes straight to storage on every toggle. Adopt those writes so this
  // page cannot save a stale copy back over them.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.environments) return;
    const incoming = AwaEnvStore.build(changes.environments.newValue, DEFAULT_SERVERS);
    if (AwaEnvStore.shape(incoming) === renderedShape(environments)) return;
    environments = incoming;
    renderAllTabs();
  });

  // Initial render
  renderAllTabs();
  renderPermissionState();
  switchTab(activeTabId);

  // Sent here to allow a site: say which row that is, rather than leaving it to be
  // found among everything else on the tab.
  if (urlParams.get('focus') === 'permissions') {
    const row = document.getElementById('permission-state')?.closest('.form-row');
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('focus-flash');
      setTimeout(() => row.classList.remove('focus-flash'), 2600);
    }
    document.getElementById('btn-grant-permissions')?.focus();
  }
});
