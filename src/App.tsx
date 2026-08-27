/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ActiveTab, VoiceSettings, TranslationHistoryItem } from './types';
import { Header } from './components/Header';
import { SubtitleLektorPlayer } from './components/SubtitleLektorPlayer';
import { LiveVoiceTranslator } from './components/LiveVoiceTranslator';
import { TextTranslator } from './components/TextTranslator';
import { ProfanityManager } from './components/ProfanityManager';
import { CacheManager } from './components/CacheManager';
import { TampermonkeyCompanion } from './components/TampermonkeyCompanion';
import { ChromeExtensionGenerator } from './components/ChromeExtensionGenerator';
import { stopSpeaking, checkPiperHealth } from './utils/speechEngine';

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  selectedVoice: 'gosia',
  speechRate: 0.85,
  pitch: 1.0,
  volume: 1.0,
  autoSpeak: true,
  duckVolume: 0.15,
  filterProfanity: true,
  censorReplacement: 'remove',
  useLocalPiperServer: true,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('subtitles_player');
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => {
    try {
      const saved = localStorage.getItem('appVoiceSettings');
      return saved ? JSON.parse(saved) : DEFAULT_VOICE_SETTINGS;
    } catch {
      return DEFAULT_VOICE_SETTINGS;
    }
  });

  const [history, setHistory] = useState<TranslationHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('appTranslationHistory');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [serverStatus, setServerStatus] = useState<boolean>(true);
  const [isPiperOnline, setIsPiperOnline] = useState<boolean>(false);

  // Save settings
  useEffect(() => {
    try {
      localStorage.setItem('appVoiceSettings', JSON.stringify(voiceSettings));
    } catch (e) {
      console.error(e);
    }
  }, [voiceSettings]);

  // Save history
  useEffect(() => {
    try {
      localStorage.setItem('appTranslationHistory', JSON.stringify(history));
    } catch (e) {
      console.error(e);
    }
  }, [history]);

  // Check health and local Piper on load and periodically
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((d) => setServerStatus(d.ok === true))
      .catch(() => setServerStatus(false));

    const checkPiper = async () => {
      const online = await checkPiperHealth();
      setIsPiperOnline(online);
    };

    checkPiper();
    const interval = setInterval(checkPiper, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleStopSpeaking = () => {
    stopSpeaking();
    setIsSpeaking(false);
  };

  return (
    <div className="min-h-screen bg-zinc-100/70 text-zinc-900 flex flex-col font-sans">
      {/* Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        voiceSettings={voiceSettings}
        setVoiceSettings={setVoiceSettings}
        isSpeaking={isSpeaking}
        onStopSpeaking={handleStopSpeaking}
        isPiperOnline={isPiperOnline}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'subtitles_player' && (
          <SubtitleLektorPlayer
            voiceSettings={voiceSettings}
            isSpeaking={isSpeaking}
            setIsSpeaking={setIsSpeaking}
            onOpenCache={() => setActiveTab('cache_manager')}
            onOpenCensor={() => setActiveTab('censor_filter')}
          />
        )}

        {activeTab === 'voice_mic' && (
          <LiveVoiceTranslator
            voiceSettings={voiceSettings}
            history={history}
            setHistory={setHistory}
            isSpeaking={isSpeaking}
            setIsSpeaking={setIsSpeaking}
          />
        )}

        {activeTab === 'text_translate' && (
          <TextTranslator
            voiceSettings={voiceSettings}
            isSpeaking={isSpeaking}
            setIsSpeaking={setIsSpeaking}
          />
        )}

        {activeTab === 'censor_filter' && (
          <ProfanityManager
            voiceSettings={voiceSettings}
            setVoiceSettings={setVoiceSettings}
          />
        )}

        {activeTab === 'cache_manager' && (
          <CacheManager voiceSettings={voiceSettings} />
        )}

        {activeTab === 'userscript' && (
          <TampermonkeyCompanion serverStatus={serverStatus} />
        )}

        {activeTab === 'chrome_extension' && (
          <ChromeExtensionGenerator />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Silnik AI: Google Gemini 3.7 Flash & Synteza Piper TTS (Multi-Voice)</span>
          </div>
          <div>
            <span>Obsługiwane platformy: YouTube, Netflix, Prime Video, Amazon, iQIYI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
