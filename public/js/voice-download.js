import { getLang } from './i18n.js';

const labels = {
  en: { download: 'Download offline recognition', checking: 'Checking language pack…', available: 'Installed. Enable offline recognition above to use it.', downloadable: 'Download the selected language for offline recognition.', downloading: 'Downloading {lang}…', unavailable: 'Offline recognition is unavailable for this language.', unsupported: 'This browser cannot download offline recognition.', failed: 'Download failed. Try again.', checkFailed: 'Could not check availability. Reopen Settings to retry.' },
  ja: { download: 'オフライン音声認識をダウンロード', checking: '言語パックを確認中…', available: '導入済みです。上のオフライン音声認識を有効にすると使えます。', downloadable: '選択中の言語をダウンロードしてオフラインで認識します。', downloading: '{lang} をダウンロード中…', unavailable: 'この言語のオフライン音声認識は利用できません。', unsupported: 'このブラウザーはオフライン音声認識のダウンロードに対応していません。', failed: 'ダウンロードに失敗しました。もう一度お試しください。', checkFailed: '確認できませんでした。設定を開き直して再試行してください。' },
};

export function bindVoiceDownload({ button, status, getLanguage, onInstalled, SR = window.SpeechRecognition || window.webkitSpeechRecognition }) {
  let state = 'checking', selected = '', downloading = '', request = 0;
  const supported = !!SR && typeof SR.available === 'function' && typeof SR.install === 'function';
  function render() {
    const text = labels[getLang()] || labels.en;
    button.textContent = text.download;
    button.disabled = !!downloading || !['downloadable', 'downloading', 'failed'].includes(state);
    status.textContent = (text[downloading ? 'downloading' : state] || text.unavailable).replace('{lang}', downloading || selected);
  }
  async function refresh() {
    selected = getLanguage(); const lang = selected, id = ++request;
    state = supported ? 'checking' : 'unsupported'; render();
    if (!supported) return;
    try {
      const result = await SR.available({ langs: [lang], processLocally: true });
      if (id !== request) return;
      state = result; render();
    } catch { if (id === request) { state = 'checkFailed'; render(); } }
  }
  button.addEventListener('click', async () => {
    if (!supported || downloading || button.disabled) return;
    const lang = getLanguage();
    if (lang !== selected) { await refresh(); return; }
    downloading = lang; ++request; render();
    try {
      // Invoke directly from the user's click, before any await, for activation.
      const ok = await SR.install({ langs: [lang], processLocally: true });
      if (!ok) throw new Error('Language pack installation failed');
      const installed = await SR.available({ langs: [lang], processLocally: true });
      if (installed !== 'available') throw new Error('Language pack is not ready');
      await onInstalled(lang);
      downloading = ''; await refresh();
    } catch {
      downloading = '';
      if (getLanguage() === lang) { selected = lang; state = 'failed'; render(); }
      else await refresh();
    }
  });
  return refresh;
}
