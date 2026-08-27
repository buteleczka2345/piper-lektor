import { VoiceSettings } from '../types';
import { filterProfanityText } from './profanityFilter';

export interface AvailableVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  desc: string;
}

export const PIPER_VOICES: AvailableVoice[] = [
  { id: 'gosia', name: 'Gosia', gender: 'female', desc: 'Żeński naturalny, wyrazisty' },
  { id: 'jarvis', name: 'Jarvis', gender: 'male', desc: 'Męski głęboki lektor' },
  { id: 'bass', name: 'Bass', gender: 'male', desc: 'Ciemny niski bas filmowy' },
  { id: 'justyna', name: 'Justyna', gender: 'female', desc: 'Ciepły żeński głos narracyjny' },
  { id: 'meski', name: 'Męski WG', gender: 'male', desc: 'Klasyczny męski lektor telewizyjny' },
  { id: 'zenski', name: 'Żeński WG', gender: 'female', desc: 'Głos kobiecy telewizyjny' },
  { id: 'janusz', name: 'Janusz (Kinowy)', gender: 'male', desc: 'Klasyczny polski lektor filmowy VHS' },
  { id: 'browser_default', name: 'Domyślny systemowy', gender: 'female', desc: 'Wbudowany syntezator przeglądarki' }
];

const LOCAL_PIPER_TTS = 'http://127.0.0.1:8765/tts';
const LOCAL_PIPER_HEALTH = 'http://127.0.0.1:8765/health';

// Check if SpeechSynthesis is supported
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// Check if SpeechRecognition is supported
export function isSpeechRecognitionSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );
}

export async function checkPiperHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(LOCAL_PIPER_HEALTH, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return data.ok !== false;
    }
    return false;
  } catch {
    return false;
  }
}

export async function requestPiperTTS(text: string, voice: string, rate = 1.0): Promise<Blob | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(LOCAL_PIPER_TTS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'audio/wav',
      },
      body: JSON.stringify({
        text,
        voice: voice || 'gosia',
        speed: rate || 1.0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      return await res.blob();
    }
    return null;
  } catch {
    return null;
  }
}

let currentAudioElement: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;

export function stopSpeaking() {
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
    } catch {}
    currentAudioElement = null;
  }
  if (currentAudioUrl) {
    try {
      URL.revokeObjectURL(currentAudioUrl);
    } catch {}
    currentAudioUrl = null;
  }
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
    activeUtterance = null;
  }
}

export async function speakPolishText(
  text: string,
  settings: VoiceSettings,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: (err: any) => void
) {
  if (!text.trim()) {
    onEnd?.();
    return;
  }

  stopSpeaking();

  let finalText = text;
  if (settings.filterProfanity) {
    const res = filterProfanityText(text, settings.censorReplacement);
    finalText = res.cleanedText;
  }

  if (!finalText.trim()) {
    onEnd?.();
    return;
  }

  // 1. Try local Piper if enabled or attempted
  if (settings.useLocalPiperServer) {
    try {
      const blob = await requestPiperTTS(finalText, settings.selectedVoice, settings.speechRate);
      if (blob && blob.size > 100) {
        currentAudioUrl = URL.createObjectURL(blob);
        const audio = new Audio(currentAudioUrl);
        currentAudioElement = audio;
        audio.volume = settings.volume ?? 1.0;
        audio.playbackRate = settings.speechRate ?? 1.0;
        audio.onplay = () => onStart?.();
        audio.onended = () => {
          stopSpeaking();
          onEnd?.();
        };
        audio.onerror = () => {
          stopSpeaking();
          speakWithBrowser(finalText, settings, onStart, onEnd, onError);
        };
        await audio.play();
        return;
      }
    } catch {
      // Fallback to browser synthesis
    }
  }

  // 2. Fallback to Browser Web Speech API
  speakWithBrowser(finalText, settings, onStart, onEnd, onError);
}

function speakWithBrowser(
  text: string,
  settings: VoiceSettings,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: (err: any) => void
) {
  if (!isSpeechSynthesisSupported()) {
    onEnd?.();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = settings.speechRate || 1.0;
  utterance.pitch = settings.pitch || 1.0;
  utterance.volume = settings.volume || 1.0;
  utterance.lang = 'pl-PL';

  const voices = window.speechSynthesis.getVoices();
  const plVoices = voices.filter(v => v.lang.startsWith('pl') || v.lang.includes('PL'));

  if (settings.selectedVoice === 'gosia' || settings.selectedVoice === 'justyna' || settings.selectedVoice === 'zenski') {
    const femaleVoice = plVoices.find(v => 
      v.name.toLowerCase().includes('female') || 
      v.name.toLowerCase().includes('paulina') || 
      v.name.toLowerCase().includes('zofia') || 
      v.name.toLowerCase().includes('agnieszka') || 
      v.name.toLowerCase().includes('ewa') || 
      v.name.toLowerCase().includes('maja')
    );
    if (femaleVoice) {
      utterance.voice = femaleVoice;
    } else if (plVoices[0]) {
      utterance.voice = plVoices[0];
      utterance.pitch = 1.15;
    }
  } else if (settings.selectedVoice === 'jarvis' || settings.selectedVoice === 'bass' || settings.selectedVoice === 'meski') {
    const maleVoice = plVoices.find(v => 
      v.name.toLowerCase().includes('male') || 
      v.name.toLowerCase().includes('jan') || 
      v.name.toLowerCase().includes('krzysztof') || 
      v.name.toLowerCase().includes('adam') || 
      v.name.toLowerCase().includes('marek')
    );
    if (maleVoice) {
      utterance.voice = maleVoice;
      if (settings.selectedVoice === 'bass') utterance.pitch = 0.7;
    } else if (plVoices[0]) {
      utterance.voice = plVoices[0];
      utterance.pitch = settings.selectedVoice === 'bass' ? 0.7 : 0.85;
    }
  } else if (settings.selectedVoice === 'janusz') {
    if (plVoices[0]) {
      utterance.voice = plVoices[0];
      utterance.pitch = 0.78;
      utterance.rate = Math.max(0.8, settings.speechRate * 0.92);
    }
  } else if (plVoices[0]) {
    utterance.voice = plVoices[0];
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => {
    activeUtterance = null;
    onEnd?.();
  };
  utterance.onerror = (e) => {
    activeUtterance = null;
    onError?.(e);
  };

  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

// Live Speech Recognition Helper for Realtime English Input
export class RealtimeSpeechListener {
  private recognition: any = null;
  private isListening = false;
  private onResultCallback: (text: string, isFinal: boolean) => void;
  private onErrorCallback: (err: string) => void;
  private onStatusChangeCallback: (listening: boolean) => void;
  public lang: string = 'en-US';

  constructor(
    onResult: (text: string, isFinal: boolean) => void,
    onError: (err: string) => void,
    onStatusChange: (listening: boolean) => void,
    lang = 'en-US'
  ) {
    this.onResultCallback = onResult;
    this.onErrorCallback = onError;
    this.onStatusChangeCallback = onStatusChange;
    this.lang = lang;
    this.initRecognition();
  }

  private initRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition not available in this browser");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.lang;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStatusChangeCallback(true);
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        this.onResultCallback(finalTranscript.trim(), true);
      } else if (interimTranscript.trim()) {
        this.onResultCallback(interimTranscript.trim(), false);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.warn("Speech recognition event error:", event.error);
      if (event.error !== 'no-speech') {
        this.onErrorCallback(`Błąd mikrofonu: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        // Auto-restart continuous listening
        try {
          this.recognition.start();
        } catch (e) {
          this.isListening = false;
          this.onStatusChangeCallback(false);
        }
      } else {
        this.onStatusChangeCallback(false);
      }
    };
  }

  public start() {
    if (!this.recognition) {
      this.initRecognition();
    }
    if (this.recognition) {
      this.isListening = true;
      try {
        this.recognition.start();
      } catch (e) {
        console.warn("Recognition already started or error:", e);
      }
    } else {
      this.onErrorCallback("Twoja przeglądarka nie obsługuje rozpoznawania mowy Web Speech API.");
    }
  }

  public stop() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.onStatusChangeCallback(false);
  }

  public setLanguage(lang: string) {
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }
}
