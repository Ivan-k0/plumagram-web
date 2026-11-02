/*
 * PlumaGram — Telegram's own AI in the web version:
 *  — a helper for the message being typed (⌥/Alt+I): fix mistakes, add emoji, shorter, formal, translate —
 *    the result goes into the message field, nothing is sent;
 *  — «Что пропустил»: the unread messages of the open chat told in short. A real retelling where Telegram gives it
 *    to the account (rich compose with a prompt, as in the Android app), else each message made short.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {toast} from '@components/toast';
import {pt} from '@/plumagram/settings';
import {createOverlay, focusSoon, makeTitle, openChoicePicker} from '@/plumagram/overlay';
import type {Message} from '@layer';

const MAX_MISSED = 80, LINE_MAX = 160;

function aiError(err: any) {
  const type = err?.type || String(err);
  if(/PREMIUM/.test(type)) return pt('Это доступно только с Telegram Premium', 'Only with Telegram Premium');
  if(/RICH_MESSAGE_UNSUPPORTED|TONE_INVALID/.test(type)) return pt('Telegram пока не даёт этот ИИ вашему аккаунту', 'Telegram does not offer this AI to your account yet');
  if(/FLOOD/.test(type)) return pt('Слишком часто — попробуйте чуть позже', 'Too often — try a bit later');
  return pt('ИИ не ответил: ', 'The AI did not answer: ') + type;
}

/** The helper for the message being typed: the text in the field is replaced by what the AI made of it */
export async function openComposeHelper() {
  const managers = bindManagersToSession(rootScope.managers);
  const {default: appImManager} = await import('@lib/appImManager');
  const input = appImManager.chat?.input;
  const field = input?.messageInputField?.input as HTMLElement;
  const text = (field?.innerText || '').trim();
  if(!field || !text) {
    toast(pt('Сначала напиши сообщение — помощник поправит его', 'Type a message first — the helper will polish it'));
    return;
  }

  const run = (params: any, name: string) => async() => {
    toast(pt(`ИИ: ${name}…`, `AI: ${name}…`));
    try {
      const result = await managers.apiManager.invokeApi('messages.composeMessageWithAI', {
        text: {_: 'textWithEntities', text, entities: []},
        ...params
      }) as any;
      const out = result?.result_text?.text;
      if(!out) throw new Error('empty');
      input.setInputValue(out, true, true);
    } catch(err) {
      toast(aiError(err));
    }
  };

  const otherLang = /[а-яё]/i.test(text) ? 'en' : 'ru';
  openChoicePicker(pt('ИИ-помощник', 'AI helper'), [
    {icon: 'check', text: pt('Исправить ошибки', 'Fix mistakes'), run: run({proofread: true}, pt('исправляю', 'fixing'))},
    {icon: 'smile', text: pt('Добавить эмодзи', 'Add emoji'), run: run({emojify: true}, pt('добавляю эмодзи', 'adding emoji'))},
    {icon: 'minus', text: pt('Короче', 'Shorter'), run: run({tone: {_: 'inputAiComposeToneDefault', tone: 'short'}}, pt('сокращаю', 'shortening'))},
    {icon: 'textedit', text: pt('Официальнее', 'More formal'), run: run({tone: {_: 'inputAiComposeToneDefault', tone: 'formal'}}, pt('переписываю', 'rewriting'))},
    {icon: 'language', text: otherLang === 'en' ? pt('Перевести на английский', 'Translate to English') : pt('Перевести на русский', 'Translate to Russian'),
      run: run({translate_to_lang: otherLang}, pt('перевожу', 'translating'))}
  ], (input.chatInput || field) as HTMLElement);
}

function clean(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > LINE_MAX ? line.slice(0, LINE_MAX) + '…' : line;
}

/** «Что пропустил»: the unread messages of the open chat, told in short; nothing is marked read */
export async function openWhatIMissed() {
  const managers = bindManagersToSession(rootScope.managers);
  const {default: appImManager} = await import('@lib/appImManager');
  const chat = appImManager.chat;
  if(!chat?.peerId) {
    toast(pt('Сначала открой чат', 'Open a chat first'));
    return;
  }

  const peerId = chat.peerId;
  const dialog = await managers.appMessagesManager.getDialogOnly(peerId) as any;
  const unreadCount = dialog?.unread_count || 0;

  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;
  const body = document.createElement('div');
  body.className = 'pg-ai-body';
  body.textContent = unreadCount ? pt(`Читаю ${Math.min(unreadCount, MAX_MISSED)} непрочитанных…`, `Reading ${Math.min(unreadCount, MAX_MISSED)} unread…`) : pt('Непрочитанных в этом чате нет.', 'No unread messages in this chat.');
  panel.append(makeTitle(pt('Что пропустил', 'What I missed')), body);
  createOverlay(panel);
  focusSoon(panel);
  if(!unreadCount) return;

  // * the unread ones: after the last read message, oldest first
  const history = await managers.apiManager.invokeApi('messages.getHistory', {
    peer: await managers.appPeersManager.getInputPeerById(peerId),
    offset_id: 0,
    offset_date: 0,
    add_offset: 0,
    limit: Math.min(unreadCount, MAX_MISSED),
    max_id: 0,
    min_id: dialog.read_inbox_max_id || 0,
    hash: '0'
  }) as any;
  const names = new Map<string, string>();
  (history.users || []).forEach((u: any) => names.set('u' + u.id, [u.first_name, u.last_name].filter(Boolean).join(' ')));
  (history.chats || []).forEach((c: any) => names.set('c' + c.id, c.title));
  const messages = ((history.messages || []) as Message.message[]).filter((m) => m._ === 'message' && (m.message || m.media)).reverse();
  if(!messages.length) {
    body.textContent = pt('Непрочитанных сообщений с текстом нет.', 'No unread messages with text.');
    return;
  }

  const lines = messages.map((m) => {
    const from = (m.from_id as any)?.user_id ? names.get('u' + (m.from_id as any).user_id) : (m.from_id as any)?.channel_id ? names.get('c' + (m.from_id as any).channel_id) : '';
    const time = new Date(m.date * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    return `${time} ${from ? from + ': ' : ''}${clean(m.message || pt('[вложение]', '[attachment]'))}`;
  });
  const text = lines.join('\n');

  // * a real retelling first (as in the Android app), else each message made short
  let answer: string;
  let failure: any;
  try {
    const result = await managers.apiManager.invokeApi('messages.composeRichMessageWithAI', {
      text: {_: 'inputRichMessage', blocks: lines.map((line) => ({_: 'pageBlockParagraph', text: {_: 'textPlain', text: line}}))},
      tone: {_: 'inputAiComposeToneSingleUse', custom_prompt: pt(
        'Это сообщения, которые я пропустил. Перескажи главное 5–7 пунктами по-русски, коротко, без вступления. Важное и то, что просят меня, — первым.',
        'These are the messages I missed. Tell the main points in 5–7 short items, no intro. What is asked of me goes first.'
      )}
    } as any) as any;
    answer = (result?.result?.blocks || []).map((b: any) => b?.text?.text || '').filter(Boolean).join('\n');
  } catch(err) {
    failure = err;
  }

  if(!answer) {
    try {
      const result = await managers.apiManager.invokeApi('messages.composeMessageWithAI', {
        text: {_: 'textWithEntities', text, entities: []},
        tone: {_: 'inputAiComposeToneDefault', tone: 'short'}
      }) as any;
      answer = result?.result_text?.text;
    } catch(err) {
      failure = err;
    }
  }

  if(!body.isConnected) return;
  if(!answer) {
    body.textContent = aiError(failure);
    return;
  }
  body.textContent = answer;
  const note = document.createElement('div');
  note.className = 'pg-settings-hint';
  note.textContent = pt(`${messages.length} непрочитанных · ничего не отмечено прочитанным`, `${messages.length} unread · nothing marked read`);
  panel.append(note);
}
