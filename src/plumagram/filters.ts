/*
 * PlumaGram — message filters, as in the Android app: an incoming message whose text matches a rule
 * is shown as a strip «Скрыто фильтром …» (a click shows it), or left out entirely («скрывать полностью»).
 * Only the display in this browser changes: nothing is deleted. Own messages are never hidden.
 */

import {pt} from '@/plumagram/settings';
import {createOverlay, openChoicePicker, focusSoon} from '@/plumagram/overlay';

export const SCOPE_ALL = 0, SCOPE_CHANNELS = 1, SCOPE_CHANNELS_GROUPS = 2, SCOPE_CHAT = 3;

export type FilterRule = {
  text: string,
  regex?: boolean,
  matchCase?: boolean,
  wholeWord?: boolean,
  hideFully?: boolean,
  scope: number,
  chatId?: PeerId,
  chatTitle?: string
};

const STORAGE_KEY = 'plumagram:filters';

let rules: FilterRule[] = load();

function load(): FilterRule[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch(err) {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch(err) {}
  refilterAll();
}

export function getFilterRules() {
  return rules;
}

export function addFilterRule(rule: FilterRule) {
  rules = [...rules, rule];
  save();
}

export function removeFilterRule(index: number) {
  rules = rules.filter((_, idx) => idx !== index);
  save();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(rule: FilterRule) {
  try {
    let source = rule.regex ? rule.text : escapeRegExp(rule.text);
    if(rule.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    return new RegExp(source, 'u' + (rule.matchCase ? '' : 'i'));
  } catch(err) {
    return undefined;
  }
}

type ChatKind = {peerId: PeerId, isBroadcast: boolean, isAnyGroup: boolean};

function ruleApplies(rule: FilterRule, chat: ChatKind) {
  switch(rule.scope) {
    case SCOPE_CHANNELS: return chat.isBroadcast;
    case SCOPE_CHANNELS_GROUPS: return chat.isBroadcast || chat.isAnyGroup;
    case SCOPE_CHAT: return rule.chatId === chat.peerId;
    default: return true;
  }
}

/** The rule that hides this text in this chat, if any */
export function matchFilter(text: string, chat: ChatKind) {
  if(!text) return;
  for(const rule of rules) {
    if(!rule.text || !ruleApplies(rule, chat)) continue;
    if(compile(rule)?.test(text)) return rule;
  }
}

// * the chat the bubbles on screen belong to (set by the hook below from appImManager)
let currentChat: ChatKind;
const revealed = new Set<string>();

function bubbleText(bubble: HTMLElement) {
  const message = bubble.querySelector('.message');
  return message?.textContent || '';
}

function applyToBubble(bubble: HTMLElement) {
  if(!currentChat || bubble.classList.contains('is-out') || bubble.classList.contains('service')) return;
  const key = currentChat.peerId + '_' + bubble.dataset.mid;
  const rule = revealed.has(key) ? undefined : matchFilter(bubbleText(bubble), currentChat);

  bubble.classList.toggle('pg-filtered', !!rule && !rule.hideFully);
  bubble.classList.toggle('pg-filtered-fully', !!rule?.hideFully);

  let strip = bubble.querySelector<HTMLElement>(':scope > .pg-filter-strip');
  if(rule && !rule.hideFully) {
    if(!strip) {
      strip = document.createElement('div');
      strip.className = 'pg-filter-strip';
      strip.addEventListener('click', (e) => {
        e.stopPropagation();
        revealed.add(key);
        applyToBubble(bubble);
      });
      bubble.prepend(strip);
    }
    strip.textContent = pt(`Скрыто фильтром «${rule.text}» — нажми, чтобы показать`, `Hidden by filter «${rule.text}» — click to show`);
  } else {
    strip?.remove();
  }
}

export function refilterAll() {
  document.querySelectorAll<HTMLElement>('.bubbles-inner .bubble[data-mid]').forEach(applyToBubble);
}

export function initFilters() {
  const observer = new MutationObserver((mutations) => {
    if(!rules.length) return;
    for(const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if(!(node instanceof HTMLElement)) return;
        if(node.matches('.bubble[data-mid]')) applyToBubble(node);
        else node.querySelectorAll?.<HTMLElement>('.bubble[data-mid]').forEach(applyToBubble);
      });
    }
  });
  observer.observe(document.body, {childList: true, subtree: true});

  // * which chat is open: checked on every chat change
  import('@lib/appImManager').then(({default: appImManager}) => {
    const update = () => {
      const chat = appImManager.chat;
      currentChat = chat?.peerId ? {peerId: chat.peerId, isBroadcast: !!chat.isBroadcast, isAnyGroup: !!chat.isAnyGroup} : undefined;
      refilterAll();
    };
    appImManager.addEventListener('peer_changed', () => setTimeout(update, 0));
    update();
  });
}

function scopeText(rule: FilterRule) {
  switch(rule.scope) {
    case SCOPE_CHANNELS: return pt('в каналах', 'in channels');
    case SCOPE_CHANNELS_GROUPS: return pt('в каналах и группах', 'in channels and groups');
    case SCOPE_CHAT: return pt(`в чате «${rule.chatTitle || ''}»`, `in «${rule.chatTitle || ''}»`);
    default: return pt('везде', 'everywhere');
  }
}

/** «Скрыть похожие…»: a rule from the first line of the message under the pointer */
export async function hideSimilarToHovered() {
  const hovered = document.querySelectorAll<HTMLElement>('.bubbles-inner .bubble[data-mid]:hover');
  const bubble = hovered[hovered.length - 1];
  const {toast} = await import('@components/toast');
  if(!bubble) {
    toast(pt('Наведи мышь на сообщение', 'Point at a message first'));
    return;
  }

  // * the first line, cut on a word boundary when it is long: a rule is a part of the text, so it still matches
  let firstLine = bubbleText(bubble).split('\n')[0].trim();
  if(firstLine.length > 60) {
    const cut = firstLine.slice(0, 60);
    firstLine = cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : 60).trim();
  }
  if(!firstLine) {
    toast(pt('В этом сообщении нет текста', 'This message has no text'));
    return;
  }

  const chat = currentChat;
  const {default: getPeerTitle} = await import('@components/wrappers/getPeerTitle');
  const chatTitle = chat ? await getPeerTitle({peerId: chat.peerId, plainText: true}) : '';

  const add = (scope: number, hideFully = false) => () => {
    addFilterRule({text: firstLine, scope, hideFully, chatId: scope === SCOPE_CHAT ? chat?.peerId : undefined, chatTitle: scope === SCOPE_CHAT ? chatTitle : undefined});
    toast(pt(`Фильтр «${firstLine}» добавлен`, `Filter «${firstLine}» added`));
  };

  openChoicePicker(pt(`Скрывать похожие на «${firstLine}»`, `Hide messages like «${firstLine}»`), [
    {text: pt('Везде', 'Everywhere'), run: add(SCOPE_ALL)},
    {text: pt('В каналах', 'In channels'), run: add(SCOPE_CHANNELS)},
    {text: pt('В каналах и группах', 'In channels and groups'), run: add(SCOPE_CHANNELS_GROUPS)},
    {text: pt(`Только в «${chatTitle}»`, `Only in «${chatTitle}»`), run: add(SCOPE_CHAT)},
    {text: pt('Везде, скрывать полностью', 'Everywhere, hide entirely'), run: add(SCOPE_ALL, true)}
  ], bubble.querySelector<HTMLElement>('.bubble-content') || bubble);
}

/** The list of rules: remove one, or add a new one by text */
export function openFiltersManager() {
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.setAttribute('role', 'dialog');

  const title = document.createElement('div');
  title.className = 'pg-settings-title';
  title.textContent = pt('Фильтры сообщений', 'Message filters');

  const input = document.createElement('input');
  input.className = 'pg-palette-input';
  input.placeholder = pt('Новое правило: слово или фраза, Enter — добавить везде', 'New rule: a word or phrase, Enter adds it everywhere');

  const list = document.createElement('div');
  list.className = 'pg-list';

  const render = () => {
    list.replaceChildren(...rules.map((rule, idx) => {
      const item = document.createElement('div');
      item.className = 'pg-item';
      const label = document.createElement('span');
      label.className = 'pg-item-title';
      label.textContent = `«${rule.text}» — ${scopeText(rule)}${rule.hideFully ? pt(', полностью', ', entirely') : ''}`;
      const remove = document.createElement('button');
      remove.className = 'pg-item-remove';
      remove.textContent = pt('Убрать', 'Remove');
      remove.addEventListener('click', () => {
        removeFilterRule(idx);
        render();
      });
      item.append(label, remove);
      return item;
    }));

    if(!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'pg-empty';
      empty.textContent = pt('Правил пока нет. Наведи мышь на сообщение и нажми ⌥/Alt+X — «скрыть похожие».', 'No rules yet. Point at a message and press ⌥/Alt+X to hide similar ones.');
      list.append(empty);
    }
  };

  input.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter') return;
    e.preventDefault();
    const text = input.value.trim();
    if(!text) return;
    addFilterRule({text, scope: SCOPE_ALL});
    input.value = '';
    render();
  });

  render();
  panel.append(title, input, list);
  createOverlay(panel);
  focusSoon(input);
}
