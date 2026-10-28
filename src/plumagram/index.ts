/*
 * PlumaGram — web version additions: «Не подглядывай!», «Без рекламы», command palette (Ctrl+K)
 * and own hotkeys. Everything of ours lives in this folder; Web K files only call into it.
 */

import {createEffect, createRoot} from 'solid-js';
import {toast} from '@components/toast';
import {plumaSettings, pt, togglePlumaSetting} from '@/plumagram/settings';
import {MessageHotkeyAction, runMessageHotkey, toggleChatTranslation} from '@/plumagram/messageHotkeys';
import '@/plumagram/plumagram.scss';

type PaletteAction = {
  id: string,
  title: () => string,
  keywords?: string,
  hotkey?: string,
  state?: () => string,
  run: () => void
};

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌥' : 'Alt';

function onOff(value: boolean) {
  return value ? pt('вкл', 'on') : pt('выкл', 'off');
}

export function toggleNoPeek() {
  const on = togglePlumaSetting('noPeek');
  toast(on ?
    pt('«Не подглядывай!» включено — наведи, чтобы прочитать', '«No peeking!» is on — hover to read') :
    pt('«Не подглядывай!» выключено', '«No peeking!» is off'));
}

export function toggleNoAds() {
  const on = togglePlumaSetting('noAds');
  toast(on ?
    pt('Реклама скрыта — в открытых заново чатах её не будет', 'Ads are hidden in chats opened from now on') :
    pt('Реклама снова показывается', 'Ads are shown again'));
}

async function openSavedMessages() {
  const {default: appImManager} = await import('@lib/appImManager');
  appImManager.setPeer({peerId: appImManager.myId});
}

async function openSettings() {
  const [{default: appSidebarLeft}, {AppSettingsTab}] = await Promise.all([
    import('@components/sidebarLeft'),
    import('@components/solidJsTabs')
  ]);
  appSidebarLeft.createTab(AppSettingsTab).open();
}

async function openSearch() {
  const {default: appSidebarLeft} = await import('@components/sidebarLeft');
  appSidebarLeft.initSearch().open();
  appSidebarLeft.inputSearch?.input?.focus();
}

async function toggleNight() {
  const {default: themeController} = await import('@helpers/themeController');
  themeController.switchTheme();
}

const ACTIONS: PaletteAction[] = [{
  id: 'noPeek',
  title: () => pt('Не подглядывай! (размыть чаты)', 'No peeking! (blur chats)'),
  keywords: 'blur privacy hide размыть скрыть приватность',
  hotkey: `${ALT}+H`,
  state: () => onOff(plumaSettings().noPeek),
  run: toggleNoPeek
}, {
  id: 'noAds',
  title: () => pt('Без рекламы', 'No ads'),
  keywords: 'ads sponsored реклама спонсор',
  state: () => onOff(plumaSettings().noAds),
  run: toggleNoAds
}, {
  id: 'reply',
  title: () => pt('Ответить на сообщение под мышью', 'Reply to the message under the pointer'),
  keywords: 'reply ответ ответить',
  hotkey: `${ALT}+R`,
  run: () => runMessageHotkey('reply')
}, {
  id: 'forward',
  title: () => pt('Переслать сообщение под мышью', 'Forward the message under the pointer'),
  keywords: 'forward переслать',
  hotkey: `${ALT}+F`,
  run: () => runMessageHotkey('forward')
}, {
  id: 'toSaved',
  title: () => pt('Сообщение под мышью — в Избранное', 'Message under the pointer to Saved Messages'),
  keywords: 'save saved store хранилище избранное сохранить',
  hotkey: `${ALT}+S`,
  run: () => runMessageHotkey('saved')
}, {
  id: 'pin',
  title: () => pt('Закрепить сообщение под мышью', 'Pin the message under the pointer'),
  keywords: 'pin unpin закрепить открепить',
  hotkey: `${ALT}+P`,
  run: () => runMessageHotkey('pin')
}, {
  id: 'translate',
  title: () => pt('Перевести сообщение под мышью', 'Translate the message under the pointer'),
  keywords: 'translate перевод перевести',
  hotkey: `${ALT}+T`,
  run: () => runMessageHotkey('translate')
}, {
  id: 'translateChat',
  title: () => pt('Перевести весь чат', 'Translate the whole chat'),
  keywords: 'translate chat перевод перевести чат весь',
  hotkey: `${ALT}+⇧+T`,
  run: () => toggleChatTranslation()
}, {
  id: 'saved',
  title: () => pt('Избранное', 'Saved Messages'),
  keywords: 'saved favorites избранное заметка note',
  hotkey: `${MOD}+0`,
  run: openSavedMessages
}, {
  id: 'search',
  title: () => pt('Поиск', 'Search'),
  keywords: 'search find поиск найти',
  run: openSearch
}, {
  id: 'night',
  title: () => pt('Ночная тема', 'Night mode'),
  keywords: 'theme dark night тема тёмная темная ночь',
  run: toggleNight
}, {
  id: 'settings',
  title: () => pt('Настройки', 'Settings'),
  keywords: 'settings настройки',
  run: openSettings
}, {
  id: 'plumaSettings',
  title: () => pt('Настройки PlumaGram', 'PlumaGram settings'),
  keywords: 'plumagram magix фишки features',
  run: () => openPlumaSettings()
}];

let openOverlay: HTMLElement;

function closeOverlay() {
  openOverlay?.remove();
  openOverlay = undefined;
}

function createOverlay(panel: HTMLElement) {
  closeOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'pg-overlay';
  overlay.append(panel);
  overlay.addEventListener('mousedown', (e) => {
    if(e.target === overlay) closeOverlay();
  });
  overlay.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    }
  });
  document.body.append(overlay);
  openOverlay = overlay;
  return overlay;
}

export function openCommandPalette() {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');

  const input = document.createElement('input');
  input.className = 'pg-palette-input';
  input.placeholder = pt('Найти действие…', 'Find an action…');
  input.setAttribute('aria-label', input.placeholder);

  const list = document.createElement('div');
  list.className = 'pg-list';
  list.setAttribute('role', 'listbox');

  panel.append(input, list);
  createOverlay(panel);

  let filtered: PaletteAction[] = [];
  let active = 0;

  const run = (action: PaletteAction) => {
    closeOverlay();
    action.run();
  };

  const render = () => {
    const query = input.value.trim().toLowerCase();
    filtered = ACTIONS.filter((action) => {
      if(!query) return true;
      const haystack = (action.title() + ' ' + (action.keywords || '')).toLowerCase();
      return query.split(/\s+/).every((word) => haystack.includes(word));
    });
    active = Math.min(active, Math.max(0, filtered.length - 1));

    list.replaceChildren(...filtered.map((action, idx) => {
      const item = document.createElement('div');
      item.className = 'pg-item' + (idx === active ? ' is-active' : '');
      item.setAttribute('role', 'option');

      const title = document.createElement('span');
      title.className = 'pg-item-title';
      title.textContent = action.title();
      item.append(title);

      if(action.state) {
        const state = document.createElement('span');
        state.className = 'pg-item-state';
        state.textContent = action.state();
        item.append(state);
      }

      if(action.hotkey) {
        const kbd = document.createElement('kbd');
        kbd.textContent = action.hotkey;
        item.append(kbd);
      }

      item.addEventListener('mousemove', () => {
        if(active === idx) return;
        active = idx;
        render();
      });
      item.addEventListener('click', () => run(action));
      return item;
    }));

    if(!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'pg-empty';
      empty.textContent = pt('Ничего не нашлось', 'Nothing found');
      list.append(empty);
    }
  };

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if(!filtered.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      render();
      list.children[active]?.scrollIntoView({block: 'nearest'});
    } else if(e.key === 'Enter') {
      e.preventDefault();
      const action = filtered[active];
      action && run(action);
    }
  });

  render();
  input.focus();
}

export function openPlumaSettings() {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const title = document.createElement('div');
  title.className = 'pg-settings-title';
  title.textContent = 'PlumaGram';

  const makeRow = (key: 'noPeek' | 'noAds', text: string, sub: string, toggle: () => void) => {
    const row = document.createElement('div');
    row.className = 'pg-settings-row';
    row.setAttribute('role', 'switch');
    row.tabIndex = 0;

    const texts = document.createElement('div');
    texts.className = 'pg-settings-row-text';
    const main = document.createElement('div');
    main.textContent = text;
    const secondary = document.createElement('div');
    secondary.className = 'pg-settings-row-sub';
    secondary.textContent = sub;
    texts.append(main, secondary);

    const sw = document.createElement('div');
    sw.className = 'pg-switch';

    const update = () => {
      const on = plumaSettings()[key];
      sw.classList.toggle('is-on', on);
      row.setAttribute('aria-checked', String(on));
    };
    update();

    const onToggle = () => {
      toggle();
      update();
    };
    row.addEventListener('click', onToggle);
    row.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    });

    row.append(texts, sw);
    return row;
  };

  const hint = document.createElement('div');
  hint.className = 'pg-settings-hint';
  hint.textContent = pt(
    `${MOD}+K — все действия по названию · ${ALT}+H — «Не подглядывай!» · ${MOD}+0 — Избранное. ` +
    `Сообщение под мышью: ${ALT}+R — ответить, ${ALT}+F — переслать, ${ALT}+S — в Избранное, ${ALT}+P — закрепить, ${ALT}+T — перевести; ${ALT}+⇧+T — перевести весь чат`,
    `${MOD}+K — every action by name · ${ALT}+H — «No peeking!» · ${MOD}+0 — Saved Messages. ` +
    `Message under the pointer: ${ALT}+R — reply, ${ALT}+F — forward, ${ALT}+S — to Saved, ${ALT}+P — pin, ${ALT}+T — translate; ${ALT}+⇧+T — translate the whole chat`
  );

  panel.append(
    title,
    makeRow('noPeek', pt('Не подглядывай!', 'No peeking!'), pt('Размывать список чатов и сообщения, открывать при наведении', 'Blur the chat list and messages, reveal on hover'), toggleNoPeek),
    makeRow('noAds', pt('Без рекламы', 'No ads'), pt('Не показывать рекламные сообщения в каналах и ботах', 'Hide sponsored messages in channels and bots'), toggleNoAds),
    hint
  );

  createOverlay(panel);
  panel.focus();
}

function isEditable(target: EventTarget) {
  const el = target as HTMLElement;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function onKeyDown(e: KeyboardEvent) {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;

  // * Ctrl+K: in a text field it keeps adding a link to the selected text; with nothing selected — the palette
  if(mod && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
    const selection = document.getSelection();
    const hasSelection = selection && !selection.isCollapsed;
    if(isEditable(e.target) && hasSelection) return;
    e.preventDefault();
    e.stopPropagation();
    if(openOverlay) closeOverlay();
    else openCommandPalette();
    return;
  }

  if(!e.altKey || e.ctrlKey || e.metaKey) return;

  if(e.shiftKey) {
    if(e.code === 'KeyT') {
      e.preventDefault();
      e.stopPropagation();
      toggleChatTranslation();
    }
    return;
  }

  if(e.code === 'KeyH') {
    e.preventDefault();
    e.stopPropagation();
    toggleNoPeek();
    return;
  }

  const messageAction = MESSAGE_HOTKEYS[e.code];
  if(messageAction) {
    e.preventDefault();
    e.stopPropagation();
    runMessageHotkey(messageAction);
  }
}

const MESSAGE_HOTKEYS: {[code: string]: MessageHotkeyAction} = {
  KeyR: 'reply',
  KeyF: 'forward',
  KeyS: 'saved',
  KeyP: 'pin',
  KeyT: 'translate'
};

export default function initPlumaGram() {
  window.addEventListener('keydown', onKeyDown, {capture: true});

  createRoot(() => {
    createEffect(() => {
      document.body.classList.toggle('pg-no-peek', plumaSettings().noPeek);
    });
  });

  (window as any).plumagram = {openCommandPalette, openPlumaSettings, settings: plumaSettings};
}
