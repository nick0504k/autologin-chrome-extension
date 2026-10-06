// Korean scenario titles from Chrome's built-in models.
// Gemini Nano does not accept Korean, so the title is drafted in English
// and Chrome's Translator turns that draft into Korean.
// Fill values, passwords, OTPs, and keypad letters are never sent.
(function (root) {
  const HANGUL = /[\uac00-\ud7a3]/;
  const SECRET_TEXT = /password|passwd|otp|\bpin\b|secret|\bpwd\b|layerpwd|비밀번호|키패드/i;

  function isSecretStep(step) {
    if (!step || step.secret || step.keypad) return true;
    const blob = `${step.selector || ''} ${step.inputType || ''} ${step.name || ''} ${step.description || ''}`;
    return SECRET_TEXT.test(blob);
  }

  function isSingleMark(text) {
    return [...String(text || '').trim()].length === 1;
  }

  function visibleLabel(step) {
    if (!step || isSecretStep(step) || step.action === 'fill') return '';
    const text = step.text ? String(step.text).trim() : '';
    if (text && !isSingleMark(text)) return text.slice(0, 30);
    let desc = step.description ? String(step.description) : '';
    desc = desc.replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
    if (!desc || SECRET_TEXT.test(desc) || isSingleMark(desc)) return '';
    return desc.slice(0, 40);
  }

  function buildOutline(steps) {
    return (Array.isArray(steps) ? steps : []).slice(0, 12).map((step, index) => {
      const action = String(step && step.action || 'step');
      const label = visibleLabel(step);
      if (action === 'fill' || isSecretStep(step)) return `${index + 1}. fill a field`;
      return `${index + 1}. ${action}${label ? `: ${label}` : ''}`;
    }).join('\n');
  }

  function cleanTitle(text) {
    const line = String(text || '').split('\n').map((part) => part.trim()).find(Boolean) || '';
    let name = line.replace(/^["'`]+|["'`]+$/g, '');
    name = name.replace(/^(name|title)\s*:\s*/i, '');
    name = name.replace(/[.。]+$/g, '');
    name = name.replace(/\s+/g, ' ').trim();
    if (name.length > 40) name = name.slice(0, 40).trim();
    return name;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        }
      );
    });
  }

  async function koreanName(steps, deps) {
    const options = deps || {};
    const LanguageModel = options.LanguageModel || root.LanguageModel;
    const Translator = options.Translator || root.Translator;
    if (!LanguageModel || !Translator || typeof LanguageModel.availability !== 'function') return null;
    const outline = buildOutline(steps);
    if (!outline.trim()) return null;

    const run = async () => {
      const modelReady = await LanguageModel.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      if (modelReady !== 'available') return null;

      let englishOutline = outline;
      if (HANGUL.test(outline)) {
        const toEnglish = await Translator.availability({ sourceLanguage: 'ko', targetLanguage: 'en' });
        if (toEnglish !== 'available') return null;
        const koEn = await Translator.create({ sourceLanguage: 'ko', targetLanguage: 'en' });
        try {
          englishOutline = await koEn.translate(outline);
        } finally {
          if (koEn && koEn.destroy) koEn.destroy();
        }
      }

      const session = await LanguageModel.create({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [{
          role: 'system',
          content: 'Name a UI test in 2 to 5 English words. Reply with the name only.',
        }],
      });
      let englishName = '';
      try {
        englishName = cleanTitle(await session.prompt(`Steps:\n${String(englishOutline).slice(0, 800)}`));
      } finally {
        if (session && session.destroy) session.destroy();
      }
      if (!englishName) return null;

      const toKorean = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ko' });
      if (toKorean !== 'available') return null;
      const enKo = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'ko' });
      try {
        const korean = cleanTitle(await enKo.translate(englishName));
        if (!korean || !HANGUL.test(korean)) return null;
        return korean;
      } finally {
        if (enKo && enKo.destroy) enKo.destroy();
      }
    };

    try {
      return await withTimeout(run(), options.timeoutMs || 6000);
    } catch (_) {
      return null;
    }
  }

  root.ScenarioNamer = {
    buildOutline,
    cleanTitle,
    koreanName,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
