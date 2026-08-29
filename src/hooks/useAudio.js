import { useCallback, useEffect } from 'react';
import { Howl, Howler } from 'howler';
import { useSettingsStore } from '../stores';

// Only files that actually ship in public/audio. Referencing a missing file
// makes Howler log a load error on every page view.
const AUDIO_FILES = {
  theme: '/audio/theme.mp3',
  dailyDouble: '/audio/daily-double.mp3',
  correct: '/audio/correct.mp3',
  wrong: '/audio/wrong.mp3',
  finalJeopardy: '/audio/final-jeopardy.mp3',
};

// Long tracks that loop under the game rather than firing once.
const MUSIC = new Set(['theme', 'finalJeopardy']);

// The sound bank is a module singleton shared by every caller of useAudio.
// It used to be per-component state guarded by an "already loaded" flag, which
// meant the first component to mount loaded the files and every later one got
// an empty bank — so AnswerFeedback's correct/wrong sounds never played.
const sounds = {};
let loaded = false;

function loadSounds() {
  if (loaded) return;
  loaded = true;

  for (const [name, src] of Object.entries(AUDIO_FILES)) {
    sounds[name] = new Howl({
      src: [src],
      loop: MUSIC.has(name),
      preload: true,
      onloaderror: () => {
        console.warn(`Audio unavailable: ${src}. Continuing without it.`);
      },
    });
  }
}

export function useAudio() {
  // Subscribe to each setting individually so an unrelated settings change
  // does not re-render every component that plays a sound.
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const musicEnabled = useSettingsStore((s) => s.musicEnabled);
  const volume = useSettingsStore((s) => s.volume);

  useEffect(() => {
    loadSounds();
  }, []);

  // Global volume covers every Howl at once. The bank is never unloaded —
  // it outlives the components that use it.
  useEffect(() => {
    Howler.volume(volume);
  }, [volume]);

  const playSound = useCallback((name) => {
    if (!soundEnabled) return;
    sounds[name]?.play();
  }, [soundEnabled]);

  const playMusic = useCallback((name) => {
    if (!musicEnabled) return;
    const track = sounds[name];
    // Restarting a looping track that is already going would layer it on itself.
    if (!track || track.playing()) return;
    track.play();
  }, [musicEnabled]);

  const stopMusic = useCallback((name) => {
    sounds[name]?.stop();
  }, []);

  const fadeOutMusic = useCallback((name, duration = 1000) => {
    const track = sounds[name];
    if (!track?.playing()) return;

    track.fade(track.volume(), 0, duration);
    track.once('fade', () => {
      track.stop();
      track.volume(1); // restore so the next play is not silent
    });
  }, []);

  const stopAll = useCallback(() => {
    Object.values(sounds).forEach((s) => s.stop());
  }, []);

  return {
    playSound,
    playMusic,
    stopMusic,
    fadeOutMusic,
    stopAll,
    playCorrect: useCallback(() => playSound('correct'), [playSound]),
    playWrong: useCallback(() => playSound('wrong'), [playSound]),
    playDailyDouble: useCallback(() => playSound('dailyDouble'), [playSound]),
    playTheme: useCallback(() => playMusic('theme'), [playMusic]),
    stopTheme: useCallback(() => stopMusic('theme'), [stopMusic]),
    fadeOutTheme: useCallback((d) => fadeOutMusic('theme', d), [fadeOutMusic]),
    playFinalJeopardy: useCallback(() => playMusic('finalJeopardy'), [playMusic]),
    stopFinalJeopardy: useCallback(() => stopMusic('finalJeopardy'), [stopMusic]),
  };
}

export default useAudio;
