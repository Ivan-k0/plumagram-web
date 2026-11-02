/*
 * PlumaGram — «Хранилище» as a screen of its own, where the chat is, as in the Android app: search; folders as
 * coloured tiles; tags; sections by kind (photos and videos, files, links, voice, music) with their counts;
 * «Недавнее» — the latest records. A folder, a section or a tag opens the list of its records; a record opens
 * in Saved Messages. «Назад» (the arrow, Esc) goes up one step, the cross closes the screen.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {toast} from '@components/toast';
import IconElement from '@components/icon';
import {pt} from '@/plumagram/settings';
import {closeOverlay, createOverlay, focusSoon, makeTitle} from '@/plumagram/overlay';
import {folderShare, shareProgress} from '@/plumagram/storageShare';
import {openShareLink, openShareSetup} from '@/plumagram/storageShareScreen';
import {CloudFolder, createFolder, folderColor, fromTdId, loadCloudStorage, STORAGE_FILE_NAME} from '@/plumagram/storageCloud';
import type {Message} from '@layer';

type Section = {id: string, filter: string, label: () => string, icon: Icon};

const SECTIONS: Section[] = [
  {id: 'media', filter: 'inputMessagesFilterPhotoVideo', label: () => pt('Фото и видео', 'Photos & videos'), icon: 'image'},
  {id: 'files', filter: 'inputMessagesFilterDocument', label: () => pt('Файлы', 'Files'), icon: 'document'},
  {id: 'links', filter: 'inputMessagesFilterUrl', label: () => pt('Ссылки', 'Links'), icon: 'link'},
  {id: 'voice', filter: 'inputMessagesFilterVoice', label: () => pt('Голосовые', 'Voice'), icon: 'microphone'},
  {id: 'music', filter: 'inputMessagesFilterMusic', label: () => pt('Музыка', 'Music'), icon: 'note'}
];

const TAG_REGEXP = /#([\p{L}\p{N}_]{1,64})/gu;

function isServiceFile(message: Message.message) {
  return !!(message.media as any)?.document?.attributes?.some((a: any) => a.file_name === STORAGE_FILE_NAME);
}

function describe(message: Message.message) {
  const text = (message.message || '').replace(/\s+/g, ' ').trim();
  if(text) return text;
  const media = message.media as any;
  if(!media) return pt('Сообщение', 'Message');
  if(media._ === 'messageMediaPhoto') return pt('Фото', 'Photo');
  if(media._ === 'messageMediaWebPage') return media.webpage?.title || media.webpage?.url || pt('Ссылка', 'Link');
  const attrs = media.document?.attributes || [];
  if(attrs.some((a: any) => a._ === 'documentAttributeAudio' && a.pFlags?.voice)) return pt('Голосовое', 'Voice message');
  if(attrs.some((a: any) => a._ === 'documentAttributeVideo')) return pt('Видео', 'Video');
  const audio = attrs.find((a: any) => a._ === 'documentAttributeAudio');
  if(audio) return [audio.performer, audio.title].filter(Boolean).join(' — ') || pt('Музыка', 'Music');
  return attrs.find((a: any) => a._ === 'documentAttributeFilename')?.file_name || pt('Файл', 'File');
}

function iconFor(message: Message.message): Icon {
  const media = message.media as any;
  if(!media) return 'message';
  if(media._ === 'messageMediaPhoto') return 'image';
  if(media._ === 'messageMediaWebPage') return 'link';
  const attrs = media.document?.attributes || [];
  if(attrs.some((a: any) => a._ === 'documentAttributeAudio' && a.pFlags?.voice)) return 'microphone';
  if(attrs.some((a: any) => a._ === 'documentAttributeVideo')) return 'videocamera';
  if(attrs.some((a: any) => a._ === 'documentAttributeAudio')) return 'note';
  return 'document';
}

async function thumbUrl(message: Message.message): Promise<string> {
  const media = message.media as any;
  const target = media?.photo || media?.document;
  const sizes = (media?.photo?.sizes || media?.document?.thumbs || []).filter((s: any) => s._ === 'photoSize' || s._ === 'photoSizeProgressive');
  if(!target || !sizes.length) return;
  const size = sizes.find((s: any) => s.w >= 120) || sizes[sizes.length - 1];
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  const blob = await appDownloadManager.downloadMedia({media: target, thumb: size}) as Blob;
  return URL.createObjectURL(blob);
}

// * the thumbnails' URLs of the screen shown, revoked when it goes
let thumbUrls: string[] = [];

async function openRecord(message: Message.message) {
  closeOverlay();
  const {default: appImManager} = await import('@lib/appImManager');
  appImManager.setPeer({peerId: appImManager.myId, lastMsgId: message.id});
}

/** One record: a thumbnail or an icon, the words, the date */
function recordRow(message: Message.message) {
  const row = document.createElement('div');
  row.className = 'pg-st-record';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');

  const thumb = document.createElement('div');
  thumb.className = 'pg-st-thumb';
  thumb.append(IconElement(iconFor(message)));
  const urls = thumbUrls;
  thumbUrl(message).then((url) => {
    if(!url) return;
    urls.push(url);
    thumb.replaceChildren();
    thumb.style.backgroundImage = `url(${url})`;
  }, () => {});

  const text = document.createElement('div');
  text.className = 'pg-st-record-text';
  const words = describe(message);
  text.textContent = words.length > 140 ? words.slice(0, 140) + '…' : words;
  text.dir = 'auto';

  const date = document.createElement('div');
  date.className = 'pg-st-record-date';
  date.dir = 'auto';
  date.textContent = new Date(message.date * 1000).toLocaleDateString([], {day: 'numeric', month: 'short'});

  row.append(thumb, text, date);
  row.addEventListener('click', () => openRecord(message));
  return row;
}

function screen(title: string, onBack?: () => void) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel pg-st-screen';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;
  const body = document.createElement('div');
  body.className = 'pg-st-body';
  panel.append(makeTitle(title, true, onBack), body);
  const urls: string[] = thumbUrls = [];
  new MutationObserver((_, observer) => {
    if(panel.isConnected) return;
    observer.disconnect();
    urls.forEach((url) => URL.revokeObjectURL(url));
  }).observe(document.body, {childList: true});
  createOverlay(panel, undefined, onBack, true);
  focusSoon(panel);
  return body;
}

function sectionTitle(text: string) {
  const el = document.createElement('div');
  el.className = 'pg-st-caption';
  el.textContent = text;
  return el;
}

/** A list of records (a folder, a section, a tag) */
function openList(title: string, load: () => Promise<Message.message[]>, empty: string) {
  fillList(screen(title, () => openStorageScreen()), load, empty);
}

async function fillList(body: HTMLElement, load: () => Promise<Message.message[]>, empty: string) {
  body.textContent = pt('Загружаю…', 'Loading…');
  let messages: Message.message[];
  try {
    messages = (await load()).filter((m) => m._ === 'message' && !isServiceFile(m));
  } catch(err) {
    body.textContent = pt('Не удалось загрузить', 'Could not load');
    return;
  }
  if(!body.isConnected) return;
  body.textContent = '';
  if(!messages.length) {
    body.textContent = empty;
    return;
  }
  // * in a card, as «Недавнее» on the main screen
  const card = document.createElement('div');
  card.className = 'pg-st-recent';
  card.append(...messages.map(recordRow));
  body.append(card);
}

async function searchSaved(filter: string, q = '', limit = 60) {
  const managers = bindManagersToSession(rootScope.managers);
  const result = await managers.apiManager.invokeApi('messages.search', {
    peer: {_: 'inputPeerSelf'}, q, filter: {_: filter}, min_date: 0, max_date: 0,
    offset_id: 0, add_offset: 0, limit, max_id: 0, min_id: 0, hash: '0'
  } as any) as any;
  return (result.messages || []) as Message.message[];
}

async function folderMessages(folder: CloudFolder) {
  const managers = bindManagersToSession(rootScope.managers);
  const ids = folder.ids.map(fromTdId).filter(Boolean).slice(-100);
  if(!ids.length) return [];
  const result = await managers.apiManager.invokeApi('messages.getMessages', {id: ids.map((id) => ({_: 'inputMessageID' as const, id}))}) as any;
  return ((result.messages || []) as Message.message[]).sort((a, b) => b.id - a.id);
}

/** A folder's records, with «Поделиться папкой» in its title (the link, when it is shared already) */
function openFolder(folder: CloudFolder) {
  const reopen = () => openFolder(folder);
  const body = screen(folder.name, () => openStorageScreen());
  const share = folderShare(folder);
  const shareButton = document.createElement('button');
  shareButton.className = 'pg-close';
  shareButton.append(IconElement('link'));
  shareButton.setAttribute('aria-label', share ? pt('Ссылка на общую папку', 'The shared folder\'s link') : pt('Поделиться папкой', 'Share the folder'));
  shareButton.addEventListener('click', () => share ? openShareLink(folder, reopen) : openShareSetup(folder, reopen));
  const title = body.previousElementSibling as HTMLElement;
  title.insertBefore(shareButton, title.lastElementChild);

  if(share) {
    const banner = document.createElement('button');
    banner.className = 'pg-st-banner';
    banner.append(IconElement('link'), pt(`Папка общая: ${share.channel ? 'канал' : 'группа'}`, `The folder is shared: a ${share.channel ? 'channel' : 'group'}`));
    banner.addEventListener('click', () => openShareLink(folder, reopen));
    body.before(banner);
  }

  fillList(body, () => folderMessages(folder),
    pt('Папка пуста. Положить запись: наведи мышь на сообщение в Избранном — ⌥/Alt+4 или правый щелчок → «В папку».', 'The folder is empty. Point at a message in Saved — ⌥/Alt+4 or right click → «To a folder».'));
}

export async function openStorageScreen() {
  const managers = bindManagersToSession(rootScope.managers);
  const body = screen(pt('Хранилище', 'Storage'));

  // * search: Saved Messages with the search open
  const searchBar = document.createElement('label');
  searchBar.className = 'pg-st-search';
  const search = document.createElement('input');
  search.className = 'pg-st-search-input';
  search.placeholder = pt('Поиск в Хранилище — Enter', 'Search the storage — Enter');
  search.setAttribute('aria-label', pt('Поиск в Хранилище', 'Search the storage'));
  searchBar.append(IconElement('search'), search);
  search.addEventListener('keydown', async(e) => {
    if(e.key !== 'Enter' || !search.value.trim()) return;
    e.preventDefault();
    const query = search.value.trim();
    closeOverlay();
    const {openSavedSearch} = await import('@/plumagram/storage');
    openSavedSearch(query);
  });

  const folders = document.createElement('div');
  folders.className = 'pg-st-tiles';
  const tags = document.createElement('div');
  tags.className = 'pg-storage-tags';
  const sections = document.createElement('div');
  sections.className = 'pg-st-sections';
  const recent = document.createElement('div');
  recent.className = 'pg-st-recent';
  recent.textContent = pt('Загружаю…', 'Loading…');

  body.append(searchBar, sectionTitle(pt('Папки', 'Folders')), folders, sectionTitle(pt('Метки', 'Tags')), tags,
    sectionTitle(pt('Разделы', 'Sections')), sections, sectionTitle(pt('Недавнее', 'Recent')), recent);
  focusSoon(search);

  // * folders
  loadCloudStorage(true).then((data) => {
    if(!folders.isConnected) return;
    folders.replaceChildren(...data.folders.map((folder) => {
      const tile = document.createElement('button');
      tile.className = 'pg-st-tile';
      tile.style.setProperty('--folder-color', folderColor(folder));
      tile.innerHTML = '<span class="pg-st-tile-name"></span><span class="pg-st-tile-count"></span>';
      tile.firstElementChild.textContent = folder.name;
      const count = tile.lastElementChild as HTMLElement;
      // * a shared folder: the link sign in its corner, and how far the copying is while it goes
      if(folderShare(folder)) {
        tile.append(IconElement('link', 'pg-st-tile-shared'));
        tile.setAttribute('aria-description', pt('общая папка', 'shared folder'));
      }
      const paintCount = () => {
        const copying = shareProgress(folder.id);
        count.textContent = copying ? pt(`копирую ${copying.done} из ${copying.total}`, `copying ${copying.done} of ${copying.total}`) : '' + folder.ids.length;
      };
      paintCount();
      const onProgress = (e: Event) => {
        if(!tile.isConnected) return window.removeEventListener('pg-share-progress', onProgress);
        if((e as CustomEvent).detail === folder.id) paintCount();
      };
      window.addEventListener('pg-share-progress', onProgress);
      tile.addEventListener('click', () => openFolder(folder));
      return tile;
    }), (() => {
      const add = document.createElement('button');
      add.className = 'pg-st-tile is-add';
      add.append(IconElement('add'), pt('Новая папка', 'New folder'));
      // * the name is typed right in the tile (no browser prompt: it blocks the page)
      add.addEventListener('click', () => {
        const input = document.createElement('input');
        input.className = 'pg-st-tile is-add is-input';
        input.dataset.pgEscape = 'local';
        input.placeholder = pt('Название, Enter', 'Name, Enter');
        input.addEventListener('keydown', (e) => {
          if(e.key === 'Escape') {
            e.stopPropagation();
            input.replaceWith(add);
            return;
          }
          if(e.key !== 'Enter' || !input.value.trim()) return;
          e.preventDefault();
          const name = input.value.trim();
          input.disabled = true;
          createFolder(name).then(() => {
            toast(pt(`Папка «${name}» создана`, `Folder «${name}» created`));
            openStorageScreen();
          });
        });
        add.replaceWith(input);
        focusSoon(input);
      });
      return add;
    })());
  }, () => {
    folders.textContent = pt('Не удалось загрузить папки', 'Could not load the folders');
  });

  // * sections with their counts, and «Недавнее»; tags from the same latest messages
  managers.apiManager.invokeApi('messages.getSearchCounters', {
    peer: {_: 'inputPeerSelf'},
    filters: SECTIONS.map((section) => ({_: section.filter}))
  } as any).then(async(counters: any) => {
    // * the service file of the folders is not a file of one's own: not counted in «Файлы»
    const serviceFiles = (await searchSaved('inputMessagesFilterDocument', 'PlumaGram', 10).catch((): Message.message[] => [])).filter(isServiceFile).length;
    const filesIdx = SECTIONS.findIndex((section) => section.id === 'files');
    if(counters?.[filesIdx]) counters[filesIdx].count = Math.max(0, counters[filesIdx].count - serviceFiles);
    if(!sections.isConnected) return;
    sections.replaceChildren(...SECTIONS.map((section, idx) => {
      const count = counters?.[idx]?.count ?? 0;
      const item = document.createElement('button');
      item.className = 'pg-st-section';
      item.innerHTML = '<span class="pg-st-section-name"></span><span class="pg-st-section-count"></span>';
      item.children[0].textContent = section.label();
      item.children[1].textContent = '' + count;
      item.prepend(IconElement(section.icon, 'pg-st-section-icon'));
      item.disabled = !count;
      item.addEventListener('click', () => openList(section.label(), () => searchSaved(section.filter), pt('Пусто', 'Empty')));
      return item;
    }));
  }, () => {
    sections.textContent = pt('Не удалось загрузить разделы', 'Could not load the sections');
  });

  managers.apiManager.invokeApi('messages.getHistory', {
    peer: {_: 'inputPeerSelf'}, offset_id: 0, offset_date: 0, add_offset: 0, limit: 100, max_id: 0, min_id: 0, hash: '0'
  } as any).then((result: any) => {
    if(!recent.isConnected) return;
    const messages = ((result.messages || []) as Message.message[]).filter((m) => m._ === 'message' && !isServiceFile(m));

    const counts = new Map<string, number>();
    messages.forEach((m) => {
      for(const match of (m.message || '').matchAll(TAG_REGEXP)) {
        const tag = match[1].toLowerCase();
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    });
    tags.replaceChildren(...[...counts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => {
      const chip = document.createElement('button');
      chip.className = 'pg-storage-tag';
      chip.innerHTML = '<span></span><span></span>';
      chip.firstElementChild.textContent = '#' + tag;
      (chip.firstElementChild as HTMLElement).dir = 'auto';
      chip.lastElementChild.textContent = '' + count;
      chip.addEventListener('click', () => openList('#' + tag, () => searchSaved('inputMessagesFilterEmpty', '#' + tag), pt('Нет записей с этой меткой', 'No records with this tag')));
      return chip;
    }));
    if(!counts.size) tags.textContent = pt('Меток пока нет — ⌥/Alt+3 на своём сообщении в Избранном.', 'No tags yet — ⌥/Alt+3 on your message in Saved.');

    recent.textContent = '';
    if(!messages.length) {
      recent.textContent = pt('В Избранном пока пусто.', 'Saved Messages is empty.');
      return;
    }
    recent.append(...messages.slice(0, 30).map(recordRow));
  }, () => {
    recent.textContent = pt('Не удалось загрузить записи', 'Could not load the records');
  });
}
