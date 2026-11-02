/*
 * PlumaGram — the message menu (right click) as one likes it, as in the app's MagiX: which items it has and in what
 * order, and our own actions in it (remind later, save to Saved, hide similar; in Saved — to a folder, a tag).
 * Items are known by their language key; the ones met in menus are remembered, so the editor shows the real list.
 */

import I18n from '@lib/langPack';
import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';
import {pt} from '@/plumagram/settings';
import {createOverlay, focusSoon, makeTitle} from '@/plumagram/overlay';
import Icon from '@components/icon';
import liteMode from '@helpers/liteMode';

const STORAGE_KEY = 'plumagram:message-menu';

type MenuSettings = {order: string[], hidden: string[], seen: {[id: string]: string}, icons: {[id: string]: string}};

function load(): MenuSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {order: raw.order || [], hidden: raw.hidden || [], seen: raw.seen || {}, icons: raw.icons || {}};
  } catch(err) {
    return {order: [], hidden: [], seen: {}, icons: {}};
  }
}

function save(settings: MenuSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch(err) {}
}

type OwnItem = {id: string, icon: string, label: () => string, onlySaved?: boolean, run: () => void};

const OWN_ITEMS: OwnItem[] = [{
  id: 'pg:remind', icon: 'schedule', label: () => pt('Напомнить позже…', 'Remind me later…'),
  run: () => import('@/plumagram/messageHotkeys').then(({runMessageHotkey}) => runMessageHotkey('remind'))
}, {
  id: 'pg:saved', icon: 'savedmessages', label: () => pt('Сохранить в Избранное', 'Save to Saved Messages'),
  run: () => import('@/plumagram/messageHotkeys').then(({runMessageHotkey}) => runMessageHotkey('saved'))
}, {
  id: 'pg:folder', icon: 'folder', label: () => pt('В папку Хранилища…', 'To a storage folder…'), onlySaved: true,
  run: () => import('@/plumagram/storage').then(({putHoveredIntoFolder}) => putHoveredIntoFolder())
}, {
  id: 'pg:tag', icon: 'tag', label: () => pt('Поставить метку…', 'Add a tag…'), onlySaved: true,
  run: () => import('@/plumagram/storage').then(({tagHoveredSavedMessage}) => tagHoveredSavedMessage())
}, {
  id: 'pg:similar', icon: 'eyecross', label: () => pt('Скрывать похожие…', 'Hide similar messages…'),
  run: () => import('@/plumagram/filters').then(({hideSimilarToHovered}) => hideSimilarToHovered())
}];

/** An item's name: its language key, or its icon for items made with their own text (as «Удалить») */
function idOf(button: ButtonMenuItemOptionsVerifiable) {
  return (button as any).pgId || (button.text as string) || (button.icon ? 'icon:' + button.icon : undefined);
}

function labelOf(button: ButtonMenuItemOptionsVerifiable) {
  const own = (button as any).pgId;
  if(own) return OWN_ITEMS.find((item) => item.id === own)?.label();
  if(button.text) return I18n.format(button.text as any, true);
  const text = button.textElement?.textContent || (typeof button.regularText === 'string' ? button.regularText : '');
  return text?.trim() || undefined;
}

/**
 * The menu's items as set: ours added (for a message), hidden ones left out, the chosen order first.
 * `forMessage` — the menu is of one message (not a selection, a link or a sticker set).
 */
export function arrangeMessageMenu<T extends ButtonMenuItemOptionsVerifiable>(buttons: T[], options: {forMessage: boolean, inSaved: boolean}): T[] {
  const settings = load();

  const own: T[] = !options.forMessage ? [] : OWN_ITEMS
  .filter((item) => !item.onlySaved || options.inSaved)
  .filter((item) => item.id !== 'pg:saved' || !options.inSaved)
  .map((item) => ({icon: item.icon as any, regularText: item.label(), onClick: item.run, pgId: item.id} as any as T));

  // * ours go before «Удалить» (the red one stays last, as one is used to)
  const dangerIdx = buttons.findIndex((button) => button.danger || button.icon === 'delete');
  const all = dangerIdx === -1 ? [...buttons, ...own] : [...buttons.slice(0, dangerIdx), ...own, ...buttons.slice(dangerIdx)];

  // * remember what menus have, with the words they show: the editor lists these
  let changed = false;
  for(const button of all) {
    const id = idOf(button);
    if(!id) continue;
    const label = labelOf(button);
    if(label && settings.seen[id] !== label) {
      settings.seen[id] = label;
      changed = true;
    }
    // * and its icon: the editor shows the items as the menu does
    if(button.icon && settings.icons[id] !== button.icon) {
      settings.icons[id] = button.icon;
      changed = true;
    }
  }
  if(changed) save(settings);

  const shown = all.filter((button) => !settings.hidden.includes(idOf(button)));
  const rank = (button: ButtonMenuItemOptionsVerifiable) => {
    const idx = settings.order.indexOf(idOf(button));
    return idx === -1 ? Infinity : idx;
  };
  return shown.map((button, idx) => ({button, idx}))
  .sort((a, b) => (rank(a.button) - rank(b.button)) || (a.idx - b.idx))
  .map(({button}) => button);
}

/** The editor: every item met in menus, a switch to show it and arrows to move it */
export function openMessageMenuEditor(onBack?: () => void) {
  const settings = load();
  OWN_ITEMS.forEach((item) => {
    settings.seen[item.id] ??= item.label();
    settings.icons[item.id] ??= item.icon;
  });

  const ids = Object.keys(settings.seen);
  const ordered = [...settings.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !settings.order.includes(id))];

  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const hint = document.createElement('div');
  hint.className = 'pg-settings-hint';
  hint.textContent = pt(
    'Галочка — пункт есть в меню по правому щелчку; стрелки — порядок. Пункты появляются здесь, когда встретились в меню хоть раз.',
    'A tick — the item is in the right-click menu; arrows — the order. Items appear here once met in a menu.'
  );

  const list = document.createElement('div');
  list.className = 'pg-list';

  const render = () => {
    // * a row that moved slides from where it was (FLIP), with full animations only: a reorder is movement
    const before = new Map<string, number>();
    if(liteMode.isAvailable('motion')) {
      list.querySelectorAll<HTMLElement>('.pg-menu-row').forEach((row) => before.set(row.dataset.id, row.getBoundingClientRect().top));
    }

    list.replaceChildren(...ordered.map((id, idx) => {
      const row = document.createElement('div');
      row.className = 'pg-item pg-menu-row' + (id.startsWith('pg:') ? ' is-own' : '');
      row.dataset.id = id;

      // * a tick of our own: the app hides the browser's checkboxes everywhere
      const box = document.createElement('button');
      box.className = 'pg-check';
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-label', settings.seen[id]);
      box.append(Icon('check'));
      const paint = () => {
        const on = !settings.hidden.includes(id);
        box.classList.toggle('is-on', on);
        box.setAttribute('aria-checked', String(on));
        row.classList.toggle('is-off', !on);
      };
      box.addEventListener('click', () => {
        settings.hidden = settings.hidden.includes(id) ? settings.hidden.filter((h) => h !== id) : [...settings.hidden, id];
        save(settings);
        paint();
      });

      // * the item as the menu shows it: its icon (ours in the accent colour) and its words
      const icon = settings.icons[id] ? Icon(settings.icons[id] as Icon, 'pg-menu-row-icon') : document.createElement('span');
      icon.classList.add('pg-menu-row-icon');
      const label = document.createElement('span');
      label.className = 'pg-item-title';
      label.textContent = settings.seen[id];
      label.dir = 'auto';

      const move = (delta: number) => () => {
        const to = idx + delta;
        if(to < 0 || to >= ordered.length) return;
        [ordered[idx], ordered[to]] = [ordered[to], ordered[idx]];
        settings.order = [...ordered];
        save(settings);
        render();
        // * the focus stays on the moved row's arrow; at the end of the list on the other one
        const moved = list.children[to];
        const same = moved?.querySelector<HTMLButtonElement>(delta < 0 ? '.pg-up' : '.pg-down');
        (same && !same.disabled ? same : moved?.querySelector<HTMLElement>(delta < 0 ? '.pg-down' : '.pg-up'))?.focus();
      };
      const arrow = (className: string, iconName: Icon, text: string, delta: number) => {
        const button = document.createElement('button');
        button.className = 'pg-arrow ' + className;
        button.append(Icon(iconName));
        button.setAttribute('aria-label', text);
        button.disabled = idx + delta < 0 || idx + delta >= ordered.length;
        button.addEventListener('click', move(delta));
        return button;
      };

      row.append(box, icon, label, arrow('pg-up', 'up', pt('Выше', 'Up'), -1), arrow('pg-down', 'down', pt('Ниже', 'Down'), 1));
      paint();
      return row;
    }));

    if(!before.size) return;
    const moved: HTMLElement[] = [];
    list.querySelectorAll<HTMLElement>('.pg-menu-row').forEach((row) => {
      const was = before.get(row.dataset.id);
      const shift = was === undefined ? 0 : was - row.getBoundingClientRect().top;
      if(!shift) return;
      row.style.transform = `translateY(${shift}px)`;
      moved.push(row);
    });
    // * two frames: the rows are drawn where they were first, then go to their places
    requestAnimationFrame(() => requestAnimationFrame(() => moved.forEach((row) => {
      row.classList.add('is-moving');
      row.style.transform = '';
      row.addEventListener('transitionend', () => row.classList.remove('is-moving'), {once: true});
    })));
  };
  render();

  const reset = document.createElement('button');
  reset.className = 'pg-storage-tag';
  reset.textContent = pt('Как было', 'Reset');
  reset.addEventListener('click', () => {
    settings.order = [];
    settings.hidden = [];
    save(settings);
    ordered.splice(0, ordered.length, ...ids);
    render();
  });
  const footer = document.createElement('div');
  footer.className = 'pg-settings-row';
  footer.append(reset);

  panel.append(makeTitle(pt('Меню сообщения', 'Message menu'), true, onBack), hint, list, footer);
  createOverlay(panel, undefined, onBack);
  focusSoon(panel);
}
