/*
 * PlumaGram — «Поделиться папкой», as in the Android app: a folder of «Хранилище» shared like a folder on a drive —
 * a private channel (or a group) with the folder's name, pinned in the chats; what is in the folder is copied there
 * in the background, in batches with pauses, and goes on after a break; an invite link for whoever should see it.
 *
 * The share lives in the folders' cloud file, as the phone keeps it (folder.share):
 *   {chat: <TDLib chat id>, link, channel, auto, copies, approval, done: [<TDLib message ids copied>]}
 * Records are copied only into a chat this account made: a cloud file changed by someone else must not send the
 * folder to their channel.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {toast} from '@components/toast';
import {pt} from '@/plumagram/settings';
import {CloudFolder, fromTdId, loadCloudStorage, saveCloudStorage} from '@/plumagram/storageCloud';

export type FolderShare = {
  chat: number,
  link?: string,
  channel: boolean,
  auto: boolean,
  copies: boolean,
  approval: boolean,
  done: number[]
};

export type ShareOptions = {title: string, channel: boolean, auto: boolean, copies: boolean, approval: boolean};

export const SHARE_BATCH = 20;
export const SHARE_PAUSE_MS = 1500;
const TD_CHANNEL_SHIFT = 1e12;

const toTdChatId = (channelId: ChatId) => -(TD_CHANNEL_SHIFT + +channelId);
export const shareChannelId = (share: FolderShare) => share?.chat ? -share.chat - TD_CHANNEL_SHIFT : 0;
export const sharePeerId = (share: FolderShare) => shareChannelId(share).toPeerId(true);

export function folderShare(folder: CloudFolder): FolderShare {
  const share = folder.share;
  return share && typeof share === 'object' && share.chat ? share : undefined;
}

/** what is in the folder and not yet in its shared copy, oldest first */
export function unshared(folder: CloudFolder) {
  const done = new Set(folderShare(folder)?.done || []);
  return folder.ids.filter((id) => !done.has(id));
}

/** folder id → {done, total} while its records are being copied; the screens listen to `pg-share-progress` */
const progress = new Map<number, {done: number, total: number}>();

export function shareProgress(folderId: number) {
  return progress.get(folderId);
}

function setProgress(folderId: number, value: {done: number, total: number}) {
  if(value) progress.set(folderId, value);
  else progress.delete(folderId);
  window.dispatchEvent(new CustomEvent('pg-share-progress', {detail: folderId}));
}

/** A folder shared anew: the chat, its link, pinned; then its records are copied there */
export async function shareFolder(folderId: number, options: ShareOptions) {
  const managers = bindManagersToSession(rootScope.managers);
  toast(pt('Создаю…', 'Creating…'));
  const channelId = await managers.appChatsManager.createChannel({
    title: options.title,
    about: pt('Папка из PlumaGram', 'A folder from PlumaGram'),
    broadcast: options.channel || undefined,
    megagroup: !options.channel || undefined
  });

  let link: string;
  try {
    const invite = await managers.appChatInvitesManager.exportChatInvite({
      chatId: channelId,
      title: 'PlumaGram',
      requestNeeded: options.approval || undefined
    }) as any;
    link = invite?.link;
  } catch(err) {
    toast(pt('Не удалось создать ссылку', 'Could not create the link'));
  }

  const data = await loadCloudStorage(true);
  const folder = data.folders.find((f) => f.id === folderId);
  if(!folder) return;
  const share: FolderShare = {
    chat: toTdChatId(channelId),
    link,
    channel: options.channel,
    auto: options.auto,
    copies: options.copies,
    approval: options.approval,
    done: []
  };
  folder.share = share;
  await saveCloudStorage(data);

  // * pinned in the chats, as on the phone; the new chat's dialog may come a moment later
  setTimeout(() => {
    managers.appMessagesManager.toggleDialogPin({peerId: channelId.toPeerId(true)}).catch(() => {});
  }, 1500);

  copyPending(folderId);
  return {folder, share};
}

const running = new Set<number>();

/** Is the chat this account's own? Only then do the folder's records go there */
async function isOwnChat(share: FolderShare) {
  const managers = bindManagersToSession(rootScope.managers);
  try {
    const chat = await managers.appChatsManager.getChat(shareChannelId(share)) as any;
    return !!chat?.pFlags?.creator;
  } catch(err) {
    return false;
  }
}

/** The records of the folder not yet in its shared copy are copied there, a batch at a time */
export async function copyPending(folderId: number) {
  if(running.has(folderId)) return;
  running.add(folderId);
  const managers = bindManagersToSession(rootScope.managers);
  const myId = rootScope.myId;
  let done = 0, total = 0, folderName = '';
  try {
    let data = await loadCloudStorage(true);
    let folder = data.folders.find((f) => f.id === folderId);
    const share = folder && folderShare(folder);
    if(!share || !(await isOwnChat(share))) return;
    folderName = folder.name;
    const pending = unshared(folder);
    done = share.done.length;
    total = done + pending.length;
    if(!pending.length) return;

    const peerId = sharePeerId(share);
    for(let from = 0; from < pending.length;) {
      setProgress(folderId, {done, total});
      const batch = pending.slice(from, from + SHARE_BATCH);
      const mids = batch.map(fromTdId).filter(Boolean);
      try {
        // * the app's own copies of the records, for it to forward them
        await managers.appMessagesManager.reloadMessages(myId, mids);
        await managers.appMessagesManager.forwardMessages({
          peerId,
          fromPeerId: myId,
          mids,
          dropAuthor: share.copies,
          silent: true // the members aren't pinged for each copy
        });
      } catch(err) {
        const error = err as ApiError;
        const wait = +(/FLOOD_WAIT_(\d+)/.exec(error?.type || '')?.[1] || 0);
        if(wait) { // Telegram asked to slow down: the same batch again after the pause it named
          await sleep(Math.min(600, wait) * 1000 + 500);
          continue;
        }
        if(/CHANNEL_INVALID|CHANNEL_PRIVATE|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED/.test(error?.type || '')) return; // the chat is gone
        // * something in this batch can't be copied (deleted, protected): skipped, the rest goes on
      }

      // * what was copied is written down at once: after a break the copying goes on from there
      data = await loadCloudStorage(true);
      folder = data.folders.find((f) => f.id === folderId);
      const current = folder && folderShare(folder);
      if(!current || current.chat !== share.chat) return; // stopped meanwhile
      current.done = [...new Set([...current.done, ...batch])];
      await saveCloudStorage(data);
      done += batch.length;
      from += batch.length;
      if(from < pending.length) await sleep(SHARE_PAUSE_MS);
    }
    setProgress(folderId, {done, total});
    toast(pt(`«${folderName}» готова: скопировано ${done} из ${total}`, `«${folderName}» is ready: ${done} of ${total} copied`));
  } catch(err) {
    toast(pt('Не удалось скопировать записи в общую папку', 'Could not copy the records to the shared folder'));
  } finally {
    running.delete(folderId);
    setProgress(folderId, undefined);
  }
}

/** «Добавлять новое из папки»: something was put into a shared folder */
export function onFolderChanged(folder: CloudFolder) {
  if(folderShare(folder)?.auto) setTimeout(() => copyPending(folder.id), 800);
}

/** After a break (the page was closed while copying): the shared folders go on */
export async function resumeShares() {
  const data = await loadCloudStorage();
  data.folders.forEach((folder) => {
    if(folderShare(folder) && unshared(folder).length) copyPending(folder.id);
  });
}

/** «Обновить»: what was put into the folder since */
export function updateShare(folder: CloudFolder) {
  const n = unshared(folder).length;
  if(!n) {
    toast(pt('В папке нет нового', 'Nothing new in the folder'));
    return;
  }
  toast(pt(`Добавляю новое: ${n}`, `Adding the new ones: ${n}`));
  copyPending(folder.id);
}

/** «Перестать делиться»: the link goes dead (the chat stays as it is), or the chat is deleted for everyone */
export async function stopShare(folderId: number, deleteChat: boolean) {
  const managers = bindManagersToSession(rootScope.managers);
  const data = await loadCloudStorage(true);
  const folder = data.folders.find((f) => f.id === folderId);
  const share = folder && folderShare(folder);
  if(!share) return;
  const channelId = shareChannelId(share);
  try {
    if(deleteChat) await managers.appChatsManager.deleteChannel(channelId);
    else if(share.link) await managers.appChatInvitesManager.editExportedChatInvite({chatId: channelId, link: share.link, revoked: true});
  } catch(err) {
    toast(pt('Не удалось: ' + ((err as ApiError)?.type || ''), 'Failed: ' + ((err as ApiError)?.type || '')));
  }
  delete folder.share;
  await saveCloudStorage(data);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
