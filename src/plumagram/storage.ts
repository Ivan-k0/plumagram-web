/*
 * PlumaGram — «Хранилище» (Saved Messages as storage), the part that lives in the cloud: #tags in the text of
 * Saved Messages, the same ones the Android app gives to own messages. Folders and tags of forwarded messages
 * are kept on the phone by the app and are not here yet.
 */

import {toast} from '@components/toast';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {pt} from '@/plumagram/settings';
import {getTargetBubble} from '@/plumagram/target';
import {ChoiceOption, createOverlay, closeOverlay, openChoicePicker, focusSoon, makeTitle} from '@/plumagram/overlay';
import type {Message} from '@layer';
import {addToFolder, CloudFolder, createFolder, folderColor, fromTdId, loadCloudStorage, STORAGE_FILE_NAME} from '@/plumagram/storageCloud';

const TAG_REGEXP = /#([\p{L}\p{N}_]{1,64})/gu;
const HISTORY_PAGES = 10, PAGE_SIZE = 100;

type TagInfo = {tag: string, count: number, lastDate: number};

/** Every #tag in Saved Messages (the last HISTORY_PAGES × PAGE_SIZE messages), most used first */
async function collectTags(): Promise<TagInfo[]> {
  const managers = bindManagersToSession(rootScope.managers);
  const tags = new Map<string, TagInfo>();
  let offsetId = 0;
  for(let page = 0; page < HISTORY_PAGES; ++page) {
    const result = await managers.apiManager.invokeApi('messages.getHistory', {
      peer: {_: 'inputPeerSelf'},
      offset_id: offsetId,
      offset_date: 0,
      add_offset: 0,
      limit: PAGE_SIZE,
      max_id: 0,
      min_id: 0,
      hash: '0'
    }) as any;
    const messages = (result.messages || []) as Message.message[];
    for(const message of messages) {
      const text = message.message;
      if(!text) continue;
      for(const match of text.matchAll(TAG_REGEXP)) {
        const tag = match[1].toLowerCase();
        const info = tags.get(tag) || {tag, count: 0, lastDate: 0};
        info.count++;
        info.lastDate = Math.max(info.lastDate, message.date);
        tags.set(tag, info);
      }
    }
    if(messages.length < PAGE_SIZE) break;
    offsetId = messages[messages.length - 1].id;
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || b.lastDate - a.lastDate);
}

/** Saved Messages with the search open on `query` */
export async function openSavedSearch(query: string) {
  const {default: appImManager} = await import('@lib/appImManager');
  await appImManager.setPeer({peerId: appImManager.myId});
  setTimeout(() => appImManager.chat?.initSearch({query, focus: false}), 300);
}

export function openStorage() {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');

  const title = makeTitle(pt('Хранилище', 'Storage'));

  const input = document.createElement('input');
  input.className = 'pg-palette-input';
  input.placeholder = pt('Поиск в Хранилище — Enter', 'Search the storage — Enter');
  input.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const query = input.value.trim();
    closeOverlay();
    openSavedSearch(query);
  });

  const caption = document.createElement('div');
  caption.className = 'pg-settings-row-sub pg-storage-caption';
  caption.textContent = pt('Метки', 'Tags');

  const tagsBox = document.createElement('div');
  tagsBox.className = 'pg-storage-tags';
  tagsBox.textContent = pt('Ищу метки в Избранном…', 'Looking for tags in Saved Messages…');

  const hint = document.createElement('div');
  hint.className = 'pg-settings-hint';
  hint.textContent = pt(
    'Папки и метки видно и в приложении. В папку: наведи мышь на сообщение в Избранном — ⌥/Alt+4. Метка (#слово в тексте своего сообщения) — ⌥/Alt+3.',
    'Folders and tags are seen in the app too. To a folder: point at a message in Saved Messages — ⌥/Alt+4. A tag (#word in your own message) — ⌥/Alt+3.'
  );

  const foldersCaption = document.createElement('div');
  foldersCaption.className = 'pg-settings-row-sub pg-storage-caption';
  foldersCaption.textContent = pt('Папки', 'Folders');

  const foldersBox = document.createElement('div');
  foldersBox.className = 'pg-storage-tags';
  foldersBox.textContent = pt('Загружаю папки…', 'Loading the folders…');

  panel.append(title, input, foldersCaption, foldersBox, caption, tagsBox, hint);
  createOverlay(panel);
  focusSoon(input);

  loadCloudStorage(true).then((data) => {
    if(!foldersBox.isConnected) return;
    const chips = data.folders.map((folder) => {
      const chip = document.createElement('button');
      chip.className = 'pg-storage-tag pg-storage-folder';
      chip.style.setProperty('--folder-color', folderColor(folder));
      chip.textContent = folder.name;
      const counter = document.createElement('span');
      counter.textContent = '' + folder.ids.length;
      chip.append(counter);
      chip.addEventListener('click', () => openFolder(folder));
      return chip;
    });
    const add = document.createElement('button');
    add.className = 'pg-storage-tag pg-storage-add';
    add.textContent = pt('+ Новая папка', '+ New folder');
    add.addEventListener('click', () => askName(pt('Новая папка', 'New folder'), async(name) => {
      await createFolder(name);
      toast(pt(`Папка «${name}» создана`, `Folder «${name}» created`));
      openStorage();
    }));
    foldersBox.replaceChildren(...chips, add);
  }, () => {
    foldersBox.textContent = pt('Не удалось загрузить папки', 'Could not load the folders');
  });

  collectTags().then((tags) => {
    if(!tagsBox.isConnected) return;
    if(!tags.length) {
      tagsBox.textContent = pt('Меток пока нет.', 'No tags yet.');
      return;
    }
    tagsBox.replaceChildren(...tags.map(({tag, count}) => {
      const chip = document.createElement('button');
      chip.className = 'pg-storage-tag';
      chip.textContent = `#${tag}`;
      const counter = document.createElement('span');
      counter.textContent = '' + count;
      chip.append(counter);
      chip.addEventListener('click', () => {
        closeOverlay();
        openSavedSearch('#' + tag);
      });
      return chip;
    }));
  }, () => {
    tagsBox.textContent = pt('Не удалось загрузить метки', 'Could not load the tags');
  });
}

/** A #tag added to the text of an own message in Saved Messages (under the pointer) */
export async function tagHoveredSavedMessage() {
  const bubble = getTargetBubble();
  const {default: appImManager} = await import('@lib/appImManager');
  const chat = appImManager.chat;
  if(!bubble || chat?.peerId !== appImManager.myId) {
    toast(pt('Наведи мышь на своё сообщение в Избранном', 'Point at your own message in Saved Messages'));
    return;
  }

  const message = ((bubble as any).message || chat.getMessageByPeer(chat.peerId, +bubble.dataset.mid)) as Message.message;
  // * in Saved Messages every message is your own (they carry no «out» flag): only forwarded ones can't be edited
  if(!message || message.fwd_from) {
    toast(pt('Метку в тексте можно поставить только на своё сообщение, не на пересланное', 'A tag can only go into the text of your own message, not a forwarded one'));
    return;
  }

  const tags = (await collectTags()).slice(0, 8);
  const put = (tag: string) => async() => {
    const clean = tag.replace(/^#/, '').trim().replace(/\s+/g, '_');
    if(!clean) return;
    const text = message.message || '';
    if(new RegExp(`#${clean}(?![\\p{L}\\p{N}_])`, 'iu').test(text)) {
      toast(pt(`Метка #${clean} уже стоит`, `#${clean} is already there`));
      return;
    }
    // * appended at the end: the offsets of the entities already there stay the same
    const newText = text + (text ? (text.endsWith('\n') ? '' : '\n') : '') + '#' + clean;
    await chat.managers.appMessagesManager.editMessage(message, newText, {entities: message.entities || []});
    toast(pt(`Метка #${clean} поставлена`, `Tagged #${clean}`));
  };

  const options: ChoiceOption[] = tags.map(({tag}) => ({text: '#' + tag, run: put(tag)}));
  const anchor = bubble.querySelector<HTMLElement>('.bubble-content') || bubble;
  options.push({text: pt('Новая метка…', 'New tag…'), run: () => askNewTag(put, anchor)});
  openChoicePicker(pt('Поставить метку', 'Add a tag'), options, anchor);
}

/** A folder's records: the first words of each, a click shows it in Saved Messages */
async function openFolder(folder: CloudFolder) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const list = document.createElement('div');
  list.className = 'pg-list';
  list.textContent = pt('Загружаю…', 'Loading…');

  panel.append(makeTitle(`${folder.name} · ${folder.ids.length}`, true, openStorage), list);
  createOverlay(panel, undefined, openStorage);
  focusSoon(panel);

  const mids = folder.ids.map(fromTdId).filter(Boolean).slice(-100);
  if(!mids.length) {
    list.textContent = pt('Папка пуста. Положить: наведи мышь на сообщение в Избранном и нажми ⌥/Alt+4.', 'The folder is empty. Point at a message in Saved Messages and press ⌥/Alt+4.');
    return;
  }

  const managers = bindManagersToSession(rootScope.managers);
  const result = await managers.apiManager.invokeApi('messages.getMessages', {
    id: mids.map((id) => ({_: 'inputMessageID' as const, id}))
  }) as any;
  const messages = ((result.messages || []) as Message.message[]).filter((m) => m._ === 'message').sort((a, b) => b.id - a.id);
  if(!list.isConnected) return;

  list.replaceChildren(...messages.map((message) => {
    const item = document.createElement('div');
    item.className = 'pg-item';
    item.tabIndex = 0;
    const label = document.createElement('span');
    label.className = 'pg-item-title';
    const text = (message.message || '').replace(/\s+/g, ' ').trim();
    label.textContent = text ? (text.length > 70 ? text.slice(0, 70) + '…' : text) : describeMedia(message);
    const date = document.createElement('span');
    date.className = 'pg-item-target';
    date.textContent = new Date(message.date * 1000).toLocaleDateString();
    item.append(label, date);
    item.addEventListener('click', async() => {
      closeOverlay();
      const {default: appImManager} = await import('@lib/appImManager');
      appImManager.setPeer({peerId: appImManager.myId, lastMsgId: message.id});
    });
    return item;
  }));
  if(!messages.length) list.textContent = pt('Записи этой папки удалены из Избранного', 'The records of this folder were deleted from Saved Messages');
}

function describeMedia(message: Message.message) {
  const media = message.media as any;
  if(!media) return pt('Сообщение', 'Message');
  if(media._ === 'messageMediaPhoto') return pt('Фото', 'Photo');
  if(media._ === 'messageMediaWebPage') return pt('Ссылка', 'Link');
  const document = media.document;
  const name = document?.attributes?.find((a: any) => a._ === 'documentAttributeFilename')?.file_name;
  if(document?.attributes?.some((a: any) => a._ === 'documentAttributeAudio' && a.pFlags?.voice)) return pt('Голосовое', 'Voice message');
  if(document?.attributes?.some((a: any) => a._ === 'documentAttributeVideo')) return pt('Видео', 'Video');
  return name || pt('Файл', 'File');
}

/** «В папку…»: the message under the pointer (in Saved Messages) into a folder of the storage */
export async function putHoveredIntoFolder() {
  const bubble = getTargetBubble();
  const {default: appImManager} = await import('@lib/appImManager');
  const chat = appImManager.chat;
  if(!bubble || chat?.peerId !== appImManager.myId) {
    toast(pt('Наведи мышь на сообщение в Избранном', 'Point at a message in Saved Messages'));
    return;
  }

  const mids = await chat.getMidsByMid(chat.peerId, +bubble.dataset.mid);
  const anchor = bubble.querySelector<HTMLElement>('.bubble-content') || bubble;
  const data = await loadCloudStorage(true);
  const put = (folderId: number, name: string) => async() => {
    const added = await addToFolder(folderId, mids);
    toast(added ?
      pt(`Положено в «${name}»`, `Put into «${name}»`) :
      pt(`Уже лежит в «${name}»`, `Already in «${name}»`));
  };

  const options: ChoiceOption[] = data.folders.map((folder) => ({text: folder.name, run: put(folder.id, folder.name)}));
  options.push({text: pt('Новая папка…', 'New folder…'), run: () => askName(pt('Новая папка', 'New folder'), async(name) => {
    const folder = await createFolder(name);
    await put(folder.id, folder.name)();
  }, anchor)});
  openChoicePicker(pt('В папку', 'To a folder'), options, anchor);
}

/** A one-line question for a name: Enter gives it */
function askName(placeholder: string, done: (name: string) => void, anchor?: HTMLElement) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  const input = document.createElement('input');
  input.className = 'pg-palette-input';
  input.placeholder = placeholder + pt(', Enter — готово', ', Enter to finish');
  input.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const name = input.value.trim();
    closeOverlay();
    done(name);
  });
  panel.append(input);
  createOverlay(panel, anchor);
  focusSoon(input);
}

function askNewTag(put: (tag: string) => () => Promise<void>, anchor: HTMLElement) {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  const input = document.createElement('input');
  input.className = 'pg-palette-input';
  input.placeholder = pt('Новая метка, Enter — поставить', 'New tag, Enter to add');
  input.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const tag = input.value.trim();
    closeOverlay();
    put(tag)();
  });
  panel.append(input);
  createOverlay(panel, anchor);
  focusSoon(input);
}

/**
 * The service file in Saved Messages is not a record: its bubble is a small grey line «Служебный файл
 * PlumaGram — папки Хранилища» (a click opens the storage), not a JSON document someone wonders about.
 */
export function initServiceFileLine() {
  const apply = (bubble: HTMLElement) => {
    if(bubble.classList.contains('pg-service-file')) return;
    const name = bubble.querySelector('.document-name')?.textContent || '';
    if(!name.includes(STORAGE_FILE_NAME.replace('.json', ''))) return;
    bubble.classList.add('pg-service-file');
    const line = document.createElement('div');
    line.className = 'pg-filter-strip pg-service-line';
    line.textContent = pt('Служебный файл PlumaGram — папки Хранилища', 'PlumaGram service file — storage folders');
    line.addEventListener('click', (e) => {
      e.stopPropagation();
      openStorage();
    });
    bubble.prepend(line);
  };

  // * the chat list too: under «Saved Messages» not «PlumaGram-Хранилище.json, Служебный файл…» but a plain line
  const fileName = STORAGE_FILE_NAME;
  const applyPreview = (span: HTMLElement) => {
    if(!span.textContent.includes(fileName) || span.dataset.pgService) return;
    span.dataset.pgService = '1';
    span.textContent = pt('Папки Хранилища обновлены', 'Storage folders updated');
  };

  new MutationObserver((mutations) => {
    for(const mutation of mutations) {
      const target = mutation.target as HTMLElement;
      const preview = target.closest?.<HTMLElement>('.dialog-subtitle-span-last');
      if(preview) {
        delete preview.dataset.pgService;
        applyPreview(preview);
      }
      mutation.addedNodes.forEach((node) => {
        if(!(node instanceof HTMLElement)) return;
        const bubble = node.closest?.<HTMLElement>('.bubbles-inner .bubble[data-mid]');
        if(bubble) apply(bubble);
        node.querySelectorAll?.<HTMLElement>('.bubbles-inner .bubble[data-mid]').forEach(apply);
        if(node.matches('.dialog-subtitle-span-last')) applyPreview(node);
        node.querySelectorAll?.<HTMLElement>('.dialog-subtitle-span-last').forEach(applyPreview);
      });
    }
  }).observe(document.body, {childList: true, subtree: true});
  document.querySelectorAll<HTMLElement>('.bubbles-inner .bubble[data-mid]').forEach(apply);
  document.querySelectorAll<HTMLElement>('.dialog-subtitle-span-last').forEach(applyPreview);
}
