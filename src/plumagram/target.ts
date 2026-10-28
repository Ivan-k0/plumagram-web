/*
 * PlumaGram — the message our hotkeys act on: the one under the pointer, or the last one the pointer was
 * over (the command palette covers the chat, so from it «under the pointer» meant nothing).
 */

let lastBubble: HTMLElement;

export function initMessageTarget() {
  document.addEventListener('mouseover', (e) => {
    const bubble = (e.target as HTMLElement)?.closest?.<HTMLElement>('.bubbles-inner .bubble[data-mid]');
    if(bubble) lastBubble = bubble;
  }, {passive: true});
}

/** The bubble under the pointer, else the last one hovered while it is still on screen in the open chat */
export function getTargetBubble() {
  const hovered = document.querySelectorAll<HTMLElement>('.bubbles-inner .bubble[data-mid]:hover');
  if(hovered.length) return hovered[hovered.length - 1];
  if(lastBubble?.isConnected && lastBubble.closest('.chat:not(.hide)')) return lastBubble;
}

/** The first words of the target message, for the palette: «Тест веб-версии…» */
export function getTargetSnippet() {
  const bubble = getTargetBubble();
  if(!bubble) return;
  // * without the time and the «edited» mark that sit inside the message element
  const message = bubble.querySelector('.message')?.cloneNode(true) as HTMLElement;
  message?.querySelectorAll('.time, .time-inner, .reactions').forEach((el) => el.remove());
  const text = (message?.textContent || '').replace(/\s+/g, ' ').trim();
  if(!text) return '…';
  return text.length > 20 ? text.slice(0, 20).trim() + '…' : text;
}
