/*
 * PlumaGram — web version additions: «Не подглядывай!», «Без рекламы», command palette (Ctrl+K)
 * and own hotkeys. Everything of ours lives in this folder; Web K files only call into it.
 */

import {createEffect, createRoot} from 'solid-js';
import {toast} from '@components/toast';
import {getLastNotifiedPeer, isQuietNow, plumaSettings, pt, setPlumaSetting, togglePlumaSetting} from '@/plumagram/settings';
import {MessageHotkeyAction, runMessageHotkey, toggleChatTranslation} from '@/plumagram/messageHotkeys';
import {ChoiceOption, closeOverlay, createOverlay, isOverlayOpen, openChoicePicker, focusSoon, makeTitle} from '@/plumagram/overlay';
import {hideSimilarToHovered, initFilters, openFiltersManager} from '@/plumagram/filters';
import {initServiceFileLine, openStorage, putHoveredIntoFolder, tagHoveredSavedMessage} from '@/plumagram/storage';
import {getTargetSnippet, initMessageTarget} from '@/plumagram/target';
import {initThemes, openThemePicker} from '@/plumagram/themes';
import {exportSettings, importSettings} from '@/plumagram/settingsTransfer';
import {openComposeHelper, openWhatIMissed} from '@/plumagram/ai';
import '@/plumagram/plumagram.scss';

type PaletteAction = {
  id: string,
  /** acts on a message: shown only when there is one (under the pointer or hovered last), named by its words */
  onMessage?: boolean,
  title: () => string,
  keywords?: string,
  hotkey?: string,
  state?: () => string,
  run: () => void
};

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// * on a Mac keys go together without a plus (⌥H, ⌘K), as the system writes them
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const ALT = IS_MAC ? '⌥' : 'Alt+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

function onOff(value: boolean) {
  return value ? pt('вкл', 'on') : pt('выкл', 'off');
}

// * while «Не подглядывай!» is on, a small mark in the corner says so and turns it off (pressed by chance,
// * a blurred screen with no word of why)
let noPeekBadge: HTMLElement;
function toggleNoPeekBadge(on: boolean) {
  if(!on) {
    noPeekBadge?.remove();
    noPeekBadge = undefined;
    return;
  }
  if(noPeekBadge) return;
  noPeekBadge = document.createElement('button');
  noPeekBadge.className = 'pg-no-peek-badge';
  noPeekBadge.textContent = pt(`Не подглядывай · ${ALT}H`, `No peeking · ${ALT}H`);
  noPeekBadge.title = pt('Выключить', 'Turn off');
  noPeekBadge.addEventListener('click', toggleNoPeek);
  document.body.append(noPeekBadge);
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

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/** «Тихий режим» of the open chat: the mute window with short times on top (15 and 30 minutes) */
async function muteOpenChat() {
  const {default: appImManager} = await import('@lib/appImManager');
  const chat = appImManager.chat;
  if(!chat?.peerId) {
    toast(pt('Сначала открой чат', 'Open a chat first'));
    return;
  }

  const {default: showMutePopup} = await import('@components/popups/mute');
  showMutePopup(chat.peerId, chat.threadId);
}

/** «Не беспокоить» на N минут: no notifications and sounds in this tab */
function openQuietPicker() {
  const quietFor = (minutes: number) => () => {
    const until = minutes ? Date.now() + minutes * 60e3 : 0;
    setPlumaSetting('quietUntil', until);
    toast(until ?
      pt(`Не беспокоить до ${formatTime(until)} — уведомлений и звуков не будет`, `Do not disturb until ${formatTime(until)} — no notifications or sounds`) :
      pt('«Не беспокоить» выключено', 'Do not disturb is off'));
  };

  const options: ChoiceOption[] = [
    {text: pt('15 минут', '15 minutes'), run: quietFor(15)},
    {text: pt('30 минут', '30 minutes'), run: quietFor(30)},
    {text: pt('1 час', '1 hour'), run: quietFor(60)},
    {text: pt('2 часа', '2 hours'), run: quietFor(120)},
    {text: pt('4 часа', '4 hours'), run: quietFor(240)},
    {text: pt('8 часов', '8 hours'), run: quietFor(480)}
  ];
  if(isQuietNow()) {
    options.push({text: pt('Выключить', 'Turn off'), run: quietFor(0)});
  }

  openChoicePicker(isQuietNow() ?
    pt(`Не беспокоить — до ${formatTime(plumaSettings().quietUntil)}`, `Do not disturb — until ${formatTime(plumaSettings().quietUntil)}`) :
    pt('Не беспокоить', 'Do not disturb'), options);
}

export function toggleChannelReactions() {
  const on = togglePlumaSetting('hideChannelReactions');
  toast(on ?
    pt('Реакции в каналах скрыты', 'Reactions in channels are hidden') :
    pt('Реакции в каналах снова видны', 'Reactions in channels are shown again'));
}

// * where «последнее уведомление» jumped from, to go back by the same key
let jumpedFromPeerId: PeerId;

/** «Последнее уведомление и обратно»: to the chat of the last notification, and by the same key back */
async function jumpToLastNotification() {
  const {default: appImManager} = await import('@lib/appImManager');
  const current = appImManager.chat?.peerId;
  const last = getLastNotifiedPeer();

  if(jumpedFromPeerId && current === last) {
    const back = jumpedFromPeerId;
    jumpedFromPeerId = undefined;
    appImManager.setPeer({peerId: back});
    return;
  }

  if(!last) {
    toast(pt('Уведомлений пока не было', 'No notifications yet'));
    return;
  }

  jumpedFromPeerId = current || undefined;
  appImManager.setPeer({peerId: last});
}

/** Next signed-in account, round */
async function switchToNextAccount() {
  const [{default: AccountController}, {getCurrentAccount}, {default: switchAccount}] = await Promise.all([
    import('@lib/accounts/accountController'),
    import('@lib/accounts/getCurrentAccount'),
    import('@lib/accounts/switchAccount')
  ]);
  const total = await AccountController.getTotalAccounts();
  if(total < 2) {
    toast(pt('Вошли только в один аккаунт — добавить: меню ☰ → аккаунт', 'Only one account is signed in'));
    return;
  }
  const next = (getCurrentAccount() % total) + 1;
  switchAccount(next as any);
}

/** «Заметка»: Saved Messages with the cursor in the message field */
async function openNote() {
  const {default: appImManager} = await import('@lib/appImManager');
  await appImManager.setPeer({peerId: appImManager.myId});
  setTimeout(() => {
    (document.querySelector('.chat:not(.hide) .chat-input [contenteditable="true"]') as HTMLElement)?.focus();
  }, 300);
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
  hotkey: `${ALT}H`,
  state: () => onOff(plumaSettings().noPeek),
  run: toggleNoPeek
}, {
  id: 'noAds',
  title: () => pt('Без рекламы', 'No ads'),
  keywords: 'ads sponsored реклама спонсор',
  state: () => onOff(plumaSettings().noAds),
  run: toggleNoAds
}, {
  id: 'hideChannelReactions',
  title: () => pt('Скрыть реакции в каналах', 'Hide reactions in channels'),
  keywords: 'reactions channels реакции каналы скрыть',
  state: () => onOff(plumaSettings().hideChannelReactions),
  run: toggleChannelReactions
}, {
  id: 'muteChat',
  title: () => pt('Тихий режим этого чата…', 'Mute this chat for…'),
  keywords: 'mute quiet silent тихий режим звук выключить заглушить',
  hotkey: `${ALT}M`,
  run: muteOpenChat
}, {
  id: 'quiet',
  title: () => pt('Не беспокоить…', 'Do not disturb…'),
  keywords: 'quiet dnd do not disturb notifications не беспокоить уведомления тишина',
  hotkey: `${ALT}D`,
  state: () => isQuietNow() ? pt(`до ${formatTime(plumaSettings().quietUntil)}`, `until ${formatTime(plumaSettings().quietUntil)}`) : onOff(false),
  run: openQuietPicker
}, {
  id: 'reply',
  onMessage: true,
  title: () => pt('Ответить', 'Reply'),
  keywords: 'reply ответ ответить',
  hotkey: `${ALT}R`,
  run: () => runMessageHotkey('reply')
}, {
  id: 'forward',
  onMessage: true,
  title: () => pt('Переслать', 'Forward'),
  keywords: 'forward переслать',
  hotkey: `${ALT}F`,
  run: () => runMessageHotkey('forward')
}, {
  id: 'toSaved',
  onMessage: true,
  title: () => pt('Сохранить в Избранное', 'Save to Saved Messages'),
  keywords: 'save saved store хранилище избранное сохранить',
  hotkey: `${ALT}S`,
  run: () => runMessageHotkey('saved')
}, {
  id: 'remind',
  onMessage: true,
  title: () => pt('Напомнить позже…', 'Remind me later…'),
  keywords: 'remind reminder later напомнить напоминание позже',
  hotkey: `${ALT}N`,
  run: () => runMessageHotkey('remind')
}, {
  id: 'hideSimilar',
  onMessage: true,
  title: () => pt('Скрывать похожие…', 'Hide similar messages…'),
  keywords: 'filter hide similar фильтр скрыть похожие',
  hotkey: `${ALT}X`,
  run: hideSimilarToHovered
}, {
  id: 'filters',
  title: () => pt('Фильтры сообщений', 'Message filters'),
  keywords: 'filter filters rules фильтры правила скрытые',
  run: () => openFiltersManager()
}, {
  id: 'pin',
  onMessage: true,
  title: () => pt('Закрепить', 'Pin'),
  keywords: 'pin unpin закрепить открепить',
  hotkey: `${ALT}P`,
  run: () => runMessageHotkey('pin')
}, {
  id: 'translate',
  onMessage: true,
  title: () => pt('Перевести', 'Translate'),
  keywords: 'translate перевод перевести',
  hotkey: `${ALT}T`,
  run: () => runMessageHotkey('translate')
}, {
  id: 'translateChat',
  title: () => pt('Перевести весь чат', 'Translate the whole chat'),
  keywords: 'translate chat перевод перевести чат весь',
  hotkey: `${ALT}${SHIFT}T`,
  run: () => toggleChatTranslation()
}, {
  id: 'lastNotification',
  title: () => pt('Последнее уведомление и обратно', 'Last notification and back'),
  keywords: 'notification last jump back уведомление последнее назад обратно',
  hotkey: `${ALT}J`,
  run: jumpToLastNotification
}, {
  id: 'nextAccount',
  title: () => pt('Следующий аккаунт', 'Next account'),
  keywords: 'account switch аккаунт сменить переключить',
  hotkey: `${ALT}A`,
  run: switchToNextAccount
}, {
  id: 'note',
  title: () => pt('Заметка (в Избранное)', 'Note (to Saved Messages)'),
  keywords: 'note заметка записать memo',
  hotkey: `${ALT}Z`,
  run: openNote
}, {
  id: 'storage',
  title: () => pt('Хранилище', 'Storage'),
  keywords: 'storage tags saved хранилище метки избранное теги',
  hotkey: `${ALT}B`,
  run: openStorage
}, {
  id: 'tagSaved',
  onMessage: true,
  title: () => pt('Поставить метку (своё сообщение в Избранном)…', 'Add a tag (your message in Saved)…'),
  keywords: 'tag hashtag метка хэштег хранилище',
  hotkey: `${ALT}3`,
  run: tagHoveredSavedMessage
}, {
  id: 'toFolder',
  onMessage: true,
  title: () => pt('В папку Хранилища…', 'To a storage folder…'),
  keywords: 'folder папка хранилище положить',
  hotkey: `${ALT}4`,
  run: putHoveredIntoFolder
}, {
  id: 'aiHelper',
  title: () => pt('ИИ-помощник для набранного сообщения…', 'AI helper for the typed message…'),
  keywords: 'ai ии помощник исправить ошибки эмодзи короче перевести proofread',
  hotkey: `${ALT}I`,
  run: openComposeHelper
}, {
  id: 'whatIMissed',
  title: () => pt('✨ Что пропустил в этом чате', '✨ What I missed in this chat'),
  keywords: 'ai ии пропустил кратко пересказ summary missed непрочитанные',
  run: openWhatIMissed
}, {
  id: 'saved',
  title: () => pt('Избранное', 'Saved Messages'),
  keywords: 'saved favorites избранное заметка note',
  hotkey: `${MOD}0`,
  run: openSavedMessages
}, {
  id: 'search',
  title: () => pt('Поиск', 'Search'),
  keywords: 'search find поиск найти',
  run: openSearch
}, {
  id: 'themes',
  title: () => pt('Тема как в приложении…', 'Theme as in the app…'),
  keywords: 'theme themes color colors тема темы цвет цвета палитра классика',
  run: () => openThemePicker()
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

const RECENT_KEY = 'plumagram:palette-recent';

function getRecent(): string[] {
  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(recent) ? recent : [];
  } catch(err) {
    return [];
  }
}

function rememberRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...getRecent().filter((other) => other !== id)].slice(0, 5)));
  } catch(err) {}
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
    rememberRecent(action.id);
    action.run();
  };

  const render = () => {
    const query = input.value.trim().toLowerCase();
    const snippet = getTargetSnippet();
    filtered = ACTIONS.filter((action) => {
      if(action.onMessage && !snippet) return false;
      if(!query) return true;
      const haystack = (action.title() + ' ' + (action.keywords || '')).toLowerCase();
      return query.split(/\s+/).every((word) => haystack.includes(word));
    });
    // * with nothing typed, the actions used last come first (the everyday ones are not looked for in a long list)
    if(!query) {
      const recent = getRecent();
      const rank = (action: PaletteAction) => {
        const idx = recent.indexOf(action.id);
        return idx === -1 ? recent.length : idx;
      };
      filtered = filtered.map((action, idx) => ({action, idx})).sort((a, b) => rank(a.action) - rank(b.action) || a.idx - b.idx).map(({action}) => action);
    }
    active = Math.min(active, Math.max(0, filtered.length - 1));

    list.replaceChildren(...filtered.map((action, idx) => {
      const item = document.createElement('div');
      item.className = 'pg-item' + (idx === active ? ' is-active' : '');
      item.setAttribute('role', 'option');

      const title = document.createElement('span');
      title.className = 'pg-item-title';
      title.textContent = action.title();
      item.append(title);

      if(action.onMessage) {
        const target = document.createElement('span');
        target.className = 'pg-item-target';
        target.textContent = `«${snippet}»`;
        title.append(target);
      }

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
  focusSoon(input);
}

/** Every PlumaGram shortcut, in groups, one per line (also from Web K's own «Сочетания клавиш») */
export function openPlumaHotkeys() {
  openHotkeysList();
}

function openHotkeysList() {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const list = document.createElement('div');
  list.className = 'pg-list';

  const group = (name: string, rows: [string, string][]) => {
    const caption = document.createElement('div');
    caption.className = 'pg-settings-row-sub pg-storage-caption';
    caption.textContent = name;
    list.append(caption);
    rows.forEach(([text, keys]) => {
      const item = document.createElement('div');
      item.className = 'pg-item pg-item--static';
      const title = document.createElement('span');
      title.className = 'pg-item-title';
      title.textContent = text;
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      item.append(title, kbd);
      list.append(item);
    });
  };

  const withKeys = ACTIONS.filter((action) => action.hotkey);
  group(pt('Общие', 'General'), [
    [pt('Все действия по названию', 'Every action by name'), `${MOD}K`],
    ...withKeys.filter((action) => !action.onMessage).map((action) => [action.title(), action.hotkey] as [string, string])
  ]);
  group(pt('Сообщение под мышью (или последнее, на которое навёл)', 'The message under the pointer (or hovered last)'),
    withKeys.filter((action) => action.onMessage).map((action) => [action.title(), action.hotkey] as [string, string]));
  group(pt('В просмотре видео', 'In the video viewer'), [
    [pt('Пауза', 'Pause'), 'K'],
    [pt('10 секунд назад / вперёд', '10 seconds back / forward'), 'J / L'],
    [pt('К 0–90 % видео', 'To 0–90 % of the video'), '0–9'],
    [pt('Медленнее / быстрее', 'Slower / faster'), `${SHIFT}< / ${SHIFT}>`],
    [pt('Картинка в картинке', 'Picture in picture'), 'P']
  ]);

  panel.append(makeTitle(pt('Горячие клавиши', 'Keyboard shortcuts'), true, openPlumaSettings), list);
  createOverlay(panel, undefined, openPlumaSettings);
  focusSoon(panel);
}

export function openPlumaSettings() {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const title = makeTitle('PlumaGram');

  const makeRow = (key: 'noPeek' | 'noAds' | 'hideChannelReactions' | 'transcribeAccurate', text: string, sub: string, toggle: () => void) => {
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

  const filtersRow = document.createElement('div');
  filtersRow.className = 'pg-settings-row';
  filtersRow.tabIndex = 0;
  filtersRow.setAttribute('role', 'button');
  filtersRow.textContent = pt('Фильтры сообщений…', 'Message filters…');
  filtersRow.addEventListener('click', () => openFiltersManager(openPlumaSettings));

  const themesRow = document.createElement('div');
  themesRow.className = 'pg-settings-row';
  themesRow.tabIndex = 0;
  themesRow.setAttribute('role', 'button');
  themesRow.textContent = pt('Тема как в приложении…', 'Theme as in the app…');
  themesRow.addEventListener('click', () => openThemePicker(openPlumaSettings));

  const transferRow = document.createElement('div');
  transferRow.className = 'pg-settings-row';
  const saveButton = document.createElement('button');
  saveButton.className = 'pg-storage-tag';
  saveButton.textContent = pt('Сохранить настройки в файл', 'Save settings to a file');
  saveButton.addEventListener('click', exportSettings);
  const loadButton = document.createElement('button');
  loadButton.className = 'pg-storage-tag';
  loadButton.textContent = pt('Загрузить из файла', 'Load from a file');
  loadButton.addEventListener('click', importSettings);
  transferRow.append(saveButton, loadButton);

  const hotkeysRow = document.createElement('div');
  hotkeysRow.className = 'pg-settings-row';
  hotkeysRow.tabIndex = 0;
  hotkeysRow.setAttribute('role', 'button');
  hotkeysRow.textContent = pt('Горячие клавиши…', 'Keyboard shortcuts…');
  hotkeysRow.addEventListener('click', openHotkeysList);

  panel.append(
    title,
    makeRow('noPeek', pt('Не подглядывай!', 'No peeking!'), pt('Размывать список чатов и сообщения, открывать при наведении', 'Blur the chat list and messages, reveal on hover'), toggleNoPeek),
    makeRow('noAds', pt('Без рекламы', 'No ads'), pt('Не показывать рекламные сообщения в каналах и ботах', 'Hide sponsored messages in channels and bots'), toggleNoAds),
    makeRow('hideChannelReactions', pt('Скрыть реакции в каналах', 'Hide reactions in channels'), pt('Под постами каналов не будет реакций', 'No reactions under channel posts'), toggleChannelReactions),
    makeRow('transcribeAccurate', pt('Точная расшифровка голосовых', 'Accurate voice transcription'), pt('Модель крупнее (≈ 250 МБ, один раз): медленнее, но лучше слышит русский. Голос никуда не уходит', 'A bigger model (≈ 250 MB, once): slower, but hears better. The voice never leaves this computer'), () => togglePlumaSetting('transcribeAccurate')),
    themesRow,
    filtersRow,
    hotkeysRow,
    transferRow
  );

  createOverlay(panel);
  focusSoon(panel);
}

function isEditable(target: EventTarget) {
  const el = target as HTMLElement;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function onKeyDown(e: KeyboardEvent) {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;

  // * Esc closes our window wherever the focus is (otherwise it would close the chat under it)
  if(isOverlayOpen() && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeOverlay();
    return;
  }

  // * Ctrl+K: in a text field it keeps adding a link to the selected text; with nothing selected — the palette
  if(mod && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
    const selection = document.getSelection();
    const hasSelection = selection && !selection.isCollapsed;
    if(isEditable(e.target) && hasSelection) return;
    e.preventDefault();
    e.stopPropagation();
    if(isOverlayOpen()) closeOverlay();
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

  // * Option with a digit types a sign on a Mac (# on the British layout, € and others): in a text field it is
  // * left to the typing
  if(/^Digit\d$/.test(e.code) && isEditable(e.target)) return;

  const appAction = APP_HOTKEYS[e.code];
  if(appAction) {
    e.preventDefault();
    e.stopPropagation();
    appAction();
    return;
  }

  if(e.code === 'KeyM' || e.code === 'KeyD') {
    e.preventDefault();
    e.stopPropagation();
    e.code === 'KeyM' ? muteOpenChat() : openQuietPicker();
    return;
  }

  const messageAction = MESSAGE_HOTKEYS[e.code];
  if(messageAction) {
    e.preventDefault();
    e.stopPropagation();
    runMessageHotkey(messageAction);
  }
}

const APP_HOTKEYS: {[code: string]: () => void} = {
  KeyI: openComposeHelper,
  KeyB: openStorage,
  Digit3: tagHoveredSavedMessage,
  Digit4: putHoveredIntoFolder,
  KeyX: hideSimilarToHovered,
  KeyJ: jumpToLastNotification,
  KeyA: switchToNextAccount,
  KeyZ: openNote
};

const MESSAGE_HOTKEYS: {[code: string]: MessageHotkeyAction} = {
  KeyR: 'reply',
  KeyF: 'forward',
  KeyS: 'saved',
  KeyP: 'pin',
  KeyT: 'translate',
  KeyN: 'remind'
};

export default function initPlumaGram() {
  window.addEventListener('keydown', onKeyDown, {capture: true});
  initMessageTarget();
  initFilters();
  initServiceFileLine();
  initThemes();

  createRoot(() => {
    createEffect(() => {
      document.body.classList.toggle('pg-no-peek', plumaSettings().noPeek);
      toggleNoPeekBadge(plumaSettings().noPeek);
      document.body.classList.toggle('pg-hide-channel-reactions', plumaSettings().hideChannelReactions);
    });
  });

  (window as any).plumagram = {openCommandPalette, openPlumaSettings, settings: plumaSettings};
  import('@/plumagram/storageCloud').then(({storageChecks}) => (window as any).plumagram.storageChecks = storageChecks);
}
