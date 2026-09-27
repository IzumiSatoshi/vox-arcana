import { getLang } from './i18n.js';
import { ONLINE_MESSAGES } from './online-locales.js';

export function onlineText(en, ja, vars) {
  let text = ONLINE_MESSAGES[en]?.[getLang()] ?? (getLang() === 'ja' ? ja : en) ?? en;
  for (const [key, value] of Object.entries(vars || {})) text = text.replaceAll('{' + key + '}', String(value));
  return text;
}
// Status messages may already have been translated before a language switch.
export function translateOnlineMessage(message) {
  message = ERROR_ALIASES[message] ?? message;
  const entry = Object.values(ONLINE_MESSAGES).find(row => Object.values(row).includes(message));
  if (entry) return entry[getLang()];
  return typeof message === 'string' && message.includes(' · ')
    ? message.split(' · ').map(translateOnlineMessage).join(' · ') : message;
}

const ERROR_ALIASES = {
  'Room closed.': 'Room has expired or closed.',
  'Opponent is not connected.': 'Not connected.',
  'Wait for the current spell.': 'Please wait for the current spell.',
  'Connect Redis in Vercel Storage to enable online rooms.': 'Online rooms are unavailable. Please try again later.',
  'Room storage is unavailable. Please retry shortly.': 'Online rooms are unavailable. Please try again later.',
  'Room service unavailable. Please retry.': 'Online rooms are unavailable. Please try again later.',
  'IP-hidden rooms require TURN relay setup on this site.': 'Relay is unavailable. Please retry or contact the site owner.',
  'This room requires TURN relay. Direct fallback is disabled.': 'Relay is unavailable. Please retry or contact the site owner.',
  'TURN credentials could not be generated. Please retry.': 'Relay is unavailable. Please retry or contact the site owner.',
  'Connection timed out. This network may need TURN relay configured on the site.': 'Relay is unavailable. Please retry or contact the site owner.',
  'Peer message too large.': 'Invalid peer message. The duel has ended.',
  'Peer message limit exceeded.': 'Invalid peer message. The duel has ended.',
  'Invalid peer message.': 'Invalid peer message. The duel has ended.',
};
