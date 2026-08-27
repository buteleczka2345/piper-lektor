import React from 'react';
import { ActiveTab, VoiceSettings } from '../types';
import { 
  Film, 
  Mic, 
  MessageSquareText, 
  ShieldAlert, 
  HardDrive, 
  Code2, 
  Puzzle, 
  Volume2, 
  Sparkles, 
  VolumeX,
  Server
} from 'lucide-react';
import { PIPER_VOICES } from '../utils/speechEngine';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  voiceSettings: VoiceSettings;
  setVoiceSettings: React.Dispatch<React.SetStateAction<VoiceSettings>>;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
  isPiperOnline?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  voiceSettings,
  setVoiceSettings,
  isSpeaking,
  onStopSpeaking,
  isPiperOnline = false,
}) => {
  const tabs = [
    { id: 'subtitles_player' as ActiveTab, label: 'Lektor Filmowy (Wszystkie Serwisy)', icon: Film },
    { id: 'voice_mic' as ActiveTab, label: 'Mowa na Żywo (Mikrofon)', icon: Mic },
    { id: 'text_translate' as ActiveTab, label: 'Tłumacz Tekstu', icon: MessageSquareText },
    { id: 'censor_filter' as ActiveTab, label: 'Cenzura & Wulgaryzmy', icon: ShieldAlert },
    { id: 'cache_manager' as ActiveTab, label: 'Pamięć Podręczna (Cache)', icon: HardDrive },
    { id: 'userscript' as ActiveTab, label: 'Skrypt Tampermonkey (Połączony)', icon: Code2 },
    { id: 'chrome_extension' as ActiveTab, label: 'Rozszerzenie do Chrome', icon: Puzzle },
  ];

  return (
    <header className="border-b border-zinc-200 bg-white sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between py-3 gap-3">
          
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-zinc-900 tracking-tight">
                  Piper Polski Lektor & Tłumacz na Żywo
                </h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  Wszystkie Serwisy
                </span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex items-center gap-1 border ${
                  isPiperOnline 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
                    : 'bg-amber-50 text-amber-700 border-amber-300'
                }`}>
                  <Server className="w-3 h-3" />
                  {isPiperOnline ? 'Piper 8765: Działa' : 'Piper 8765: Offline (Tryb Web Speech)'}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                YouTube • Netflix • Prime Video • Amazon • iQIYI • Mikrofon • Gemini 3.7 AI
              </p>
            </div>
          </div>

          {/* Quick Voice Bar */}
          <div className="flex items-center flex-wrap gap-2 text-xs bg-zinc-50 p-2 rounded-xl border border-zinc-200">
            <div className="flex items-center gap-1.5 font-medium text-zinc-700">
              <Volume2 className="w-4 h-4 text-blue-600" />
              <span>Głos lektora:</span>
            </div>

            <select
              value={voiceSettings.selectedVoice}
              onChange={(e) => setVoiceSettings(prev => ({ ...prev, selectedVoice: e.target.value }))}
              className="bg-white border border-zinc-300 rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              {PIPER_VOICES.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.desc})
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 pl-2 border-l border-zinc-200">
              <span className="text-zinc-500">Tempo:</span>
              <select
                value={voiceSettings.speechRate}
                onChange={(e) => setVoiceSettings(prev => ({ ...prev, speechRate: parseFloat(e.target.value) }))}
                className="bg-white border border-zinc-300 rounded-lg px-2 py-1 text-xs text-zinc-800 focus:outline-hidden"
              >
                <option value="0.75">0.75x</option>
                <option value="0.85">0.85x (Zalecane)</option>
                <option value="1.0">1.0x (Standard)</option>
                <option value="1.15">1.15x</option>
                <option value="1.3">1.3x</option>
              </select>
            </div>

            <label className="flex items-center gap-1.5 pl-2 border-l border-zinc-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={voiceSettings.autoSpeak}
                onChange={(e) => setVoiceSettings(prev => ({ ...prev, autoSpeak: e.target.checked }))}
                className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
              />
              <span className="text-zinc-700 font-medium">Auto-Mowa</span>
            </label>

            {isSpeaking && (
              <button
                onClick={onStopSpeaking}
                className="flex items-center gap-1 px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 font-semibold rounded-lg transition-colors ml-auto"
                title="Zatrzymaj mowę lektora"
              >
                <VolumeX className="w-3.5 h-3.5" />
                Zatrzymaj
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex space-x-1 overflow-x-auto py-2 border-t border-zinc-100 no-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
