/*
 * PlumaGram — the themes of the Android app in the web version: the same colours (themes.json is made from
 * the app's .tgx-theme files by scripts/plumagram-themes.mjs). Web K's own theme machinery does the rest:
 * every colour is given through themeController.applyAppColor, which makes its lighter and darker shades.
 */

import rootScope from '@lib/rootScope';
import {toast} from '@components/toast';
import {plumaSettings, pt, setPlumaSetting} from '@/plumagram/settings';
import {closeOverlay, createOverlay, focusSoon, makeTitle} from '@/plumagram/overlay';
import THEMES from '@/plumagram/themes.json';

type PlumaTheme = typeof THEMES[number];

const NAMES_RU: {[name: string]: string} = {
  'Blue': 'Синяя',
  'Night Black': 'Ночная чёрная',
  'Black White': 'Чёрно-белая',
  'White Black': 'Бело-чёрная',
  'Red': 'Красная',
  'Orange': 'Оранжевая',
  'Green': 'Зелёная',
  'Pink': 'Розовая',
  'Cyan': 'Бирюзовая',
  'Night Blue': 'Ночная синяя',
  'Classic': 'Классика'
};

export function themeName(theme: PlumaTheme) {
  return pt(NAMES_RU[theme.name] || theme.name, theme.name);
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let applying = false;

/** The chosen theme's colours over Web K's day or night one (it is switched to the theme's side first) */
async function applyColors(theme: PlumaTheme) {
  const {default: themeController} = await import('@helpers/themeController');
  if(themeController.isNight() !== theme.dark) {
    applying = true;
    await themeController.switchTheme(theme.dark ? 'night' : 'day');
    applying = false;
  }

  // * the page and every chat: Web K paints a chat on its own (for the themes a chat can have)
  const elements = [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('.chat'))];
  const accent = theme.colors['primary-color'];
  const l = luminance(accent);
  for(const element of elements) {
    for(const [name, hex] of Object.entries(theme.colors)) {
      if(hex) themeController.applyAppColor({name: name as any, hex, element, isNight: theme.dark, saveToCache: element === document.documentElement});
    }

    // * an accent as light as white (or as dark as black) on a monochrome theme: buttons get a grey fill,
    // * or their white text would not be seen
    if(l > .85 || l < .08) {
      element.style.setProperty('--primary-button-color', theme.dark ? '#5a5a5a' : '#3a3a3a');
    }
  }
  document.documentElement.dataset.plumaTheme = '' + theme.id;
}

function current(): PlumaTheme {
  const id = plumaSettings().theme;
  return id ? THEMES.find((theme) => theme.id === id) : undefined;
}

export function initThemes() {
  // * Web K paints its own colours on every theme change: ours go over them again right after
  rootScope.addEventListener('theme_changed', () => {
    const theme = current();
    if(!theme || applying) return;
    setTimeout(async() => {
      const {default: themeController} = await import('@helpers/themeController');
      if(themeController.isNight() !== theme.dark) {
        // * day or night was switched by hand (the menu's «Night mode»): our theme gives way to Web K's own
        setPlumaSetting('theme', 0);
        delete document.documentElement.dataset.plumaTheme;
        return;
      }
      applyColors(theme);
    }, 0);
  });
  // * a chat opened (or painted with its own theme) gets ours again
  import('@lib/appImManager').then(({default: appImManager}) => {
    appImManager.addEventListener('peer_changed', () => {
      const theme = current();
      if(theme) setTimeout(() => applyColors(theme), 50);
    });
  });

  const theme = current();
  if(theme) applyColors(theme);
}

export function setPlumaTheme(id: number) {
  setPlumaSetting('theme', id);
  const theme = current();
  if(theme) {
    applyColors(theme);
    toast(pt(`Тема «${themeName(theme)}»`, `Theme «${themeName(theme)}»`));
  } else {
    // * back to Web K's own colours: its theme is painted anew
    delete document.documentElement.dataset.plumaTheme;
    import('@helpers/themeController').then(({default: themeController}) => themeController.switchTheme(themeController.isNight() ? 'night' : 'day'));
    toast(pt('Обычная тема веб-версии', 'The web version\'s own theme'));
  }
}

/** The themes as in the app: a swatch of each (its background, a message, the accent) */
export function openThemePicker(onBack?: () => void) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const list = document.createElement('div');
  list.className = 'pg-list';

  const chosen = plumaSettings().theme || 0;
  const item = (id: number, name: string, theme?: PlumaTheme) => {
    const row = document.createElement('div');
    row.className = 'pg-item' + (id === chosen ? ' is-active' : '');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const swatch = document.createElement('span');
    swatch.className = 'pg-theme-swatch';
    if(theme) {
      swatch.style.background = theme.colors['background-color'];
      swatch.innerHTML = `<i style="background:${theme.colors['message-background-color']}"></i><i style="background:${theme.colors['message-out-background-color']}"></i><b style="background:${theme.colors['primary-color']}"></b>`;
    } else {
      swatch.classList.add('is-default');
    }

    const label = document.createElement('span');
    label.className = 'pg-item-title';
    label.textContent = name;
    row.append(swatch, label);
    if(id === chosen) {
      const check = document.createElement('span');
      check.className = 'pg-item-state';
      check.textContent = '✓';
      row.append(check);
    }

    const choose = () => {
      closeOverlay();
      setPlumaTheme(id);
    };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    return row;
  };

  list.append(
    item(0, pt('Как в веб-версии (по умолчанию)', 'The web version\'s own (default)')),
    ...THEMES.map((theme) => item(theme.id, themeName(theme), theme))
  );

  panel.append(makeTitle(pt('Тема как в приложении', 'Theme as in the app'), true, onBack), list);
  createOverlay(panel, undefined, onBack);
  focusSoon((list.querySelector('.is-active') as HTMLElement) || panel);
}
