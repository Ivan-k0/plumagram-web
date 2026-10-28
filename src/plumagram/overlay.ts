/*
 * PlumaGram — our windows over the app (palette, settings, pickers): one at a time, in the app's back stack.
 */

import appNavigationController, {NavigationItem} from '@components/appNavigationController';

let openOverlay: HTMLElement;
let overlayNavigationItem: NavigationItem;

export function isOverlayOpen() {
  return !!openOverlay;
}

export function closeOverlay() {
  openOverlay?.remove();
  openOverlay = undefined;
  if(overlayNavigationItem) {
    const item = overlayNavigationItem;
    overlayNavigationItem = undefined;
    appNavigationController.removeItem(item);
  }
}

export function createOverlay(panel: HTMLElement) {
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
  // * in the app's back stack, so Esc and «back» close our window first, not the chat under it
  appNavigationController.pushItem(overlayNavigationItem = {
    type: 'popup',
    onPop: () => {
      overlayNavigationItem = undefined;
      closeOverlay();
    }
  });
  return overlay;
}

export type ChoiceOption = {
  text: string,
  run: () => void
};

/** A window with a title and a list to pick one from: mouse, arrows and Enter */
export function openChoicePicker(titleText: string, options: ChoiceOption[]) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const title = document.createElement('div');
  title.className = 'pg-settings-title';
  title.textContent = titleText;

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
  createOverlay(panel);
  (list.firstElementChild as HTMLElement)?.focus();
}
