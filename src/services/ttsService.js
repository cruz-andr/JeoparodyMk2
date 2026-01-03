const synth = window.speechSynthesis;
let currentUtterance = null;
let selectedVoiceName = null;

// Sample phrase for voice preview
const SAMPLE_PHRASE = "This is Jeopardy! Here's your clue.";

// Get all available English voices
export function getAvailableVoices() {
  const voices = synth.getVoices();
  return voices.filter(v => v.lang.startsWith('en'));
}

// Set the voice to use
export function setVoice(voiceName) {
  selectedVoiceName = voiceName;
}

// Preview a voice with a sample phrase
export function previewVoice(voiceName) {
  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(SAMPLE_PHRASE);
  const voices = synth.getVoices();
  const voice = voices.find(v => v.name === voiceName);

  if (voice) {
    utterance.voice = voice;
  }

  utterance.rate = 1.15;
  utterance.pitch = 1.0;

  synth.speak(utterance);
}

export async function speakText(text) {
  stopSpeaking();

  return new Promise((resolve) => {
    currentUtterance = new SpeechSynthesisUtterance(text);

    // Use selected voice or find a good default
    const voices = synth.getVoices();
    let voice = null;

    if (selectedVoiceName) {
      voice = voices.find(v => v.name === selectedVoiceName);
    }

    if (!voice) {
      // Auto-select best available (prefer Google UK English Male)
      voice = voices.find(v => v.name === 'Google UK English Male') ||
              voices.find(v => v.name.includes('Google UK English')) ||
              voices.find(v => v.name.includes('Daniel')) || // macOS
              voices.find(v => v.lang.startsWith('en'));
    }

    if (voice) currentUtterance.voice = voice;

    currentUtterance.rate = 1.15;
    currentUtterance.pitch = 1.0;

    currentUtterance.onend = () => {
      currentUtterance = null;
      resolve();
    };

    currentUtterance.onerror = (event) => {
      console.error('TTS error:', event.error);
      currentUtterance = null;
      resolve();
    };

    synth.speak(currentUtterance);
  });
}

export function stopSpeaking() {
  synth.cancel();
  currentUtterance = null;
}

export function isPlaying() {
  return synth.speaking;
}
