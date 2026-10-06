/**
 * ai-tab-automator.js
 * Automates real browser tabs for ChatGPT, Claude, and Gemini
 * Functions identically to Auto-Login DOM manipulation:
 * 1. Checks or opens the AI web tab
 * 2. Injects prompt using ProseMirror / Lexical compatible execCommand
 * 3. Triggers Send
 * 4. Observes stream completion and extracts structured JSON response
 */

(function (global) {
  'use strict';

  const AI_PROVIDERS = {
    chatgpt: {
      name: 'ChatGPT',
      url: 'https://chatgpt.com/',
      urlMatchPattern: '*://*.chatgpt.com/*',
      inputSelector: '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][id="prompt-textarea"], div.ProseMirror',
      sendButtonSelector: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="보내기"], form button[type="submit"]',
      stopButtonSelector: 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="생성 중지"]',
      responseSelector: '[data-message-author-role="assistant"], .agent-turn, .markdown'
    },
    claude: {
      name: 'Claude',
      url: 'https://claude.ai/new',
      urlMatchPattern: '*://claude.ai/*',
      inputSelector: 'fieldset div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[role="textbox"], textarea',
      sendButtonSelector: 'button[aria-label="Send Message"], button[aria-label="Send message"], button:has(svg)',
      stopButtonSelector: 'button[aria-label="Stop Response"], button[aria-label="Stop response"]',
      responseSelector: '.font-claude-message, [data-is-streaming="false"], .standard-markdown'
    },
    gemini: {
      name: 'Google Gemini',
      url: 'https://gemini.google.com/app',
      urlMatchPattern: '*://gemini.google.com/*',
      inputSelector: 'div.ql-editor, div[role="textbox"], textarea',
      sendButtonSelector: 'button[aria-label="Send message"], button.send-button, button[aria-label="메시지 보내기"]',
      stopButtonSelector: 'button[aria-label="Stop generating"], button[aria-label="응답 생성 중지"]',
      responseSelector: '.model-response-text, message-content, .response-container'
    }
  };

  /**
   * Finds an existing tab for the provider, or opens a new one
   */
  async function ensureAiTab(providerKey) {
    const meta = AI_PROVIDERS[providerKey] || AI_PROVIDERS.chatgpt;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      return { tabId: 999, isNew: false, url: meta.url };
    }

    const tabs = await chrome.tabs.query({});
    const matchedTab = tabs.find(t => t.url && (
      (providerKey === 'chatgpt' && (t.url.includes('chatgpt.com') || t.url.includes('chat.openai.com'))) ||
      (providerKey === 'claude' && t.url.includes('claude.ai')) ||
      (providerKey === 'gemini' && t.url.includes('gemini.google.com'))
    ));

    if (matchedTab) {
      // Bring tab to attention if needed
      return { tabId: matchedTab.id, isNew: false, url: matchedTab.url };
    }

    // Open a new tab
    const newTab = await chrome.tabs.create({ url: meta.url, active: true });
    // Wait for tab to load
    await new Promise((resolve) => {
      const listener = (tid, changeInfo) => {
        if (tid === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 8000); // 8s timeout fallback
    });

    return { tabId: newTab.id, isNew: true, url: meta.url };
  }

  /**
   * Content script injected into the AI page to enter text, click send, and observe reply
   */
  function tabInjectedScript(providerKey, promptText) {
    return new Promise((resolve) => {
      try {
        let inputEl = null;
        let stopSelector = '';
        let respSelector = '';
        let sendSelector = '';

        if (providerKey === 'chatgpt') {
          inputEl = document.querySelector('#prompt-textarea, div.ProseMirror, textarea, div[contenteditable="true"]');
          sendSelector = 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="보내기"], form button[type="submit"]';
          stopSelector = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="생성 중지"]';
          respSelector = '[data-message-author-role="assistant"], .markdown';
        } else if (providerKey === 'claude') {
          inputEl = document.querySelector('fieldset div[contenteditable="true"], div[role="textbox"], textarea');
          sendSelector = 'button[aria-label="Send Message"], button[aria-label="Send message"]';
          stopSelector = 'button[aria-label="Stop Response"]';
          respSelector = '.font-claude-message, [data-is-streaming="false"], .standard-markdown';
        } else {
          inputEl = document.querySelector('div.ql-editor, div[role="textbox"], textarea');
          sendSelector = 'button[aria-label="Send message"], button.send-button, button[aria-label="메시지 보내기"]';
          stopSelector = 'button[aria-label="Stop generating"], button[aria-label="응답 생성 중지"]';
          respSelector = '.model-response-text, message-content';
        }

        if (!inputEl) {
          return resolve({ ok: false, error: 'AI 채팅 입력창을 찾을 수 없습니다. 로그인 상태를 확인해주세요.' });
        }

        // Record initial state
        const initialMessages = Array.from(document.querySelectorAll(respSelector));
        const initialCount = initialMessages.length;
        const initialLastText = initialCount > 0 ? (initialMessages[initialCount - 1].innerText || '').trim() : '';

        // ProseMirror / Lexical rich text insertion
        inputEl.focus();
        if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
          inputEl.value = promptText;
          inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } else {
          // Contenteditable
          if (window.getSelection && document.createRange) {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(inputEl);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          // execCommand updates internal ProseMirror / React state
          document.execCommand('insertText', false, promptText);
          inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }

        setTimeout(() => {
          // Trigger Send
          let sendBtn = document.querySelector(sendSelector);
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          } else {
            // Simulate Enter key on input
            inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          // Monitor generation
          const startTime = Date.now();
          let generationStarted = false;
          let lastSeenLength = 0;
          let unchangedCount = 0;

          const checkInterval = setInterval(() => {
            const isGenerating = !!document.querySelector(stopSelector);
            const currentMessages = Array.from(document.querySelectorAll(respSelector));
            const currentCount = currentMessages.length;
            const latestMsg = currentCount > 0 ? currentMessages[currentCount - 1] : null;
            const currentLatestText = latestMsg ? (latestMsg.innerText || latestMsg.textContent || '').trim() : '';

            // Check if generation has started
            if (!generationStarted) {
              if (isGenerating || currentCount > initialCount || (currentCount === initialCount && currentLatestText !== initialLastText && currentLatestText.length > 5)) {
                generationStarted = true;
              } else if (Date.now() - startTime > 4000) {
                // Retry click/Enter once if not started
                const btnRetry = document.querySelector(sendSelector);
                if (btnRetry && !btnRetry.disabled) btnRetry.click();
                else inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              }
            }

            // Max timeout (60 seconds)
            if (Date.now() - startTime > 60000) {
              clearInterval(checkInterval);
              if (currentLatestText && currentLatestText.length > 10) {
                return resolve({ ok: true, text: currentLatestText });
              }
              return resolve({ ok: false, error: 'AI 응답 수신 시간 초과 (60초)' });
            }

            // If generation has started and stop button is gone
            if (generationStarted && !isGenerating) {
              if (currentLatestText.length === lastSeenLength && currentLatestText.length > 15) {
                unchangedCount++;
                if (unchangedCount >= 2) { // Stable for 1.6s
                  clearInterval(checkInterval);
                  return resolve({ ok: true, text: currentLatestText });
                }
              } else {
                lastSeenLength = currentLatestText.length;
                unchangedCount = 0;
              }
            }
          }, 800);
        }, 500);

      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  /**
   * Executes the prompt on the AI tab and returns the response
   */
  async function sendPromptViaTab(providerKey, promptText) {
    const tabInfo = await ensureAiTab(providerKey);

    if (typeof chrome === 'undefined' || !chrome.scripting) {
      // Mock for testing
      return {
        ok: true,
        text: '```json\n{"name": "Tab Automated Test", "steps": [{"action": "click", "selector": "#btn-test", "description": "Click test button"}]}\n```'
      };
    }

    // If new tab was opened, wait a moment for DOM initialization
    if (tabInfo.isNew) {
      await new Promise(r => setTimeout(r, 2500));
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabInfo.tabId },
        func: tabInjectedScript,
        args: [providerKey, promptText]
      });

      if (results && results[0] && results[0].result) {
        return results[0].result;
      }
      return { ok: false, error: '탭에서 결과를 수신하지 못했습니다. AI 탭이 정상적으로 열려있는지 확인해주세요.' };
    } catch (err) {
      return { ok: false, error: `탭 자동화 오류: ${err.message}` };
    }
  }

  const AiTabAutomator = {
    AI_PROVIDERS,
    ensureAiTab,
    tabInjectedScript,
    sendPromptViaTab
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AiTabAutomator;
  }
  global.AiTabAutomator = AiTabAutomator;

})(typeof window !== 'undefined' ? window : globalThis);
