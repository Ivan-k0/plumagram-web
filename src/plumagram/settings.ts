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
  noAds: boolean
};

const STORAGE_KEY = 'plumagram:settings';

const DEFAULTS: PlumaSettings = {
  noPeek: false,
  noAds: true
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

export function togglePlumaSetting(key: 'noPeek' | 'noAds') {
  setPlumaSetting(key, !settingsSignal()[key]);
  return settingsSignal()[key];
}

/** Russian or English text, following the interface language */
export function pt(ru: string, en: string) {
  const code = I18n.getLastRequestedLangCode() || document.documentElement.lang || navigator.language;
  return code?.toLowerCase().startsWith('ru') ? ru : en;
}
