/*
 * PlumaGram — «Газета»: the posts of all one's channels as one feed, as in the Android app. Posts full width
 * without bubbles; the channel's avatar and name on top (a run of posts of one channel is one group), views and
 * time at the bottom right, reactions at the bottom left; long posts folded with «Показать полностью»; oldest
 * on top, opened at the first unread one. A post scrolled past is marked read in its channel — a switch
 * («Отмечать прочитанным»), on by default as in the app.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {pt} from '@/plumagram/settings';
import {createOverlay, focusSoon, makeTitle} from '@/plumagram/overlay';
import type {Chat, Message} from '@layer';
import {getMiddleware, Middleware} from '@helpers/middleware';

const PER_CHANNEL = 30, FOLD_LINES = 8;
const SETTINGS_KEY = 'plumagram:gazeta';

type GazetaSettings = {markRead: boolean, archived: boolean, hidden: string[]};

function loadSettings(): GazetaSettings {
  try {
    return {markRead: true, archived: false, hidden: [], ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')};
  } catch(err) {
    return {markRead: true, archived: false, hidden: []};
  }
}

function saveSettings(settings: GazetaSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch(err) {}
}

type Post = {message: Message.message, channel: Chat.channel, unread: boolean};

async function loadPosts(settings: GazetaSettings): Promise<Post[]> {
  const managers = bindManagersToSession(rootScope.managers);
  const folders = settings.archived ? [0, 1] : [0];
  const channels: {channel: Chat.channel, readMax: number, unread: number}[] = [];
  for(const folder_id of folders) {
    const result = await managers.apiManager.invokeApi('messages.getDialogs', {
      offset_date: 0, offset_id: 0, offset_peer: {_: 'inputPeerEmpty'}, limit: 100, hash: '0', folder_id
    }) as any;
    // * the app learns these channels too: their avatars and names are drawn by it
    await managers.appPeersManager.saveApiPeers(result);
    const chats = new Map<string, Chat.channel>((result.chats || []).map((chat: any) => ['' + chat.id, chat]));
    for(const dialog of result.dialogs || []) {
      if(dialog.peer?._ !== 'peerChannel') continue;
      const channel = chats.get('' + dialog.peer.channel_id);
      if(!channel?.pFlags?.broadcast || settings.hidden.includes('' + channel.id)) continue;
      channels.push({channel, readMax: dialog.read_inbox_max_id || 0, unread: dialog.unread_count || 0});
    }
  }

  const posts: Post[] = [];
  await Promise.all(channels.map(async({channel, readMax, unread}) => {
    const history = await managers.apiManager.invokeApi('messages.getHistory', {
      peer: {_: 'inputPeerChannel', channel_id: channel.id, access_hash: channel.access_hash},
      offset_id: 0, offset_date: 0, add_offset: 0, limit: Math.max(PER_CHANNEL, Math.min(unread, 100)), max_id: 0, min_id: 0, hash: '0'
    } as any).catch((): any => undefined) as any;
    for(const message of (history?.messages || []) as Message.message[]) {
      if(message._ !== 'message') continue;
      posts.push({message, channel, unread: message.id > readMax});
    }
  }));

  // * an album is one post: its first message, with the count of the others
  posts.sort((a, b) => a.message.date - b.message.date || a.message.id - b.message.id);
  return posts;
}

function formatViews(views: number) {
  if(views >= 1e6) return (views / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if(views >= 1e3) return (views / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '' + views;
}

async function photoUrl(message: Message.message): Promise<string> {
  const media = message.media as any;
  const photo = media?._ === 'messageMediaPhoto' ? media.photo : undefined;
  const document = media?._ === 'messageMediaDocument' ? media.document : undefined;
  const target = photo || document;
  const sizes = (photo?.sizes || document?.thumbs || []).filter((s: any) => s._ === 'photoSize' || s._ === 'photoSizeProgressive');
  if(!target || !sizes.length) return;
  // * a picture as wide as the feed, not the biggest one
  const size = sizes.find((s: any) => s.w >= 600) || sizes[sizes.length - 1];
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  const blob = await appDownloadManager.downloadMedia({media: target, thumb: size}) as Blob;
  return URL.createObjectURL(blob);
}

function renderPost(post: Post, showHeader: boolean, avatars: Map<string, HTMLElement>) {
  const {message, channel} = post;
  const card = document.createElement('article');
  card.className = 'pg-gz-post' + (showHeader ? ' is-first' : '') + (post.unread ? ' is-unread' : '');
  card.dataset.channel = '' + channel.id;
  card.dataset.id = '' + message.id;

  if(showHeader) {
    const header = document.createElement('div');
    header.className = 'pg-gz-header';
    const avatar = document.createElement('div');
    avatar.className = 'pg-gz-avatar';
    avatar.textContent = (channel.title || '?').slice(0, 1).toUpperCase();
    avatars.set(channel.id + ':' + message.id, avatar);
    const name = document.createElement('div');
    name.className = 'pg-gz-name';
    name.textContent = channel.title;
    header.append(avatar, name);
    card.append(header);
  }

  const media = message.media as any;
  if(media && (media._ === 'messageMediaPhoto' || media.document?.thumbs?.length)) {
    const picture = document.createElement('div');
    picture.className = 'pg-gz-photo';
    const isVideo = media.document?.attributes?.some((a: any) => a._ === 'documentAttributeVideo');
    if(isVideo) picture.classList.add('is-video');
    card.append(picture);
    photoUrl(message).then((url) => {
      if(!url) return picture.remove();
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      picture.append(img);
    }, () => picture.remove());
  }

  if(message.message) {
    const text = document.createElement('div');
    text.className = 'pg-gz-text';
    text.textContent = message.message;
    card.append(text);
    requestAnimationFrame(() => {
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 20;
      if(text.scrollHeight > lineHeight * (FOLD_LINES + 1)) {
        text.classList.add('is-folded');
        text.style.maxHeight = lineHeight * FOLD_LINES + 'px';
        const more = document.createElement('button');
        more.className = 'pg-gz-more';
        more.textContent = pt('Показать полностью', 'Show in full');
        more.addEventListener('click', () => {
          text.classList.remove('is-folded');
          text.style.maxHeight = '';
          more.remove();
        });
        text.after(more);
      }
    });
  }

  const footer = document.createElement('div');
  footer.className = 'pg-gz-footer';
  const reactions = document.createElement('div');
  reactions.className = 'pg-gz-reactions';
  for(const result of ((message.reactions as any)?.results || []).slice(0, 6)) {
    const emoji = result.reaction?.emoticon || (result.reaction?._ === 'reactionPaid' ? '⭐' : '◆');
    const chip = document.createElement('span');
    chip.className = 'pg-gz-reaction';
    chip.textContent = `${emoji} ${formatViews(result.count)}`;
    reactions.append(chip);
  }
  const meta = document.createElement('div');
  meta.className = 'pg-gz-meta';
  const time = new Date(message.date * 1000);
  const sameDay = time.toDateString() === new Date().toDateString();
  meta.textContent = (message.views ? '👁 ' + formatViews(message.views) + ' · ' : '') +
    (sameDay ? '' : time.toLocaleDateString([], {day: 'numeric', month: 'short'}) + ' ') +
    time.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  footer.append(reactions, meta);
  card.append(footer);
  return card;
}

/** Real avatars of the channels, drawn after the feed is shown */
async function fillAvatars(avatars: Map<string, HTMLElement>, posts: Post[], middleware: Middleware) {
  const {avatarNew} = await import('@components/avatarNew');
  for(const [key, holder] of avatars) {
    const channelId = key.split(':')[0];
    const post = posts.find((p) => '' + p.channel.id === channelId);
    if(!post) continue;
    try {
      const avatar = avatarNew({middleware, size: 36, peerId: post.channel.id.toPeerId(true)});
      avatar.render?.();
      holder.textContent = '';
      holder.append(avatar.element as HTMLElement);
    } catch(err) {}
  }
}

let markReadTimer: number;

/** Posts scrolled past are marked read in their channels (in batches, a moment later) */
function watchRead(list: HTMLElement, settings: GazetaSettings) {
  const managers = bindManagersToSession(rootScope.managers);
  const pending = new Map<string, {channel: Chat.channel, maxId: number}>();
  const observer = new IntersectionObserver((entries) => {
    if(!settings.markRead) return;
    for(const entry of entries) {
      const card = entry.target as HTMLElement;
      if(!entry.isIntersecting || !card.classList.contains('is-unread')) continue;
      card.classList.remove('is-unread');
      const channel = (card as any).pgChannel as Chat.channel;
      const id = +card.dataset.id;
      const was = pending.get(card.dataset.channel);
      if(!was || was.maxId < id) pending.set(card.dataset.channel, {channel, maxId: id});
    }
    clearTimeout(markReadTimer);
    markReadTimer = window.setTimeout(() => {
      pending.forEach(({channel, maxId}) => {
        managers.apiManager.invokeApi('channels.readHistory', {
          channel: {_: 'inputChannel', channel_id: channel.id, access_hash: channel.access_hash},
          max_id: maxId
        } as any).catch(() => {});
      });
      pending.clear();
    }, 1500);
  }, {root: list, threshold: 0.6});
  list.querySelectorAll('.pg-gz-post').forEach((card) => observer.observe(card));
  return observer;
}

export async function openGazeta() {
  const settings = loadSettings();
  const panel = document.createElement('div');
  panel.className = 'pg-panel pg-gz-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const title = makeTitle(pt('Газета', 'Gazeta'));
  const settingsButton = document.createElement('button');
  settingsButton.className = 'pg-close';
  settingsButton.textContent = '⚙';
  settingsButton.setAttribute('aria-label', pt('Настройки Газеты', 'Gazeta settings'));
  settingsButton.addEventListener('click', () => openGazetaSettings());
  title.insertBefore(settingsButton, title.lastElementChild);

  const list = document.createElement('div');
  list.className = 'pg-gz-list';
  list.textContent = pt('Собираю посты каналов…', 'Gathering the channels\' posts…');
  panel.append(title, list);
  createOverlay(panel);
  focusSoon(panel);

  let posts: Post[];
  try {
    posts = await loadPosts(settings);
  } catch(err) {
    list.textContent = pt('Не удалось загрузить каналы', 'Could not load the channels');
    return;
  }
  if(!list.isConnected) return;
  if(!posts.length) {
    list.textContent = pt('В подписках нет каналов.', 'No channels in your subscriptions.');
    return;
  }

  const avatars = new Map<string, HTMLElement>();
  list.textContent = '';
  let firstUnread: HTMLElement;
  posts.forEach((post, idx) => {
    const previous = posts[idx - 1];
    const card = renderPost(post, !previous || previous.channel.id !== post.channel.id, avatars);
    (card as any).pgChannel = post.channel;
    if(post.unread && !firstUnread) {
      firstUnread = card;
      const divider = document.createElement('div');
      divider.className = 'pg-gz-divider';
      divider.textContent = pt('Непрочитанные', 'Unread');
      list.append(divider);
    }
    list.append(card);
  });

  // * opened at the first unread post, or at the newest one when all are read
  requestAnimationFrame(() => {
    if(firstUnread) firstUnread.previousElementSibling?.scrollIntoView({block: 'start'});
    else list.scrollTop = list.scrollHeight;
  });

  const middlewareHelper = getMiddleware();
  fillAvatars(avatars, posts, middlewareHelper.get());
  const observer = watchRead(list, settings);
  new MutationObserver(() => {
    if(!panel.isConnected) {
      observer.disconnect();
      middlewareHelper.destroy();
    }
  }).observe(document.body, {childList: true});
}

function openGazetaSettings() {
  const settings = loadSettings();
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;

  const row = (key: 'markRead' | 'archived', text: string, sub: string) => {
    const el = document.createElement('div');
    el.className = 'pg-settings-row';
    el.setAttribute('role', 'switch');
    el.tabIndex = 0;
    const texts = document.createElement('div');
    texts.className = 'pg-settings-row-text';
    texts.innerHTML = '<div></div><div class="pg-settings-row-sub"></div>';
    texts.firstElementChild.textContent = text;
    texts.lastElementChild.textContent = sub;
    const sw = document.createElement('div');
    sw.className = 'pg-switch';
    const paint = () => sw.classList.toggle('is-on', settings[key]);
    paint();
    el.addEventListener('click', () => {
      settings[key] = !settings[key];
      saveSettings(settings);
      paint();
    });
    el.append(texts, sw);
    return el;
  };

  panel.append(
    makeTitle(pt('Настройки Газеты', 'Gazeta settings'), true, () => openGazeta()),
    row('markRead', pt('Отмечать прочитанным', 'Mark as read'), pt('Пролистанный пост — прочитан и в канале', 'A post scrolled past is read in its channel too')),
    row('archived', pt('Каналы из архива', 'Archived channels'), pt('Показывать и посты каналов из архива', 'Show the posts of archived channels too'))
  );
  createOverlay(panel, undefined, () => openGazeta());
  focusSoon(panel);
}
