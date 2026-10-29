/*
 * PlumaGram — the settings to a file and back: to move them to another browser (and, later, between the app
 * and the web version). Only what is a choice is in it: switches, the theme, the message filters — not the
 * consents to downloads or a «do not disturb» that is running now.
 */

import {toast} from '@components/toast';
import {plumaSettings, pt, setPlumaSetting, PlumaSettings} from '@/plumagram/settings';
import {addFilterRule, FilterRule, getFilterRules, removeFilterRule} from '@/plumagram/filters';

const FILE_NAME = 'PlumaGram-настройки.json';
const KEYS: (keyof PlumaSettings)[] = ['noPeek', 'noAds', 'hideChannelReactions', 'transcribeAccurate', 'theme'];

/** The settings as the text of the file */
export function exportSettingsText() {
  const settings = plumaSettings();
  const web: Partial<PlumaSettings> = {};
  for(const key of KEYS) (web as any)[key] = settings[key];
  return JSON.stringify({app: 'PlumaGram', kind: 'settings', v: 1, updated: Date.now(), by: 'web', web, filters: getFilterRules()}, null, 1);
}

export function exportSettings() {
  const blob = new Blob([exportSettingsText()], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = FILE_NAME;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(pt('Настройки сохранены в файл «PlumaGram-настройки.json»', 'Settings saved to «PlumaGram-настройки.json»'));
}

/** Takes the settings from the text of a file; only known settings of the right kind, nothing else */
export function importSettingsText(text: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch(err) {}
  if(!parsed || parsed.app !== 'PlumaGram' || parsed.kind !== 'settings' || typeof parsed.web !== 'object') {
    throw new Error(pt('это не файл настроек PlumaGram', 'not a PlumaGram settings file'));
  }

  for(const key of KEYS) {
    const value = parsed.web[key];
    if(value === undefined) continue;
    if(typeof value !== typeof plumaSettings()[key]) continue;
    setPlumaSetting(key, value);
  }

  if(Array.isArray(parsed.filters)) {
    const rules = (parsed.filters as FilterRule[]).filter((rule) => rule && typeof rule.text === 'string' && rule.text && typeof rule.scope === 'number').slice(0, 500);
    for(let i = getFilterRules().length - 1; i >= 0; --i) removeFilterRule(i);
    rules.forEach((rule) => addFilterRule({
      text: rule.text.slice(0, 200),
      scope: rule.scope,
      hideFully: !!rule.hideFully,
      regex: !!rule.regex,
      matchCase: !!rule.matchCase,
      wholeWord: !!rule.wholeWord,
      chatId: rule.chatId,
      chatTitle: typeof rule.chatTitle === 'string' ? rule.chatTitle.slice(0, 64) : undefined
    }));
  }
}

export function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async() => {
    const file = input.files?.[0];
    if(!file) return;
    if(file.size > 512 * 1024) {
      toast(pt('Файл слишком большой для настроек', 'The file is too big for settings'));
      return;
    }
    try {
      importSettingsText(await file.text());
      toast(pt('Настройки загружены. Тема применится после перезагрузки страницы', 'Settings loaded. The theme applies after reloading the page'));
    } catch(err) {
      toast(pt('Не удалось загрузить: ', 'Could not load: ') + (err as Error).message);
    }
  });
  input.click();
}
