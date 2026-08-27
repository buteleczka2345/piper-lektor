import React, { useState, useEffect, useRef } from 'react';
import { SubtitleSegment, VoiceSettings } from '../types';
import { SAMPLE_MOVIES } from '../utils/srtParser';
import { parseAnySubtitle, cleanSubtitleText } from '../utils/subtitleParsers';
import { speakPolishText, stopSpeaking, checkPiperHealth } from '../utils/speechEngine';
import { filterProfanityText } from '../utils/profanityFilter';
import { idbSet, idbGet, idbListKeys } from '../utils/idbCache';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Sparkles, 
  Upload, 
  Download, 
  Film, 
  Volume2, 
  Zap, 
  Headphones, 
  FileText, 
  HardDrive, 
  ShieldAlert, 
  CheckCircle2, 
  ListOrdered,
  Layers,
  Tv
} from 'lucide-react';

interface SubtitleLektorPlayerProps {
  voiceSettings: VoiceSettings;
  isSpeaking: boolean;
  setIsSpeaking: (v: boolean) => void;
  onOpenCache?: () => void;
  onOpenCensor?: () => void;
}

export const SubtitleLektorPlayer: React.FC<SubtitleLektorPlayerProps> = ({
  voiceSettings,
  isSpeaking,
  setIsSpeaking,
  onOpenCache,
  onOpenCensor,
}) => {
  const [currentMovie, setCurrentMovie] = useState(SAMPLE_MOVIES[0]);
  const [segments, setSegments] = useState<SubtitleSegment[]>(() => parseAnySubtitle(SAMPLE_MOVIES[0].srt));
  const [totalDuration, setTotalDuration] = useState<number>(SAMPLE_MOVIES[0].duration);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [lektorEnabled, setLektorEnabled] = useState<boolean>(true);
  const [syncMode, setSyncMode] = useState<boolean>(true);
  const [liveListenMode, setLiveListenMode] = useState<boolean>(false);
  const [prepareStatus, setPrepareStatus] = useState<string>('');
  const [currentReadingText, setCurrentReadingText] = useState<string>('');
  const [customSRTInput, setCustomSRTInput] = useState<string>('');
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);
  const [selectedService, setSelectedService] = useState<'all' | 'youtube' | 'netflix' | 'prime' | 'iqiyi'>('youtube');

  const lastPlayedIdxRef = useRef<number>(-1);
  const playbackIntervalRef = useRef<any>(null);

  // Playback timer loop
  useEffect(() => {
    if (isPlaying) {
      playbackIntervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= totalDuration) {
            setIsPlaying(false);
            stopSpeaking();
            setIsSpeaking(false);
            setCurrentReadingText('');
            return 0;
          }
          return Number((prev + 0.1).toFixed(2));
        });
      }, 100);
    } else {
      if (playbackIntervalRef.current) clearInterval(playbackIntervalRef.current);
    }

    return () => {
      if (playbackIntervalRef.current) clearInterval(playbackIntervalRef.current);
    };
  }, [isPlaying, totalDuration]);

  // Synchronized Lektor Engine on Time Update
  useEffect(() => {
    if (!isPlaying || !lektorEnabled) return;

    // Find active subtitle segment
    const activeSeg = segments.find(
      (s) => currentTime >= s.start && currentTime <= s.end
    );

    if (activeSeg) {
      if (lastPlayedIdxRef.current !== activeSeg.id) {
        lastPlayedIdxRef.current = activeSeg.id;

        const textToRead = activeSeg.translatedText || activeSeg.text;
        if (textToRead) {
          let cleaned = textToRead;
          if (voiceSettings.filterProfanity) {
            cleaned = filterProfanityText(textToRead, voiceSettings.censorReplacement).cleanedText;
          }

          setCurrentReadingText(cleaned);

          speakPolishText(
            cleaned,
            voiceSettings,
            () => setIsSpeaking(true),
            () => {
              setIsSpeaking(false);
              setCurrentReadingText('');
            },
            () => {
              setIsSpeaking(false);
              setCurrentReadingText('');
            }
          );
        }
      }
    } else {
      if (currentReadingText && !isSpeaking) {
        setCurrentReadingText('');
      }
    }
  }, [currentTime, isPlaying, lektorEnabled, segments, voiceSettings, isSpeaking]);

  // 1. HYBRYDA: Równoległe tłumaczenie i buforowanie z zapisem w pamięci IndexedDB
  const handlePrepareHybrid = async () => {
    if (segments.length === 0) return;
    setPrepareStatus('🚀 Inicjalizacja hybrydowego generowania...');
    setLiveListenMode(false);

    try {
      const cacheKey = `${currentMovie.title || 'video'}::${voiceSettings.selectedVoice}`;
      const cached = await idbGet(cacheKey);

      if (cached && cached.segments && cached.segments.length > 0) {
        setPrepareStatus('✅ Załadowano z pamięci podręcznej (Cache)!');
        const restored = segments.map((s, idx) => ({
          ...s,
          translatedText: cached.segments[idx]?.translated || s.translatedText || s.text,
        }));
        setSegments(restored);
        setLektorEnabled(true);
        setIsPlaying(true);
        return;
      }

      setPrepareStatus('Tłumaczenie napisów AI Gemini...');
      const response = await fetch('/api/batch-translate-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments }),
      });

      const data = await response.json();
      if (data.segments) {
        setSegments(data.segments);
        // Save to cache
        await idbSet(cacheKey, {
          segments: data.segments.map((s: SubtitleSegment) => ({
            start: s.start,
            orig_duration: s.duration,
            text: s.originalText,
            translated: s.translatedText || s.text,
          })),
          blobs: new Array(data.segments.length).fill(null),
          timestamp: Date.now(),
        });
        setPrepareStatus('✅ Hybryda gotowa w 100% (Zapisano w pamięci)');
        setLektorEnabled(true);
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('Hybrid preparation error:', e);
      setPrepareStatus('Błąd przygotowywania hybrydy');
    }
  };

  // 2. OD RAZU (Live Listen): Odtwarzanie w locie bez bufora wstępnego
  const handleLiveListen = () => {
    setLiveListenMode(true);
    setLektorEnabled(true);
    setPrepareStatus('🎧 Tryb Na Żywo aktywny — lektor czyta od razu w locie!');
    setIsPlaying(true);
  };

  const loadSample = (movie: typeof SAMPLE_MOVIES[0]) => {
    setIsPlaying(false);
    stopSpeaking();
    setIsSpeaking(false);
    setCurrentTime(0);
    setCurrentMovie(movie);
    lastPlayedIdxRef.current = -1;
    const parsed = parseAnySubtitle(movie.srt);
    setSegments(parsed);
    setTotalDuration(movie.duration);
    setPrepareStatus('');
    setCurrentReadingText('');
  };

  const handleApplyCustomSRT = () => {
    if (!customSRTInput.trim()) return;
    const parsed = parseAnySubtitle(customSRTInput);
    if (parsed.length === 0) {
      alert('Nie rozpoznano prawidłowego formatu napisów (SRT, VTT, ASS, SBV, LRC, TXT).');
      return;
    }
    const maxEnd = Math.max(...parsed.map((p) => p.end), 30);
    setSegments(parsed);
    setTotalDuration(Math.ceil(maxEnd));
    setCurrentTime(0);
    setIsPlaying(false);
    stopSpeaking();
    setShowCustomModal(false);
    setPrepareStatus(`Załadowano plik: ${parsed.length} linii dialogowych`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCustomSRTInput(content);
        const parsed = parseAnySubtitle(content);
        const maxEnd = Math.max(...parsed.map((p) => p.end), 30);
        setSegments(parsed);
        setTotalDuration(Math.ceil(maxEnd));
        setCurrentTime(0);
        setIsPlaying(false);
        setPrepareStatus(`Załadowano plik ${file.name} (${parsed.length} kwestii)`);
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadSRT = () => {
    const srtLines: string[] = [];
    segments.forEach((seg, i) => {
      const s = seg.start;
      const e = seg.end;
      const sTime = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')},${String(Math.floor((s % 1) * 1000)).padStart(3, '0')}`;
      const eTime = `${String(Math.floor(e / 3600)).padStart(2, '0')}:${String(Math.floor((e % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(e % 60)).padStart(2, '0')},${String(Math.floor((e % 1) * 1000)).padStart(3, '0')}`;

      srtLines.push(`${i + 1}`);
      srtLines.push(`${sTime} --> ${eTime}`);
      srtLines.push(seg.translatedText || seg.text);
      srtLines.push('');
    });

    const blob = new Blob([srtLines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'polski_lektor_napisy.srt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const activeSubtitle = segments.find(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Main Control Station */}
      <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                <Tv className="w-3.5 h-3.5" />
                Uniwersalny Lektor w Czasie Rzeczywistym
              </span>
              <span className="text-xs font-semibold text-zinc-500 bg-zinc-100 px-2.5 py-0.5 rounded-full">
                Wszystkie formaty (SRT, VTT, ASS, SBV, LRC, TXT)
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900">
              Odtwarzacz Lektora & Obsługa Serwisów Wideo
            </h2>
            <p className="text-xs text-zinc-500">
              Przetestuj pełny zestaw funkcji dokładnie tak, jak działa na YouTube, Netflix, Prime Video, Amazon i iQIYI.
            </p>
          </div>

          {/* Unified Action Buttons Panel */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. ON/OFF Button */}
            <button
              onClick={() => {
                const next = !lektorEnabled;
                setLektorEnabled(next);
                if (!next) {
                  stopSpeaking();
                  setIsSpeaking(false);
                }
              }}
              className={`px-4 py-2 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition-all shadow-xs ${
                lektorEnabled
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                  : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-300'
              }`}
            >
              <Volume2 className="w-4 h-4" />
              {lektorEnabled ? '🔊 LEKTOR: WŁĄCZONY' : '🔇 LEKTOR: WYŁĄCZONY'}
            </button>

            {/* 2. Hybryda */}
            <button
              onClick={handlePrepareHybrid}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-all"
              title="Równoległe pobieranie, tłumaczenie i zapis w pamięci cache"
            >
              <Zap className="w-4 h-4 text-amber-300" />
              🚀 Hybryda
            </button>

            {/* 3. Od razu */}
            <button
              onClick={handleLiveListen}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-all"
              title="Słuchaj od razu bez zapisu do pamięci"
            >
              <Headphones className="w-4 h-4 text-indigo-200" />
              🎧 Od razu
            </button>

            {/* 4. Plik */}
            <button
              onClick={() => setShowCustomModal(true)}
              className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold rounded-xl border border-zinc-300 transition-colors flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4 text-zinc-600" />
              📄 Plik
            </button>

            {/* 5. Pamięć */}
            {onOpenCache && (
              <button
                onClick={onOpenCache}
                className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold rounded-xl border border-zinc-300 transition-colors flex items-center gap-1.5"
              >
                <HardDrive className="w-4 h-4 text-amber-600" />
                💾 Pamięć
              </button>
            )}

            {/* 6. Cenzura */}
            {onOpenCensor && (
              <button
                onClick={onOpenCensor}
                className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold rounded-xl border border-zinc-300 transition-colors flex items-center gap-1.5"
              >
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                🤬 Cenzura
              </button>
            )}

            {/* 7. Pobierz SRT */}
            <button
              onClick={handleDownloadSRT}
              className="p-2 text-zinc-600 hover:text-zinc-900 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-xl transition-colors"
              title="Pobierz przetłumaczony plik SRT"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Bar */}
        {(prepareStatus || currentReadingText) && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-blue-700">Status:</span>
              <span className="text-zinc-700 font-medium">{prepareStatus || 'Odtwarzanie...'}</span>
            </div>
            {currentReadingText && (
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                <span>Odczyt: {currentReadingText}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Service Simulator Bar & Preset Clips */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          <span className="font-bold text-zinc-500 shrink-0">Wybierz scenariusz:</span>
          {SAMPLE_MOVIES.map((movie, idx) => (
            <button
              key={idx}
              onClick={() => loadSample(movie)}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-all shrink-0 ${
                currentMovie.title === movie.title
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white hover:bg-blue-50 text-zinc-700 border-zinc-200'
              }`}
            >
              🎬 {movie.title}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <span className="text-zinc-400 font-medium">Serwis:</span>
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value as any)}
            className="bg-white border border-zinc-300 rounded-lg px-2 py-1 text-xs text-zinc-800 focus:outline-hidden"
          >
            <option value="youtube">📺 YouTube</option>
            <option value="netflix">🍿 Netflix</option>
            <option value="prime">📦 Amazon Prime Video</option>
            <option value="iqiyi">🎋 iQIYI</option>
          </select>
        </div>
      </div>

      {/* Cinema Screen Simulation */}
      <div className="bg-zinc-950 rounded-3xl overflow-hidden shadow-xl border border-zinc-800 flex flex-col">
        <div className="relative aspect-video w-full max-h-[380px] bg-gradient-to-b from-zinc-900 via-zinc-950 to-black flex flex-col items-center justify-between p-6 select-none">
          {/* Top Cinema Bar */}
          <div className="w-full flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${lektorEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="font-mono uppercase font-semibold text-zinc-300 tracking-wider">
                {lektorEnabled ? 'LEKTOR AKTYWNY (SYNC)' : 'LEKTOR WYŁĄCZONY'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-zinc-300 bg-zinc-900 px-2.5 py-0.5 rounded-md border border-zinc-800">
                Głos: {voiceSettings.selectedVoice.toUpperCase()} ({voiceSettings.speechRate}x)
              </span>
            </div>
          </div>

          {/* Central Movie Visual Graphic */}
          <div className="flex flex-col items-center justify-center space-y-2 opacity-80">
            <Film className="w-12 h-12 text-zinc-700 animate-pulse" />
            <span className="text-zinc-500 text-xs font-medium">
              Strumień wideo: {selectedService.toUpperCase()} • Tytuł: {currentMovie.title}
            </span>
          </div>

          {/* Subtitle Display on Video */}
          <div className="w-full max-w-2xl text-center space-y-1.5 pb-2">
            {activeSubtitle ? (
              <div className="animate-in fade-in zoom-in-95 duration-200">
                {/* English source */}
                <div className="text-xs text-zinc-400 font-sans tracking-wide">
                  🇺🇸 {activeSubtitle.originalText}
                </div>
                {/* Polish translated audio text */}
                <div className="inline-block bg-black/85 text-yellow-300 border border-yellow-500/30 px-4 py-2 rounded-xl text-lg sm:text-xl font-bold tracking-wide shadow-2xl backdrop-blur-xs">
                  {activeSubtitle.translatedText || activeSubtitle.text}
                </div>
              </div>
            ) : (
              <div className="text-zinc-600 text-xs italic">
                {isPlaying ? '...oczekiwanie na kwestię dialogową...' : 'Kliknij Play, aby uruchomić film z polskim lektorem'}
              </div>
            )}
          </div>
        </div>

        {/* Video Player Controls */}
        <div className="bg-zinc-900 p-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-400 w-12">{formatSeconds(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={totalDuration}
              step="0.1"
              value={currentTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                lastPlayedIdxRef.current = -1;
              }}
              className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-xs font-mono text-zinc-400 w-12 text-right">{formatSeconds(totalDuration)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (isPlaying) {
                    setIsPlaying(false);
                    stopSpeaking();
                    setIsSpeaking(false);
                  } else {
                    setIsPlaying(true);
                  }
                }}
                className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-all shadow-md"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              <button
                onClick={() => {
                  setCurrentTime(0);
                  lastPlayedIdxRef.current = -1;
                  stopSpeaking();
                  setIsSpeaking(false);
                }}
                className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                title="Przewiń na początek"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="hidden sm:inline">Kwestii: {segments.length}</span>
              <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 font-medium">
                Głośność: {Math.round((voiceSettings.volume ?? 1) * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Subtitles Timeline List */}
      <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-blue-600" />
            Oś czasu dialogów i tłumaczeń
          </h3>
          <span className="text-xs text-zinc-500">Kliknij wers, aby natychmiast przeskoczyć w czasie filmu</span>
        </div>

        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {segments.map((seg) => {
            const isCurrentlyActive = currentTime >= seg.start && currentTime <= seg.end;
            return (
              <div
                key={seg.id}
                onClick={() => {
                  setCurrentTime(seg.start);
                  lastPlayedIdxRef.current = -1;
                }}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  isCurrentlyActive
                    ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400/20'
                    : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100'
                }`}
              >
                <div className="flex items-start sm:items-center gap-3">
                  <span className="text-xs font-mono font-bold text-zinc-400 bg-white px-2 py-1 rounded-md border border-zinc-200 shrink-0">
                    {formatSeconds(seg.start)} - {formatSeconds(seg.end)}
                  </span>
                  <div>
                    <div className="text-xs text-zinc-500">🇺🇸 {seg.originalText}</div>
                    <div className="text-sm font-bold text-zinc-900">
                      🇵🇱 {seg.translatedText || (
                        <span className="text-zinc-400 font-normal italic">
                          (Tłumaczenie generowane w locie lub po kliknięciu 🚀 Hybryda)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const text = seg.translatedText || seg.text;
                      speakPolishText(
                        text,
                        voiceSettings,
                        () => setIsSpeaking(true),
                        () => setIsSpeaking(false),
                        () => setIsSpeaking(false)
                      );
                    }}
                    className="p-1.5 bg-white hover:bg-blue-50 text-blue-600 border border-zinc-200 rounded-lg transition-colors"
                    title="Odsłuchaj tylko tę linię"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal for Custom File / Text */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-zinc-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
              <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Wczytaj plik napisów (SRT, VTT, ASS, SBV, LRC, TXT)
              </h3>
              <button
                onClick={() => setShowCustomModal(false)}
                className="text-zinc-400 hover:text-zinc-700 font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-700">
                Wklej treść napisów lub wgraj plik z dysku:
              </label>
              <textarea
                value={customSRTInput}
                onChange={(e) => setCustomSRTInput(e.target.value)}
                placeholder={`1\n00:00:01,000 --> 00:00:04,000\nHello, this is a subtitle line.\n\n2\n00:00:05,000 --> 00:00:09,000\nWelcome to real-time Piper lector.`}
                className="w-full h-44 p-3 border border-zinc-300 rounded-xl text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="cursor-pointer text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                Wybierz plik z komputera
                <input
                  type="file"
                  accept=".srt,.txt,.vtt,.ass,.ssa,.sbv,.lrc,.sub"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCustomModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleApplyCustomSRT}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs"
                >
                  Zastosuj napisy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
