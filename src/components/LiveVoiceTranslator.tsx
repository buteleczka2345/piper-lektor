import React, { useState, useEffect, useRef } from 'react';
import { VoiceSettings, TranslationHistoryItem } from '../types';
import { speakPolishText, stopSpeaking, RealtimeSpeechListener, isSpeechRecognitionSupported } from '../utils/speechEngine';
import { filterProfanityText } from '../utils/profanityFilter';
import { Mic, MicOff, Volume2, Copy, Trash2, ArrowRight, Play, Check, AlertCircle, Sparkles } from 'lucide-react';

interface LiveVoiceTranslatorProps {
  voiceSettings: VoiceSettings;
  history: TranslationHistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<TranslationHistoryItem[]>>;
  isSpeaking: boolean;
  setIsSpeaking: (v: boolean) => void;
}

export const LiveVoiceTranslator: React.FC<LiveVoiceTranslatorProps> = ({
  voiceSettings,
  history,
  setHistory,
  isSpeaking,
  setIsSpeaking,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [interimEnglish, setInterimEnglish] = useState('');
  const [currentPolishTranslation, setCurrentPolishTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Gotowy do nasłuchiwania.');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const listenerRef = useRef<RealtimeSpeechListener | null>(null);
  const recognitionSupported = isSpeechRecognitionSupported();

  // Initialize Speech Listener
  useEffect(() => {
    listenerRef.current = new RealtimeSpeechListener(
      (text: string, isFinal: boolean) => {
        if (!isFinal) {
          setInterimEnglish(text);
          // Trigger quick intermediate translate if text length > 12
          if (text.length > 15) {
            handleFastTranslate(text, false);
          }
        } else {
          setInterimEnglish(text);
          handleFinalTranslate(text);
        }
      },
      (err: string) => {
        setStatusMessage(err);
      },
      (listening: boolean) => {
        setIsListening(listening);
        if (listening) {
          setStatusMessage('Mikrofon aktywny: Mów teraz po angielsku...');
        } else {
          setStatusMessage('Nasłuchiwanie zatrzymane.');
        }
      },
      'en-US'
    );

    return () => {
      listenerRef.current?.stop();
    };
  }, [voiceSettings]);

  // Fast translation debounce
  const translateTimeoutRef = useRef<any>(null);
  const handleFastTranslate = (text: string, isFinal: boolean) => {
    if (translateTimeoutRef.current) clearTimeout(translateTimeoutRef.current);
    translateTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, sourceLang: 'en', targetLang: 'pl' }),
        });
        const data = await res.json();
        if (data.translated) {
          setCurrentPolishTranslation(data.translated);
        }
      } catch (e) {
        console.error(e);
      }
    }, 250);
  };

  const handleFinalTranslate = async (englishText: string) => {
    if (!englishText.trim()) return;
    setIsTranslating(true);
    setStatusMessage('Tłumaczenie Gemini AI...');

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: englishText, sourceLang: 'en', targetLang: 'pl' }),
      });
      const data = await res.json();
      const polishText = data.translated || englishText;

      setCurrentPolishTranslation(polishText);

      // Profanity filtering check
      let cleanedPolish = polishText;
      if (voiceSettings.filterProfanity) {
        const filterRes = filterProfanityText(polishText, voiceSettings.censorReplacement as any);
        cleanedPolish = filterRes.cleanedText;
      }

      const newItem: TranslationHistoryItem = {
        id: Math.random().toString(36).substring(2, 9),
        originalText: englishText,
        translatedText: cleanedPolish,
        sourceLang: 'Angielski (EN)',
        targetLang: 'Polski (PL)',
        timestamp: Date.now(),
      };

      setHistory(prev => [newItem, ...prev.slice(0, 49)]);
      setStatusMessage('Przetłumaczono!');

      // Auto speak Polish
      if (voiceSettings.autoSpeak && cleanedPolish.trim()) {
        speakPolishText(
          cleanedPolish,
          voiceSettings,
          () => setIsSpeaking(true),
          () => setIsSpeaking(false),
          () => setIsSpeaking(false)
        );
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage('Błąd tłumaczenia.');
    } finally {
      setIsTranslating(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      listenerRef.current?.stop();
    } else {
      setInterimEnglish('');
      setCurrentPolishTranslation('');
      listenerRef.current?.start();
    }
  };

  const playSpeech = (text: string) => {
    speakPolishText(
      text,
      voiceSettings,
      () => setIsSpeaking(true),
      () => setIsSpeaking(false),
      () => setIsSpeaking(false)
    );
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const samplePhrases = [
    "Hello! How are you doing today?",
    "Could you please show me the fastest way to the airport?",
    "We are receiving a signal from the outer space station.",
    "This real-time speech interpreter works amazingly fast.",
    "Be careful, the highway is slippery due to heavy rain."
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner / Controls */}
      <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center md:text-left">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              Symultaniczny tłumacz mowy
            </div>
            <h2 className="text-xl font-bold text-zinc-900">
              Mów po angielsku – słuchaj po polsku w czasie rzeczywistym
            </h2>
            <p className="text-xs text-zinc-500">
              Aplikacja słucha Twojego mikrofonu lub rozmówcy i automatycznie tłumaczy oraz czyta tekst polskim głosem lektorskim.
            </p>
          </div>

          {/* Main Action Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleListening}
              className={`flex items-center gap-3 px-6 py-3.5 rounded-xl font-bold text-sm shadow-md transition-all ${
                isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-lg'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-5 h-5" />
                  <span>Zatrzymaj nasłuch</span>
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  <span>Włącz nasłuch mikrofonu</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Audio Visualizer / Status */}
        <div className="mt-6 pt-4 border-t border-zinc-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-ping' : 'bg-zinc-300'}`} />
            <span className="font-medium text-zinc-700">{statusMessage}</span>
          </div>

          {isListening && (
            <div className="flex items-center gap-1 text-blue-600 font-medium">
              <span className="inline-block w-1.5 h-4 bg-blue-600 rounded-full animate-bounce [animation-delay:0ms]"></span>
              <span className="inline-block w-1.5 h-6 bg-blue-600 rounded-full animate-bounce [animation-delay:150ms]"></span>
              <span className="inline-block w-1.5 h-3 bg-blue-600 rounded-full animate-bounce [animation-delay:300ms]"></span>
              <span className="inline-block w-1.5 h-7 bg-blue-600 rounded-full animate-bounce [animation-delay:450ms]"></span>
              <span className="inline-block w-1.5 h-4 bg-blue-600 rounded-full animate-bounce [animation-delay:200ms]"></span>
              <span className="ml-1 text-xs">Analiza fal dźwiękowych...</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Stream Dual Box (English -> Polish) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* English Box */}
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs flex flex-col justify-between min-h-[190px]">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-100">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Wejście: Mowa po angielsku
              </span>
              {isListening && (
                <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                  ● LIVE
                </span>
              )}
            </div>
            <p className="text-zinc-800 font-medium text-base leading-relaxed">
              {interimEnglish || (
                <span className="text-zinc-400 italic">
                  {isListening ? 'Nasłuchuję... powiedz coś po angielsku' : 'Naciśnij przycisk mikrofonu powyżej i zacznij mówić...'}
                </span>
              )}
            </p>
          </div>

          <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-400">
            <span>Język źródłowy: English (US/UK)</span>
            {interimEnglish && (
              <button
                onClick={() => handleFinalTranslate(interimEnglish)}
                disabled={isTranslating}
                className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
              >
                Przetłumacz teraz <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Polish Translation Box */}
        <div className="bg-gradient-to-br from-blue-50/50 via-white to-zinc-50 rounded-2xl p-5 border border-blue-200 shadow-xs flex flex-col justify-between min-h-[190px]">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-blue-100">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Wyjście: Lektor po polsku
              </span>
              {isSpeaking && (
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                  Mówi lektor...
                </span>
              )}
            </div>
            <p className="text-zinc-900 font-semibold text-lg leading-relaxed">
              {currentPolishTranslation || (
                <span className="text-zinc-400 italic text-base font-normal">
                  {isTranslating ? 'Tłumaczenie na żywo...' : 'Tutaj pojawi się przetłumaczony tekst po polsku'}
                </span>
              )}
            </p>
          </div>

          <div className="pt-3 border-t border-blue-100/60 flex items-center justify-between">
            <span className="text-xs text-blue-700 font-medium">Głos: {voiceSettings.selectedVoice}</span>
            {currentPolishTranslation && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => playSpeech(currentPolishTranslation)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Odsłuchaj lektora
                </button>
                <button
                  onClick={() => copyToClipboard(currentPolishTranslation, 'current')}
                  className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition-colors"
                  title="Skopiuj tłumaczenie"
                >
                  {copiedId === 'current' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Test Phrases */}
      <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-200">
        <div className="text-xs font-bold text-zinc-600 mb-2 flex items-center gap-1.5">
          <span>Szybkie frazy do przetestowania (kliknij, aby zasymulować mowę):</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {samplePhrases.map((phrase, idx) => (
            <button
              key={idx}
              onClick={() => {
                setInterimEnglish(phrase);
                handleFinalTranslate(phrase);
              }}
              className="text-xs bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-zinc-700 px-3 py-1.5 rounded-lg border border-zinc-300 transition-all font-medium text-left"
            >
              "{phrase}"
            </button>
          ))}
        </div>
      </div>

      {/* Realtime History Stream */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <span>Dziennik przetłumaczonych wypowiedzi</span>
              <span className="text-xs font-normal text-zinc-500">({history.length})</span>
            </h3>
            <button
              onClick={() => setHistory([])}
              className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1 p-1 hover:bg-red-50 rounded-lg"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Wyczyść historię
            </button>
          </div>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {history.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80 hover:border-blue-200 hover:bg-blue-50/20 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="text-xs text-zinc-500 font-medium">
                    🇺🇸 {item.originalText}
                  </div>
                  <div className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                    🇵🇱 {item.translatedText}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    onClick={() => playSpeech(item.translatedText)}
                    className="p-2 bg-white hover:bg-blue-50 text-blue-600 border border-zinc-200 rounded-lg transition-colors"
                    title="Odtwórz głos lektora"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => copyToClipboard(item.translatedText, item.id)}
                    className="p-2 bg-white hover:bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-lg transition-colors"
                    title="Kopiuj"
                  >
                    {copiedId === item.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
