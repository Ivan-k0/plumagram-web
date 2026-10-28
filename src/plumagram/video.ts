/*
 * PlumaGram — video: the chosen quality is remembered for the next videos; extra player keys.
 */

import type {Level} from 'hls.js';
import setCurrentTime from '@helpers/dom/setCurrentTime';
import {snapQualityHeight} from '@lib/hls/snapQualityHeight';
import {plumaSettings, setPlumaSetting} from '@/plumagram/settings';

/** Remembers the quality picked in the player menu (0 — «Авто») */
export function rememberVideoQuality(height?: number) {
  setPlumaSetting('videoQuality', height || 0);
}

/** The level to start a video with: the remembered height, or the nearest one below it */
export function getPreferredLevelIndex(levels: Level[]) {
  const preferred = plumaSettings().videoQuality;
  if(!preferred || !levels?.length) return -1;

  const heights = Array.from(new Set(levels.map((level) => snapQualityHeight(level.height)))).sort((a, b) => b - a);
  const height = heights.find((h) => h <= preferred) ?? heights[heights.length - 1];

  let bestIdx = -1;
  levels.forEach((level, idx) => {
    if(snapQualityHeight(level.height) !== height) return;
    // * the best bitrate of that height
    if(bestIdx === -1 || level.bitrate > levels[bestIdx].bitrate) bestIdx = idx;
  });
  return bestIdx;
}

type PlayerLike = {
  video: HTMLVideoElement,
  canSeek: boolean,
  canPause: boolean,
  togglePlay: () => void,
  changeRate: (amount: number) => void,
  pictureInPicture: () => void
};

/**
 * Extra player keys: J / L — 10 seconds back / forward, K — pause, 0–9 — to 0–90 % of the video,
 * Shift+< / Shift+> — slower / faster, P — picture in picture. Returns true when the key was ours.
 */
export function handlePlumaPlayerKey(e: KeyboardEvent, player: PlayerLike) {
  if(e.ctrlKey || e.metaKey || e.altKey) return false;
  const {video} = player;
  const code = e.code;

  if(e.shiftKey) {
    if(code === 'Comma' || code === 'Period') {
      player.changeRate(code === 'Period' ? 1 : -1);
      return true;
    }
    return false;
  }

  if((code === 'KeyJ' || code === 'KeyL') && player.canSeek) {
    const time = video.currentTime + (code === 'KeyL' ? 10 : -10);
    setCurrentTime(video, Math.max(0, Math.min(video.duration || 0, time)));
    return true;
  }

  if(code === 'KeyK' && player.canPause) {
    player.togglePlay();
    return true;
  }

  if(/^Digit\d$/.test(code) && player.canSeek && video.duration) {
    setCurrentTime(video, video.duration * (+code.slice(5) / 10));
    return true;
  }

  if(code === 'KeyP' && document.pictureInPictureEnabled) {
    player.pictureInPicture();
    return true;
  }

  return false;
}
