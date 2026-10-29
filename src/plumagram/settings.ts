/*
 * PlumaGram — own settings of the web version.
 * Kept in localStorage of this browser, apart from the Web K state, so upstream updates merge cleanly.
 */

import {createRoot, createSignal} from 'solid-js';
import I18n from '@lib/langPack';

export type PlumaSettings = {
  /** «Не подглядывай!»: chat list and messages are blurred until hovered */
  noPeek: boolean,
  /** «Без рекламы»: no sponsored messages in channels and bots */
  noAds: boolean,
  /** reactions under channel posts are not shown */
  hideChannelReactions: boolean,
  /** «Не беспокоить»: no notifications and sounds in this tab until this moment (ms) */
  quietUntil: number,
  /** voice messages are transcribed in this browser (the model download was agreed to) */
  localTranscribe: boolean,
  /** the bigger, slower and more accurate model for voice messages */
  transcribeAccurate: boolean,
  /** a theme of the Android app (its id in themes.json), 0 — the web version's own */
  theme: number,
  /** the video quality picked last time (480 / 720 / 1080), 0 — «Авто» */
  videoQuality: number
};

const STORAGE_KEY = 'plumagram:settings';

const DEFAULTS: PlumaSettings = {
  noPeek: false,
  noAds: true,
  hideChannelReactions: false,
  quietUntil: 0,
  videoQuality: 0,
  localTranscribe: false,
  transcribeAccurate: false,
  theme: 0
};

function load(): PlumaSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return {...DEFAULTS, ...(raw ? JSON.parse(raw) : {})};
  } catch(err) {
    return {...DEFAULTS};
  }
}

const [settingsSignal, setSettingsSignal] = createRoot(() => createSignal<PlumaSettings>(load()));

export function plumaSettings() {
  return settingsSignal();
}

export function setPlumaSetting<K extends keyof PlumaSettings>(key: K, value: PlumaSettings[K]) {
  const next = {...settingsSignal(), [key]: value};
  setSettingsSignal(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch(err) {}
}

export function togglePlumaSetting(key: 'noPeek' | 'noAds' | 'hideChannelReactions' | 'transcribeAccurate') {
  setPlumaSetting(key, !settingsSignal()[key]);
  return settingsSignal()[key];
}

/** Russian or English text, following the interface language */
export function pt(ru: string, en: string) {
  const code = I18n.getLastRequestedLangCode() || document.documentElement.lang || navigator.language;
  return code?.toLowerCase().startsWith('ru') ? ru : en;
}

export function isQuietNow() {
  return settingsSignal().quietUntil > Date.now();
}

// * the chat of the last message notification in this tab (for «последнее уведомление и обратно»)
let lastNotifiedPeerId: PeerId;
export function setLastNotifiedPeer(peerId: PeerId) {
  lastNotifiedPeerId = peerId;
}
export function getLastNotifiedPeer() {
  return lastNotifiedPeerId;
}
