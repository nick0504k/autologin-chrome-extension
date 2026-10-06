(function () {
  'use strict';

  // Environment and fallback configs for all DEV & STG servers
  const DEFAULT_ENV_CONFIG = AwaDefaultServers.ALL;

  const DEFAULT_GLOBAL = AwaDefaultServers.GLOBAL;

  let detectedOwners = {};
  let detectionOff = {};
  let activeEnvKey = detectEnvKey();
  let currentEnvConfig = { ...(DEFAULT_ENV_CONFIG[activeEnvKey] || {}) };
  let currentGlobalConfig = { ...DEFAULT_GLOBAL };
  let isRunning = false;
  let masterEnabled = true;
  let pageSuspended = false;
  let controlVersion = 0;
  let runningVersion = 0;

  function assertActive() {
    if (document.hidden || pageSuspended || !masterEnabled || currentEnvConfig.enabled === false || runningVersion !== controlVersion) {
      const error = new Error('자동 로그인이 꺼졌습니다.');
      error.cancelled = true;
      throw error;
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.autoLoginEnabled && !changes.environments)) return;
    const wasEnabled = masterEnabled && currentEnvConfig.enabled !== false;
    if (changes.autoLoginEnabled) masterEnabled = changes.autoLoginEnabled.newValue !== false;
    if (changes.environments) {
      const envs = changes.environments.newValue;
      const key = detectEnvKey(envs);
      currentEnvConfig.enabled = envs?.[key]?.enabled ?? DEFAULT_ENV_CONFIG[key]?.enabled ?? true;
    }
    const enabled = masterEnabled && currentEnvConfig.enabled !== false;
    if (enabled !== wasEnabled) controlVersion++;
    syncObserver();
    if (enabled && !wasEnabled && !isRunning && !document.hidden && !pageSuspended) setTimeout(performLogin, 0);
  });
  let statusBanner = null;

  function detectEnvKey(environments) {
    const currentHostname = window.location.hostname.toLowerCase();
    const currentHost = window.location.host.toLowerCase();
    // Storage holds whatever the settings page last wrote, which for a server that
    // shipped later is nothing, and for one that shipped earlier is missing every
    // field added since. AwaEnvStore owns that merge; detection without it sends an
    // unrecognised host to the fallback server and types its account into the page.
    const envs = AwaEnvStore.build(environments, DEFAULT_ENV_CONFIG);

    // An address shared by several servers resolves to what it was detected as,
    // then to the one ticked for it.
    const ranking = { detected: detectedOwners, detectionOff };
    const exact = AwaServerUrl.matchHost(envs, currentHost, ranking)
      || AwaServerUrl.matchHost(envs, currentHostname, ranking);
    if (exact) return exact;

    // A login that walks across hosts answers for every page of its flow.
    const flow = Object.entries(envs).find(([, cfg]) => cfg?.hosts?.length && AwaServerUrl.owns(cfg, currentHost));
    if (flow) return flow[0];
    for (const [key, cfg] of Object.entries(envs)) {
      if (cfg && cfg.host) {
        const cfgHost = cfg.host.toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
        if (currentHost.includes(cfgHost) || cfgHost.includes(currentHostname)) {
          return key;
        }
      }
    }

    // Nothing configured answers for this address. Guessing a server would type one
    // site's account into another site's form, so the answer is "none" and the run
    // stops — which is also what lets this script carry no host list of its own.
    return null;
  }

  function isMobileEnvironment() {
    const isPinPath =
      window.location.pathname.includes('/pin/login') ||
      window.location.href.includes('/pin/login') ||
      window.location.hash.includes('/pin/login');

    if (isPinPath) return true;

    // Which family this server belongs to is a setting, not something to read out of
    // the spelling of its address.
    return AwaAccounts.isMobile(currentEnvConfig);
  }

  async function reloadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          'environments',
          'autoLoginEnabled',
          'global',
          'enabled',
          'username',
          'password',
          'otpSecret',
          'keyDelay',
          'autoSubmit',
          'detectedOwners',
          'detectionOff'
        ],
        (result) => {
          masterEnabled = result.autoLoginEnabled !== false;
          detectedOwners = result.detectedOwners || {};
          detectionOff = result.detectionOff || {};
          const environments = AwaEnvStore.build(result.environments, DEFAULT_ENV_CONFIG);
          activeEnvKey = detectEnvKey(environments);
          currentEnvConfig = { ...(environments[activeEnvKey] || {}) };

          currentEnvConfig.password = AwaAccounts.getPassword(currentEnvConfig);

          currentGlobalConfig = {
            autoSubmit: result.global?.autoSubmit ?? result.autoSubmit ?? DEFAULT_GLOBAL.autoSubmit,
            keyDelay: Number(result.global?.keyDelay ?? result.keyDelay ?? DEFAULT_GLOBAL.keyDelay)
          };

          resolve();
        }
      );
    });
  }

  async function recordSuccessfulLogin(envKey, username) {
    if (!username) return;
    try {
      const stored = await chrome.storage.local.get(['environments']);
      const envs = stored.environments || {};
      const targetEnv = envs[envKey] || { ...(DEFAULT_ENV_CONFIG[envKey] || {}) };

      if (!Array.isArray(targetEnv.accounts)) {
        targetEnv.accounts = [];
      }

      if (!targetEnv.accounts.includes(username)) {
        targetEnv.accounts.push(username);
        targetEnv.username = username;
        envs[envKey] = targetEnv;
        await chrome.storage.local.set({ environments: envs });
        console.log(`[AWA Auto-Login] Auto-recorded login account '${username}' for ${envKey}`);
      }
    } catch (e) {
      console.warn('[AWA Auto-Login] Failed to record login account:', e);
    }
  }

  // --- Utility Functions ---
  function sleep(ms) {
    assertActive();
    return new Promise((resolve) => setTimeout(resolve, ms)).then(() => assertActive());
  }

  function createOrUpdateBanner(message, type = 'info') {
    if (!statusBanner) {
      statusBanner = document.createElement('div');
      statusBanner.id = 'awa-autologin-banner';
      statusBanner.style.position = 'fixed';
      statusBanner.style.top = '16px';
      statusBanner.style.right = '16px';
      statusBanner.style.zIndex = '999999';
      statusBanner.style.padding = '10px 16px';
      statusBanner.style.borderRadius = '8px';
      statusBanner.style.color = '#fff';
      statusBanner.style.fontSize = '13px';
      statusBanner.style.fontWeight = '600';
      statusBanner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      statusBanner.style.transition = 'all 0.3s ease';
      statusBanner.style.display = 'flex';
      statusBanner.style.alignItems = 'center';
      statusBanner.style.gap = '8px';
      document.body.appendChild(statusBanner);
    }

    if (type === 'info') statusBanner.style.backgroundColor = '#2563eb';
    else if (type === 'success') statusBanner.style.backgroundColor = '#16a34a';
    else if (type === 'error') statusBanner.style.backgroundColor = '#dc2626';

    statusBanner.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    statusBanner.style.opacity = '1';

    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        if (statusBanner) statusBanner.style.opacity = '0';
      }, 3500);
    }
  }

  function setNativeValue(element, value) {
    assertActive();
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

  // =========================================================================
  // PIPELINE 1: MOBILE PIN LOGIN ENGINE (/pin/login)
  // - Pure numeric VR keyboard clicking (0-9)
  // - Dedicated mobile touch & pointer dispatch
  // - NO submit button (6th digit automatically submits)
  // - NO 2nd factor OTP
  // =========================================================================

  function findMobileNumericKey(digit) {
    const dStr = String(digit).trim();

    // 1. Scrutinize mobile keypad containers
    const keypadContainers = Array.from(
      document.querySelectorAll(
        'div[class*="keypad"], div[id*="keypad"], div[class*="numpad"], div[id*="numpad"], div[class*="pin"], div[id*="pin"], div[class*="security"], div[id*="security"], div[role="grid"], div[role="dialog"], ul[class*="key"], [class*="vr-keypad"]'
      )
    );

    const matchMobileElement = (el) => {
      if (!el) return false;
      const aria = (el.getAttribute('aria-label') || '').trim();
      if (aria === dStr) return true;

      const dataKey = (el.getAttribute('data-key') || '').trim();
      if (dataKey === dStr) return true;

      const dataVal = (
        el.getAttribute('data-value') ||
        el.getAttribute('data-val') ||
        el.getAttribute('data-num') ||
        el.getAttribute('data-number') ||
        el.getAttribute('value') ||
        ''
      ).trim();
      if (dataVal === dStr) return true;

      const alt = (el.getAttribute('alt') || '').trim();
      if (alt === dStr) return true;

      const title = (el.getAttribute('title') || '').trim();
      if (title === dStr) return true;

      const txt = (el.textContent || '').trim();
      if (txt === dStr && el.children.length === 0) return true;
      if (txt === dStr && el.children.length === 1 && (el.children[0].textContent || '').trim() === dStr) return true;

      return false;
    };

    for (const container of keypadContainers) {
      const candidates = Array.from(container.querySelectorAll('button, div[role="button"], span[role="button"], a, td, li, span, div, img'));
      const found = candidates.find(matchMobileElement);
      if (found) return found;
    }

    // 2. Global search across the document
    const allCandidates = Array.from(
      document.querySelectorAll('button, [role="button"], [data-key], [data-value], [data-num], [data-val], [aria-label]')
    );
    return allCandidates.find(matchMobileElement);
  }

  async function clickMobileNumericKey(keyEl) {
    if (!keyEl) return false;

    keyEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = keyEl.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    // Pointer events
    try {
      const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX, clientY, pointerType: 'touch' });
      keyEl.dispatchEvent(pointerDown);
    } catch (e) {}

    // Mobile touch events
    try {
      if (typeof window.TouchEvent === 'function') {
        const touchObj = new Touch({
          identifier: Date.now(),
          target: keyEl,
          clientX,
          clientY,
          screenX: clientX,
          screenY: clientY,
          pageX: clientX + (window.scrollX || 0),
          pageY: clientY + (window.scrollY || 0)
        });
        keyEl.dispatchEvent(new TouchEvent('touchstart', { touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj], bubbles: true }));
        keyEl.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touchObj], bubbles: true }));
      }
    } catch (e) {}

    // Mouse events
    ['mousedown', 'mouseup', 'click'].forEach((evtType) => {
      const evt = new MouseEvent(evtType, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      });
      keyEl.dispatchEvent(evt);
    });

    if (typeof keyEl.click === 'function') {
      try {
        keyEl.click();
      } catch (e) {}
    }

    return true;
  }

  async function runMobilePinPipeline() {
    const isPinPage =
      window.location.pathname.includes('/pin/login') ||
      window.location.href.includes('/pin/login') ||
      window.location.hash.includes('/pin/login');

    if (!isPinPage) {
      console.log('[AWA Auto-Login Mobile] 현재 /pin/login 경로가 아닙니다.');
      return;
    }

    createOrUpdateBanner('[모바일 PIN] 화면 감지 (/pin/login) - 가상 키패드 확인 중...', 'info');

    // The PIN is the server's own; the fallback is shipped with the servers.
    const pin = (currentEnvConfig.password || AwaDefaultServers.NEW_SERVER.mobilePassword || '').trim();
    const delay = currentGlobalConfig.keyDelay || DEFAULT_GLOBAL.keyDelay;

    // Check if keypad is visible; if not, click PIN box or trigger
    let firstKey = findMobileNumericKey(pin[0]);
    if (!firstKey) {
      const pinTrigger = document.querySelector(
        'input[type="password"], input[type="tel"], input[placeholder*="PIN"], input[placeholder*="비밀번호"], .pin-input, .pin-box, [role="textbox"], button[class*="keypad"], [class*="pin-input"]'
      );
      if (pinTrigger) {
        pinTrigger.focus();
        pinTrigger.click();
        await sleep(400);
      }
    }

    // Wait up to 3 seconds for mobile VR keyboard to appear
    for (let waitCount = 0; waitCount < 15; waitCount++) {
      firstKey = findMobileNumericKey(pin[0]);
      if (firstKey) break;
      await sleep(200);
    }

    if (!firstKey) {
      createOrUpdateBanner('[모바일 PIN] 가상 키패드가 감지되지 않았습니다.', 'error');
      console.warn('[AWA Auto-Login Mobile] 가상 키패드 첫 글자(', pin[0], ')를 찾을 수 없습니다.');
      return;
    }

    createOrUpdateBanner(`[모바일 PIN] 가상 키패드로 PIN(${pin.length}자리) 자동 입력 중...`, 'info');

    // Sequentially click all digits of the PIN
    for (let i = 0; i < pin.length; i++) {
      const digit = pin[i];
      const keyEl = findMobileNumericKey(digit);
      if (keyEl) {
        await clickMobileNumericKey(keyEl);
      } else {
        console.warn(`[AWA Auto-Login Mobile] PIN 숫자 '${digit}' 키를 찾지 못함`);
      }
      await sleep(delay);
    }

    // Note: Mobile has NO submit button and NO OTP!
    // Entering the 6th digit automatically submits and navigates.
    createOrUpdateBanner('[모바일 PIN] PIN 6자리 입력 완료! (자동 인증)', 'success');
  }

  // =========================================================================
  // PIPELINE 2: STANDARD WEB / ADMIN LOGIN ENGINE (AWA / PDM / PDV)
  // - ID input filling
  // - Web Virtual Keypad (Raon Transkey / Standard Web Keypad) or Direct Input
  // - Submit / Login button auto-click
  // - 2nd Factor OTP generation and submission
  // =========================================================================

  function findWebKeypadKey(char) {
    const charStr = String(char).toLowerCase().trim();
    const keypadContainer = document.querySelector(
      '#transkey_div, .transkey_div, div[id*="transkey"], div[class*="keypad"], div[id*="keypad"]'
    );

    let keyElement = null;

    if (keypadContainer) {
      const candidates = Array.from(keypadContainer.querySelectorAll('img, button, a, div, span'));
      keyElement = candidates.find((el) => {
        const alt = (el.getAttribute('alt') || '').trim().toLowerCase();
        const title = (el.getAttribute('title') || '').trim().toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        return alt === charStr || title === charStr || text === charStr || ariaLabel === charStr;
      });
    }

    if (!keyElement) {
      const allCandidates = Array.from(document.querySelectorAll('img, button, a, div[role="button"]'));
      keyElement = allCandidates.find((el) => {
        const alt = (el.getAttribute('alt') || '').trim().toLowerCase();
        const title = (el.getAttribute('title') || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        return alt === charStr || title === charStr || ariaLabel === charStr;
      });
    }

    return keyElement;
  }

  async function clickWebKey(char) {
    assertActive();
    const keyElement = findWebKeypadKey(char);
    if (!keyElement) return false;

    // Single native click to prevent double-character input on mTranskey
    if (typeof keyElement.click === 'function') {
      keyElement.click();
    } else {
      keyElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  async function enterWebPassword(pwField, password) {
    const isDirect =
      currentEnvConfig.keypadMode === 'direct' ||
      currentEnvConfig.useVirtualKeypad === false;

    if (isDirect) {
      createOrUpdateBanner('비밀번호 직접 입력 모드 적용...', 'info');
      pwField.focus();
      setNativeValue(pwField, password);
      await sleep(200);
      return;
    }

    // Web Virtual Keypad mode
    createOrUpdateBanner('가상 키패드 활성화 대기 중...', 'info');
    pwField.focus();
    pwField.click();

    // Wait for virtual keyboard to open and keys to be ready
    let keypadReady = false;
    for (let w = 0; w < 25; w++) {
      if (findWebKeypadKey(password[0]) || document.querySelector('[aria-label="a"], [aria-label="A"]')) {
        keypadReady = true;
        break;
      }
      if (w === 5 || w === 12) {
        pwField.click();
        const mtkLink = document.querySelector('a[href*="mtranskey"], a[title*="키보드"]');
        if (mtkLink) mtkLink.click();
      }
      await sleep(200);
    }

    const delay = Math.max(50, Number(currentGlobalConfig.keyDelay) || DEFAULT_GLOBAL.keyDelay);
    let fallbackToDirect = false;

    for (let i = 0; i < password.length; i++) {
      const char = password[i];
      const clicked = await clickWebKey(char);

      if (!clicked) {
        console.warn(`[AWA Auto-Login Web] 가상 키패드에서 문자 '${char}'를 찾지 못함. 직접 입력 전환.`);
        fallbackToDirect = true;
        break;
      }
      await sleep(delay);
    }

    if (fallbackToDirect) {
      createOrUpdateBanner('가상 키패드 미탐지로 직접 입력 전환...', 'info');
      pwField.focus();
      setNativeValue(pwField, password);
      await sleep(200);
    } else {
      // Click "입력완료"
      const doneBtn =
        document.querySelector('[aria-label="입력완료"]') ||
        Array.from(document.querySelectorAll('a, button, div[role="button"]')).find((b) =>
          b.textContent.trim().includes('입력완료')
        );

      if (doneBtn) {
        doneBtn.click();
        await sleep(Math.max(100, delay));
      }

      // Close keypad if button exists
      const closeBtn = document.querySelector('[aria-label="가상키보드 닫기"]');
      if (closeBtn) {
        closeBtn.click();
        await sleep(100);
      }

      createOrUpdateBanner('가상 키패드 입력 완료!', 'info');
    }
  }

  async function runWebLoginPipeline() {
    // 1. ID & Password Step
    const idField = document.querySelector(
      'input[name="loginId"], input[name="userId"], input[id*="loginId"], input[id*="userId"], input[placeholder*="아이디"], input[placeholder*="사용자"]'
    );
    const pwField = document.querySelector(
      'input[type="password"], input[name="password"], input[name="userPw"], input[id*="password"]'
    );

    if (idField && pwField) {
      createOrUpdateBanner(`[${currentEnvConfig.name || activeEnvKey}] ID/비밀번호 자동 입력 시작...`, 'info');

      if (currentEnvConfig.username) {
        idField.focus();
        setNativeValue(idField, currentEnvConfig.username);
        await sleep(200);
      }

      if (currentEnvConfig.password) {
        await enterWebPassword(pwField, currentEnvConfig.password);
        await sleep(300);
      }

      if (currentGlobalConfig.autoSubmit) {
        const submitBtn =
          document.querySelector('button[type="submit"]') ||
          Array.from(document.querySelectorAll('button, a')).find(
            (el) =>
              el.textContent.trim() === '로그인' ||
              el.textContent.trim() === '확인' ||
              el.textContent.trim() === 'Login'
          );

        if (submitBtn) {
          createOrUpdateBanner('로그인 버튼 자동 클릭!', 'success');
          submitBtn.click();
          await recordSuccessfulLogin(activeEnvKey, currentEnvConfig.username);
          return;
        }
      }
    }

    // 2. 2nd Factor OTP Step
    const otpField = document.querySelector(
      'input[name="otp"], input[id*="otp"], input[placeholder*="OTP"], input[placeholder*="인증번호"]'
    );

    if (otpField && currentEnvConfig.otpSecret) {
      createOrUpdateBanner('2차 인증 OTP 생성 중...', 'info');
      await sleep(200);

      const code = await globalThis.generateTotp(currentEnvConfig.otpSecret);

      if (code) {
        createOrUpdateBanner(`OTP 자동 입력 중 (${code})...`, 'info');
        otpField.focus();
        setNativeValue(otpField, code);
        await sleep(250);

        if (currentGlobalConfig.autoSubmit) {
          const confirmBtn =
            document.querySelector('button[type="submit"]') ||
            Array.from(document.querySelectorAll('button, a')).find(
              (el) =>
                el.textContent.trim() === '확인' ||
                el.textContent.trim() === '인증' ||
                el.textContent.trim() === '로그인'
            );

          if (confirmBtn) {
            confirmBtn.click();
            createOrUpdateBanner('OTP 인증 요청 완료', 'success');
            await recordSuccessfulLogin(activeEnvKey, currentEnvConfig.username);
          }
        }
      } else {
        createOrUpdateBanner('OTP 생성 실패: Secret 키를 확인하세요.', 'error');
      }
    }
  }

  // =========================================================================
  // PIPELINE 3: CONFIGURED MULTI-PAGE LOGIN
  //
  // A login that is a sequence of pages — a sign-in page, a credential page, a
  // second factor — is described by the server it belongs to, not by this file.
  // Each step says how to recognise its page (a button's words, or a selector) and
  // which of three things to do there: press it, type the account, type the code.
  // Nothing here names a site, a button or a field: that is the configuration's
  // job, which is what lets this script be published.
  //
  //   loginSteps: [{ id, find: { label, selector }, action, once, submit }]
  //   loginErrorSelector: where the page puts what went wrong
  // =========================================================================

  function ssoVisible(el) {
    return !!el && el.type !== 'hidden' && (el.offsetParent !== null || el.getClientRects().length > 0);
  }

  // The first field a user would actually see, not the first one in the markup.
  function ssoField(selectors) {
    for (const selector of [].concat(selectors || [])) {
      for (const el of document.querySelectorAll(selector)) {
        if (ssoVisible(el)) return el;
      }
    }
    return null;
  }

  // A real button before a link: a page's own guidance text can carry the same words.
  function findSsoButtonByLabel(pattern) {
    const clickable = [
      ...document.querySelectorAll('button, input[type="submit"], input[type="button"]'),
      ...document.querySelectorAll('a'),
    ];
    return clickable.find((el) => ssoVisible(el) && pattern.test((el.textContent || el.value || '').trim())) || null;
  }

  function ssoPattern(source) {
    try {
      return source ? new RegExp(source) : null;
    } catch (_) {
      return null;
    }
  }

  // What the page says went wrong last time. Re-posting a form that came back with
  // an error is how an account gets locked out, so it ends the run instead. These
  // pages ship an empty error element on every load; only text in one counts.
  function ssoErrorMessage() {
    const selector = currentEnvConfig.loginErrorSelector;
    if (!selector) return '';
    for (const el of document.querySelectorAll(selector)) {
      const text = (el.textContent || '').trim();
      if (text && ssoVisible(el)) return text;
    }
    return '';
  }

  function findStepAnchor(step) {
    const find = step?.find || {};
    const pattern = ssoPattern(find.label);
    return (pattern && findSsoButtonByLabel(pattern)) || ssoField(find.selector);
  }

  function findStepButton(submit) {
    if (!submit) return null;
    return ssoField(submit.selector) || (ssoPattern(submit.label) ? findSsoButtonByLabel(ssoPattern(submit.label)) : null);
  }

  // A step that must not run twice in one tab — pressing a button that leads
  // somewhere, where pressing it again would lead back.
  function stepDone(step) {
    try {
      return sessionStorage.getItem(`awaLoginStep:${step.id}`) === '1';
    } catch (_) {
      return false;
    }
  }

  function markStepDone(step) {
    try {
      sessionStorage.setItem(`awaLoginStep:${step.id}`, '1');
    } catch (_) {}
  }

  // Press it, and let the page it leads to be the next step.
  async function runClickStep(step, anchor) {
    if (step.once && stepDone(step)) {
      createOrUpdateBanner(step.blocked || '다음 단계 버튼을 눌러주세요.', 'info');
      return;
    }
    if (step.once) markStepDone(step);
    createOrUpdateBanner(step.waiting || '다음 단계로 이동...', 'info');
    anchor.click();
  }

  // The anchor is the visible password field; the ID is the visible text field of
  // its own form, which is what it is on screen even where neither carries a name.
  async function runCredentialsStep(step, pwField) {
    const scope = pwField.form || document;
    const idField = [...scope.querySelectorAll('input[type="text"], input:not([type])')].find(ssoVisible);
    if (!idField) return;

    if (!currentEnvConfig.username || !currentEnvConfig.password) {
      idField.focus();
      createOrUpdateBanner('팝업에서 ID와 비밀번호를 먼저 저장하세요.', 'error');
      return;
    }

    createOrUpdateBanner(`[${currentEnvConfig.name || activeEnvKey}] ID/비밀번호 자동 입력 시작...`, 'info');
    idField.focus();
    setNativeValue(idField, currentEnvConfig.username);
    await sleep(200);
    // These forms have no 가상 키패드; probing for one would stall for five seconds
    // and then do exactly this.
    pwField.focus();
    setNativeValue(pwField, currentEnvConfig.password);
    await sleep(300);

    if (!currentGlobalConfig.autoSubmit) return;
    const submitBtn = findStepButton(step.submit);
    if (submitBtn) {
      createOrUpdateBanner('로그인 버튼 자동 클릭!', 'success');
      submitBtn.click();
    }
  }

  async function runOtpStep(step, otpField) {
    const code = currentEnvConfig.otpSecret ? await globalThis.generateTotp(currentEnvConfig.otpSecret) : '';
    if (!code) {
      otpField.focus();
      createOrUpdateBanner('OTP Secret이 없습니다. 인증번호를 직접 입력하세요.', 'error');
      return;
    }

    createOrUpdateBanner(`OTP 자동 입력 중 (${code})...`, 'info');
    otpField.focus();
    setNativeValue(otpField, code);
    await sleep(250);

    if (!currentGlobalConfig.autoSubmit) return;
    const confirmBtn = findStepButton(step.submit);
    if (confirmBtn) {
      confirmBtn.click();
      createOrUpdateBanner('OTP 인증 요청 완료', 'success');
      await recordSuccessfulLogin(activeEnvKey, currentEnvConfig.username);
    }
  }

  const STEP_ACTIONS = {
    click: runClickStep,
    credentials: runCredentialsStep,
    otp: runOtpStep,
  };

  // Which step this page is, by what it holds. Configured order is precedence: the
  // page that offers the sign-in button also has a login form of its own, and the
  // button is what settles it. Client-rendered pages are empty at first, so this
  // keeps looking for a while before giving up.
  async function waitForLoginStep(steps) {
    for (let attempt = 0; attempt < 40; attempt++) {
      for (const step of steps) {
        if (!STEP_ACTIONS[step.action]) continue;
        const anchor = findStepAnchor(step);
        if (anchor) return { step, anchor };
      }
      await sleep(250);
    }
    return null;
  }

  async function runConfiguredLoginPipeline() {
    const steps = currentEnvConfig.loginSteps;
    if (!Array.isArray(steps) || !steps.length) {
      console.log('[AWA Auto-Login] 이 서버에는 로그인 단계가 설정되어 있지 않습니다.', activeEnvKey);
      return;
    }

    const found = await waitForLoginStep(steps);
    if (!found) {
      console.log('[AWA Auto-Login] 로그인 요소를 찾지 못했습니다.', window.location.href);
      return;
    }

    const failure = ssoErrorMessage();
    if (failure) {
      createOrUpdateBanner(`로그인 오류: ${failure} — 자동 입력을 중단합니다.`, 'error');
      return;
    }

    console.log(`[AWA Auto-Login] 로그인 단계: ${found.step.id}`, window.location.href);
    await STEP_ACTIONS[found.step.action](found.step, found.anchor);
  }

  // =========================================================================
  // MAIN ROUTER
  // =========================================================================
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

  async function performLogin() {
    if (isRunning) return;
    isRunning = true;
    runningVersion = controlVersion;
    setAutoLoginActive(true);

    try {
      await reloadConfig();
      if (runningVersion !== controlVersion) return;

      syncObserver();
      if (!activeEnvKey) {
        console.log('[AWA Auto-Login] 이 주소로 설정된 서버가 없습니다.', window.location.host);
        return;
      }
      if (pageSuspended || document.hidden || !masterEnabled || currentEnvConfig.enabled === false) {
        console.log(`[AWA Auto-Login] ${activeEnvKey} 자동 로그인이 비활성화되어 있습니다.`);
        return;
      }

      if (isMobileEnvironment()) {
        await runMobilePinPipeline();
      } else if (Array.isArray(currentEnvConfig.loginSteps) && currentEnvConfig.loginSteps.length) {
        await runConfiguredLoginPipeline();
      } else {
        await runWebLoginPipeline();
      }
    } catch (error) {
      if (error.cancelled) return;
      console.error('[AWA Auto-Login] Error:', error);
      createOrUpdateBanner(`오류 발생: ${error.message}`, 'error');
    } finally {
      isRunning = false;
      setAutoLoginActive(false);
      if (masterEnabled && currentEnvConfig.enabled !== false && !pageSuspended && !document.hidden && runningVersion !== controlVersion) setTimeout(performLogin, 0);
    }
  }

  // --- Observer & Trigger Setup ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TRIGGER_LOGIN') {
      reloadConfig().then(() => {
        if (request.targetEnvKey) {
          activeEnvKey = request.targetEnvKey;
        }
        return performLogin();
      }).then(() => sendResponse({ success: true, status: 'started' }));
      return true;
    }
    if (request.action === 'SETTINGS_UPDATED') {
      reloadConfig();
    }
  });

  // Client-side SPA navigation hooks for mobile
  const fireLocationChange = () => {
    if (document.body) delete document.body.dataset.pinLoginExecuted;
    setTimeout(performLogin, 350);
  };

  try {
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      fireLocationChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      fireLocationChange();
    };
  } catch (e) {}

  window.addEventListener('popstate', fireLocationChange);
  window.addEventListener('hashchange', fireLocationChange);

  const observer = new MutationObserver(() => {
    if (isRunning || document.hidden || !masterEnabled || currentEnvConfig.enabled === false) return;

    if (isMobileEnvironment()) {
      const isPinPage =
        window.location.pathname.includes('/pin/login') ||
        window.location.href.includes('/pin/login') ||
        window.location.hash.includes('/pin/login');

      if (isPinPage) {
        if (document.body && !document.body.dataset.pinLoginExecuted) {
          const pinTrigger = document.querySelector(
            '[aria-label="1"], [data-key="1"], [data-value="1"], div[class*="keypad"], div[class*="numpad"], div[class*="pin"], input[type="password"]'
          );
          if (pinTrigger) {
            document.body.dataset.pinLoginExecuted = 'true';
            performLogin();
          }
        }
      }
    } else {
      const loginField = document.querySelector(
        'input[name="loginId"], input[name="userId"], input[placeholder*="아이디"], input[placeholder*="사용자"], input[placeholder*="OTP"]'
      );
      if (loginField && !loginField.dataset.autologinDetected) {
        loginField.dataset.autologinDetected = 'true';
        performLogin();
      }
    }
  });

  function syncObserver() {
    observer.disconnect();
    if (document.body && !pageSuspended && !document.hidden && masterEnabled && currentEnvConfig.enabled !== false) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) controlVersion++;
    syncObserver();
    if (!document.hidden) performLogin();
  });
  window.addEventListener('pagehide', () => {
    pageSuspended = true;
    controlVersion++;
    observer.disconnect();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      pageSuspended = false;
      syncObserver();
      performLogin();
    }
  });
  if (document.body) performLogin();
  else document.addEventListener('DOMContentLoaded', performLogin, { once: true });
})();
