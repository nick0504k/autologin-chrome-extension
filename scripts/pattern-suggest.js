/**
 * Repeat detector for one-click scenarios.
 * Keeps a short per-host action log. A similar pattern that shows up three
 * times is appended to the suggestion list and left there. Other actions may
 * sit between passes. A generated id or a different row label does not make
 * it a new pattern.
 */
(function (root) {
  'use strict';

  const REPEAT = 3;
  const GAP_MS = 20000;
  const MAX_ACTIONS = 180;
  const MIN_STEPS = 2;
  const MAX_BLOCK = 20;
  const MAX_SUGGESTIONS = 100;
  const FILL_COALESCE_MS = 5000;

  function emptyState() {
    return { hosts: {}, suggestions: [] };
  }

  function watchEnabled(stored) {
    return stored !== false;
  }

  function normalizeToken(value) {
    return String(value || '').replace(/_\d{3,}/g, '');
  }

  function isKeypadStep(step) {
    if (!step || step.action !== 'click') return false;
    if (step.keypad) return true;
    const match = String(step.selector || '').match(/^a\[aria-label="([^"]*)"\]$/);
    return Boolean(match && Array.from(match[1]).length === 1);
  }

  function isInstanceSelector(selector) {
    return /^(td|tr|li|option)$/i.test(selector);
  }

  function isAutomatedLogin(action) {
    const step = action.step || {};
    if (isKeypadStep(step)) return true;
    const url = String(action.startUrl || '');
    if (/\/login(?:[/?#]|$)|\/otp(?:[/?#]|$)|\/pin\/login/i.test(url)) return true;
    const blob = `${step.selector || ''} ${step.description || ''} ${step.target || ''}`;
    return /layerpwd|비밀번호를 입력|OTP 번호|아이디를 입력|입력완료/.test(blob);
  }

  function suggestionFromLogin(item) {
    if (isAutomatedLogin({ startUrl: item.startUrl || '', step: {} })) return true;
    if ((item.steps || []).some((step) => isAutomatedLogin({ startUrl: item.startUrl || '', step }))) return true;
    return /click\|keypad|layerpwd|비밀번호를 입력|OTP 번호|아이디를 입력|입력완료/.test(item.signature || '');
  }

  function signatureOf(step) {
    if (isKeypadStep(step)) return 'click|keypad';
    const action = step.action || '';
    if (action === 'navigate') return `navigate|${normalizeToken(step.target || step.url || '')}`;
    const selector = normalizeToken(step.selector || '');
    if (action === 'fill') return `fill|${selector}`;
    const text = !isInstanceSelector(selector) && step.text
      ? String(step.text).trim().slice(0, 30)
      : '';
    return text ? `${action}|${selector}|${text}` : `${action}|${selector}`;
  }

  function signatureOfSteps(steps) {
    return steps.map(signatureOf).join('\n');
  }

  function isSecret(step) {
    if (step.secret) return true;
    if (String(step.inputType || '').toLowerCase() === 'password') return true;
    const blob = `${step.selector || ''} ${step.inputType || ''} ${step.name || ''}`.toLowerCase();
    return /password|passwd|otp|\bpin\b|secret|\bpwd\b/.test(blob);
  }

  function storedStep(step) {
    if (isKeypadStep(step)) {
      return { action: 'click', description: '키패드 입력', keypad: true };
    }
    const out = { action: step.action };
    if (step.selector) out.selector = step.selector;
    if (step.target) out.target = step.target;
    if (step.url) out.url = step.url;
    if (step.text) out.text = String(step.text).slice(0, 30);
    if (step.action === 'fill') {
      if (isSecret(step)) {
        out.value = '';
        out.secret = true;
        out.description = '입력: (숨김)';
      } else {
        out.value = step.value == null ? '' : String(step.value).slice(0, 80);
        out.description = `입력: "${out.value}"`;
      }
    } else if (step.description) {
      out.description = String(step.description).slice(0, 80);
    }
    return out;
  }

  function labelFor(steps) {
    const named = steps.find((s) => s.action === 'click' && s.text && !isInstanceSelector(s.selector || ''));
    if (named) return `${named.text} · ${steps.length}단계`;
    return `반복 동작 ${steps.length}단계`;
  }

  function suggestionStep(step) {
    const out = storedStep(step);
    if (isInstanceSelector(out.selector || '')) {
      delete out.text;
      out.description = '클릭: 목록 항목';
    }
    return out;
  }

  function sharedRun(longer, shorter) {
    const hay = longer.split('\n');
    const needle = shorter.split('\n');
    let best = 0;
    for (let i = 0; i < hay.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        let k = 0;
        while (hay[i + k] && needle[j + k] && hay[i + k] === needle[j + k]) k += 1;
        if (k > best) best = k;
      }
    }
    return best;
  }

  function nearDuplicate(signature, count, otherSignature, otherCount) {
    const left = signature.split('\n').length;
    const right = otherSignature.split('\n').length;
    if (Math.abs(left - right) > 2) return false;
    if (Math.abs(count - otherCount) > 1) return false;
    const run = sharedRun(signature, otherSignature);
    return run >= MIN_STEPS && run >= Math.min(left, right) - 2;
  }

  function containsSequence(longer, shorter) {
    const hay = longer.split('\n');
    const needle = shorter.split('\n');
    if (needle.length >= hay.length) return false;
    for (let i = 0; i + needle.length <= hay.length; i++) {
      let same = true;
      for (let j = 0; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) {
          same = false;
          break;
        }
      }
      if (same) return true;
    }
    return false;
  }

  function contiguous(actions, start, len) {
    for (let i = start; i < start + len - 1; i++) {
      if ((actions[i + 1].at || 0) - (actions[i].at || 0) > GAP_MS) return false;
    }
    return true;
  }

  function similarRepeats(actions) {
    const sigs = actions.map((action) => signatureOf(action.step));
    const grouped = new Map();
    const n = sigs.length;
    for (let len = MIN_STEPS; len <= MAX_BLOCK; len++) {
      for (let i = 0; i + len <= n; i++) {
        if (!contiguous(actions, i, len)) continue;
        const signature = sigs.slice(i, i + len).join('\n');
        let found = grouped.get(signature);
        if (!found) {
          found = { signature, len, starts: [] };
          grouped.set(signature, found);
        }
        found.starts.push(i);
      }
    }

    const ranked = [];
    for (const found of grouped.values()) {
      const starts = [];
      let next = -1;
      for (const start of found.starts) {
        if (start < next) continue;
        starts.push(start);
        next = start + found.len;
      }
      if (starts.length < REPEAT) continue;
      if (actions.slice(starts[0], starts[0] + found.len).every((action) => isKeypadStep(action.step))) continue;
      let boundaries = 0;
      for (const start of starts) {
        const fresh = start === 0 || (actions[start].at || 0) - (actions[start - 1].at || 0) > GAP_MS;
        if (fresh) boundaries += 1;
      }
      const last = starts[starts.length - 1];
      ranked.push({
        signature: found.signature,
        len: found.len,
        count: starts.length,
        boundaries,
        starts,
        steps: actions.slice(last, last + found.len).map((action) => action.step),
        startUrl: actions[last].startUrl || '',
      });
    }
    ranked.sort((a, b) => b.len - a.len || b.boundaries - a.boundaries || b.count - a.count);

    const accepted = [];
    const covered = new Set();
    for (const candidate of ranked) {
      const pieceOfKept = accepted.some((kept) => (
        containsSequence(kept.signature, candidate.signature) && candidate.count <= kept.count
      ));
      if (pieceOfKept) continue;
      let slots = 0;
      let fresh = 0;
      for (const start of candidate.starts) {
        for (let i = start; i < start + candidate.len; i++) {
          slots += 1;
          if (!covered.has(i)) fresh += 1;
        }
      }
      if (slots && fresh / slots < 0.5) continue;
      for (const start of candidate.starts) {
        for (let i = start; i < start + candidate.len; i++) covered.add(i);
      }
      accepted.push(candidate);
    }
    return accepted;
  }

  function observe(state, event) {
    const base = state && typeof state === 'object' ? state : emptyState();
    const hosts = { ...(base.hosts || {}) };
    let suggestions = Array.isArray(base.suggestions) ? base.suggestions.slice() : [];
    const host = String(event.host || '').toLowerCase();
    if (!host || !event.step || !event.step.action) {
      return { state: { hosts, suggestions }, suggestion: null };
    }

    const step = storedStep(event.step);
    const existing = (hosts[host] && hosts[host].actions) || [];
    const last = existing[existing.length - 1];
    const at = event.at || 0;

    const sameVisit = !event.visitId || !last?.visitId || last.visitId === event.visitId;

    // A reload is not a step, and it is not always the first one. Drop it wherever it sits.
    if (step.action === 'navigate' && String(step.description || '').startsWith('페이지 새로고침')) {
      return { state: { hosts, suggestions }, suggestion: null };
    }

    if (sameVisit && step.action === 'navigate' && last && last.step.action === 'navigate' && last.step.target === step.target) {
      return { state: { hosts, suggestions }, suggestion: null };
    }

    const noted = { at, startUrl: event.pageUrl || '', visitId: event.visitId || '', step };
    let actions;
    if (
      sameVisit &&
      step.action === 'fill' &&
      last &&
      last.step.action === 'fill' &&
      last.step.selector === step.selector &&
      at - last.at <= FILL_COALESCE_MS
    ) {
      actions = existing.slice(0, -1).concat([{ ...noted, startUrl: last.startUrl || '' }]);
    } else {
      actions = existing.concat([noted]);
    }
    if (actions.length > MAX_ACTIONS) actions = actions.slice(actions.length - MAX_ACTIONS);
    actions = actions
      .filter((action) => !isAutomatedLogin(action))
      .map((action) => ({ ...action, step: storedStep(action.step) }));
    hosts[host] = { actions };

    const accepted = similarRepeats(actions);
    const superseded = (item) => accepted.some((candidate) => (
      candidate.signature !== item.signature
      && (
        (containsSequence(candidate.signature, item.signature) && item.seenCount <= candidate.count)
        || nearDuplicate(item.signature, item.seenCount, candidate.signature, candidate.count)
      )
    ));

    let created = null;
    const next = [];
    for (const item of suggestions) {
      if (item.host !== host || item.status !== 'pending') {
        next.push(item);
        continue;
      }
      const candidate = accepted.find((entry) => entry.signature === item.signature);
      if (candidate && !superseded(item) && !suggestionFromLogin(item)) {
        const steps = candidate.steps.map(suggestionStep);
        next.push({
          ...item,
          steps,
          seenCount: candidate.count,
          label: labelFor(steps),
          startUrl: candidate.startUrl || item.startUrl,
        });
        continue;
      }
      if (!candidate && !superseded(item) && !suggestionFromLogin(item)) next.push(item);
    }
    suggestions = next;

    for (const candidate of accepted) {
      if (suggestions.some((item) => item.host === host && item.signature === candidate.signature)) continue;
      if (suggestions.some((item) => (
        item.host === host
        && containsSequence(item.signature, candidate.signature)
        && candidate.count <= item.seenCount
      ))) continue;
      if (suggestions.some((item) => (
        item.host === host
        && nearDuplicate(candidate.signature, candidate.count, item.signature, item.seenCount)
      ))) continue;
      if (suggestionFromLogin({ signature: candidate.signature, startUrl: candidate.startUrl, steps: candidate.steps })) continue;
      if (suggestions.length >= MAX_SUGGESTIONS) continue;
      const steps = candidate.steps.map(suggestionStep);
      created = {
        id: `pat_${at}_${suggestions.length}`,
        signature: candidate.signature,
        host,
        startUrl: candidate.startUrl || '',
        steps,
        seenCount: candidate.count,
        label: labelFor(steps),
        createdAt: new Date(at).toISOString(),
        status: 'pending',
      };
      suggestions.push(created);
    }

    return { state: { hosts, suggestions }, suggestion: created };
  }

  root.PatternSuggest = {
    REPEAT,
    GAP_MS,
    MAX_ACTIONS,
    MAX_SUGGESTIONS,
    emptyState,
    watchEnabled,
    observe,
    signatureOfSteps,
    isSecret,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
