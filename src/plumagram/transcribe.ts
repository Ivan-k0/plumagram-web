/*
 * PlumaGram — the transcribe button of a voice message without Premium: the text is made in this browser
 * (whisper.worker.ts). The first time it asks, since the model (≈ 80 МБ) has to be downloaded once.
 */

import {toast} from '@components/toast';
import {plumaSettings, pt, setPlumaSetting} from '@/plumagram/settings';
import {openChoicePicker} from '@/plumagram/overlay';
import {getTargetBubble} from '@/plumagram/target';
import type {Message} from '@layer';

let worker: Worker;
let nextId = 1;
const waiting = new Map<number, {resolve: (text: string) => void, reject: (error: Error) => void}>();
let lastProgressToast = 0;

function getWorker() {
  if(worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {type: 'module'});
  worker.onmessage = (event) => {
    const data = event.data;
    if(data.type === 'progress') {
      // * the model is downloaded once: how far, now and then
      if(Date.now() - lastProgressToast > 1500) {
        lastProgressToast = Date.now();
        const percent = Math.round(data.loaded / data.total * 100);
        toast(pt(`Скачиваю модель расшифровки… ${percent}%`, `Downloading the transcription model… ${percent}%`));
      }
      return;
    }
    const entry = waiting.get(data.id);
    if(!entry) return;
    waiting.delete(data.id);
    data.type === 'done' ? entry.resolve(data.text) : entry.reject(new Error(data.error));
  };
  return worker;
}

/** The sound of a voice message as 16 kHz mono, what Whisper takes */
async function decodeVoice(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(buffer);
    const length = Math.ceil(decoded.duration * 16000);
    const offline = new OfflineAudioContext(1, length, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    context.close();
  }
}

/** The language voices are in: the one of this computer (Russian for a Russian system) */
function speechLanguage() {
  return (navigator.languages?.[0] || navigator.language || 'ru').slice(0, 2).toLowerCase();
}

/** Asked once: the model is downloaded only with a yes */
export function askLocalTranscription(): Promise<boolean> {
  if(plumaSettings().localTranscribe) return Promise.resolve(true);
  return new Promise((resolve) => {
    openChoicePicker(pt(
      'Расшифровать в браузере? Один раз скачается модель ≈ 80 МБ, сам голос никуда не уходит.',
      'Transcribe in the browser? A model of ≈ 80 MB is downloaded once; the voice never leaves this computer.'
    ), [{
      text: pt('Да, скачать и расшифровать', 'Yes, download and transcribe'),
      run: () => {
        setPlumaSetting('localTranscribe', true);
        resolve(true);
      }
    }, {
      text: pt('Не сейчас', 'Not now'),
      run: () => resolve(false)
    }], getTargetBubble()?.querySelector<HTMLElement>('.bubble-content'));
  });
}

/** The text of a voice message (or round video), made on this computer */
export async function transcribeLocally(message: Message.message): Promise<string> {
  const document = (message.media as any)?.document;
  if(!document) throw new Error('no document');
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  const blob = await appDownloadManager.downloadMedia({media: document}) as Blob;
  const audio = await decodeVoice(blob);

  const id = nextId++;
  const result = new Promise<string>((resolve, reject) => waiting.set(id, {resolve, reject}));
  // * «Точная расшифровка»: the bigger model (≈ 250 МБ), slower and much better at Russian
  const model = plumaSettings().transcribeAccurate ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';
  getWorker().postMessage({id, audio, language: speechLanguage(), model}, [audio.buffer]);
  return result;
}
