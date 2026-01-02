import { create } from 'zustand';

const initialState = {
  // Audio State
  isMusicPlaying: false,
  isMuted: false,
  currentTrack: null,
  volume: 0.7,

  // Audio instances (will be set up when Howler is loaded)
  sounds: {},
  isLoaded: false,
};

export const useAudioStore = create((set, get) => ({
  ...initialState,

  // Initialize audio (call this after Howler is imported)
  initAudio: (Howl) => {
    // We'll set up sounds when the audio files are added
    // For now, just mark as loaded
    set({ isLoaded: true });
  },

  // Register a sound
  registerSound: (name, howlInstance) => {
    set(state => ({
      sounds: { ...state.sounds, [name]: howlInstance }
    }));
  },

  // Play theme music
  playTheme: () => {
    const { sounds, isMuted, volume } = get();
    if (sounds.theme && !isMuted) {
      sounds.theme.volume(volume);
      sounds.theme.play();
      set({ isMusicPlaying: true, currentTrack: 'theme' });
    }
  },

  // Stop theme music
  stopTheme: () => {
    const { sounds } = get();
    if (sounds.theme) {
      sounds.theme.stop();
      set({ isMusicPlaying: false, currentTrack: null });
    }
  },

  // Fade out theme
  fadeOutTheme: (duration = 1000) => {
    const { sounds } = get();
    if (sounds.theme) {
      sounds.theme.fade(sounds.theme.volume(), 0, duration);
      setTimeout(() => {
        sounds.theme.stop();
        set({ isMusicPlaying: false, currentTrack: null });
      }, duration);
    }
  },

  // Play a sound effect
  playSound: (soundName) => {
    const { sounds, isMuted, volume } = get();
    if (sounds[soundName] && !isMuted) {
      sounds[soundName].volume(volume);
      sounds[soundName].play();
    }
  },

  // Play Daily Double sound
  playDailyDouble: () => {
    get().playSound('dailyDouble');
  },

  // Play correct answer sound
  playCorrect: () => {
    get().playSound('correct');
  },

  // Play wrong answer sound
  playWrong: () => {
    get().playSound('wrong');
  },

  // Play timer tick
  playTimerTick: () => {
    get().playSound('timerTick');
  },

  // Toggle mute
  toggleMute: () => {
    const { isMuted, sounds, isMusicPlaying, currentTrack, volume } = get();
    const newMuted = !isMuted;

    // Mute/unmute all sounds
    Object.values(sounds).forEach(sound => {
      sound.mute(newMuted);
    });

    set({ isMuted: newMuted });
  },

  // Set volume
  setVolume: (newVolume) => {
    const volume = Math.max(0, Math.min(1, newVolume));
    const { sounds, isMusicPlaying, currentTrack } = get();

    // Update volume for all sounds
    Object.values(sounds).forEach(sound => {
      sound.volume(volume);
    });

    set({ volume });
  },

  // Stop all sounds
  stopAll: () => {
    const { sounds } = get();
    Object.values(sounds).forEach(sound => {
      sound.stop();
    });
    set({ isMusicPlaying: false, currentTrack: null });
  },

  // Cleanup
  cleanup: () => {
    const { sounds } = get();
    Object.values(sounds).forEach(sound => {
      sound.unload();
    });
    set(initialState);
  },
}));

export default useAudioStore;
