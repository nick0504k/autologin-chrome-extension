/**
 * Flow Runner & Test Recorder Content Script
 * 1. Executes automated E2E test steps on the active webpage
 * 2. Provides live visual feedback and highlights
 * 3. Records user clicks, inputs, and navigations into executable test flows
 */
(function () {
  'use strict';

  // Prevent duplicate runner instances
  if (window.__AwaFlowRunnerActive) return;
  window.__AwaFlowRunnerActive = true;

  const STATUS_PILL_ID = '__awa_test_status_pill';
  const RECORD_BADGE_ID = '__awa_record_badge';
  let activeHighlightEl = null;
  let isFlowAborted = false;

  // Recording State
  let isRecording = false;
  let recordedSteps = [];
  let patternWatch = true;
  let activityListenersOn = false;
  const patternVisitId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let patternSawUserAction = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Extract compact interactive DOM context for AI prompt / inspection */
  function extractPageContext() {
    const elements = [];
    const seen = new Set();

    const candidates = document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [role="tab"], [role="dialog"], h1, h2, h3, .modal-title, th'
    );

    for (const el of candidates) {
      if (elements.length >= 60) break;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const tag = el.tagName.toLowerCase();
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      const id = el.id ? `#${el.id}` : '';
      const name = el.getAttribute('name') ? `[name='${el.getAttribute('name')}']` : '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const role = el.getAttribute('role') || '';

      let selector = '';
      if (id) selector = id;
      else if (name) selector = `${tag}${name}`;
      else if (ariaLabel) selector = `[aria-label='${ariaLabel}']`;
      else if (placeholder) selector = `[placeholder='${placeholder}']`;
      else if (el.className && typeof el.className === 'string') {
        const primaryClass = el.className.split(' ').filter(c => c && !c.includes('active') && !c.includes('hover'))[0];
        if (primaryClass) selector = `${tag}.${primaryClass}`;
      }
      if (!selector) selector = tag;

      const key = `${tag}:${selector}:${text}:${placeholder}`;
      if (seen.has(key)) continue;
      seen.add(key);

      elements.push({
        tag,
        selector,
        text: text || undefined,
        ariaLabel: ariaLabel || undefined,
        placeholder: placeholder || undefined,
        role: role || undefined
      });
    }

    return {
      url: window.location.href,
      hash: window.location.hash,
      title: document.title,
      interactiveElements: elements
    };
  }

  /** Smart element finder supporting CSS, text search, aria-labels */
  function findElement(selector, textFilter) {
    if (!selector && !textFilter) return null;

    if (selector) {
      try {
        const cleaned = selector.replace(/:has-text\([^)]+\)/g, '').trim();
        if (cleaned) {
          const matched = document.querySelectorAll(cleaned);
          if (matched.length === 1 && !textFilter) return matched[0];
          if (matched.length > 0) {
            for (const el of matched) {
              if (textFilter && !(el.textContent || '').includes(textFilter)) continue;
              if (isElementVisible(el)) return el;
            }
            return matched[0];
          }
        }
      } catch {}
    }

    if (textFilter) {
      const candidates = document.querySelectorAll('button, a, span, label, [role="button"], td, th, div');
      for (const el of candidates) {
        if ((el.innerText || el.textContent || '').trim() === textFilter && isElementVisible(el)) {
          return el;
        }
      }
      for (const el of candidates) {
        if ((el.innerText || el.textContent || '').includes(textFilter) && isElementVisible(el)) {
          return el;
        }
      }
    }

    if (selector) {
      const placeholderMatch = document.querySelector(`[placeholder*="${selector}"]`);
      if (placeholderMatch) return placeholderMatch;
    }

    return null;
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** Highlight active element temporarily during step execution */
  function highlightElement(el) {
    clearHighlight();
    if (!el || !el.style) return;
    activeHighlightEl = el;
    el.dataset.awaPrevOutline = el.style.outline || '';
    el.style.outline = '3px solid #3b82f6';
    el.style.outlineOffset = '2px';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  function clearHighlight() {
    if (activeHighlightEl) {
      activeHighlightEl.style.outline = activeHighlightEl.dataset.awaPrevOutline || '';
      delete activeHighlightEl.dataset.awaPrevOutline;
      activeHighlightEl = null;
    }
  }

  /** Floating Status Pill on target page */
  function showStatusPill(text, type = 'running') {
    let pill = document.getElementById(STATUS_PILL_ID);
    if (!pill) {
      pill = document.createElement('div');
      pill.id = STATUS_PILL_ID;
      pill.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: rgba(15, 23, 42, 0.94);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        pointer-events: none;
        transition: all 0.2s ease-in-out;
      `;
      document.body.appendChild(pill);
    }
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚡';
    pill.innerHTML = `<span>${icon}</span> <span>${text}</span>`;

    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        hideStatusPill();
      }, 3500);
    }
  }

  function hideStatusPill() {
    const pill = document.getElementById(STATUS_PILL_ID);
    if (pill) pill.remove();
  }

  /** Set input value via native prototype setter to trigger React/Vue binders */
  function setNativeInputValue(el, value) {
    el.focus();
    const isTextarea = el.tagName && el.tagName.toLowerCase() === 'textarea';
    const proto = isTextarea ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
    const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  /** Execute a single test step */
  async function executeStep(step) {
    try {
      if (isFlowAborted) throw new Error('사용자에 의해 테스트가 중단되었습니다.');
      const action = (step.action || '').toLowerCase();
      const desc = step.description || `${action} ${step.selector || step.url || ''}`;
      showStatusPill(desc, 'running');

      if (action === 'navigate') {
        const url = step.url || step.target || step.value;
        if (!url) throw new Error('navigate 액션에 URL이 필요합니다.');
        if (url.startsWith('#')) {
          window.location.hash = url;
        } else if (url.startsWith('/#')) {
          window.location.hash = url.substring(1);
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          window.location.href = url;
        } else {
          window.location.hash = `#${url.replace(/^\/+/, '')}`;
        }
        await sleep(step.ms || 600);
        return { success: true };
      }

      if (action === 'sleep') {
        await sleep(step.ms || 1000);
        return { success: true };
      }

      if (action === 'waitfor') {
        const timeout = step.timeout || 6000;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          const el = findElement(step.selector, step.text);
          if (el && isElementVisible(el)) {
            highlightElement(el);
            await sleep(200);
            return { success: true };
          }
          await sleep(250);
        }
        throw new Error(`요소를 찾지 못했습니다 (${timeout}ms 타임아웃): ${step.selector || step.text}`);
      }

      if (action === 'click') {
        let el = findElement(step.selector, step.text);
        if (!el) {
          const startTime = Date.now();
          while (Date.now() - startTime < 1800) {
            if (isFlowAborted) throw new Error('사용자에 의해 테스트가 중단되었습니다.');
            await sleep(150);
            el = findElement(step.selector, step.text);
            if (el) break;
          }
        }
        if (!el) throw new Error(`클릭할 요소를 찾을 수 없습니다: ${step.selector || step.text}`);

        highlightElement(el);
        await sleep(150);
        el.focus?.();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.click();
        await sleep(step.ms || 400);
        return { success: true };
      }

      if (action === 'fill') {
        let el = findElement(step.selector);
        if (!el) {
          const startTime = Date.now();
          while (Date.now() - startTime < 1800) {
            if (isFlowAborted) throw new Error('사용자에 의해 테스트가 중단되었습니다.');
            await sleep(150);
            el = findElement(step.selector);
            if (el) break;
          }
        }
        if (!el) throw new Error(`입력 필드를 찾을 수 없습니다: ${step.selector}`);

        highlightElement(el);
        await sleep(100);
        setNativeInputValue(el, step.value || '');
        await sleep(step.ms || 250);
        return { success: true };
      }

      if (action === 'assertvisible') {
        const el = findElement(step.selector, step.text);
        if (!el || !isElementVisible(el)) {
          throw new Error(`요소가 화면에 표시되지 않습니다: ${step.selector || step.text}`);
        }
        highlightElement(el);
        await sleep(200);
        return { success: true };
      }

      if (action === 'asserttext') {
        const el = findElement(step.selector);
        if (!el) throw new Error(`텍스트를 검증할 요소를 찾을 수 없습니다: ${step.selector}`);
        const actual = (el.innerText || el.textContent || '').trim();
        const expected = (step.expected || step.text || '').trim();
        if (!actual.includes(expected)) {
          throw new Error(`텍스트 불일치: 예상="${expected}", 실제="${actual}"`);
        }
        highlightElement(el);
        await sleep(200);
        return { success: true };
      }

      throw new Error(`지원하지 않는 테스트 액션: ${action}`);
    } catch (err) {
      showStatusPill(err.message, 'error');
      return { success: false, error: err.message };
    }
  }

  // ==========================================
  // E2E User Action Recorder Engine
  // ==========================================

  function computeBestSelector(el) {
    if (!el || !el.tagName) return '';
    const tag = el.tagName.toLowerCase();

    // 1. Element ID
    if (el.id && !el.id.startsWith('__awa_') && el.id.length < 50 && !/^[0-9a-f-]{10,}$/i.test(el.id)) {
      try {
        const matches = document.querySelectorAll('#' + CSS.escape(el.id));
        if (matches.length <= 1) {
          return '#' + CSS.escape(el.id);
        }
      } catch (_) {
        return '#' + CSS.escape(el.id);
      }
    }

    // 2. data-testid
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) return `[data-testid="${testId}"]`;

    // 3. Name attribute
    const name = el.getAttribute('name');
    if (name) {
      const sel = `${tag}[name="${name}"]`;
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch (_) {}
    }

    // 4. aria-label or placeholder
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const sel = `${tag}[aria-label="${ariaLabel}"]`;
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch (_) {}
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) {
      const sel = `${tag}[placeholder="${placeholder}"]`;
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch (_) {}
    }

    // 5. Meaningful CSS class
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\s+/).filter(c =>
        c && !c.includes('active') && !c.includes('hover') && !c.includes('focus') &&
        !c.includes('selected') && !c.includes('disabled') && !c.startsWith('awa-') &&
        !c.startsWith('v-') && !c.startsWith('ng-')
      );
      for (const cls of classes) {
        try {
          const sel = `${tag}.${CSS.escape(cls)}`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch (_) {}
      }
      if (classes.length > 1) {
        try {
          const sel = `${tag}.${classes.slice(0, 2).map(c => CSS.escape(c)).join('.')}`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch (_) {}
      }
    }

    // 6. Parent context
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const pTag = parent.tagName.toLowerCase();
      if (parent.id && !parent.id.startsWith('__awa_')) {
        return `#${CSS.escape(parent.id)} > ${tag}`;
      }
    }

    return tag;
  }

  function updateRecordBadge() {
    let badge = document.getElementById(RECORD_BADGE_ID);
    if (!badge) {
      badge = document.createElement('div');
      badge.id = RECORD_BADGE_ID;
      badge.style.cssText = `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 18px;
        background: rgba(220, 38, 38, 0.95);
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        border-radius: 9999px;
        box-shadow: 0 4px 20px rgba(220, 38, 38, 0.4);
        pointer-events: none;
        letter-spacing: -0.2px;
        animation: awa-fade 0.2s ease-in-out;
      `;
      document.body.appendChild(badge);
    }
    badge.innerHTML = `<span>🔴 E2E 기록 중:</span> <span><b>${recordedSteps.length}</b>개 동작 감지</span>`;
  }

  function removeRecordBadge() {
    const badge = document.getElementById(RECORD_BADGE_ID);
    if (badge) badge.remove();
  }

  function fieldIsSecret(target) {
    const type = String(target.type || '').toLowerCase();
    const blob = [
      target.id,
      target.name,
      target.placeholder,
      target.getAttribute?.('aria-label'),
      target.getAttribute?.('autocomplete'),
    ].join(' ').toLowerCase();
    return type === 'password' || /password|passwd|otp|\bpin\b|secret|\bpwd\b/.test(blob);
  }

  function drivenByAutoLogin(event) {
    const root = document.documentElement;
    if (root && root.dataset && root.dataset.awaAutoLogin) return true;
    return Boolean(event && event.isTrusted === false);
  }

  function enqueuePattern(step) {
    if (!patternWatch || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({
      action: 'PATTERN_NOTE',
      event: {
        host: String(window.location.host || '').toLowerCase(),
        at: Date.now(),
        pageUrl: window.location.href,
        visitId: patternVisitId,
        step,
      },
    }, () => {
      void chrome.runtime.lastError;
    });
  }

  function syncActivityListeners() {
    if (!document.addEventListener || !window.addEventListener) return;
    const need = isRecording || patternWatch;
    if (need === activityListenersOn) return;
    const method = need ? 'addEventListener' : 'removeEventListener';
    document[method]('click', onRecordClick, true);
    document[method]('input', onRecordInput, true);
    document[method]('change', onRecordInput, true);
    window[method]('hashchange', onRecordLocationChange);
    window[method]('popstate', onRecordLocationChange);
    activityListenersOn = need;
  }

  function onRecordClick(e) {
    if (!isRecording && !patternWatch) return;
    const target = e.target;
    if (!target || target.closest?.('#' + STATUS_PILL_ID) || target.closest?.('#' + RECORD_BADGE_ID)) return;

    const selector = computeBestSelector(target);
    const text = (target.innerText || target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const desc = text ? `클릭: "${text}"` : `클릭: ${selector}`;
    const step = {
      action: 'click',
      selector,
      text: text || undefined,
      description: desc
    };

    if (isRecording) {
      recordedSteps.push(step);
      updateRecordBadge();
    }
    if (patternWatch && !drivenByAutoLogin(e)) {
      patternSawUserAction = true;
      const patternTarget = target.closest?.('button, a, input, textarea, select, [role="button"], [role="tab"]') || target;
      const patternSelector = computeBestSelector(patternTarget);
      const patternText = (patternTarget.innerText || patternTarget.textContent || target.innerText || target.textContent || '')
        .trim().replace(/\s+/g, ' ').slice(0, 30);
      enqueuePattern({
        action: 'click',
        selector: patternSelector,
        text: patternText || undefined,
        description: patternText ? `클릭: "${patternText}"` : `클릭: ${patternSelector}`
      });
    }
  }

  function onRecordInput(e) {
    if (!isRecording && !patternWatch) return;
    const target = e.target;
    if (!target || target.closest?.('#' + STATUS_PILL_ID) || target.closest?.('#' + RECORD_BADGE_ID)) return;
    const tag = (target.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    if (target.type === 'hidden') return;

    const selector = computeBestSelector(target);
    const secret = fieldIsSecret(target);
    const val = secret ? '' : target.value;
    const desc = secret ? '입력: (숨김)' : `입력: "${val}"`;
    const step = {
      action: 'fill',
      selector,
      value: val,
      inputType: target.type || '',
      name: target.name || '',
      secret,
      description: desc
    };

    if (isRecording) {
      if (recordedSteps.length > 0 && recordedSteps[recordedSteps.length - 1].action === 'fill' && recordedSteps[recordedSteps.length - 1].selector === selector) {
        recordedSteps[recordedSteps.length - 1].value = target.value;
        recordedSteps[recordedSteps.length - 1].description = `입력: "${target.value}"`;
      } else {
        recordedSteps.push({
          action: 'fill',
          selector,
          value: target.value,
          description: `입력: "${target.value}"`
        });
      }
      updateRecordBadge();
    }
    if (patternWatch && !drivenByAutoLogin(e)) {
      patternSawUserAction = true;
      enqueuePattern(step);
    }
  }

  function onRecordLocationChange() {
    if (!isRecording && !patternWatch) return;
    const target = window.location.hash || window.location.pathname;
    if (!target || target === '#' || target === '#/') return;
    const step = {
      action: 'navigate',
      target,
      description: `화면 이동: ${target}`
    };
    if (isRecording) {
      const prev = recordedSteps[recordedSteps.length - 1];
      if (!(prev && prev.action === 'navigate' && prev.target === target)) {
        recordedSteps.push(step);
        updateRecordBadge();
      }
    }
    if (patternWatch && patternSawUserAction && !drivenByAutoLogin()) enqueuePattern(step);
  }

  function startRecording() {
    isRecording = true;
    recordedSteps = [];

    // Capture initial route
    const hash = window.location.hash;
    if (hash && hash !== '#/' && hash !== '#') {
      recordedSteps.push({
        action: 'navigate',
        target: hash,
        description: `초기 화면 이동: ${hash}`
      });
    }

    syncActivityListeners();
    updateRecordBadge();
    return { success: true, count: recordedSteps.length };
  }

  function stopRecording() {
    isRecording = false;
    syncActivityListeners();
    removeRecordBadge();
    return { success: true, steps: recordedSteps, count: recordedSteps.length };
  }

  function loadPatternWatch() {
    syncActivityListeners();
    if (!chrome.storage?.local?.get || !chrome.storage?.onChanged?.addListener) return;
    chrome.storage.local.get(['patternWatchEnabled'], (res) => {
      const api = globalThis.PatternSuggest;
      patternWatch = api
        ? api.watchEnabled(res?.patternWatchEnabled)
        : res?.patternWatchEnabled !== false;
      syncActivityListeners();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.patternWatchEnabled) return;
      const api = globalThis.PatternSuggest;
      patternWatch = api
        ? api.watchEnabled(changes.patternWatchEnabled.newValue)
        : changes.patternWatchEnabled.newValue !== false;
      syncActivityListeners();
    });
  }

  // --- Runtime Message Listener from Extension ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PAGE_CONTEXT') {
      try {
        const ctx = extractPageContext();
        sendResponse({ success: true, context: ctx });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (request.action === 'EXECUTE_TEST_STEP') {
      if (request.index === 0) isFlowAborted = false;
      executeStep(request.step)
        .then((res) => sendResponse(res))
        .catch((err) => {
          showStatusPill(err.message, 'error');
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    if (request.action === 'TEST_FLOW_FINISHED') {
      if (request.status === 'success') {
        showStatusPill('테스트 완료 (모든 스텝 성공)', 'success');
      } else {
        showStatusPill(`테스트 실패: ${request.error || ''}`, 'error');
      }
      clearHighlight();
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'CANCEL_TEST_FLOW') {
      isFlowAborted = true;
      hideStatusPill();
      clearHighlight();
      sendResponse({ success: true });
      return true;
    }

    // Recorder Actions
    if (request.action === 'START_RECORDING') {
      const res = startRecording();
      sendResponse(res);
      return true;
    }

    if (request.action === 'STOP_RECORDING') {
      const res = stopRecording();
      sendResponse(res);
      return true;
    }

    if (request.action === 'GET_RECORDING_STATUS') {
      sendResponse({ isRecording, count: recordedSteps.length });
      return true;
    }
  });

  loadPatternWatch();

  if (typeof window !== 'undefined') {
    window.__awaFlowRunner = {
      extractPageContext,
      executeStep,
      showStatusPill,
      hideStatusPill,
      startRecording,
      stopRecording
    };
  }
})();
