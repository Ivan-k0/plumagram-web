/*
 * PlumaGram — the folders of «Хранилище» in the cloud: one service file in Saved Messages,
 * «PlumaGram-Хранилище.json», that the web version and the Android app both read and write.
 *
 * The format is the one the Android app keeps on the phone (Tgx101SavedStore, "v": 1), its data part only:
 *   {app: 'PlumaGram', kind: 'storage', v: 1, updated: <ms>, by: 'web' | 'android', next: <next folder id>,
 *    folders: [{id, name, color, home, size?, ids: [<message ids>], share?}],
 *    tags: {<tag>: [<message ids>]}, homeTags: [<tag>]}
 * Message ids are TDLib's, as on the phone: the server id × 2^20. Fields this side doesn't know are kept as
 * they are. The file is replaced in the same message (not sent anew), silently.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import type {Document, Message} from '@layer';
import {pt} from '@/plumagram/settings';

export const STORAGE_FILE_NAME = 'PlumaGram-Хранилище.json';
const CAPTION = 'Служебный файл PlumaGram: папки Хранилища для приложения и веб-версии. Не удаляйте.';
const TD_SHIFT = 1048576;

/** the folder colours of the app, by number */
export const FOLDER_COLORS = ['#3f7cad', '#c0662a', '#2e8a4a', '#7c4fb0', '#b53c57', '#2a8c8c', '#8a7a2a',
  '#d04545', '#cc4f96', '#c79a14', '#4d5fc9', '#6c7a87'];

export type CloudFolder = {
  id: number,
  name: string,
  color: number,
  home?: boolean,
  size?: number,
  ids: number[],
  [key: string]: any
};

export type CloudStorage = {
  app: string,
  kind: string,
  v: number,
  updated: number,
  by: string,
  next: number,
  folders: CloudFolder[],
  tags: {[tag: string]: number[]},
  homeTags: string[],
  [key: string]: any
};

export const toTdId = (mid: number) => mid * TD_SHIFT;
export const fromTdId = (id: number) => id % TD_SHIFT === 0 ? id / TD_SHIFT : undefined;

export function folderColor(folder: CloudFolder) {
  return FOLDER_COLORS[Math.abs(folder.color || 0) % FOLDER_COLORS.length];
}

function empty(): CloudStorage {
  return {app: 'PlumaGram', kind: 'storage', v: 1, updated: 0, by: 'web', next: 1, folders: [], tags: {}, homeTags: []};
}

let cached: {data: CloudStorage, mid?: number};

const MAX_FILE_SIZE = 512 * 1024, MAX_FOLDERS = 500, MAX_IDS = 10000, MAX_NAME = 64;

/**
 * Only our own file in Saved Messages: never a forwarded one — a file someone sent and that was forwarded here
 * would put their folders (and a «share» target) in place of yours
 */
function isStorageDocument(message: Message.message) {
  if(!message || message.fwd_from) return false;
  const document = (message.media as any)?.document as Document.document;
  return !!document?.attributes?.some((attribute) => attribute._ === 'documentAttributeFilename' && attribute.file_name === STORAGE_FILE_NAME) &&
    +document.size <= MAX_FILE_SIZE;
}

const isId = (value: any) => typeof value === 'number' && Number.isSafeInteger(value);

/** The file's data if it is sound, else nothing: a broken or oversized file is never taken in */
function validate(parsed: any): CloudStorage {
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const folders = parsed.folders ?? [];
  const tags = parsed.tags ?? {};
  if(!Array.isArray(folders) || folders.length > MAX_FOLDERS || typeof tags !== 'object' || Array.isArray(tags)) return;
  for(const folder of folders) {
    if(!folder || typeof folder !== 'object' || !isId(folder.id) || typeof folder.name !== 'string' ||
      !Array.isArray(folder.ids) || folder.ids.length > MAX_IDS || !folder.ids.every(isId)) return;
    folder.name = folder.name.slice(0, MAX_NAME);
    if(!isId(folder.color)) folder.color = 0;
  }
  for(const tag in tags) {
    if(!Array.isArray(tags[tag]) || tags[tag].length > MAX_IDS || !tags[tag].every(isId)) return;
  }
  if(parsed.homeTags !== undefined && !(Array.isArray(parsed.homeTags) && parsed.homeTags.every((t: any) => typeof t === 'string'))) return;
  return {...empty(), ...parsed, folders, tags, next: isId(parsed.next) ? parsed.next : 1, updated: isId(parsed.updated) ? parsed.updated : 0};
}

// * a copy in this browser: the file is made again from it when it was deleted, and taken when the cloud one is broken
function copyKey() {
  return 'plumagram:storage-copy:' + rootScope.myId;
}

function readCopy(): {data: CloudStorage, hadFile: boolean} {
  try {
    const raw = JSON.parse(localStorage.getItem(copyKey()) || 'null');
    const data = validate(raw?.data);
    return data ? {data, hadFile: !!raw.hadFile} : undefined;
  } catch(err) {}
}

function writeCopy(data: CloudStorage, hadFile: boolean) {
  try {
    localStorage.setItem(copyKey(), JSON.stringify({data, hadFile}));
  } catch(err) {}
}

/** Two versions of the folders as one: a folder's name and colour from the newer, the records of both */
function merge(a: CloudStorage, b: CloudStorage): CloudStorage {
  const [newer, older] = a.updated >= b.updated ? [a, b] : [b, a];
  const folders = newer.folders.map((folder) => {
    const other = older.folders.find((f) => f.id === folder.id);
    return other ? {...folder, ids: [...new Set([...folder.ids, ...other.ids])]} : folder;
  });
  older.folders.forEach((folder) => {
    if(!folders.some((f) => f.id === folder.id)) folders.push(folder);
  });
  const tags = {...older.tags};
  for(const tag in newer.tags) tags[tag] = [...new Set([...(tags[tag] || []), ...newer.tags[tag]])];
  return {...older, ...newer, folders, tags, next: Math.max(newer.next || 1, older.next || 1)};
}

function sameRecords(a: CloudStorage, b: CloudStorage) {
  return JSON.stringify(a.folders) === JSON.stringify(b.folders) && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}

/** The service file's message in Saved Messages (the newest one, if there are several) */
async function findStorageMessage(): Promise<Message.message> {
  const managers = bindManagersToSession(rootScope.managers);
  // * the recent messages first: the search sees a file sent a moment ago only some time later
  const recent = await managers.apiManager.invokeApi('messages.getHistory', {
    peer: {_: 'inputPeerSelf'},
    offset_id: 0,
    offset_date: 0,
    add_offset: 0,
    limit: 100,
    max_id: 0,
    min_id: 0,
    hash: '0'
  }) as any;
  const result = ((recent.messages || []) as Message.message[]).some(isStorageDocument) ? recent : await managers.apiManager.invokeApi('messages.search', {
    peer: {_: 'inputPeerSelf'},
    q: 'PlumaGram',
    filter: {_: 'inputMessagesFilterDocument'},
    min_date: 0,
    max_date: 0,
    offset_id: 0,
    add_offset: 0,
    limit: 20,
    max_id: 0,
    min_id: 0,
    hash: '0'
  }) as any;
  const found = ((result.messages || []) as Message.message[]).filter(isStorageDocument).sort((a, b) => b.id - a.id)[0];
  if(!found) return;

  // * the app's own copy of the message, with the document saved, to download and edit it
  const myId = rootScope.myId;
  const [message] = await managers.appMessagesManager.reloadMessages(myId, [found.id]) as Message.message[];
  return message;
}

/** The folders as they are in the cloud now (made again from this browser's copy when the file was deleted) */
export async function loadCloudStorage(force = false): Promise<CloudStorage> {
  if(cached && (!force || cached.mid === undefined && Date.now() - cached.data.updated < 15e3)) return cached.data;

  const copy = readCopy();
  const message = await findStorageMessage();
  if(!message) {
    if(copy?.hadFile && copy.data.folders.length) {
      // * the file was there and is gone: deleted — sent again from the copy
      cached = {data: copy.data};
      await saveCloudStorage(copy.data);
      notifyRestored();
      return copy.data;
    }
    cached = {data: copy?.data || empty()};
    return cached.data;
  }

  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  let data: CloudStorage;
  try {
    const blob = await appDownloadManager.downloadMedia({media: (message.media as any).document});
    data = validate(JSON.parse(await (blob as Blob).text()));
  } catch(err) {}

  cached = {data: data || copy?.data || empty(), mid: message.mid};
  if(!data) {
    // * a broken file is never taken in: the copy stays, and is written over it when there is one
    if(copy) await saveCloudStorage(copy.data);
    return cached.data;
  }

  if(copy && !sameRecords(copy.data, data) && copy.data.updated > data.updated) {
    // * this browser has something newer than the cloud (a write that did not get through): both, as one
    const merged = merge(copy.data, data);
    cached = {data: merged, mid: message.mid};
    await saveCloudStorage(merged);
    return merged;
  }

  writeCopy(data, true);
  return data;
}

function notifyRestored() {
  import('@components/toast').then(({toast}) => toast(pt(
    'Папки Хранилища восстановлены с этого устройства',
    'The storage folders were restored from this device'
  )));
}

/** Writes the folders back: the file in the same message is replaced, or sent the first time */
export async function saveCloudStorage(data: CloudStorage) {
  const managers = bindManagersToSession(rootScope.managers);
  const myId = rootScope.myId;
  data.updated = Date.now();
  data.by = 'web';

  const file = new File([JSON.stringify(data, null, 1)], STORAGE_FILE_NAME, {type: 'application/json'});
  // * never a second file: the one already in Saved Messages is looked for when its id isn't known yet
  const message = cached?.mid ?
    await managers.appMessagesManager.getMessageByPeer(myId, cached.mid) as Message.message :
    await findStorageMessage();

  if(message) {
    await managers.appMessagesManager.editMessageMedia({
      message,
      text: CAPTION,
      sendFileDetails: {file},
      options: {isMedia: false}
    });
  } else {
    await managers.appMessagesManager.sendFile({
      peerId: myId,
      file,
      caption: CAPTION,
      isMedia: false,
      silent: true
    });
  }

  // * after the first sending the message is found again on the next load (its id is the server's by then)
  cached = {data, mid: message?.mid};
  writeCopy(data, true);
}

export async function createFolder(name: string) {
  const data = await loadCloudStorage(true);
  const folder: CloudFolder = {id: data.next || 1, name, color: (data.folders.length) % FOLDER_COLORS.length, home: true, ids: []};
  data.next = folder.id + 1;
  data.folders.push(folder);
  await saveCloudStorage(data);
  return folder;
}

/** Puts Saved Messages (by their ids in the web version) into a folder; returns how many were new there */
export async function addToFolder(folderId: number, mids: number[]) {
  const data = await loadCloudStorage(true);
  const folder = data.folders.find((f) => f.id === folderId);
  if(!folder) return 0;
  const ids = mids.map(toTdId).filter((id) => !folder.ids.includes(id));
  folder.ids.push(...ids);
  if(ids.length) await saveCloudStorage(data);
  return ids.length;
}

export async function removeFromFolder(folderId: number, mid: number) {
  const data = await loadCloudStorage(true);
  const folder = data.folders.find((f) => f.id === folderId);
  if(!folder) return;
  folder.ids = folder.ids.filter((id) => id !== toTdId(mid));
  await saveCloudStorage(data);
}

// * for checks from the console: plumagram.storageChecks
export const storageChecks = {validate, merge, isStorageDocument};
