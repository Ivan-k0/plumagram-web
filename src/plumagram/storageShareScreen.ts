/*
 * PlumaGram — the windows of «Поделиться папкой»: the setup (name, channel or group, the switches), the link
 * (copy, QR code, open the chat, update) and «Перестать делиться».
 */

import IconElement from '@components/icon';
import {toast} from '@components/toast';
import {copyTextToClipboard} from '@helpers/clipboard';
import {pt} from '@/plumagram/settings';
import {closeOverlay, createOverlay, focusSoon, makeSwitchRow, makeTitle, openChoicePicker} from '@/plumagram/overlay';
import {CloudFolder, loadCloudStorage} from '@/plumagram/storageCloud';
import {folderShare, SHARE_BATCH, SHARE_PAUSE_MS, sharePeerId, shareFolder, shareProgress, stopShare, unshared, updateShare} from '@/plumagram/storageShare';

function panel() {
  const el = document.createElement('div');
  el.className = 'pg-panel pg-share-panel';
  el.setAttribute('role', 'dialog');
  el.tabIndex = -1;
  return el;
}

function hint(text: string) {
  const el = document.createElement('div');
  el.className = 'pg-settings-hint';
  el.textContent = text;
  return el;
}

function primaryButton(text: string, onClick: () => void) {
  const button = document.createElement('button');
  button.className = 'pg-button is-primary';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function textButton(icon: Icon, text: string, onClick: () => void, danger?: boolean) {
  const button = document.createElement('button');
  button.className = 'pg-share-action' + (danger ? ' is-danger' : '');
  button.append(IconElement(icon), text);
  button.addEventListener('click', onClick);
  return button;
}

/** One of two choices (a channel or a group): a row with a radio circle */
function radioRow(text: string, sub: string, group: HTMLElement, onPick: () => void) {
  const row = document.createElement('div');
  row.className = 'pg-settings-row';
  row.setAttribute('role', 'radio');
  row.tabIndex = 0;
  const texts = document.createElement('div');
  texts.className = 'pg-settings-row-text';
  const main = document.createElement('div');
  main.textContent = text;
  const secondary = document.createElement('div');
  secondary.className = 'pg-settings-row-sub';
  secondary.textContent = sub;
  texts.append(main, secondary);
  const circle = document.createElement('div');
  circle.className = 'pg-radio';
  row.append(circle, texts);
  const pick = () => {
    group.querySelectorAll('[role="radio"]').forEach((other) => other.setAttribute('aria-checked', String(other === row)));
    onPick();
  };
  row.addEventListener('click', pick);
  row.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  return row;
}

/** «Поделиться папкой»: what the shared copy is and how it goes; «Создать ссылку» makes it */
export function openShareSetup(folder: CloudFolder, onBack: () => void) {
  const el = panel();
  const options = {title: folder.name, channel: true, auto: true, copies: true, approval: false};

  const name = document.createElement('input');
  name.className = 'pg-field';
  name.value = folder.name;
  name.maxLength = 128;
  name.setAttribute('aria-label', pt('Название', 'Name'));

  const kinds = document.createElement('div');
  kinds.setAttribute('role', 'radiogroup');
  const viewOnly = radioRow(pt('Только смотреть', 'View only'), pt('закрытый канал: пишете только вы', 'a private channel: only you post'), kinds, () => options.channel = true);
  const viewAdd = radioRow(pt('Смотреть и добавлять', 'View and add'), pt('закрытая группа: участники тоже присылают', 'a private group: the members post too'), kinds, () => options.channel = false);
  viewOnly.setAttribute('aria-checked', 'true');
  viewAdd.setAttribute('aria-checked', 'false');
  kinds.append(viewOnly, viewAdd);

  const toggle = (key: 'auto' | 'copies' | 'approval', text: string, sub: string) =>
    makeSwitchRow(text, sub, () => options[key], () => options[key] = !options[key]);

  const n = folder.ids.length;
  const minutes = Math.max(1, Math.ceil(n / SHARE_BATCH * SHARE_PAUSE_MS / 60000));
  const create = primaryButton(pt(`Создать ссылку · записей: ${n}`, `Create the link · records: ${n}`), async() => {
    options.title = name.value.trim() || folder.name;
    create.disabled = true;
    try {
      const result = await shareFolder(folder.id, options);
      if(result) openShareLink(result.folder, onBack);
    } catch(err) {
      create.disabled = false;
      toast(pt('Не удалось: ' + ((err as ApiError)?.type || ''), 'Failed: ' + ((err as ApiError)?.type || '')));
    }
  });

  const footer = document.createElement('div');
  footer.className = 'pg-share-footer';
  footer.append(create);

  el.append(
    makeTitle(pt('Поделиться папкой', 'Share the folder'), true, onBack),
    name,
    kinds,
    toggle('auto', pt('Добавлять новое из папки', 'Add what is new in the folder'), pt('положили в папку — появится и там', 'put into the folder — it shows there too')),
    toggle('copies', pt('Без «Переслано от»', 'Without «Forwarded from»'), pt('копии, а не пересылка', 'copies, not forwards')),
    toggle('approval', pt('Вход по одобрению', 'Join by approval'), pt('вы подтверждаете каждого', 'you approve everyone')),
    hint(pt(`Записей: ${n}. Копирование займёт около ${minutes} мин, оно идёт в фоне.`, `Records: ${n}. Copying takes about ${minutes} min, in the background.`)),
    footer
  );
  createOverlay(el, undefined, onBack);
  focusSoon(name);
}

/** The shared folder's link: copy it, its QR code, open the chat, add the new records, stop sharing */
export function openShareLink(folder: CloudFolder, onBack: () => void) {
  const share = folderShare(folder);
  if(!share) return;
  const el = panel();
  const reopen = () => openShareLink(folder, onBack);

  const sub = document.createElement('div');
  sub.className = 'pg-share-sub';
  sub.textContent = pt(`«${folder.name}» · записей: ${folder.ids.length} · закреплена в чатах`, `«${folder.name}» · records: ${folder.ids.length} · pinned in the chats`);

  const linkRow = document.createElement('div');
  linkRow.className = 'pg-share-link';
  const link = document.createElement('span');
  link.className = 'pg-share-link-text';
  link.dir = 'ltr';
  link.textContent = share.link || pt('Ссылки нет', 'No link');
  linkRow.append(IconElement('link'), link);
  if(share.link) {
    const copy = document.createElement('button');
    copy.className = 'pg-share-copy';
    copy.textContent = pt('Копировать', 'Copy');
    copy.addEventListener('click', () => {
      copyTextToClipboard(share.link);
      toast(pt('Ссылка скопирована', 'Link copied'));
    });
    linkRow.append(copy);
  }

  const actions = document.createElement('div');
  actions.className = 'pg-share-actions';
  if(share.link) actions.append(textButton('qr', pt('QR-код', 'QR code'), async() => {
    // * the popup comes after our window has left the app's back stack: else that going back closes it too
    const {default: showLinkQrCodePopup} = await import('@components/popups/linkQrCode');
    closeOverlay();
    setTimeout(() => showLinkQrCodePopup({url: share.link, aboutLangKey: share.channel ? 'InviteLink.QRCode.InfoChannel' : 'InviteLink.QRCode.Info'}), 50);
  }));
  actions.append(
    textButton(share.channel ? 'channel' : 'group', share.channel ? pt('Открыть канал', 'Open the channel') : pt('Открыть группу', 'Open the group'), async() => {
      closeOverlay();
      const {default: appImManager} = await import('@lib/appImManager');
      appImManager.setPeer({peerId: sharePeerId(share)});
    }),
    textButton('rotate_right', pt('Обновить', 'Update'), () => updateShare(folder)),
    textButton('stop', pt('Перестать делиться', 'Stop sharing'), () => {
      openChoicePicker(pt('Перестать делиться?', 'Stop sharing?'), [{
        icon: 'link',
        text: pt('Отозвать ссылку', 'Revoke the link'),
        run: () => stopShare(folder.id, false).then(onBack)
      }, {
        icon: 'delete',
        danger: true,
        text: share.channel ? pt('Удалить канал', 'Delete the channel') : pt('Удалить группу', 'Delete the group'),
        run: () => stopShare(folder.id, true).then(onBack)
      }, {
        icon: 'close',
        text: pt('Отмена', 'Cancel'),
        run: reopen
      }]);
    }, true)
  );

  // * how far the copying is, live: «копирую 12 из 40», then what is left (nothing — the line goes)
  const status = hint('');
  const paintStatus = async() => {
    const copying = shareProgress(folder.id);
    if(copying) {
      status.textContent = pt(`Копирую: ${copying.done} из ${copying.total}`, `Copying: ${copying.done} of ${copying.total}`);
      return;
    }
    const fresh = (await loadCloudStorage()).folders.find((f) => f.id === folder.id) || folder;
    const left = unshared(fresh).length;
    status.textContent = left ? pt(`Ещё не скопировано: ${left}`, `Not copied yet: ${left}`) : '';
  };
  paintStatus();
  const onProgress = (e: Event) => {
    if(!el.isConnected) return window.removeEventListener('pg-share-progress', onProgress);
    if((e as CustomEvent).detail === folder.id) paintStatus();
  };
  window.addEventListener('pg-share-progress', onProgress);

  el.append(makeTitle(pt('Папка доступна по ссылке', 'The folder is shared by a link'), true, onBack), sub, linkRow, status, actions);
  createOverlay(el, undefined, onBack);
  focusSoon(el);
}
