/* Mobile wallet login: pick a customer on the picker page, follow the button that
 * leads on from it, then enter the PIN on its keypad.
 *
 * Which page is which, what that button says, and where the customer list comes
 * from are the site's — they are configuration, carried on the server, so this file
 * names none of them and a build that ships no servers does nothing here.
 */

(function () {
  'use strict';

  console.log('%c[AWA Mobile Script] Loaded on: ' + window.location.href, 'background: #2563eb; color: #fff; padding: 2px 6px; border-radius: 3px;');

  let isRunning = false;
  let autoLoginMark = 0;
  function setAutoLoginActive(active) {
    const root = document.documentElement;
    if (!root) return;
    if (active) {
      autoLoginMark += 1;
      root.dataset.awaAutoLogin = String(autoLoginMark);
      return;
    }
    const mark = root.dataset.awaAutoLogin;
    setTimeout(() => {
      if (root.dataset.awaAutoLogin === mark) delete root.dataset.awaAutoLogin;
    }, 1500);
  }
  let masterEnabled = true;
  let serverEnabled = true;
  let controlVersion = 0;
  let runningVersion = 0;

  function assertActive() {
    if (!isEnabled || runningVersion !== controlVersion) {
      const error = new Error('이 서버의 자동 로그인이 꺼졌습니다.');
      error.cancelled = true;
      throw error;
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.autoLoginEnabled) masterEnabled = changes.autoLoginEnabled.newValue !== false;
    // Which server this page belongs to is loadConfig's question, and it is the only
    // one that asks it — guessing the key from the host is what this used to do and
    // what made a renamed or re-addressed server stop being switchable.
    const touchesThisServer =
      changes.environments || changes.global || changes.keyDelay ||
      changes.superAppUser || changes.superAppCustomerData;
    if (touchesThisServer) {
      loadConfig().then(() => {
        const enabled = masterEnabled && serverEnabled;
        if (enabled === isEnabled) return;
        controlVersion++;
        isEnabled = enabled;
        if (!enabled) cancelCustomerRequest();
        updateAutomation(true);
      });
      return;
    }
    const enabled = masterEnabled && serverEnabled;
    const changed = enabled !== isEnabled;
    if (changed) controlVersion++;
    isEnabled = enabled;
    if (changed) {
      if (!enabled) cancelCustomerRequest();
      updateAutomation(true);
    }
  });
  let targetPin = '';
  // Where this server's customers are picked, where its PIN is entered, what its
  // button to the wallet says, and where its customer list comes from. All of it is
  // the site's, so all of it is configuration.
  let superAppPath = '';
  let pinPath = '';
  let walletLabel = '';
  let listUrl = '';
  let isEnabled = true;
  let keyDelay = 250;
  let preferredSuperAppUser = ''; // defaults to dynamic server customer if empty
  let preferredSuperAppCustomerData = null;

  function sleep(ms) {
    assertActive();
    return new Promise((resolve) => setTimeout(resolve, ms)).then(() => assertActive());
  }

  function logDebug(...args) {
    console.log('%c[AWA Mobile DEBUG]', 'background: #7c3aed; color: #fff; padding: 2px 5px; font-weight: bold;', ...args);
  }

  function logWarn(...args) {
    console.warn('%c[AWA Mobile WARN]', 'background: #d97706; color: #fff; padding: 2px 5px; font-weight: bold;', ...args);
  }

  function logSuccess(...args) {
    console.log('%c[AWA Mobile SUCCESS]', 'background: #059669; color: #fff; padding: 2px 5px; font-weight: bold;', ...args);
  }

  function createOrUpdateBanner(message, type = 'info') {
    let banner = document.getElementById('awa-mobile-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'awa-mobile-banner';
      banner.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        right: 20px;
        padding: 10px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        z-index: 2147483647;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        transition: opacity 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: space-between;
        pointer-events: none;
      `;
      document.body.appendChild(banner);
    }

    if (type === 'info') {
      banner.style.backgroundColor = '#1e293b';
      banner.style.color = '#ffffff';
      banner.style.border = '1px solid #334155';
    } else if (type === 'success') {
      banner.style.backgroundColor = '#065f46';
      banner.style.color = '#ffffff';
      banner.style.border = '1px solid #059669';
    } else if (type === 'error') {
      banner.style.backgroundColor = '#991b1b';
      banner.style.color = '#ffffff';
      banner.style.border = '1px solid #dc2626';
    }

    banner.textContent = message;
    banner.style.opacity = '1';

    if (type === 'success') {
      setTimeout(() => {
        if (banner) banner.style.opacity = '0';
      }, 5000);
    }
  }

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['environments', 'autoLoginEnabled', 'global', 'keyDelay', 'superAppUser', 'superAppCustomerData'], (stored) => {
        // Through AwaEnvStore and by address, not by guessing at the spelling of the
        // host: a server saved by an older build is missing every field added since,
        // and the host a mobile server answers on is a setting like any other.
        const environments = AwaEnvStore.build(stored?.environments, AwaDefaultServers.ALL);
        const envKey = Object.keys(environments).find(
          (key) => AwaServerTypes.isMobile(environments[key]) && AwaServerUrl.owns(environments[key], window.location.host)
        );
        const envCfg = environments[envKey] || {};
        masterEnabled = stored.autoLoginEnabled !== false;
        serverEnabled = !!envKey && envCfg.enabled !== false;
        isEnabled = masterEnabled && serverEnabled;
        targetPin = String(envCfg.password || AwaDefaultServers.NEW_SERVER.mobilePassword || '').trim();
        superAppPath = String(envCfg.superAppPath || AwaDefaultServers.SUPERAPP_PATH || '').trim();
        pinPath = String(envCfg.pinPath || AwaDefaultServers.PIN_PATH || '').trim();
        walletLabel = String(envCfg.walletButtonLabel || AwaDefaultServers.WALLET_BUTTON_LABEL || '').trim();
        listUrl = envKey ? AwaSuperAppUsers.listUrl(envCfg) : '';
        keyDelay = Math.max(60, Number(stored?.global?.keyDelay ?? stored?.keyDelay ?? 70));
        // This server's own pick wins; the global keys are what older versions wrote.
        preferredSuperAppUser = envCfg.superAppUser || stored?.superAppUser || '';
        preferredSuperAppCustomerData = envCfg.superAppCustomerData || stored?.superAppCustomerData || null;
        resolve();
      });
    });
  }

  function isPinPage() {
    if (!pinPath) return false;
    const currentUrl = (window.location.pathname + window.location.hash + window.location.search).toLowerCase();
    return currentUrl.includes(pinPath.toLowerCase());
  }

  function isSuperAppPage() {
    if (!superAppPath) return false;
    const currentUrl = (window.location.pathname + window.location.hash + window.location.search).toLowerCase();
    return currentUrl.includes(superAppPath.toLowerCase().replace(/^\//, ''));
  }

  // =========================================================================
  // SUPER APP SAMPLE HELPER FUNCTIONS
  // =========================================================================

  /**
   * Fetches the customer list from the endpoint configured for this server
   */
  let customerRequest = null;
  let customerController = null;
  function cancelCustomerRequest() {
    customerController?.abort();
  }
  function fetchSuperAppCustomerList() {
    if (customerRequest) return customerRequest;
    const controller = new AbortController();
    customerController = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const request = (async () => {
      try {
        const resp = await fetch(listUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data) ? data : (data.data || []);
      } catch (err) {
        if (err.name !== 'AbortError') logWarn('fetchSuperAppCustomerList failed:', err);
        return [];
      } finally {
        clearTimeout(timeout);
      }
    })();
    customerRequest = request;
    request.finally(() => {
      if (customerRequest === request) {
        customerRequest = null;
        customerController = null;
      }
    });
    return request;
  }

  function setNativeValue(element, value) {
    assertActive();
    if (!element) return;
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Selects a customer on the picker page, by the method the e2e fixture uses:
   * Playwright code:
   * await page.locator('input[name="selectCi"]').locator('..').locator('label').click();
   * await page.locator('input#search').fill(id);
   * await page.locator(`label[for*="${id}"]`).first().click();
   * await page.getByText(walletLabel, { exact: true }).click();
   */
  async function selectSuperAppUserOnPage(userKeyword, autoNavigate = true) {
    assertActive();
    logDebug('Selecting SuperApp user on page:', userKeyword);

    try {
      // 1. Wait for input[name="selectCi"] to exist in DOM
      let selectCiInput = document.querySelector('input[name="selectCi"]');
      for (let i = 0; i < 25; i++) {
        if (selectCiInput) break;
        await sleep(50);
        selectCiInput = document.querySelector('input[name="selectCi"]');
      }

      if (!selectCiInput) {
        logWarn('input[name="selectCi"] not found on page.');
        return false;
      }

      // Exact Playwright Step 1:
      // await this.page.locator('input[name="selectCi"]').locator('..').locator('label').click();
      const parentContainer = selectCiInput.parentElement;
      let labelTrigger = parentContainer ? parentContainer.querySelector('label') : null;
      if (!labelTrigger) {
        labelTrigger = selectCiInput.closest('label') || parentContainer || selectCiInput;
      }

      logDebug('Clicking label trigger to open BottomSheet:', labelTrigger);
      if (labelTrigger) {
        labelTrigger.click();
      }

      // 2. Wait for BottomSheet to open and input#search to appear
      let searchInput = document.querySelector('input#search');
      for (let i = 0; i < 20; i++) {
        searchInput = document.querySelector('input#search');
        if (searchInput && searchInput.offsetParent !== null) break;
        await sleep(50);
      }

      if (!searchInput) {
        logWarn('input#search not found or BottomSheet did not open.');
        return false;
      }

      // If userKeyword provided, fill search
      if (userKeyword) {
        logDebug('Found input#search. Filling with:', userKeyword);
        searchInput.focus();
        setNativeValue(searchInput, userKeyword);
        await sleep(80);
      }

      // 3. Locate user radio label in BottomSheet
      let userLabel = null;
      for (let i = 0; i < 20; i++) {
        if (userKeyword) {
          userLabel = document.querySelector(`label[for*="${userKeyword}"]`);
          if (!userLabel) {
            const labels = Array.from(document.querySelectorAll('.btm-sheet-btn.radio, label[for]'));
            userLabel = labels.find((l) => (l.textContent || '').includes(userKeyword));
          }
        }

        // Fallback: If no keyword or not found yet, pick the first valid existing customer (exclude '신규')
        if (!userLabel) {
          const labels = Array.from(document.querySelectorAll('.btm-sheet-btn.radio, label[for]'));
          userLabel = labels.find((l) => {
            const txt = (l.textContent || '').trim();
            const htmlFor = (l.getAttribute('for') || '').trim();
            if (txt.includes('신규') || htmlFor.includes('신규')) return false;
            return txt.includes(':') || htmlFor.includes(':') || txt.includes(';');
          });
        }

        if (userLabel) break;
        await sleep(50);
      }

      if (!userLabel) {
        logWarn('Could not find any user label in BottomSheet.');
        return false;
      }

      const selectedName = userLabel.textContent ? userLabel.textContent.trim().split(':')[0] : '사용자';
      createOrUpdateBanner(`📱 [슈퍼앱] '${selectedName}' 선택 완료!`, 'info');
      logSuccess('Found user label! Clicking option:', userLabel.textContent);
      userLabel.click();
      await sleep(100);

      // 4. Press the button that leads on from the picker
      // Exact Playwright Step 4:
      if (autoNavigate) {
        let submitBtn = null;
        for (let i = 0; i < 20; i++) {
          const buttons = Array.from(document.querySelectorAll('button'));
          submitBtn = walletLabel ? buttons.find((b) => (b.textContent || '').trim().includes(walletLabel)) : null;
          if (submitBtn) break;
          await sleep(50);
        }

        if (submitBtn) {
          logSuccess(`Found "${walletLabel}" button. Clicking...`);
          createOrUpdateBanner(`📱 [슈퍼앱] ${walletLabel} 중...`, 'info');
          submitBtn.click();
        } else {
          logWarn(`"${walletLabel}" button not found.`);
        }
      }

      return true;
    } catch (e) {
      if (e.cancelled) throw e;
      logWarn('selectSuperAppUserOnPage error:', e);
      return false;
    }
  }

  /**
   * Automatically executes SuperApp page flow if enabled
   */
  /**
   * Direct Form Injection: Instantly fills all form fields without waiting
   * for the BottomSheet modal or React cycle animations.
   */
  function fillSuperAppFormDirectly(customer, autoNavigate = true) {
    assertActive();
    if (!customer || !customer.ci || !customer.cstmrNo) return false;

    const selectCiInput = document.querySelector('input[name="selectCi"]');
    const userIdInput = document.querySelector('input[name="userId"]');
    const userCIInput = document.querySelector('input[name="userCI"]');
    const accountInput = document.querySelector('input[name="account"]');

    if (!selectCiInput || !userIdInput || !userCIInput || !accountInput) {
      logWarn('Direct fill inputs not all found yet in DOM.');
      return false;
    }

    try {
      const combinedCi = `${customer.ci}::${customer.cstmrNo}::${customer.acnutno || ''}`;

      // Directly update hidden and text input values via native descriptor setters
      setNativeValue(selectCiInput, combinedCi);
      setNativeValue(userIdInput, customer.cstmrNo);
      setNativeValue(userCIInput, customer.ci);
      setNativeValue(accountInput, customer.acnutno || '');

      // Also persist to localStorage for web page state sync
      try {
        localStorage.setItem('selectedUserKey', combinedCi);
      } catch (e) {}

      // Update visible label / display input if present
      const displayInput = selectCiInput.parentElement?.querySelector('input[type="text"][readonly]');
      if (displayInput) {
        displayInput.value = `${customer.koreanNm || ''} (${customer.cstmrNo || ''})`;
      }

      const selectedName = customer.koreanNm || customer.cstmrNo;
      createOrUpdateBanner(`📱 [슈퍼앱] '${selectedName}' 폼 직접 주입 완료!`, 'info');
      logSuccess('SuperApp form direct fill succeeded for:', selectedName, combinedCi);

      if (autoNavigate) {
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = walletLabel ? buttons.find((b) => (b.textContent || '').trim().includes(walletLabel)) : null;
        if (submitBtn) {
          logSuccess(`Found "${walletLabel}" button. Clicking directly without BottomSheet...`);
          createOrUpdateBanner(`📱 [슈퍼앱] ${walletLabel} 중...`, 'info');
          submitBtn.click();
        } else {
          logWarn(`"${walletLabel}" button not found during direct fill.`);
        }
      }

      return true;
    } catch (err) {
      logWarn('fillSuperAppFormDirectly error:', err);
      return false;
    }
  }

  async function executeSuperAppFlow() {
    if (isRunning) return;
    if (!isSuperAppPage()) return;
    if (document.body && document.body.dataset.superAppExecuted === 'true') return;

    isRunning = true;
    runningVersion = controlVersion;
    setAutoLoginActive(true);
    try {
      await loadConfig();
      if (runningVersion !== controlVersion) return;
      if (!isEnabled) return;

      logDebug(`Detected ${superAppPath} page. Starting SuperApp user selection pipeline...`);
      createOrUpdateBanner(`📱 [슈퍼앱] 화면 감지 (${superAppPath}) - 사용자 선택 준비 중...`, 'info');

      // Wait for page form elements to be mounted
      for (let wait = 0; wait < 20; wait++) {
        const input = document.querySelector('input[name="selectCi"]');
        if (input) break;
        await sleep(50);
      }

      let targetUser = preferredSuperAppUser || '';
      let customerObj = preferredSuperAppCustomerData || null;

      // Ensure customer object is available
      if (!customerObj || !customerObj.ci) {
        const customers = await fetchSuperAppCustomerList();
        const activeUsers = customers.filter((c) => !!c.ci);
        if (targetUser) {
          customerObj = activeUsers.find((c) => c.koreanNm === targetUser || c.cstmrNo === targetUser || (c.koreanNm && c.koreanNm.includes(targetUser)));
        }
        if (!customerObj && activeUsers.length > 0) {
          customerObj = activeUsers[0];
          targetUser = customerObj.koreanNm || customerObj.cstmrNo;
        }
      }

      assertActive();
      logDebug('SuperApp resolved customer:', targetUser, customerObj);

      let ok = false;
      // 1. DIRECT FAST PATH: Fill form directly without opening BottomSheet or waiting for React cycle
      if (customerObj && customerObj.ci && customerObj.cstmrNo) {
        logDebug('Attempting direct fast form injection...');
        ok = fillSuperAppFormDirectly(customerObj, true);
      }

      // 2. FALLBACK PATH: If direct injection failed, use UI BottomSheet interaction
      if (!ok) {
        logDebug('Falling back to BottomSheet UI selection flow...');
        ok = await selectSuperAppUserOnPage(targetUser, true);
      }

      if (ok && document.body) {
        document.body.dataset.superAppExecuted = 'true';
      }
    } catch (err) {
      if (!err.cancelled) logWarn('executeSuperAppFlow error:', err);
    } finally {
      isRunning = false;
      setAutoLoginActive(false);
    }
  }

  // =========================================================================
  // PIN KEYPAD LOGIN IMPLEMENTATION (Playwright e2e fixture tested)
  // =========================================================================

  async function singleClick(el, label = '') {
    assertActive();
    if (!el) {
      logWarn('singleClick: element is null', label);
      return false;
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (e) {}

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const hasTouch = el.hasAttribute('ontouchstart');
    const hasMouse = el.hasAttribute('onmousedown');

    if (hasTouch && !hasMouse) {
      try {
        const touchObj = new Touch({
          identifier: Date.now(),
          target: el,
          clientX,
          clientY,
          screenX: clientX,
          screenY: clientY,
          pageX: clientX + (window.scrollX || 0),
          pageY: clientY + (window.scrollY || 0)
        });
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj], bubbles: true }));
        await sleep(30);
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touchObj], bubbles: true }));
      } catch (e) {
        if (e.cancelled) throw e;
        el.click();
      }
    } else {
      if (typeof el.click === 'function') {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX, clientY }));
      }
    }

    return true;
  }

  function getPinInputValue() {
    const pinBox = document.querySelector('.pin-box');
    const inputEl = pinBox ? pinBox.querySelector('input') : document.querySelector('input[type="password"], input[type="tel"]');
    return inputEl ? inputEl.value : null;
  }

  let cancelKeypadWait = null;
  function readKeypadMap() {
    window.dispatchEvent(new Event('awa-request-keypad-map'));
    let dki;
    try {
      dki = JSON.parse(document.body?.dataset.transkeyDki || 'null');
    } catch (_) { return null; }
    if (!Array.isArray(dki) || dki.length < 10) return null;

    const byIndex = {};
    for (const anchor of document.querySelectorAll('a[onclick*="mtk.start"], a[ontouchstart*="mtk.start"], a[onmousedown*="mtk.start"]')) {
      for (const attribute of ['onclick', 'ontouchstart', 'onmousedown']) {
        const match = anchor.getAttribute(attribute)?.match(/mtk\.start\(\s*event\s*,\s*this\s*,\s*(\d+)\s*\)/);
        if (match) byIndex[Number(match[1])] = anchor;
      }
    }
    const map = {};
    // numberMobile has two non-digit slots: button 9 reads dki[10].
    // Ten-element arrays use their indices directly.
    for (const [index, anchor] of Object.entries(byIndex)) {
      const slot = Number(index) === 9 && dki.length > 10 ? 10 : Number(index);
      const digit = String(dki[slot]);
      if (/^\d$/.test(digit)) map[digit] = anchor;
    }
    return Object.keys(map).length === 10 ? map : null;
  }

  function mapKeypadButtons() {
    assertActive();
    const immediate = readKeypadMap();
    if (immediate) return Promise.resolve(immediate);

    // Buttons can exist before the asynchronous allocation supplies dki.
    // Listen only during this attempt; never probe digits or install a poller.
    return new Promise((resolve, reject) => {
      let deadline;
      const cleanup = () => {
        readiness.disconnect();
        clearTimeout(deadline);
        document.removeEventListener('load', check, true);
        if (cancelKeypadWait === cancel) cancelKeypadWait = null;
      };
      const finish = (map, error) => {
        cleanup();
        if (error) reject(error); else resolve(map);
      };
      const cancel = () => {
        const error = new Error('키패드 매핑 대기가 중단되었습니다.');
        error.cancelled = true;
        finish(null, error);
      };
      const check = () => {
        try {
          assertActive();
          const map = readKeypadMap();
          if (map) finish(map);
        } catch (error) { finish(null, error); }
      };
      const readiness = new MutationObserver(check);
      cancelKeypadWait = cancel;
      readiness.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['onclick', 'ontouchstart', 'onmousedown', 'aria-label', 'style'] });
      document.addEventListener('load', check, true);
      deadline = setTimeout(() => {
        try {
          assertActive();
          finish(readKeypadMap());
        } catch (error) { finish(null, error); }
      }, 1500);
      check();
    });
  }

  async function executePinLogin() {
    if (isRunning) return;
    if (!isPinPage()) return;
    if (document.body && document.body.dataset.pinLoginExecuted === 'true') return;

    isRunning = true;
    runningVersion = controlVersion;
    setAutoLoginActive(true);
    try {
      await loadConfig();
      if (runningVersion !== controlVersion) return;

      if (!isEnabled) {
        return;
      }

      createOrUpdateBanner(`📱 [모바일 PIN] 화면 감지 (${pinPath}) - 키패드 준비 중...`, 'info');

      let deleteBtn = document.querySelector('a[onclick*="mtk.del"], a[ontouchstart*="mtk.del"], [aria-label="삭제"]');
      let buttons = document.querySelectorAll('a[onclick*="mtk.start"], a[ontouchstart*="mtk.start"]');

      if (!deleteBtn || buttons.length < 10) {
        const pinTrigger = document.querySelector('.pin-box, input[type="password"], input[type="tel"]');
        if (pinTrigger) {
          pinTrigger.focus();
          await singleClick(pinTrigger, 'PIN Trigger');
        }

        for (let wait = 0; wait < 25; wait++) {
          await sleep(50);
          deleteBtn = document.querySelector('a[onclick*="mtk.del"], a[ontouchstart*="mtk.del"], [aria-label="삭제"]');
          buttons = document.querySelectorAll('a[onclick*="mtk.start"], a[ontouchstart*="mtk.start"]');
          if (deleteBtn && buttons.length >= 10) break;
        }
      }

      if (!deleteBtn || buttons.length < 10) {
        createOrUpdateBanner('⚠️ [모바일 PIN] 키패드를 찾지 못했습니다.', 'error');
        return;
      }

      await sleep(50);

      const digitMap = await mapKeypadButtons();
      if (!digitMap) {
        logWarn('Direct keypad map unavailable; skipping button probing.');
        createOrUpdateBanner('⚠️ [모바일 PIN] 숫자 배열 초기화를 기다린 뒤 다시 시도합니다.', 'error');
        return;
      }

      createOrUpdateBanner(`📱 [모바일 PIN] 목표 PIN(${targetPin}) 입력 중...`, 'info');
      await sleep(80);

      for (let i = 0; i < targetPin.length; i++) {
        const digit = targetPin[i];
        let btn = digitMap ? digitMap[digit] : null;

        if (!btn) {
          btn = document.querySelector(`[aria-label="${digit}"], a[aria-label="${digit}"]`);
        }

        if (!btn) {
          throw new Error(`숫자 '${digit}' 키패드 버튼을 찾을 수 없습니다.`);
        }

        await singleClick(btn, `Digit ${digit}`);
        await sleep(keyDelay);
      }

      if (document.body) {
        document.body.dataset.pinLoginExecuted = 'true';
      }
      createOrUpdateBanner(`🎉 [모바일 PIN] PIN(${targetPin}) 6자리 입력 완료!`, 'success');
      logSuccess('PIN typing finished successfully!');
    } catch (err) {
      if (err.cancelled) return;
      logWarn('executePinLogin failed:', err);
      createOrUpdateBanner(`오류: ${err.message}`, 'error');
    } finally {
      isRunning = false;
      setAutoLoginActive(false);
    }
  }

  // Observe only unfinished login pages. Each route gets at most three attempts.
  const MAX_ATTEMPTS = 3;
  let attempts = 0;
  let scheduled = null;
  let suspended = false;
  let currentRoute = window.location.pathname + window.location.search + window.location.hash;
  const observer = new MutationObserver(() => {
    if (!isRunning && scheduled === null) scheduleAutomation(50);
  });

  function stopAutomation() {
    cancelKeypadWait?.();
    if (scheduled !== null) clearTimeout(scheduled);
    scheduled = null;
    observer.disconnect();
  }
  function needsAutomation() {
    if (!document.body || !isEnabled || suspended || document.hidden || attempts >= MAX_ATTEMPTS) return false;
    return (isPinPage() && !document.body.dataset.pinLoginExecuted) ||
      (isSuperAppPage() && !document.body.dataset.superAppExecuted);
  }
  function scheduleAutomation(delay) {
    if (!needsAutomation() || isRunning || scheduled !== null) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      runAutomation();
    }, delay);
  }
  function updateAutomation(reset = false) {
    stopAutomation();
    if (reset) attempts = 0;
    if (!needsAutomation() || isRunning) return;
    observer.observe(document.body, { childList: true, subtree: true });
    runAutomation();
  }
  async function runAutomation() {
    if (!needsAutomation() || isRunning) return;
    observer.disconnect(); // Ignore our own banners, input changes, and keypad clicks.
    attempts++;
    const version = controlVersion;
    if (isPinPage()) await executePinLogin();
    else await executeSuperAppFlow();
    if (version !== controlVersion) {
      updateAutomation();
      return;
    }
    if (needsAutomation()) {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleAutomation(1000 * attempts);
    } else {
      stopAutomation();
    }
  }
  const fireLocationChange = () => {
    const route = window.location.pathname + window.location.search + window.location.hash;
    if (route === currentRoute) return;
    currentRoute = route;
    controlVersion++;
    cancelCustomerRequest();
    if (document.body) {
      delete document.body.dataset.pinLoginExecuted;
      delete document.body.dataset.superAppExecuted;
    }
    updateAutomation(true);
  };
  window.addEventListener('awa-mobile-route-change', fireLocationChange);
  window.addEventListener('popstate', fireLocationChange);
  window.addEventListener('hashchange', fireLocationChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      controlVersion++;
      stopAutomation();
      cancelCustomerRequest();
    } else updateAutomation(true);
  });
  window.addEventListener('pagehide', () => {
    suspended = true;
    controlVersion++;
    stopAutomation();
    cancelCustomerRequest();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      suspended = false;
      loadConfig().then(() => updateAutomation());
    }
  });

  // Message listener from popup & background
  chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
    // 1. Full Login Trigger
    if (request.action === 'TRIGGER_LOGIN') {
      if (isRunning || !isEnabled) {
        sendResponse({ success: false, disabled: !isEnabled, running: isRunning });
        return;
      }
      if (document.body) {
        delete document.body.dataset.pinLoginExecuted;
        delete document.body.dataset.superAppExecuted;
      }
      attempts = 0;
      stopAutomation();
      runAutomation().then(() => sendResponse({ success: document.body?.dataset.pinLoginExecuted === 'true' || document.body?.dataset.superAppExecuted === 'true', status: 'started' }));
      return true;
    }

    // 2. SuperApp Page Status Inquiry
    if (request.action === 'CHECK_SUPERAPP_STATUS') {
      const isSuper = isSuperAppPage();
      sendResponse({ isSuperApp: isSuper, url: window.location.href });
      return true;
    }

    // 3. SuperApp Fetch Customers API
    if (request.action === 'FETCH_SUPERAPP_CUSTOMERS') {
      fetchSuperAppCustomerList().then((list) => {
        sendResponse({ success: true, customers: list });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    // 4. SuperApp Select User Command from Popup
    if (request.action === 'SELECT_SUPERAPP_USER') {
      if (isRunning || !isEnabled) {
        sendResponse({ success: false, disabled: !isEnabled, running: isRunning });
        return;
      }
      if (request.customerData) {
        preferredSuperAppCustomerData = request.customerData;
      }
      if (request.userKeyword) {
        preferredSuperAppUser = request.userKeyword;
      }
      if (document.body) delete document.body.dataset.superAppExecuted;
      attempts = 0;
      stopAutomation();
      runAutomation().then(() => sendResponse({ success: document.body?.dataset.superAppExecuted === 'true' }));
      return true;
    }

    if (request.action === 'SETTINGS_UPDATED') {
      loadConfig().then(() => updateAutomation(true));
    }
  });

  // Load once at startup; subsequent work comes from route/DOM/settings events.
  const start = () => loadConfig().then(() => updateAutomation());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
