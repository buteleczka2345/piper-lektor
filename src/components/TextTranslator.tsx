import React, { useState, useEffect, useRef } from 'react';
import { VoiceSettings } from '../types';
import { speakPolishText, stopSpeaking } from '../utils/speechEngine';
import { filterProfanityText } from '../utils/profanityFilter';
import { Volume2, Copy, Check, Sparkles, ArrowLeftRight, X, Play, RefreshCw } from 'lucide-react';

interface TextTranslatorProps {
  voiceSettings: VoiceSettings;
  isSpeaking: boolean;
  setIsSpeaking: (v: boolean) => void;
}

export const TextTranslator: React.FC<TextTranslatorProps> = ({
  voiceSettings,
  isSpeaking,
  setIsSpeaking,
}) => {
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tone, setTone] = useState<'cinema' | 'natural' | 'literal'>('cinema');
  const [copied, setCopied] = useState(false);
  const debounceTimerRef = useRef<any>(null);

  // Auto translate on typing with debounce
  useEffect(() => {
    if (!inputText.trim()) {
      setTranslatedText('');
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      handleTranslate(inputText);
    }, 450);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [inputText, tone]);

  const handleTranslate = async (textToTranslate: string) => {
    if (!textToTranslate.trim()) return;
    setIsLoading(true);

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToTranslate,
          sourceLang: 'en',
          targetLang: 'pl',
          tone,
        }),
      });

      const data = await response.json();
      let output = data.translated || '';

      if (voiceSettings.filterProfanity) {
        const filterRes = filterProfanityText(output, voiceSettings.censorReplacement as any);
        output = filterRes.cleanedText;
      }

      setTranslatedText(output);

      if (voiceSettings.autoSpeak && output.trim()) {
        speakPolishText(
          output,
          voiceSettings,
          () => setIsSpeaking(true),
          () => setIsSpeaking(false),
          () => setIsSpeaking(false)
        );
      }
    } catch (e) {
      console.error('Translation error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!translatedText) return;
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSpeak = () => {
    if (!translatedText.trim()) return;
    speakPolishText(
      translatedText,
      voiceSettings,
      () => setIsSpeaking(true),
      () => setIsSpeaking(false),
      () => setIsSpeaking(false)
    );
  };

  const presets = [
    { label: "Film Sci-Fi", text: "Warning: High energy signature detected near the planetary core. Evacuate all personnel." },
    { label: "Dialog Filmowy", text: "Look at me. We are going to finish this together, no matter what happens." },
    { label: "Komunikat lotniskowy", text: "Attention passengers, flight 402 to Warsaw is now boarding at gate twelve." },
    { label: "Rozmowa codzienna", text: "Could you tell me what time the grocery store opens tomorrow morning?" }
  ];

  return (
    <div className="space-y-6">
      {/* Settings bar */}
      <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-bold text-zinc-700">Styl tłumaczenia lektorskiego:</span>
          <div className="flex bg-zinc-100 p-1 rounded-xl gap-1">
            <button
              onClick={() => setTone('cinema')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                tone === 'cinema' ? 'bg-white text-blue-700 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              🎬 Kinowy / Lektor
            </button>
            <button
              onClick={() => setTone('natural')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                tone === 'natural' ? 'bg-white text-blue-700 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              🗣️ Potoczny / Mówiony
            </button>
            <button
              onClick={() => setTone('literal')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                tone === 'literal' ? 'bg-white text-blue-700 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              📖 Dokładny
            </button>
          </div>
        </div>

        <div className="text-xs text-zinc-500 flex items-center gap-2">
          <span>Tłumaczy w locie przy pisaniu</span>
          {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />}
        </div>
      </div>

      {/* Main Dual Translation Box */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Input English */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-xs flex flex-col justify-between overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
          <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-zinc-800">🇺🇸 Angielski (Wpisz tekst)</span>
            </div>
            {inputText && (
              <button
                onClick={() => setInputText('')}
                className="p-1 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                title="Wyczyść"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Wklej lub wpisz tutaj tekst po angielsku..."
            className="w-full h-48 p-4 text-base text-zinc-800 placeholder-zinc-400 resize-none focus:outline-hidden"
          />

          <div className="p-3 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
            <span>{inputText.length} znaków</span>
            <button
              onClick={() => handleTranslate(inputText)}
              disabled={isLoading || !inputText.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1 transition-colors"
            >
              {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Przetłumacz
            </button>
          </div>
        </div>

        {/* Output Polish */}
        <div className="bg-gradient-to-br from-blue-50/40 via-white to-zinc-50 rounded-2xl border border-blue-200 shadow-xs flex flex-col justify-between overflow-hidden">
          <div className="p-4 border-b border-blue-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-blue-900">🇵🇱 Polski (Tłumaczenie & Lektor)</span>
            </div>
            {isSpeaking && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                Lektor mówi
              </span>
            )}
          </div>

          <div className="p-4 h-48 overflow-y-auto">
            {translatedText ? (
              <p className="text-zinc-900 text-lg font-semibold leading-relaxed">
                {translatedText}
              </p>
            ) : (
              <p className="text-zinc-400 italic text-sm">
                {isLoading ? 'Generowanie tłumaczenia w czasie rzeczywistym...' : 'Wynik tłumaczenia pojawi się tutaj automatycznie...'}
              </p>
            )}
          </div>

          <div className="p-3 bg-blue-50/50 border-t border-blue-100 flex items-center justify-between">
            <span className="text-xs text-blue-700 font-medium">Głos: {voiceSettings.selectedVoice} ({voiceSettings.speechRate}x)</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSpeak}
                disabled={!translatedText}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Czytaj lektorem
              </button>
              <button
                onClick={handleCopy}
                disabled={!translatedText}
                className="p-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-white rounded-lg transition-colors border border-zinc-200"
                title="Kopiuj tekst"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Preset Phrases */}
      <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs">
        <h3 className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-3">
          Przykładowe teksty do szybkiego tłumaczenia:
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {presets.map((preset, i) => (
            <div
              key={i}
              onClick={() => setInputText(preset.text)}
              className="p-3 rounded-xl border border-zinc-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-all space-y-1"
            >
              <div className="text-xs font-bold text-blue-700">{preset.label}</div>
              <div className="text-xs text-zinc-600 line-clamp-2">{preset.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
