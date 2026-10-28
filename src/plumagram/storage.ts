/*
 * PlumaGram — «Хранилище» (Saved Messages as storage), the part that lives in the cloud: #tags in the text of
 * Saved Messages, the same ones the Android app gives to own messages. Folders and tags of forwarded messages
 * are kept on the phone by the app and are not here yet.
 */

import {toast} from '@components/toast';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {pt} from '@/plumagram/settings';
import {ChoiceOption, createOverlay, closeOverlay, openChoicePicker} from '@/plumagram/overlay';
import type {Message} from '@layer';

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

  const title = document.createElement('div');
  title.className = 'pg-settings-title';
  title.textContent = pt('Хранилище', 'Storage');

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
    'Метка — #слово в тексте своего сообщения в Избранном: её видно и в приложении. Поставить: наведи мышь на своё сообщение в Избранном и нажми ⌥/Alt+3 (#).',
    'A tag is a #word in the text of your own message in Saved Messages, seen in the app too. Point at your message there and press ⌥/Alt+3 (#).'
  );

  panel.append(title, input, caption, tagsBox, hint);
  createOverlay(panel);
  input.focus();

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
  const hovered = document.querySelectorAll<HTMLElement>('.bubbles-inner .bubble[data-mid]:hover');
  const bubble = hovered[hovered.length - 1];
  const {default: appImManager} = await import('@lib/appImManager');
  const chat = appImManager.chat;
  if(!bubble || chat?.peerId !== appImManager.myId) {
    toast(pt('Наведи мышь на своё сообщение в Избранном', 'Point at your own message in Saved Messages'));
    return;
  }

  const message = ((bubble as any).message || chat.getMessageByPeer(chat.peerId, +bubble.dataset.mid)) as Message.message;
  if(!message || message.fwd_from || !message.pFlags?.out) {
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
  options.push({text: pt('Новая метка…', 'New tag…'), run: () => askNewTag(put)});
  openChoicePicker(pt('Поставить метку', 'Add a tag'), options);
}

function askNewTag(put: (tag: string) => () => Promise<void>) {
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
  createOverlay(panel);
  input.focus();
}
