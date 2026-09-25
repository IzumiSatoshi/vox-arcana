// Interface translations and speech recognition are independent settings.
export const UI_LANGUAGES = {
  en: 'English', ja: '日本語', es: 'Español', fr: 'Français', de: 'Deutsch',
  'zh-Hans': '简体中文', ko: '한국어', pt: 'Português', hi: 'हिन्दी',
};

export const VOICE_LANGUAGES = {
  'en-US': 'English (US)', 'en-GB': 'English (UK)', 'en-AU': 'English (Australia)',
  'ja-JP': '日本語', 'es-ES': 'Español (España)', 'es-MX': 'Español (México)',
  'fr-FR': 'Français (France)', 'fr-CA': 'Français (Canada)', 'de-DE': 'Deutsch',
  'it-IT': 'Italiano', 'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)',
  'zh-CN': '中文 (简体)', 'zh-TW': '中文 (繁體)', 'ko-KR': '한국어',
  'hi-IN': 'हिन्दी', 'ar-SA': 'العربية', 'bn-BD': 'বাংলা', 'ru-RU': 'Русский',
  'nl-NL': 'Nederlands', 'pl-PL': 'Polski', 'tr-TR': 'Türkçe', 'id-ID': 'Bahasa Indonesia',
  'th-TH': 'ไทย', 'vi-VN': 'Tiếng Việt', 'sv-SE': 'Svenska', 'uk-UA': 'Українська',
};

export function uiLanguage(tag) {
  if (typeof tag !== 'string') return 'en';
  if (tag.toLowerCase().startsWith('zh')) return 'zh-Hans';
  const base = tag.toLowerCase().split('-')[0];
  return UI_LANGUAGES[base] ? base : 'en';
}

export function recognitionLanguage(tag) {
  if (typeof tag !== 'string' || !tag.trim() || tag.length > 35) return null;
  try {
    const canonical = Intl.getCanonicalLocales(tag.trim())[0];
    // SpeechRecognition expects a language, rather than a region-only or private tag.
    return /^[a-z]{2,3}(?:-|$)/i.test(canonical) ? canonical : null;
  } catch { return null; }
}

export function defaultRecognitionLanguage(ui) {
  return { ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
    'zh-Hans': 'zh-CN', ko: 'ko-KR', pt: 'pt-BR', hi: 'hi-IN' }[ui] || 'en-US';
}
