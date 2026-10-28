/*
 * PlumaGram — voice messages to text in the browser: Whisper runs here, on this computer.
 * The sound never leaves it; only the model is downloaded once (from huggingface.co) and kept in the cache.
 */

import {env, pipeline} from '@huggingface/transformers';

env.allowLocalModels = false;


type Request = {id: number, audio: Float32Array, language?: string, model: string};

let recognizer: Promise<any>, recognizerModel: string;

function getRecognizer(model: string) {
  if(recognizerModel !== model) recognizer = undefined;
  recognizerModel = model;
  return recognizer ??= (async() => {
    const webgpu = !!(self.navigator as any).gpu && !!(await (self.navigator as any).gpu.requestAdapter().catch((): void => undefined));
    return pipeline('automatic-speech-recognition', model, {
      device: webgpu ? 'webgpu' : 'wasm',
      dtype: webgpu ? {encoder_model: 'fp32', decoder_model_merged: 'q4'} : 'q8',
      progress_callback: (progress: any) => {
        if(progress.status === 'progress' && progress.total) {
          self.postMessage({type: 'progress', loaded: progress.loaded, total: progress.total, file: progress.file});
        }
      }
    } as any);
  })();
}

self.onmessage = async(event: MessageEvent<Request>) => {
  const {id, audio, language, model} = event.data;
  try {
    const recognize = await getRecognizer(model);
    // * the language is given: without it the model wrote English, translating a Russian voice
    const result = await recognize(audio, {task: 'transcribe', language, chunk_length_s: 30, stride_length_s: 5, return_timestamps: false});
    const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text || '').trim();
    self.postMessage({type: 'done', id, text});
  } catch(err) {
    recognizer = undefined;
    self.postMessage({type: 'error', id, error: String((err as Error)?.message || err)});
  }
};
