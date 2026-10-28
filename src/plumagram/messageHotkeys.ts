/*
 * PlumaGram — hotkeys for the message under the pointer: reply, forward, to Saved Messages, pin, translate;
 * and translating the whole chat (no Premium: it goes through the same free per-message translation).
 */

import {toast} from '@components/toast';
import {pt} from '@/plumagram/settings';
import type {Message} from '@layer';

export type MessageHotkeyAction = 'reply' | 'forward' | 'saved' | 'pin' | 'translate';

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
