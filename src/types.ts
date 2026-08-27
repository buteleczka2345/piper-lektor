export type ActiveTab = 
  | 'subtitles_player' 
  | 'voice_mic' 
  | 'text_translate' 
  | 'censor_filter' 
  | 'cache_manager' 
  | 'userscript' 
  | 'chrome_extension';

export interface TranslationHistoryItem {
  id: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  audioSpoken?: boolean;
}

export interface SubtitleSegment {
  id: number;
  start: number; // in seconds
  duration: number; // in seconds
  end: number;
  originalText: string;
  text: string; // translated or cleaned text
  translatedText?: string;
  audioBlobUrl?: string;
  failed?: boolean;
  skipped?: boolean;
}

export interface VoiceSettings {
  selectedVoice: string; // 'gosia' | 'jarvis' | 'bass' | 'justyna' | 'meski' | 'zenski' | 'janusz' | 'browser_default'
  speechRate: number; // 0.5 to 2.0 (default 1.0)
  pitch: number; // 0.5 to 1.5
  volume: number; // 0.0 to 1.0
  autoSpeak: boolean; // Auto play translated speech
  duckVolume: number; // 0.0 to 1.0 (video/audio ducking while lector speaks)
  filterProfanity: boolean; // Enable profanity censor
  censorReplacement: 'remove' | 'beep' | 'stars' | 'cenzura'; // replacement mode
  useLocalPiperServer: boolean; // whether to connect to 127.0.0.1:8765 or use browser fallback
}

export interface PiperVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  desc: string;
}

export interface CacheEntry {
  key: string;
  videoId: string;
  voice: string;
  segmentCount: number;
  createdDate: string;
  sizeEstimate?: string;
}
