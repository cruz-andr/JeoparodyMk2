import { useCallback, useEffect } from 'react';
import { Howl, Howler } from 'howler';
import { useSettingsStore } from '../stores';

/* Only files that actually ship in public/audio. Referencing a missing file
   makes Howler log a load error on every page view. The show's music (its
   theme, "Think!" under Final Jeopardy, the Daily Double sting) is not ours to
   play and is gone. What is left is four short effects, all public domain
   (CC0): correct, wrong and time's up from Kenney's Interface Sounds, and the
   buzz-in from Qvantor on Freesound (#878254). Levelled so none jumps out. */
const AUDIO_FILES = {
  correct: '/audio/correct.mp3',
  wrong: '/audio/wrong.mp3',
  buzz: '/audio/buzz.mp3',
  timeUp: '/audio/timeup.mp3',
};

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

  const stopAll = useCallback(() => {
    Object.values(sounds).forEach((s) => s.stop());
  }, []);

  return {
    playSound,
    stopAll,
    playCorrect: useCallback(() => playSound('correct'), [playSound]),
    playWrong: useCallback(() => playSound('wrong'), [playSound]),
    playBuzz: useCallback(() => playSound('buzz'), [playSound]),
    playTimeUp: useCallback(() => playSound('timeUp'), [playSound]),
  };
}

export default useAudio;
