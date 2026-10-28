/*
 * PlumaGram — hotkeys for the message under the pointer: reply, forward, to Saved Messages, pin, translate;
 * and translating the whole chat (no Premium: it goes through the same free per-message translation).
 */

import {toast} from '@components/toast';
import {pt} from '@/plumagram/settings';
import {openChoicePicker} from '@/plumagram/overlay';
import type {Message} from '@layer';

export type MessageHotkeyAction = 'reply' | 'forward' | 'saved' | 'pin' | 'translate' | 'remind';

async function getChat() {
  const {default: appImManager} = await import('@lib/appImManager');
  return {appImManager, chat: appImManager.chat};
}

/** The message bubble under the pointer in the open chat */
function getHoveredBubble() {
  const hovered = document.querySelectorAll<HTMLElement>('.bubbles-inner .bubble[data-mid]:hover');
  return hovered[hovered.length - 1];
}

export async function runMessageHotkey(action: MessageHotkeyAction) {
  const bubble = getHoveredBubble();
  if(!bubble) {
    toast(pt('Наведи мышь на сообщение', 'Point at a message first'));
    return;
  }

  const {appImManager, chat} = await getChat();
  const peerId = bubble.dataset.peerId?.toPeerId() ?? chat.peerId;
  const mid = +bubble.dataset.mid;
  const message = ((bubble as any).message || chat.getMessageByPeer(peerId, mid)) as Message.message;
  if(!message || !mid) return;

  switch(action) {
    case 'reply': {
      const replyTo = chat.input.getChatInputReplyToFromMessage(message);
      if(!await chat.canSend()) {
        replyTo.replyToPeerId = peerId;
        chat.input.createReplyPicker(replyTo);
        return;
      }
      chat.input.initMessageReply(replyTo);
      break;
    }

    case 'forward': {
      const {hotReloadGuard} = await import('@lib/solidjs/hotReloadGuardProvider');
      hotReloadGuard.showForwardPopup({[peerId]: await chat.getMidsByMid(peerId, mid)});
      break;
    }

    case 'saved': {
      const mids = await chat.getMidsByMid(peerId, mid);
      await chat.managers.appMessagesManager.forwardMessages({
        peerId: appImManager.myId,
        fromPeerId: peerId,
        mids
      });
      toast(pt('Сохранено в Избранное', 'Saved to Saved Messages'));
      break;
    }

    case 'remind': {
      // * «Напомнить позже»: the message goes to Saved Messages as a scheduled forward, so Telegram
      // * itself reminds about it at that time on every device
      const mids = await chat.getMidsByMid(peerId, mid);
      const remindAt = (date: Date) => async() => {
        await chat.managers.appMessagesManager.forwardMessages({
          peerId: appImManager.myId,
          fromPeerId: peerId,
          mids,
          scheduleDate: Math.floor(date.getTime() / 1000)
        });
        toast(pt(
          `Напомню ${formatWhen(date)} — сообщение придёт в Избранное`,
          `I will remind you ${formatWhen(date)} — the message will come to Saved Messages`
        ));
      };

      const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60e3);
      const today = (hour: number) => {
        const date = new Date();
        date.setHours(hour, 0, 0, 0);
        return date;
      };
      const tomorrow = (hour: number) => {
        const date = today(hour);
        date.setDate(date.getDate() + 1);
        return date;
      };

      const options = [
        {text: pt('Через 30 минут', 'In 30 minutes'), run: remindAt(inMinutes(30))},
        {text: pt('Через 1 час', 'In 1 hour'), run: remindAt(inMinutes(60))},
        {text: pt('Через 3 часа', 'In 3 hours'), run: remindAt(inMinutes(180))}
      ];
      if(today(19).getTime() - Date.now() > 30 * 60e3) {
        options.push({text: pt('Сегодня в 19:00', 'Today at 19:00'), run: remindAt(today(19))});
      }
      options.push({text: pt('Завтра в 9:00', 'Tomorrow at 9:00'), run: remindAt(tomorrow(9))});

      openChoicePicker(pt('Напомнить позже', 'Remind me later'), options);
      break;
    }

    case 'pin': {
      const {default: showPinMessagePopup} = await import('@components/popups/unpinMessage');
      message.pFlags?.pinned ? showPinMessagePopup(peerId, mid, true) : showPinMessagePopup(peerId, mid);
      break;
    }

    case 'translate': {
      const [{default: detectLanguageForTranslation}, {getMessageSourceText}, {openTranslatePopup}, {default: SolidJSHotReloadGuardProvider}] = await Promise.all([
        import('@helpers/detectLanguageForTranslation'),
        import('@stores/peerLanguage'),
        import('@components/popups/translate'),
        import('@lib/solidjs/hotReloadGuardProvider')
      ]);
      const text = getMessageSourceText(message);
      if(!text) {
        toast(pt('Здесь нечего переводить', 'Nothing to translate here'));
        return;
      }
      const detectedLanguage = await detectLanguageForTranslation(text);
      openTranslatePopup({peerId: message.peerId, message, detectedLanguage}, SolidJSHotReloadGuardProvider);
      break;
    }
  }
}

/** Turns translation of the open chat on or off */
export async function toggleChatTranslation() {
  const {chat} = await getChat();
  const peerId = chat?.peerId;
  if(!peerId) {
    toast(pt('Сначала открой чат', 'Open a chat first'));
    return;
  }

  const {appSettings, setAppSettings} = await import('@stores/appSettings');
  if(!appSettings.translations.enabled) {
    setAppSettings('translations', 'enabled', true);
  }

  const on = !appSettings.translations.enabledPeers[peerId];
  setAppSettings('translations', 'enabledPeers', peerId, on ? true : undefined);
  toast(on ?
    pt('Чат переводится — язык можно сменить в полоске сверху', 'Translating the chat — change the language in the bar on top') :
    pt('Перевод чата выключен', 'Chat translation is off'));
}

function formatWhen(date: Date) {
  const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? pt(`в ${time}`, `at ${time}`) : pt(`завтра в ${time}`, `tomorrow at ${time}`);
}
