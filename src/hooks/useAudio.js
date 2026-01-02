import { useEffect, useRef, useCallback } from 'react';
import { Howl, Howler } from 'howler';
import { useAudioStore, useSettingsStore } from '../stores';

// Audio file paths - these will need to be added to the project
const AUDIO_FILES = {
  theme: '/audio/theme.mp3',
  dailyDouble: '/audio/daily-double.mp3',
  correct: '/audio/correct.mp3',
  wrong: '/audio/wrong.mp3',
  timerTick: '/audio/timer-tick.mp3',
  finalJeopardy: '/audio/final-jeopardy.mp3',
  buzzer: '/audio/buzzer.mp3',
};

export function useAudio() {
  const soundsRef = useRef({});
  const { registerSound, isLoaded } = useAudioStore();
  const { soundEnabled, musicEnabled, volume } = useSettingsStore();

  // Initialize audio on mount
  useEffect(() => {
    // Set global volume
    Howler.volume(volume);

    // Only load if not already loaded
    if (isLoaded) return;

    // Create Howl instances for each sound
    Object.entries(AUDIO_FILES).forEach(([name, path]) => {
      try {
        const isMusic = name === 'theme' || name === 'finalJeopardy';

        const howl = new Howl({
          src: [path],
          loop: isMusic,
          volume: volume,
          preload: true,
          onloaderror: (id, error) => {
            console.warn(`Audio file not found: ${path}. Game will continue without this sound.`);
          },
        });

        soundsRef.current[name] = howl;
        registerSound(name, howl);
      } catch (err) {
        console.warn(`Could not load audio: ${name}`);
      }
    });

    useAudioStore.getState().initAudio(Howl);

    // Cleanup on unmount
    return () => {
      Object.values(soundsRef.current).forEach((sound) => {
        if (sound && sound.unload) {
          sound.unload();
        }
      });
    };
  }, []);

  // Update volume when settings change
  useEffect(() => {
    Howler.volume(volume);
  }, [volume]);

  // Play sound effect
  const playSound = useCallback((soundName) => {
    if (!soundEnabled) return;

    const sound = soundsRef.current[soundName];
    if (sound) {
      sound.play();
    }
  }, [soundEnabled]);

  // Play music
  const playMusic = useCallback((trackName) => {
    if (!musicEnabled) return;

    const music = soundsRef.current[trackName];
    if (music) {
      music.play();
    }
  }, [musicEnabled]);

  // Stop music
  const stopMusic = useCallback((trackName) => {
    const music = soundsRef.current[trackName];
    if (music) {
      music.stop();
    }
  }, []);

  // Fade out music
  const fadeOutMusic = useCallback((trackName, duration = 1000) => {
    const music = soundsRef.current[trackName];
    if (music) {
      music.fade(music.volume(), 0, duration);
      setTimeout(() => {
        music.stop();
      }, duration);
    }
  }, []);

  return {
    playSound,
    playMusic,
    stopMusic,
    fadeOutMusic,
    playCorrect: () => playSound('correct'),
    playWrong: () => playSound('wrong'),
    playDailyDouble: () => playSound('dailyDouble'),
    playTimerTick: () => playSound('timerTick'),
    playBuzzer: () => playSound('buzzer'),
    playTheme: () => playMusic('theme'),
    stopTheme: () => stopMusic('theme'),
    fadeOutTheme: (duration) => fadeOutMusic('theme', duration),
  };
}

export default useAudio;
