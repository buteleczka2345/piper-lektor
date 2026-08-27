import React, { useState, useEffect } from 'react';
import { idbListKeys, idbGet, idbDelete, idbClearAll, CachedVideoRecord } from '../utils/idbCache';
import { HardDrive, Trash2, Play, RefreshCw, Layers, Sparkles, CheckCircle2 } from 'lucide-react';
import { VoiceSettings } from '../types';
import { speakPolishText } from '../utils/speechEngine';

interface CacheManagerProps {
  voiceSettings: VoiceSettings;
}

export const CacheManager: React.FC<CacheManagerProps> = ({ voiceSettings }) => {
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedRecord, setSelectedRecord] = useState<{ key: string; data: CachedVideoRecord } | null>(null);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const list = await idbListKeys();
      setKeys(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleDelete = async (key: string) => {
    if (confirm(`Czy na pewno chcesz usunąć z pamięci podręcznej wpis: ${key}?`)) {
      await idbDelete(key);
      if (selectedRecord?.key === key) setSelectedRecord(null);
      await loadKeys();
    }
  };

  const handleClearAll = async () => {
    if (confirm('Czy na pewno chcesz usunąć całą pamięć podręczną (wszystkie pobrane i wygenerowane napisy)?')) {
      await idbClearAll();
      setSelectedRecord(null);
      await loadKeys();
    }
  };

  const handleInspect = async (key: string) => {
    const data = await idbGet(key);
    if (data) {
      setSelectedRecord({ key, data });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200 mb-1">
            <HardDrive className="w-3.5 h-3.5" />
            Baza Danych IndexedDB (Cache Piper 8765)
          </div>
          <h2 className="text-lg font-bold text-zinc-900">
            Zarządzanie Pamięcią Podręczną (Cache)
          </h2>
          <p className="text-xs text-zinc-500">
            Wszystkie przetłumaczone kwestie dialogowe filmów są bezpiecznie przechowywane w Twojej przeglądarce, aby nie marnować transferu ani zapytań.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadKeys}
            className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold rounded-xl border border-zinc-300 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Odśwież
          </button>
          {keys.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl border border-red-200 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Wyczyść całą pamięć
            </button>
          )}
        </div>
      </div>

      {/* Grid of keys and inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List of Cached Items */}
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs space-y-3 lg:col-span-1">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              Zapisane filmy & ścieżki ({keys.length})
            </h3>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-zinc-500">Ładowanie bazy danych...</div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-400 space-y-2">
              <HardDrive className="w-8 h-8 mx-auto text-zinc-300" />
              <p>Brak zapisanych filmów w pamięci podręcznej.</p>
              <p className="text-[11px] text-zinc-400">
                Uruchom tryb 🚀 Hybryda w odtwarzaczu lub skrypcie Tampermonkey, aby zapisać film do pamięci.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {keys.map((k) => (
                <div
                  key={k}
                  onClick={() => handleInspect(k)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between gap-2 ${
                    selectedRecord?.key === k
                      ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400/20'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="font-bold text-zinc-900 truncate" title={k}>
                      {k}
                    </div>
                    <div className="text-[11px] text-zinc-500">Klucz: ID wideo + głos</div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(k);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    title="Usuń ten wpis"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Record Inspector */}
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-xs space-y-4 lg:col-span-2">
          {selectedRecord ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div>
                  <h3 className="text-base font-bold text-zinc-900 truncate">
                    Podgląd wpisu: {selectedRecord.key}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Liczba zapisanych kwestii dialogowych: {selectedRecord.data.segments.length}
                  </p>
                </div>
              </div>

              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-2">
                {selectedRecord.data.segments.map((seg, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-zinc-400 font-mono text-[11px]">
                      <span>#{idx + 1} • Start: {seg.start}s (Czas: {seg.orig_duration}s)</span>
                      <button
                        onClick={() => {
                          const txt = seg.translated || seg.text;
                          speakPolishText(txt, voiceSettings);
                        }}
                        className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                      >
                        <Play className="w-3 h-3 fill-current" /> Odsłuchaj
                      </button>
                    </div>
                    <div className="text-zinc-600">🇺🇸 {seg.text}</div>
                    <div className="font-bold text-zinc-900">🇵🇱 {seg.translated || '(Brak tłumaczenia)'}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center text-zinc-400 space-y-2">
              <Sparkles className="w-8 h-8 text-zinc-300" />
              <p className="text-sm font-medium text-zinc-600">Wybierz wpis z listy po lewej stronie</p>
              <p className="text-xs text-zinc-400">
                Możesz przejrzeć każdą przetłumaczoną kwestię i odsłuchać jej odczyt przez polskiego lektora.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
