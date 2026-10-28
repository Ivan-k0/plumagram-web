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

function isStorageDocument(message: Message.message) {
  const document = (message?.media as any)?.document as Document.document;
  return !!document?.attributes?.some((attribute) => attribute._ === 'documentAttributeFilename' && attribute.file_name === STORAGE_FILE_NAME);
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

/** The folders as they are in the cloud now */
export async function loadCloudStorage(force = false): Promise<CloudStorage> {
  if(cached && (!force || cached.mid === undefined && Date.now() - cached.data.updated < 15e3)) return cached.data;

  const message = await findStorageMessage();
  if(!message) {
    cached = {data: empty()};
    return cached.data;
  }

  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  const blob = await appDownloadManager.downloadMedia({media: (message.media as any).document});
  let data = empty();
  try {
    const parsed = JSON.parse(await (blob as Blob).text());
    if(parsed && typeof parsed === 'object') data = {...data, ...parsed, folders: parsed.folders || [], tags: parsed.tags || {}};
  } catch(err) {}

  cached = {data, mid: message.mid};
  return data;
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
