/*
 * PlumaGram — our windows over the app (palette, settings, pickers): one at a time, in the app's back stack.
 */

import appNavigationController, {NavigationItem} from '@components/appNavigationController';
import Icon from '@components/icon';

let openOverlay: HTMLElement;
let overlayNavigationItem: NavigationItem;

export function isOverlayOpen() {
  return !!openOverlay;
}

export function closeOverlay() {
  if(openOverlay) (document.activeElement as HTMLElement)?.blur?.();
  openOverlay?.remove();
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
function placePanel(overlay: HTMLElement, panel: HTMLElement, anchor?: HTMLElement) {
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

  const column = document.getElementById('column-center');
  const rect = column?.getBoundingClientRect();
  if(rect && rect.width >= 360) {
    overlay.style.paddingLeft = Math.max(margin, rect.left) + 'px';
    overlay.style.paddingRight = Math.max(margin, vw - rect.right) + 'px';
  }
}

/** `onBack`: this window was opened from another one — Esc, «back» and the arrow return there */
export function createOverlay(panel: HTMLElement, anchor?: HTMLElement, onBack?: () => void) {
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
    if(e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
      onBack?.();
    }
  });
  document.body.append(overlay);
  openOverlay = overlay;
  placePanel(overlay, panel, anchor);

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

export type ChoiceOption = {
  text: string,
  run: () => void
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

  options.forEach(({text, run}) => {
    const item = document.createElement('div');
    item.className = 'pg-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const label = document.createElement('span');
    label.className = 'pg-item-title';
    label.textContent = text;
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
