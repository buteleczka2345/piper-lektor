import React, { useState, useEffect } from 'react';
import { VoiceSettings } from '../types';
import { getCustomBadWords, saveCustomBadWords, getAllBadWords, filterProfanityText } from '../utils/profanityFilter';
import { ShieldAlert, Plus, Trash2, Check, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';

interface ProfanityManagerProps {
  voiceSettings: VoiceSettings;
  setVoiceSettings: React.Dispatch<React.SetStateAction<VoiceSettings>>;
}

export const ProfanityManager: React.FC<ProfanityManagerProps> = ({
  voiceSettings,
  setVoiceSettings,
}) => {
  const [customWords, setCustomWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState('');
  const [testText, setTestText] = useState('To jest przykładowy tekst zawierający kurw oraz inne słowa.');
  const [testResult, setTestResult] = useState<{ cleanedText: string; filteredCount: number }>({ cleanedText: '', filteredCount: 0 });

  useEffect(() => {
    setCustomWords(getCustomBadWords());
  }, []);

  useEffect(() => {
    if (testText) {
      const res = filterProfanityText(testText, voiceSettings.censorReplacement as any);
      setTestResult(res);
    } else {
      setTestResult({ cleanedText: '', filteredCount: 0 });
    }
  }, [testText, customWords, voiceSettings.censorReplacement]);

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newWord.trim().toLowerCase();
    if (!clean) return;

    if (!customWords.includes(clean)) {
      const updated = [...customWords, clean];
      setCustomWords(updated);
      saveCustomBadWords(updated);
      setNewWord('');
    } else {
      alert('To słowo już znajduje się na liście.');
    }
  };

  const handleRemoveWord = (wordToRemove: string) => {
    const updated = customWords.filter((w) => w !== wordToRemove);
    setCustomWords(updated);
    saveCustomBadWords(updated);
  };

  const allWords = getAllBadWords();

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-semibold">
            <ShieldAlert className="w-3.5 h-3.5" />
            Agresywny filtr wulgaryzmów i nieodpowiednich słów
          </div>
          <h2 className="text-xl font-bold text-zinc-900">
            Zarządzanie Cenzurą & Własną Listą Słów
          </h2>
          <p className="text-xs text-zinc-500">
            Filtruje wulgaryzmy oraz niepożądane słowa przed przeczytaniem ich przez lektora głosowego.
          </p>
        </div>

        {/* Global Filter Switch */}
        <label className="flex items-center gap-3 bg-zinc-50 px-4 py-2.5 rounded-xl border border-zinc-200 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={voiceSettings.filterProfanity}
            onChange={(e) => setVoiceSettings(prev => ({ ...prev, filterProfanity: e.target.checked }))}
            className="w-4 h-4 text-blue-600 rounded border-zinc-300 focus:ring-blue-500"
          />
          <div>
            <div className="text-xs font-bold text-zinc-800">
              {voiceSettings.filterProfanity ? 'Filtr Włączony' : 'Filtr Wyłączony'}
            </div>
            <div className="text-[10px] text-zinc-500">
              Cenzuruje mowę przed odczytem lektora
            </div>
          </div>
        </label>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Add & Manage Custom Words */}
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Własne słowa do cenzury (Dodawaj w locie)
          </h3>

          <form onSubmit={handleAddWord} className="flex gap-2">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="Wpisz słowo, np. brzydkieslowo..."
              className="flex-1 px-3.5 py-2 border border-zinc-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj
            </button>
          </form>

          {/* List of custom words */}
          <div>
            <div className="text-xs font-semibold text-zinc-500 mb-2">
              Twoje dodane słowa ({customWords.length}):
            </div>
            {customWords.length === 0 ? (
              <p className="text-xs text-zinc-400 italic bg-zinc-50 p-3 rounded-xl border border-dashed border-zinc-200 text-center">
                Brak własnych słów. Wpisz powyżej słowo i kliknij "Dodaj", aby natychmiast rozszerzyć filtr.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                {customWords.map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium"
                  >
                    {word}
                    <button
                      type="button"
                      onClick={() => handleRemoveWord(word)}
                      className="hover:text-red-900 font-bold ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Replacement Method */}
          <div className="pt-3 border-t border-zinc-100 space-y-2">
            <label className="text-xs font-semibold text-zinc-700 block">
              Sposób zastępowania wykrytych słów:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'cenzura', label: 'Zastąp słowem "cenzura"' },
                { id: 'stars', label: 'Zastąp gwiazdkami (***)' },
                { id: 'beep', label: 'Zastąp dźwiękiem [BEEP]' },
                { id: 'remove', label: 'Całkowicie usuń słowo' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setVoiceSettings(prev => ({ ...prev, censorReplacement: opt.id as any }))}
                  className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition-all ${
                    voiceSettings.censorReplacement === opt.id
                      ? 'border-blue-600 bg-blue-50/60 text-blue-900 ring-2 ring-blue-500/20'
                      : 'border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Live Filter Sandbox / Tester */}
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Tester działania filtra na żywo
            </h3>

            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">
                Wpisz zdanie testowe do przetestowania:
              </label>
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                className="w-full h-24 p-3 border border-zinc-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Wpisz dowolny tekst z wulgaryzmami lub słowami kluczowymi..."
              />
            </div>

            {/* Filtered Result */}
            <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-200 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-700">Wynik po filtracji:</span>
                <span className={`font-semibold px-2 py-0.5 rounded-md text-[11px] ${
                  testResult.filteredCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  Wykryto słów: {testResult.filteredCount}
                </span>
              </div>
              <p className="text-sm font-bold text-zinc-900">
                {testResult.cleanedText || <span className="text-zinc-400 font-normal italic">Brak tekstu</span>}
              </p>
            </div>
          </div>

          <div className="p-3 bg-blue-50 rounded-xl text-[11px] text-blue-800 leading-relaxed border border-blue-100">
            💡 Filtr automatycznie usuwa polskie znaki diakrytyczne (np. ą→a, ć→c) oraz spacje i znaki specjalne podczas weryfikacji, uniemożliwiając ominięcie cenzury.
          </div>
        </div>
      </div>
    </div>
  );
};
