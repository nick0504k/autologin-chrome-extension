/**
 * AI Service Module
 * Handles User AI configuration (BYO AI), API calls (Gemini, OpenAI, Claude, Ollama, ChatGPT Plus Web, Claude Pro Web),
 * prompt engineering with DOM context, and test flow JSON generation.
 */
(function (global) {
  'use strict';

  const DEFAULT_AI_CONFIG = {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-2.0-flash',
    baseUrl: ''
  };

  const PROVIDER_DEFAULTS = {
    gemini: {
      name: 'Google Gemini (완전 무료)',
      defaultModel: 'gemini-2.0-flash',
      defaultBaseUrl: 'https://generativelanguage.googleapis.com',
      isFreeTier: true
    },
    'chatgpt-web': {
      name: 'ChatGPT Plus 웹 세션 (기존 $20 구독 활용)',
      defaultModel: 'gpt-4o',
      defaultBaseUrl: 'https://chatgpt.com',
      isSubscription: true
    },
    'claude-web': {
      name: 'Claude Pro 웹 세션 (기존 $20 구독 활용)',
      defaultModel: 'claude-3-5-sonnet',
      defaultBaseUrl: 'https://api.claude.ai',
      isSubscription: true
    },
    openai: {
      name: 'OpenAI API (공식 개발자 종량제 키)',
      defaultModel: 'gpt-4o-mini',
      defaultBaseUrl: 'https://api.openai.com/v1'
    },
    claude: {
      name: 'Anthropic Claude API (공식 개발자 종량제 키)',
      defaultModel: 'claude-3-5-sonnet-latest',
      defaultBaseUrl: 'https://api.anthropic.com/v1'
    },
    ollama: {
      name: 'Ollama (로컬 무료)',
      defaultModel: 'llama3.2',
      defaultBaseUrl: 'http://localhost:11434/v1',
      isFreeTier: true
    }
  };

  /** Load AI configuration from chrome.storage.local */
  async function getAiConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (res) => {
          if (done) return;
          done = true;
          resolve({ ...DEFAULT_AI_CONFIG, ...(res?.aiConfig || {}) });
        };
        const p = chrome.storage.local.get(['aiConfig'], finish);
        if (p && typeof p.then === 'function') {
          p.then(finish).catch(() => finish({}));
        }
      });
    }
    return { ...DEFAULT_AI_CONFIG };
  }

  /** Save AI configuration to chrome.storage.local */
  async function saveAiConfig(config) {
    const sanitized = {
      provider: config.provider || 'gemini',
      apiKey: (config.apiKey || '').trim(),
      model: (config.model || '').trim(),
      baseUrl: (config.baseUrl || '').trim()
    };
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(sanitized);
        };
        const p = chrome.storage.local.set({ aiConfig: sanitized }, finish);
        if (p && typeof p.then === 'function') {
          p.then(finish).catch(() => finish());
        }
      });
    }
    return sanitized;
  }

  /** Retrieve saved test flows */
  async function getSavedTests() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (res) => {
          if (done) return;
          done = true;
          resolve(Array.isArray(res?.savedTests) ? res.savedTests : []);
        };
        const p = chrome.storage.local.get(['savedTests'], finish);
        if (p && typeof p.then === 'function') {
          p.then(finish).catch(() => finish({ savedTests: [] }));
        }
      });
    }
    return [];
  }

  /** Save or update a test flow */
  async function saveTestFlow(testFlow) {
    const current = await getSavedTests();
    const flowId = testFlow.id || `flow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const flowRecord = {
      ...testFlow,
      id: flowId,
      name: testFlow.name || '무제 자동 테스트',
      description: testFlow.description || '',
      serverKey: testFlow.serverKey || null,
      serverName: testFlow.serverName || '',
      group: testFlow.group || '',
      targetHost: testFlow.targetHost || '',
      startUrl: testFlow.startUrl || '',
      createdAt: testFlow.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: Array.isArray(testFlow.steps) ? testFlow.steps : []
    };

    const existingIdx = current.findIndex((t) => t.id === flowId);
    if (existingIdx >= 0) {
      current[existingIdx] = flowRecord;
    } else {
      current.push(flowRecord);
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const p = chrome.storage.local.set({ savedTests: current }, finish);
        if (p && typeof p.then === 'function') {
          p.then(finish).catch(() => finish());
        }
      });
    }
    return flowRecord;
  }

  /** Delete a saved test flow by id */
  async function deleteSavedTest(id) {
    const current = await getSavedTests();
    const filtered = current.filter((t) => t.id !== id);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const p = chrome.storage.local.set({ savedTests: filtered }, finish);
        if (p && typeof p.then === 'function') {
          p.then(finish).catch(() => finish());
        }
      });
    }
    return filtered;
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function parseChatGptSseResponse(rawText) {
    if (!rawText) return '';
    const lines = rawText.split('\n');
    let lastContent = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') break;
      try {
        const parsed = JSON.parse(jsonStr);
        const parts = parsed.message?.content?.parts;
        if (Array.isArray(parts) && parts.length > 0) {
          lastContent = parts.join('');
        }
      } catch {}
    }
    return lastContent;
  }

  /**
   * Attempts to detect active browser login session for ChatGPT Plus or Claude Pro.
   */
  async function detectBrowserSession(provider = 'chatgpt-web') {
    if (provider === 'chatgpt-web') {
      try {
        const resp = await fetch('https://chatgpt.com/api/auth/session', {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.accessToken) {
            return {
              ok: true,
              token: data.accessToken,
              user: data.user || {},
              expires: data.expires
            };
          }
        }
      } catch {}

      if (typeof chrome !== 'undefined' && chrome.cookies?.get) {
        try {
          const cookie = await new Promise((resolve) => {
            chrome.cookies.get({ url: 'https://chatgpt.com', name: '__Secure-next-auth.session-token' }, resolve);
          });
          if (cookie && cookie.value) {
            return { ok: true, sessionToken: cookie.value };
          }
        } catch {}
      }
      return { ok: false, error: 'ChatGPT 로그인 세션을 감지하지 못했습니다.' };
    }

    if (provider === 'claude-web') {
      if (typeof chrome !== 'undefined' && chrome.cookies?.get) {
        try {
          const cookie = await new Promise((resolve) => {
            chrome.cookies.get({ url: 'https://claude.ai', name: 'sessionKey' }, resolve);
          });
          if (cookie && cookie.value) {
            return { ok: true, sessionKey: cookie.value };
          }
        } catch {}
      }
      return { ok: false, error: 'Claude.ai 로그인 세션을 감지하지 못했습니다.' };
    }

    return { ok: false, error: `지원하지 않는 세션 Provider: ${provider}` };
  }

  /** Test connection to configured AI */
  async function testAiConnection(config) {
    const cfg = { ...DEFAULT_AI_CONFIG, ...(config || {}) };
    const provider = (cfg.provider || 'gemini').toLowerCase();

    if (provider === 'gemini' && !cfg.apiKey) {
      return { ok: false, error: 'GEMINI API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해 주세요.' };
    }

    // ChatGPT Plus Web Session
    if (provider === 'chatgpt-web') {
      let token = (cfg.apiKey || '').trim();
      let userDesc = '';
      if (!token) {
        const detected = await detectBrowserSession('chatgpt-web');
        if (detected.ok) {
          token = detected.token || detected.sessionToken;
          userDesc = detected.user?.email ? ` (${detected.user.email})` : '';
        }
      }
      if (!token) {
        return {
          ok: false,
          error: '브라우저에서 chatgpt.com에 로그인되어 있지 않거나 세션 토큰을 찾을 수 없습니다. chatgpt.com에 로그인하시거나 세션 토큰(accessToken)을 입력해주세요.'
        };
      }
      return {
        ok: true,
        message: `ChatGPT Plus 세션 연동 성공${userDesc} - 별도 API 결제 없이 기존 $20 구독으로 사용 가능!`
      };
    }

    // Claude Pro Web Session
    if (provider === 'claude-web') {
      let sessionKey = (cfg.apiKey || '').trim();
      if (!sessionKey) {
        const detected = await detectBrowserSession('claude-web');
        if (detected.ok) {
          sessionKey = detected.sessionKey;
        }
      }
      if (!sessionKey) {
        return {
          ok: false,
          error: '브라우저에서 claude.ai에 로그인되어 있지 않거나 sessionKey를 찾을 수 없습니다. claude.ai에 로그인하시거나 쿠키의 sessionKey를 입력해주세요.'
        };
      }
      return {
        ok: true,
        message: 'Claude Pro 세션 연동 성공 - 별도 API 결제 없이 기존 $20 구독으로 사용 가능!'
      };
    }

    const pingPrompt = 'Respond with exactly {"status":"connected"} as raw JSON.';
    try {
      const result = await callAiApi({
        config: cfg,
        systemInstruction: 'You are a test connection verifier. Output only valid JSON.',
        prompt: pingPrompt
      });
      return { ok: true, message: `연결 성공 (${cfg.provider} - ${cfg.model})`, raw: result };
    } catch (err) {
      return { ok: false, error: err.message || '연결 실패' };
    }
  }

  /** Low-level API caller supporting Gemini, ChatGPT Plus Web, Claude Pro Web, OpenAI, Claude, Ollama */
  async function callAiApi({ config, systemInstruction, prompt }) {
    const provider = (config.provider || 'gemini').toLowerCase();
    const apiKey = (config.apiKey || '').trim();
    const model = (config.model || PROVIDER_DEFAULTS[provider]?.defaultModel || '').trim();

    // Auto-Login style Browser Tab Automation Mode (ChatGPT, Claude, Gemini)
    if (['chatgpt', 'claude', 'gemini', 'chatgpt-tab', 'claude-tab', 'gemini-tab'].includes(provider) && !apiKey) {
      const tabAutomator = (typeof window !== 'undefined' && window.AiTabAutomator) || (typeof global !== 'undefined' && global.AiTabAutomator) || (typeof globalThis !== 'undefined' && globalThis.AiTabAutomator) || (typeof AiTabAutomator !== 'undefined' ? AiTabAutomator : null);
      if (tabAutomator) {
        const tabProvider = provider.startsWith('claude') ? 'claude' : (provider.startsWith('gemini') ? 'gemini' : 'chatgpt');
        const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
        const res = await tabAutomator.sendPromptViaTab(tabProvider, fullPrompt);
        if (!res.ok) {
          throw new Error(res.error || `${tabProvider} 탭 통신 중 오류가 발생했습니다.`);
        }
        return res.text;
      }
    }

    if (provider !== 'ollama' && provider !== 'chatgpt-web' && provider !== 'claude-web' && provider !== 'chatgpt' && provider !== 'claude' && !apiKey) {
      throw new Error(`${provider.toUpperCase()} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해 주세요.`);
    }

    if (provider === 'gemini') {
      const baseUrl = (config.baseUrl || PROVIDER_DEFAULTS.gemini.defaultBaseUrl).replace(/\/+$/, '');
      const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API 오류 (${resp.status}): ${errText}`);
      }
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini API 응답에서 텍스트를 찾을 수 없습니다.');
      return text;
    }

    if (provider === 'chatgpt-web') {
      let token = apiKey;
      if (!token) {
        const detected = await detectBrowserSession('chatgpt-web');
        if (detected.ok) token = detected.token || detected.sessionToken;
      }
      if (!token) {
        throw new Error('ChatGPT Plus 세션 토큰을 찾을 수 없습니다. 브라우저에서 chatgpt.com에 로그인하시거나 세션 토큰을 입력해주세요.');
      }

      const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
      const resp = await fetch('https://chatgpt.com/backend-api/conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'next',
          messages: [
            {
              id: generateUUID(),
              author: { role: 'user' },
              content: { content_type: 'text', parts: [fullPrompt] }
            }
          ],
          model: model || 'gpt-4o',
          parent_message_id: generateUUID()
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 401 || resp.status === 403) {
          throw new Error('ChatGPT 세션이 만료되었거나 인증에 실패했습니다. chatgpt.com에 다시 로그인해주세요.');
        }
        throw new Error(`ChatGPT Web 오류 (${resp.status}): ${errText.slice(0, 150)}`);
      }

      const responseText = await resp.text();
      const extracted = parseChatGptSseResponse(responseText);
      if (!extracted) {
        try {
          const parsedJson = JSON.parse(responseText);
          const part = parsedJson.message?.content?.parts?.[0];
          if (part) return part;
        } catch {}
        throw new Error('ChatGPT 응답에서 내용을 추출할 수 없습니다.');
      }
      return extracted;
    }

    if (provider === 'claude-web') {
      let sessionKey = apiKey;
      if (!sessionKey) {
        const detected = await detectBrowserSession('claude-web');
        if (detected.ok) sessionKey = detected.sessionKey;
      }
      if (!sessionKey) {
        throw new Error('Claude 세션 키를 찾을 수 없습니다. 브라우저에서 claude.ai에 로그인하시거나 sessionKey를 입력해주세요.');
      }

      const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
      const resp = await fetch('https://api.claude.ai/api/organizations', {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionKey=${sessionKey}`
        }
      });
      if (!resp.ok) {
        throw new Error('Claude.ai 세션이 만료되었습니다. claude.ai에 다시 로그인해주세요.');
      }
      const orgs = await resp.json();
      const orgId = orgs?.[0]?.uuid;
      if (!orgId) throw new Error('Claude 활성 조직을 찾을 수 없습니다.');

      const chatResp = await fetch(`https://api.claude.ai/api/organizations/${orgId}/chat_conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionKey=${sessionKey}`
        },
        body: JSON.stringify({
          name: 'E2E Test Automation',
          uuid: generateUUID()
        })
      });
      const chatData = await chatResp.json();
      const convUuid = chatData.uuid;

      const completionResp = await fetch(`https://api.claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionKey=${sessionKey}`
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          model: model || 'claude-3-5-sonnet'
        })
      });

      if (!completionResp.ok) {
        throw new Error(`Claude Web 오류 (${completionResp.status})`);
      }
      const completionText = await completionResp.text();
      const sseText = parseChatGptSseResponse(completionText) || completionText;
      return sseText;
    }

    if (provider === 'openai' || provider === 'ollama') {
      const defaultUrl = provider === 'ollama' ? PROVIDER_DEFAULTS.ollama.defaultBaseUrl : PROVIDER_DEFAULTS.openai.defaultBaseUrl;
      const baseUrl = (config.baseUrl || defaultUrl).replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;

      const messages = [];
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
      }
      messages.push({ role: 'user', content: prompt });

      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`${provider.toUpperCase()} API 오류 (${resp.status}): ${errText}`);
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${provider.toUpperCase()} 응답에서 내용을 찾을 수 없습니다.`);
      return text;
    }

    if (provider === 'claude') {
      const baseUrl = (config.baseUrl || PROVIDER_DEFAULTS.claude.defaultBaseUrl).replace(/\/+$/, '');
      const url = `${baseUrl}/messages`;

      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      };

      const payload = {
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      };
      if (systemInstruction) payload.system = systemInstruction;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Claude API 오류 (${resp.status}): ${errText}`);
      }
      const data = await resp.json();
      const text = data.content?.[0]?.text;
      if (!text) throw new Error('Claude 응답에서 내용을 찾을 수 없습니다.');
      return text;
    }

    throw new Error(`지원하지 않는 AI Provider: ${provider}`);
  }

  /** Clean markdown code fences and extract JSON object */
  function extractJson(rawText) {
    if (!rawText) return null;
    let cleaned = rawText.trim();
    // Strip markdown code fences if present
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) cleaned = match[1].trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      // Look for first '{' and last '}'
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.substring(start, end + 1));
        } catch {}
      }
    }
    return null;
  }

  /** Generate structured E2E test flow from natural language prompt and page context */
  async function generateTestFlow({ prompt, pageContext = {}, config }) {
    const cfg = config || (await getAiConfig());
    const ctx = pageContext || {};

    const systemInstruction = `You are an automated web testing agent for the site under test.
Your job is to generate a JSON test plan from a user natural language prompt and current DOM structure.
The target site may be a single-page app (Vue/React) with hash-based routing.

Available action types:
1. "navigate": Change hash or URL. Properties: { "action": "navigate", "target": "#/path" }
2. "click": Click interactive button/menu/link. Properties: { "action": "click", "selector": "css_selector", "text": "optional button text" }
3. "fill": Type into text/number input. Properties: { "action": "fill", "selector": "css_selector", "value": "text to type" }
4. "waitFor": Wait for element to become visible. Properties: { "action": "waitFor", "selector": "css_selector", "timeout": 5000 }
5. "assertVisible": Assert element exists and is visible. Properties: { "action": "assertVisible", "selector": "css_selector" }
6. "assertText": Assert element text contains expected. Properties: { "action": "assertText", "selector": "css_selector", "expected": "keyword" }
7. "sleep": Wait milliseconds. Properties: { "action": "sleep", "ms": 1000 }

Output MUST be STRICTLY a JSON object with this structure (no conversational text outside):
{
  "name": "Short test name in Korean",
  "description": "Short description of what is tested",
  "steps": [
    { "action": "navigate", "target": "#/...", "description": "설명" },
    { "action": "click", "selector": "...", "description": "설명" }
  ]
}`;

    const contextPayload = {
      currentUrl: ctx.url || '',
      currentTitle: ctx.title || '',
      interactiveElements: (ctx.interactiveElements || []).slice(0, 80)
    };

    const userPrompt = `Target page context:
${JSON.stringify(contextPayload, null, 2)}

User Request:
${prompt}

Generate a concise and robust JSON test plan to accomplish and verify this request.`;

    const rawResponse = await callAiApi({
      config: cfg,
      systemInstruction,
      prompt: userPrompt
    });

    const parsed = extractJson(rawResponse);
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error(`AI 응답에서 유효한 테스트 플로우 JSON을 추출하지 못했습니다.\n응답 내용:\n${rawResponse.slice(0, 300)}`);
    }

    parsed.name = parsed.name || parsed.scenarioName || 'AI Test Flow';
    return parsed;
  }

  const AiService = {
    DEFAULT_AI_CONFIG,
    PROVIDER_DEFAULTS,
    getAiConfig,
    saveAiConfig,
    getSavedTests,
    saveTestFlow,
    deleteSavedTest,
    testAiConnection,
    detectBrowserSession,
    parseChatGptSseResponse,
    callAiApi,
    extractJson,
    generateTestFlow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AiService;
  }
  if (typeof window !== 'undefined') {
    window.AiService = AiService;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.AiService = AiService;
  }
  global.AiService = AiService;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
