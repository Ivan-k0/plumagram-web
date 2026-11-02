/*
 * PlumaGram — our windows over the app (palette, settings, pickers): one at a time, in the app's back stack.
 */

import appNavigationController, {NavigationItem} from '@components/appNavigationController';
import Icon from '@components/icon';
import overlayCounter from '@helpers/overlayCounter';
import liteMode from '@helpers/liteMode';

let openOverlay: HTMLElement;
let overlayNavigationItem: NavigationItem;

export function isOverlayOpen() {
  return !!openOverlay;
}

/** A closed window fades out where it stands (at once with animations off), no longer taking clicks or keys */
function leave(overlay: HTMLElement) {
  if(!overlay) return;
  if(!liteMode.isAvailable('animations')) {
    overlay.remove();
    return;
  }
  overlay.classList.add('is-closing');
  overlay.inert = true;
  setTimeout(() => overlay.remove(), 150);
}

export function closeOverlay() {
  if(openOverlay) {
    (document.activeElement as HTMLElement)?.blur?.();
    // * a tick later: the Enter that chose an item is still on its way up to the app's «type anywhere»
    setTimeout(() => overlayCounter.isOverlayActive = false, 0);
  }
  leave(openOverlay);
  openOverlay = undefined;
  if(overlayNavigationItem) {
    const item = overlayNavigationItem;
    overlayNavigationItem = undefined;
    appNavigationController.removeItem(item);
  }
}

/**
 * Where our window stands: next to `anchor` (the message it is about), like a context menu, or else in
 * the middle of the chat column (the middle of the whole page looked pushed to the top left over the chat)
 */
function placePanel(overlay: HTMLElement, panel: HTMLElement, anchor?: HTMLElement, screen?: boolean) {
  const margin = 16;
  const vw = window.innerWidth, vh = window.innerHeight;

  if(anchor?.isConnected) {
    overlay.classList.add('is-anchored');
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    // * beside the message: under it if it fits, else above it, else as low as it can be
    const left = Math.min(Math.max(margin, rect.left), vw - width - margin);
    let top = rect.bottom + 8;
    if(top + height > vh - margin) top = rect.top - height - 8;
    if(top < margin) top = Math.max(margin, vh - height - margin);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    return;
  }

  // * a screen of its own (Хранилище): exactly where the chat is, no dimming — the chat list stays usable to see;
  // * a window: in the middle of the room beside the list. Either follows the window and the list as they change
  if(screen) overlay.classList.add('is-screen');
  const fit = () => {
    const {left, right, top, height} = besideChatList();
    if(screen) Object.assign(overlay.style, {left: left + 'px', top: top + 'px', width: (window.innerWidth - left - right) + 'px', height: height + 'px'});
    else Object.assign(overlay.style, {paddingLeft: left + 'px', paddingRight: right + 'px'});
  };
  fit();
  const list = document.getElementById('column-left');
  const resizeObserver = new ResizeObserver(fit);
  list && resizeObserver.observe(list);
  window.addEventListener('resize', fit);
  // * the list changes sides with the direction (a language switched while the window is open)
  const directionObserver = new MutationObserver(fit);
  directionObserver.observe(document.documentElement, {attributeFilter: ['dir']});
  new MutationObserver((_, observer) => {
    if(!overlay.isConnected) {
      window.removeEventListener('resize', fit);
      resizeObserver.disconnect();
      directionObserver.disconnect();
      observer.disconnect();
    }
  }).observe(document.body, {childList: true});
}

/**
 * The room beside the chat list (physical left and right insets, the list's top and height): the chat column
 * itself runs under the list in the floating layout, and sits on the left of it right to left
 */
function besideChatList() {
  const gap = 16, vw = window.innerWidth;
  const list = document.getElementById('column-left')?.getBoundingClientRect();
  const inset = {left: gap, right: gap, top: list ? list.top : gap, height: list ? list.height : window.innerHeight - 2 * gap};
  // * a list as wide as the window (a narrow one) is covered, not avoided
  if(!list || !list.width || list.width >= vw * .6) return inset;
  if(list.left + list.width / 2 < vw / 2) inset.left = list.right + gap;
  else inset.right = vw - list.left + gap;
  return inset;
}

/** `onBack`: this window was opened from another one — Esc, «back» and the arrow return there */
export function createOverlay(panel: HTMLElement, anchor?: HTMLElement, onBack?: () => void, screen?: boolean) {
  closeOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'pg-overlay';
  overlay.append(panel);
  overlay.addEventListener('mousedown', (e) => {
    if(e.target === overlay) closeOverlay();
  });
  overlay.addEventListener('keydown', (e) => {
    // * Enter and Space press a row that acts as a button, as with a mouse (keyboard-only use)
    const target = e.target as HTMLElement;
    if((e.key === 'Enter' || e.key === ' ') && target.getAttribute?.('role') === 'button' && !e.defaultPrevented) {
      e.preventDefault();
      target.click();
      return;
    }
    // * an Esc a menu inside our window has already taken (it closed itself) is not ours
    if(e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
      onBack?.();
    }
  });
  document.body.append(overlay);
  openOverlay = overlay;
  // * counted as the app's own popups are: while it is open, keys are not «typed anywhere» into the message
  // * field — Enter on a choice of ours also sent the draft of the chat under it
  overlayCounter.isOverlayActive = true;
  placePanel(overlay, panel, anchor, screen);

  // * while our window is open the focus stays in it: the app gives it back to the message field when the
  // * window before ours closes, and typing went into the chat (Enter sent it)
  let lastInside: HTMLElement;
  const keepFocus = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if(overlay.contains(target)) {
      lastInside = target;
      return;
    }
    if(openOverlay !== overlay) {
      document.removeEventListener('focusin', keepFocus, true);
      return;
    }
    (lastInside?.isConnected ? lastInside : overlay.querySelector<HTMLElement>('input, [tabindex]'))?.focus();
  };
  document.addEventListener('focusin', keepFocus, true);

  // * in the app's back stack, so Esc and «back» close our window first, not the chat under it
  appNavigationController.pushItem(overlayNavigationItem = {
    type: 'popup',
    // * Esc in a field that cancels itself (a folder's name being typed) is that field's
    onEscape: (e) => (e.target as HTMLElement)?.dataset?.pgEscape !== 'local',
    onPop: () => {
      overlayNavigationItem = undefined;
      closeOverlay();
      // * the window before is opened after the app has finished going back, or that same «back» closed it
      onBack && setTimeout(onBack, 0);
    }
  });
  return overlay;
}

/**
 * Focus that stays: when one of our windows replaces another, the app gives the focus back to the message
 * field as the first one closes — a moment later. Without taking it again, typing went into the chat
 * (and Enter sent it).
 */
export function focusSoon(element: HTMLElement) {
  element.focus();
  requestAnimationFrame(() => element.isConnected && element.focus());
  setTimeout(() => element.isConnected && element.focus(), 60);
}

/** The title of our window, with a close button on the right as in the app's own popups */
export function makeTitle(text: string, closable = true, onBack?: () => void) {
  const title = document.createElement('div');
  title.className = 'pg-settings-title';
  if(onBack) {
    const back = document.createElement('button');
    back.className = 'pg-close pg-back';
    back.setAttribute('aria-label', 'Back');
    back.append(Icon('left'));
    back.addEventListener('click', () => {
      closeOverlay();
      onBack();
    });
    title.append(back);
  }
  const label = document.createElement('span');
  label.className = 'pg-title-text';
  label.textContent = text;
  // * a name in its own direction (a folder, «#тег»): «#тег» is not turned into «тег#» right to left
  label.dir = 'auto';
  title.append(label);
  if(closable) {
    const close = document.createElement('button');
    close.className = 'pg-close';
    close.setAttribute('aria-label', 'Close');
    close.append(Icon('close'));
    close.addEventListener('click', () => closeOverlay());
    title.append(close);
  }
  return title;
}

/**
 * A settings row with the app's own switch (Material: the track fills, the knob grows and slides along the line):
 * a click, Enter or Space on the row flips it. `isOn` is read again after every `toggle`
 */
export function makeSwitchRow(text: string, sub: string, isOn: () => boolean, toggle: () => void, options: {
  icon?: Icon,
  /** a switch that only means something with another one on (black bars — with «Не подглядывай!») */
  isEnabled?: () => boolean
} = {}) {
  const row = document.createElement('div');
  row.className = 'pg-settings-row';
  row.setAttribute('role', 'switch');
  row.tabIndex = 0;
  if(options.icon) row.append(Icon(options.icon, 'pg-settings-row-icon'));

  const texts = document.createElement('div');
  texts.className = 'pg-settings-row-text';
  // * the words in their own direction: «…» and «!» stay where they belong in a line of the other direction
  const main = document.createElement('div');
  main.textContent = text;
  main.dir = 'auto';
  const secondary = document.createElement('div');
  secondary.className = 'pg-settings-row-sub';
  secondary.textContent = sub;
  secondary.dir = 'auto';
  texts.append(main, secondary);

  // * the app's toggle is drawn from a checkbox's state; this one only shows the row's
  const toggleField = document.createElement('div');
  toggleField.className = 'checkbox-field checkbox-field-toggle';
  toggleField.setAttribute('aria-hidden', 'true');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.tabIndex = -1;
  input.className = 'checkbox-field-input';
  const track = document.createElement('div');
  track.className = 'checkbox-toggle';
  const knob = document.createElement('div');
  knob.className = 'checkbox-toggle-circle';
  track.append(knob);
  toggleField.append(input, track);

  const update = () => {
    const on = isOn();
    input.checked = on;
    row.setAttribute('aria-checked', String(on));
    const enabled = options.isEnabled ? options.isEnabled() : true;
    row.classList.toggle('is-disabled', !enabled);
    row.setAttribute('aria-disabled', String(!enabled));
  };
  update();
  // * the other rows of the window follow a change (a switch that depends on this one)
  const onChanged = () => row.isConnected ? update() : window.removeEventListener('pg-settings-changed', onChanged);
  window.addEventListener('pg-settings-changed', onChanged);

  const onToggle = () => {
    if(row.classList.contains('is-disabled')) return;
    toggle();
    update();
    window.dispatchEvent(new Event('pg-settings-changed'));
  };
  row.addEventListener('click', onToggle);
  row.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  });

  row.append(texts, toggleField);
  return row;
}

/** A row that opens another window: an icon, the words, a chevron along the line */
export function makeLinkRow(icon: Icon, text: string, onClick: () => void) {
  const row = document.createElement('div');
  row.className = 'pg-settings-row is-link';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  const label = document.createElement('span');
  label.className = 'pg-settings-row-text';
  label.textContent = text;
  label.dir = 'auto';
  row.append(Icon(icon, 'pg-settings-row-icon'), label, Icon('next', 'pg-settings-row-chevron'));
  row.addEventListener('click', onClick);
  return row;
}

/** A group's name over its rows, as Material settings lists have */
export function makeCaption(text: string) {
  const caption = document.createElement('div');
  caption.className = 'pg-settings-caption';
  caption.textContent = text;
  return caption;
}

export type ChoiceOption = {
  text: string,
  run: () => void,
  /** the app's icon before the words, as a Material menu item has */
  icon?: Icon,
  danger?: boolean
};

/** A window with a title and a list to pick one from: mouse, arrows and Enter */
export function openChoicePicker(titleText: string, options: ChoiceOption[], anchor?: HTMLElement) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  // * a choice next to a message is a small menu: no close button there
  const title = makeTitle(titleText, !anchor);

  const list = document.createElement('div');
  list.className = 'pg-list';

  options.forEach(({text, run, icon, danger}) => {
    const item = document.createElement('div');
    item.className = 'pg-item' + (danger ? ' is-danger' : '');
    if(icon) item.append(Icon(icon, 'pg-item-icon'));
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const label = document.createElement('span');
    label.className = 'pg-item-title';
    label.textContent = text;
    label.dir = 'auto';
    item.append(label);

    const choose = () => {
      closeOverlay();
      run();
    };
    item.addEventListener('click', choose);
    item.addEventListener('mouseenter', () => item.focus());
    item.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    list.append(item);
  });

  list.addEventListener('keydown', (e) => {
    if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(list.children) as HTMLElement[];
    const idx = items.indexOf(document.activeElement as HTMLElement);
    items[(idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });

  panel.append(title, list);
  createOverlay(panel, anchor);
  list.firstElementChild && focusSoon(list.firstElementChild as HTMLElement);
}
