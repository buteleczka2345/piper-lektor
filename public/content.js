/**
 * Piper Polski Lektor & Tłumacz - Chrome Extension Content Script (Full GUI & Engine)
 * Obsługuje: YouTube, Netflix, Prime Video, Amazon, Disney+, HBO Max, Apple TV+, iQIYI, CDA, Player.pl, TVP VOD
 * Funkcje:
 *  - Zaawansowany nasłuch "Od razu" (Microsecond MutationObserver + Native textTracks oncuechange + Web Speech STT Mowa)
 *  - Pływający panel GUI na wideo (z minimalizacją, suwakami, wskaźnikiem live)
 *  - Multi-Voice (Gosia, Jarvis, Bass, Justyna, Męski WG, Żeński WG, Janusz)
 *  - Hybryda z równoległym prebuforowaniem (8 wątków) & IndexedDB
 *  - Dynamiczne wyciszanie filmu (Audio Ducking)
 *  - Inteligentna cenzura wulgaryzmów
 */
(function () {
  'use strict';

  if (window.__PIPER_CHROME_EXT_FULL_RUNNING__) return;
  window.__PIPER_CHROME_EXT_FULL_RUNNING__ = true;

  const TTS_URL = 'http://127.0.0.1:8765/tts';
  const HEALTH_URL = 'http://127.0.0.1:8765/health';
  const PARALLEL_WORKERS = 8;

  const AVAILABLE_VOICES = [
    { id: 'gosia', name: 'Gosia (Żeński)' },
    { id: 'jarvis', name: 'Jarvis (Męski)' },
    { id: 'bass', name: 'Bass (Niski Bas)' },
    { id: 'justyna', name: 'Justyna (Ciepły Narracyjny)' },
    { id: 'meski', name: 'Męski WG' },
    { id: 'zenski', name: 'Żeński WG' },
    { id: 'janusz', name: 'Janusz (Kinowy)' }
  ];

  let selectedVoice = 'gosia';
  let speechRate = 1.0;
  let duckVolume = 0.50;
  let videoVolume = 1.0;
  let translateEnabled = true;
  let enabled = false;
  let filterEnabled = true;
  let filterMode = 'remove';
  let liveListenMode = false;
  let liveSttMode = false;
  let isPiperOnline = false;

  let audioCtx = null;
  let curSyncAudio = null;
  let curSyncUrl = null;
  let curSyncIdx = null;
  let lastSyncTime = -1;
  let lastPlayedIdx = -1;
  const RESET_THRESHOLD_SECONDS = 2.0;

  let syncMode = false;
  let syncVideoId = null;
  let syncSegments = null;
  let syncBlobs = null;
  let preparing = false;

  const translationCache = new Map();
  let liveSpeechRecognition = null;
  let liveObserver = null;
  let hookedVideos = new WeakSet();
  let masterAudioElement = null;
  let currentSpeechToken = 0;
  let domScanDebounceTimer = null;
  let lastTextTrackTime = 0;
  const recentSpokenHistory = []; // { norm: string, time: number }
  const MAX_QUEUE_SIZE = 3;
  let sentenceQueue = [];
  let isQueuePlaying = false;
  let currentSentenceId = 0;
  let currentPlayingItem = null;

  const PROFANITY_LIST = [
    'kurwa', 'kurwo', 'kurwy', 'kurwą', 'kurwę', 'kurw',
    'chuj', 'chuja', 'chuju', 'chujowy', 'chujowa', 'chujowe', 'chuje',
    'pierdol', 'pierdoli', 'pierdole', 'pierdolenie', 'pierdolony',
    'jebać', 'jebany', 'jebana', 'jebane', 'jebią', 'jeb',
    'dupa', 'dupy', 'dupę', 'dupą', 'dupie',
    'gówno', 'gówna', 'gównem', 'gówniany', 'gowno',
    'szmata', 'szmaty', 'szmac',
    'cipa', 'cipy', 'cipę', 'cipą',
    'cholera', 'cholery', 'cholerę', 'cholerny',
    'pieprzyć', 'pieprz'
  ];

  // Wczytaj ustawienia z chrome.storage
  try {
    chrome.storage.local.get(['selectedVoice', 'speechRate', 'duckVolume', 'filterEnabled', 'filterMode', 'lektorEnabled', 'translateEnabled'], (res) => {
      if (res.selectedVoice) selectedVoice = res.selectedVoice;
      if (res.speechRate) speechRate = Number(res.speechRate);
      if (res.duckVolume !== undefined) duckVolume = Number(res.duckVolume);
      if (res.filterEnabled !== undefined) filterEnabled = res.filterEnabled;
      if (res.filterMode) filterMode = res.filterMode;
      if (res.translateEnabled !== undefined) translateEnabled = res.translateEnabled;
      if (res.lektorEnabled) {
        enabled = true;
        setVideoVolume(duckVolume);
      }
      updateUIState();
    });
  } catch (e) {}

  chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'toggleLektor') toggleLektor();
    if (req.action === 'setVoice') { selectedVoice = req.voice; updateUIState(); }
    if (req.action === 'setSpeed') { speechRate = Number(req.speed); }
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function cleanSubtitleText(text) {
    if (!text) return '';
    return String(text)
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\N/gi, ' ')
      .replace(/\\n/gi, ' ')
      .replace(/\s+\d{1,4}\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function censorText(text) {
    if (!filterEnabled || !text) return text;
    const pattern = new RegExp('(' + PROFANITY_LIST.join('|') + ')', 'gi');
    let result = text;
    switch (filterMode) {
      case 'remove': result = result.replace(pattern, ''); break;
      case 'beep': result = result.replace(pattern, '[BEEP]'); break;
      case 'cenzura': result = result.replace(pattern, 'cenzura'); break;
      case 'replace':
      default:
        result = result.replace(pattern, (m) => m[0] + '*'.repeat(m.length - 1));
        break;
    }
    return cleanSubtitleText(result);
  }

  function looksLikePolish(text) {
    if (!text) return false;
    if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return true;
    const words = text.toLowerCase().split(/\s+/);
    const commonPl = ['nie', 'się', 'jest', 'jak', 'tak', 'ale', 'dla', 'jestem', 'jesteś', 'być', 'był', 'była', 'może', 'tylko', 'przez', 'gdzie', 'kiedy', 'dlaczego', 'dobrze', 'cześć', 'proszę', 'dzięki', 'tutaj', 'tam', 'teraz', 'zawsze', 'nigdy', 'wiem', 'chcę', 'muszę', 'pan', 'pani'];
    let plHits = 0;
    for (const w of words) {
      const clean = w.replace(/[^a-z]/g, '');
      if (commonPl.includes(clean)) plHits++;
    }
    return plHits >= 1;
  }

  // Tłumaczenie przez Google Translate API z szybkim timeoutem
  async function translate(text) {
    if (looksLikePolish(text)) return text;
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pl&dt=t&q=' + encodeURIComponent(text);
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let out = '';
    if (Array.isArray(data[0])) {
      for (const part of data[0]) {
        if (Array.isArray(part) && part[0]) out += part[0];
      }
    }
    return cleanSubtitleText(out) || text;
  }

  async function translateWithRetry(text) {
    if (!text) return '';
    if (looksLikePolish(text)) return text;
    if (translationCache.has(text)) return translationCache.get(text);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await translate(text);
        if (res) {
          translationCache.set(text, res);
          return res;
        }
      } catch (e) {
        if (attempt < 2) await sleep(200);
      }
    }
    return text;
  }

  function setVideoVolume(v) {
    document.querySelectorAll('video').forEach(video => {
      try { video.volume = Math.max(0, Math.min(1, v)); } catch (e) {}
    });
  }

  // IndexedDB Cache
  const DB_NAME = 'piper8765ChromeCache';
  const DB_STORE = 'videos';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function getVideoId() {
    if (location.hostname.includes('youtube.com')) {
      try {
        const u = new URL(location.href);
        return u.searchParams.get('v') || location.pathname;
      } catch (e) { return location.pathname; }
    }
    return location.hostname + location.pathname;
  }

  function getCaptionTracks() {
    const mp = document.querySelector('#movie_player');
    if (!mp || typeof mp.getPlayerResponse !== 'function') return [];
    try {
      const resp = mp.getPlayerResponse();
      return resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch (e) { return []; }
  }

  async function fetchTranscriptSegments() {
    const tracks = getCaptionTracks();
    if (!tracks.length) throw new Error('Brak napisów w strumieniu YouTube.');
    const track = tracks.find(t => t.languageCode === 'pl') || tracks.find(t => (t.languageCode || '').startsWith('pl')) || tracks[0];
    const url = track.baseUrl + (track.baseUrl.includes('fmt=') ? '' : '&fmt=json3');
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const segments = [];
    for (const ev of (data.events || [])) {
      if (!ev.segs) continue;
      const text = cleanSubtitleText(ev.segs.map(s => s.utf8 || '').join(''));
      if (!text) continue;
      segments.push({ text, start: (ev.tStartMs || 0) / 1000, duration: Math.max((ev.dDurationMs || 0) / 1000, 0.3) });
    }
    return segments;
  }

  function getUsableTextTrack() {
    const video = document.querySelector('video');
    if (!video || !video.textTracks) return null;
    const tracks = Array.from(video.textTracks);
    return tracks.find(t => t.mode === 'showing' && t.cues && t.cues.length) || tracks.find(t => t.cues && t.cues.length) || null;
  }

  function segmentsFromTextTrack(track) {
    const segments = [];
    for (let i = 0; i < track.cues.length; i++) {
      const cue = track.cues[i];
      const text = cleanSubtitleText(cue.text);
      if (text) segments.push({ text, start: cue.startTime, duration: Math.max(cue.endTime - cue.startTime, 0.3) });
    }
    return segments;
  }

  async function fetchTranscriptSegmentsAuto() {
    if (location.hostname.includes('youtube.com')) {
      try {
        const segs = await fetchTranscriptSegments();
        if (segs.length) return segs;
      } catch (e) {}
    }
    const track = getUsableTextTrack();
    if (track) {
      const segs = segmentsFromTextTrack(track);
      if (segs.length) return segs;
    }
    throw new Error('Włącz napisy w odtwarzaczu (ikona CC/Napisy).');
  }

  async function requestPiper(text) {
    const resp = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: selectedVoice, speed: speechRate })
    });
    if (!resp.ok) throw new Error('Piper HTTP ' + resp.status);
    return await resp.blob();
  }

  async function checkPiperHealth() {
    try {
      const res = await fetch(HEALTH_URL, { method: 'GET', signal: AbortSignal.timeout(2000) });
      isPiperOnline = res.ok;
    } catch (e) {
      isPiperOnline = false;
    }
    updateStatusDot();
  }

  function stopSyncSource() {
    if (curSyncAudio) {
      try { curSyncAudio.pause(); curSyncAudio.currentTime = 0; } catch (e) {}
      curSyncAudio = null;
    }
    if (curSyncUrl) {
      try { URL.revokeObjectURL(curSyncUrl); } catch (e) {}
      curSyncUrl = null;
    }
    curSyncIdx = null;
    setVideoVolume(videoVolume);
  }

  function resetSyncState() {
    stopSyncSource();
    lastPlayedIdx = -1;
    updateNowReading('');
    setVideoVolume(videoVolume);
  }

  async function playSyncSegment(idx, video) {
    if (curSyncIdx === idx && curSyncAudio) return;
    const seg = syncSegments[idx];
    if (!seg || seg.failed) return;

    if (!syncBlobs[idx]) {
      updateNowReading('(Ładowanie...) ' + seg.text);
      return;
    }
    if (!enabled || !syncMode) return;

    stopAllSpeech();
    stopSyncSource();
    curSyncIdx = idx;
    updateNowReading(seg.text);

    const blob = syncBlobs[idx];
    curSyncUrl = URL.createObjectURL(blob);
    const audio = new Audio(curSyncUrl);
    audio.preservesPitch = true;
    audio.playbackRate = speechRate * (video.playbackRate || 1);
    curSyncAudio = audio;

    setVideoVolume(duckVolume);

    audio.onended = () => {
      if (curSyncAudio === audio) {
        curSyncAudio = null;
        curSyncIdx = null;
        updateNowReading('');
        setVideoVolume(videoVolume);
      }
    };
    audio.onerror = () => {
      if (curSyncAudio === audio) {
        curSyncAudio = null;
        curSyncIdx = null;
        updateNowReading('');
        setVideoVolume(videoVolume);
      }
    };
    audio.play().catch(() => {
      curSyncAudio = null;
      curSyncIdx = null;
      setVideoVolume(videoVolume);
    });
  }

  function syncTick(video) {
    if (!syncMode || !enabled) return;
    if (!video || video.paused) {
      if (curSyncAudio && !curSyncAudio.paused) { try { curSyncAudio.pause(); } catch (e) {} }
      return;
    }

    if (curSyncAudio && curSyncAudio.paused && !curSyncAudio.ended) {
      curSyncAudio.play().catch(() => {});
    }

    const t = video.currentTime;
    if (lastSyncTime !== -1 && Math.abs(t - lastSyncTime) > RESET_THRESHOLD_SECONDS) {
      resetSyncState();
    }
    lastSyncTime = t;

    if (curSyncAudio && !curSyncAudio.ended) return;

    if (syncSegments) {
      for (let i = 0; i < syncSegments.length; i++) {
        const s = syncSegments[i];
        const endTime = s.start + Math.max(s.orig_duration, 0.1);
        if (t >= s.start && t < endTime) {
          if (i !== lastPlayedIdx && i !== curSyncIdx) {
            lastPlayedIdx = i;
            playSyncSegment(i, video);
          }
          break;
        }
      }
    }
  }

  // ==========================================================
  // HYBRYDA: PARALLEL PIPER PREBUFFERING
  // ==========================================================
  async function prepareHybridStreaming(cacheKeyStr, segments, videoId) {
    liveListenMode = false;
    const cleaned = segments.map(s => ({ ...s, text: cleanSubtitleText(s.text) })).filter(s => s.text.length > 0);
    const blobs = new Array(cleaned.length);
    const meta = new Array(cleaned.length);

    for (let i = 0; i < cleaned.length; i++) {
      meta[i] = { start: cleaned[i].start, orig_duration: Math.max(cleaned[i].duration, 0.05), text: cleaned[i].text };
    }

    syncVideoId = videoId;
    syncSegments = meta;
    syncBlobs = blobs;
    syncMode = true;
    curSyncIdx = null;
    lastPlayedIdx = -1;
    lastSyncTime = -1;

    if (!enabled) toggleLektor();

    let completed = 0;
    let curr = 0;

    async function worker() {
      while (true) {
        if (!syncMode || syncVideoId !== videoId) break;
        const i = curr++;
        if (i >= cleaned.length) break;

        const seg = cleaned[i];
        let textToUse = seg.text;
        try { textToUse = await translateWithRetry(seg.text); } catch (e) {}
        let finalText = censorText(textToUse) || textToUse;

        if (!finalText || finalText.length < 2) {
          meta[i].skipped = true;
          completed++;
          updateProgress(`Pominięto: ${completed}/${cleaned.length}`);
          continue;
        }

        try {
          const blob = await requestPiper(finalText);
          blobs[i] = blob;
          meta[i].translated = finalText;
        } catch (e) {
          meta[i].failed = true;
        }

        completed++;
        updateProgress(`Buforowanie: ${completed}/${cleaned.length} (${Math.round((completed/cleaned.length)*100)}%)`);

        if (completed % 5 === 0) {
          await idbSet(cacheKeyStr, { segments: meta, blobs }).catch(() => {});
        }
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(PARALLEL_WORKERS, cleaned.length); w++) workers.push(worker());
    await Promise.all(workers);
    await idbSet(cacheKeyStr, { segments: meta, blobs }).catch(() => {});
    updateProgress(`✅ Gotowe (100% zbuforowane w Pamięci)`);
  }

  async function prepareWholeVideo() {
    if (preparing) return;
    const videoId = getVideoId();
    if (!videoId) { alert('Nie wykryto ID filmu.'); return; }

    await checkPiperHealth();

    preparing = true;
    updateProgress('Sprawdzam pamięć podręczną...');

    const key = videoId + '::' + selectedVoice;
    const cached = await idbGet(key).catch(() => null);
    if (cached) {
      syncVideoId = videoId;
      syncSegments = cached.segments;
      syncBlobs = cached.blobs;
      syncMode = true;
      liveListenMode = false;
      curSyncIdx = null;
      lastPlayedIdx = -1;
      lastSyncTime = -1;
      updateProgress('✅ Załadowano natychmiast z pamięci podręcznej.');
      preparing = false;
      if (!enabled) toggleLektor();
      return;
    }

    updateProgress('Pobieram napisy z filmu...');
    let segments;
    try {
      segments = await fetchTranscriptSegmentsAuto();
    } catch (e) {
      updateProgress('⚠️ Włącz napisy CC w odtwarzaczu lub wgraj plik .srt');
      preparing = false;
      return;
    }

    preparing = false;
    await prepareHybridStreaming(key, segments, videoId);
  }

  // ==========================================================
  // SUPERCHARGED "OD RAZU" (AKTYWNY NASŁUCH NAPISÓW & IMMERSIVE TRANSLATE)
  // ==========================================================
  const IMMERSIVE_SELECTORS = [
    '.immersive-translate-target-inner',
    '.immersive-translate-target-translation',
    '[data-immersive-translate-translation-element]',
    '.notranslate.immersive-translate-target-inner',
    '.immersive-translate-target-wrapper span'
  ];

  const SUBTITLE_SELECTORS = [
    // Immersive Translate (najwyższy priorytet przy dwujęzyczności)
    '.immersive-translate-target-inner',
    '.immersive-translate-target-translation',
    '[data-immersive-translate-translation-element]',
    // iQIYI (iq.com, iqiyi.com)
    '.iqp-subtitle-item',
    '.iqp-subtitles-item',
    '.iqp-player-subtitles',
    '.iqp-subtitle-text',
    'div[class*="iqp-subtitle"]',
    'div[class*="subtitles-item"]',
    'div[class*="player-subtitles"]',
    // Prime Video / Amazon (najwyższy priorytet i precyzyjne selektory)
    '.atvwebplayersdk-captions-text',
    '.rendererContainer span',
    '.overlays-container .caption-text',
    '.overlays-container .atvwebplayersdk-captions-text',
    // YouTube
    '.ytp-caption-segment',
    '.caption-visual-line',
    // Netflix
    '.player-timedtext-text-container span',
    '.timedtext-line',
    // Disney+
    '.dss-subtitle-renderer-line',
    '.subtitle-container span',
    // HBO Max / Max
    '[data-testid="subtitle-window"] span',
    '.subtitle-renderer span',
    // CDA / Player / Twitch / Generic HTML5
    '.jw-text-track-cue',
    '.vjs-text-track-display',
    '.subtitle-text',
    '.cda-subtitles',
    '.player-subtitles',
    'div[class*="subtitle"]',
    'span[class*="subtitle"]'
  ];

  function normalizeForDeduplication(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/\[.*?\]|\(.*?\)|♪/g, '')
      .replace(/[^a-ząćęłńóśźż0-9]/gi, '')
      .trim();
  }

  function isDuplicateOrSubstring(normText) {
    if (!normText || normText.length < 2) return true;
    const now = Date.now();
    
    // Usuń wpisy starsze niż 7 sekund
    for (let i = recentSpokenHistory.length - 1; i >= 0; i--) {
      if (now - recentSpokenHistory[i].time > 7000) {
        recentSpokenHistory.splice(i, 1);
      }
    }

    for (const item of recentSpokenHistory) {
      const timeDiff = now - item.time;
      if (timeDiff < 5000) {
        if (item.norm === normText) return true;
        if (item.norm.includes(normText) && timeDiff < 4000) return true;
        if (normText.startsWith(item.norm) && timeDiff < 1800) return true;
      }
    }
    return false;
  }

  function registerSpokenText(normText) {
    if (!normText) return;
    recentSpokenHistory.push({ norm: normText, time: Date.now() });
    if (recentSpokenHistory.length > 25) recentSpokenHistory.shift();
  }

  function clearSpeechQueue() {
    currentSpeechToken++;
    sentenceQueue.forEach(item => {
      if (item.blobUrl) {
        try { URL.revokeObjectURL(item.blobUrl); } catch (e) {}
      }
    });
    sentenceQueue = [];
    isQueuePlaying = false;
    currentPlayingItem = null;
    if (masterAudioElement) {
      try {
        masterAudioElement.pause();
        masterAudioElement.removeAttribute('src');
        masterAudioElement.load();
      } catch (e) {}
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    setVideoVolume(1.0);
    updateNowReading('');
  }

  function stopAllSpeech() {
    clearSpeechQueue();
  }

  function playMasterAudio(url, rate, token, onDone) {
    if (token !== currentSpeechToken) {
      if (onDone) onDone();
      return;
    }

    if (!masterAudioElement) {
      masterAudioElement = new Audio();
      masterAudioElement.preservesPitch = true;
    } else {
      try {
        masterAudioElement.pause();
        masterAudioElement.removeAttribute('src');
        masterAudioElement.load();
      } catch (e) {}
    }

    masterAudioElement.playbackRate = rate;
    masterAudioElement.src = url;

    setVideoVolume(duckVolume);

    masterAudioElement.onended = () => {
      if (token === currentSpeechToken && onDone) onDone();
    };
    masterAudioElement.onerror = () => {
      if (token === currentSpeechToken && onDone) onDone();
    };

    masterAudioElement.play().catch((e) => {
      if (token === currentSpeechToken) {
        console.warn('[Piper MasterAudio Play error]', e);
        if (onDone) onDone();
      }
    });
  }

  function speakWebSpeechSingle(text, token, onDone) {
    if (token !== currentSpeechToken) {
      if (onDone) onDone();
      return;
    }
    if (!('speechSynthesis' in window)) {
      if (onDone) onDone();
      return;
    }
    
    try { window.speechSynthesis.cancel(); } catch (e) {}
    
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    u.rate = speechRate;
    u.onstart = () => {
      if (token === currentSpeechToken) setVideoVolume(duckVolume);
    };
    u.onend = () => {
      if (token === currentSpeechToken && onDone) onDone();
    };
    u.onerror = () => {
      if (token === currentSpeechToken && onDone) onDone();
    };
    window.speechSynthesis.speak(u);
  }

  async function processSentenceQueue() {
    if (!enabled || (!liveListenMode && !liveSttMode)) {
      if (isQueuePlaying) clearSpeechQueue();
      return;
    }

    if (isQueuePlaying) {
      return;
    }

    if (sentenceQueue.length === 0) {
      setVideoVolume(1.0);
      updateNowReading('');
      return;
    }

    const item = sentenceQueue[0];
    if (!item.ready && !item.failed) {
      // Czekamy na pre-fetch / tłumaczenie
      return;
    }

    isQueuePlaying = true;
    currentPlayingItem = item;
    const token = ++currentSpeechToken;

    const spokenText = item.translated || item.raw;
    updateNowReading(`${item.sourceTag} ${spokenText}`);

    const onSentenceDone = () => {
      if (token !== currentSpeechToken) return;
      if (item.blobUrl) {
        try { URL.revokeObjectURL(item.blobUrl); } catch (e) {}
      }
      const idx = sentenceQueue.indexOf(item);
      if (idx !== -1) sentenceQueue.splice(idx, 1);
      isQueuePlaying = false;
      currentPlayingItem = null;
      if (sentenceQueue.length === 0) {
        setVideoVolume(videoVolume);
        updateNowReading('');
      }
      processSentenceQueue();
    };

    if (item.blobUrl) {
      playMasterAudio(item.blobUrl, speechRate, token, onSentenceDone);
    } else if (spokenText) {
      speakWebSpeechSingle(spokenText, token, onSentenceDone);
    } else {
      onSentenceDone();
    }
  }

  function startLiveListening() {
    liveListenMode = !liveListenMode;
    syncMode = false;
    stopSyncSource();
    stopAllSpeech();
    updateUIState();
    
    if (liveListenMode) {
      if (!enabled) toggleLektor();
      initLiveObserver();
      hookAllVideoTextTracks();
      updateProgress('🎧 Aktywny nasłuch napisów w czasie rzeczywistym');
    } else {
      if (liveObserver) {
        liveObserver.disconnect();
        liveObserver = null;
      }
      updateProgress('');
    }
  }

  function toggleLiveStt() {
    liveSttMode = !liveSttMode;
    updateUIState();
    if (liveSttMode) {
      if (!enabled) toggleLektor();
      startWebSpeechRecognition();
      updateProgress('🎙️ Aktywny nasłuch mowy (STT) z audio filmu...');
    } else {
      stopWebSpeechRecognition();
      updateProgress(liveListenMode ? '🎧 Aktywny nasłuch napisów' : '');
    }
  }

  function startWebSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Twoja przeglądarka nie obsługuje Web Speech Recognition.');
      liveSttMode = false;
      updateUIState();
      return;
    }

    try {
      if (liveSpeechRecognition) liveSpeechRecognition.stop();
    } catch (e) {}

    liveSpeechRecognition = new SpeechRecognition();
    liveSpeechRecognition.continuous = true;
    liveSpeechRecognition.interimResults = false;
    liveSpeechRecognition.lang = 'en-US';

    liveSpeechRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const spoken = event.results[i][0].transcript.trim();
          if (spoken) {
            handleLiveDetectedText(spoken, '🎙️ [Mowa/STT]');
          }
        }
      }
    };

    liveSpeechRecognition.onerror = (err) => {
      console.warn('[Piper STT]', err);
    };

    liveSpeechRecognition.onend = () => {
      if (liveSttMode && enabled) {
        try { liveSpeechRecognition.start(); } catch (e) {}
      }
    };

    try {
      liveSpeechRecognition.start();
    } catch (e) {}
  }

  function stopWebSpeechRecognition() {
    if (liveSpeechRecognition) {
      try { liveSpeechRecognition.stop(); } catch (e) {}
      liveSpeechRecognition = null;
    }
  }

  function scheduleScanSubtitles() {
    if (domScanDebounceTimer) clearTimeout(domScanDebounceTimer);
    domScanDebounceTimer = setTimeout(scanSubtitlesFromDOM, 40);
  }

  function initLiveObserver() {
    if (liveObserver) return;
    liveObserver = new MutationObserver((mutations) => {
      if (!enabled || !liveListenMode) return;
      for (const m of mutations) {
        if (m.type === 'childList' || m.type === 'characterData') {
          scheduleScanSubtitles();
          break;
        }
      }
    });

    const target = document.querySelector('#movie_player') ||
                   document.querySelector('.watch-video--player') ||
                   document.querySelector('.player-container') ||
                   document.querySelector('#dv-web-player') ||
                   document.querySelector('.webPlayerContainer') ||
                   document.body;

    if (target) {
      liveObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  function hookAllVideoTextTracks() {
    document.querySelectorAll('video').forEach(video => {
      if (hookedVideos.has(video)) return;
      hookedVideos.add(video);

      video.addEventListener('seeked', () => {
        if (liveListenMode || liveSttMode) clearSpeechQueue();
      });

      video.addEventListener('pause', () => {
        if (masterAudioElement && !masterAudioElement.paused) {
          try { masterAudioElement.pause(); } catch(e) {}
        }
      });

      video.addEventListener('play', () => {
        if (masterAudioElement && masterAudioElement.paused && masterAudioElement.src) {
          masterAudioElement.play().catch(() => {});
        }
      });

      if (video.textTracks) {
        const handleCueChange = (track) => {
          if (!enabled || !liveListenMode) return;
          const activeCues = track.activeCues;
          if (activeCues && activeCues.length) {
            lastTextTrackTime = Date.now();
            for (let i = 0; i < activeCues.length; i++) {
              const cueText = cleanSubtitleText(activeCues[i].text);
              if (cueText) handleLiveDetectedText(cueText, '⚡ [TextTrack]');
            }
          }
        };

        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          track.oncuechange = () => handleCueChange(track);
        }

        video.textTracks.onaddtrack = (e) => {
          if (e.track) e.track.oncuechange = () => handleCueChange(e.track);
        };
      }
    });
  }

  function scanSubtitlesFromDOM() {
    if (!enabled || !liveListenMode) return;

    // Jeżeli natywny textTrack właśnie dostarczył napis (w ciągu ostatnich 800ms), nie dubluj go z DOM
    if (Date.now() - lastTextTrackTime < 800) {
      return;
    }

    // 1. Priorytet: Immersive Translate (jeśli obecny, wyciągnij wyłącznie przetłumaczony polski tekst)
    for (const selector of IMMERSIVE_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length) {
        const texts = Array.from(elements)
          .map(el => el.innerText || el.textContent || '')
          .map(t => cleanSubtitleText(t))
          .filter(t => t.length > 0);
        if (texts.length) {
          handleLiveDetectedText(texts.join(' '), '🌐 [Immersive]');
          return;
        }
      }
    }

    // 2. Standardowe selektory (w tym iQIYI)
    for (const selector of SUBTITLE_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length) {
        const texts = Array.from(elements)
          .map(el => el.innerText || el.textContent || '')
          .map(t => cleanSubtitleText(t))
          .filter(t => t.length > 0);

        if (texts.length) {
          const fullText = texts.join(' ');
          handleLiveDetectedText(fullText, '👁️ [Ekran]');
          break;
        }
      }
    }
  }

  function handleLiveDetectedText(rawText, sourceTag = '') {
    if (!enabled || (!liveListenMode && !liveSttMode)) return;

    const cleaned = cleanSubtitleText(rawText);
    if (!cleaned || cleaned.length < 2) return;

    const norm = normalizeForDeduplication(cleaned);
    if (!norm || norm.length < 2) return;

    if (isDuplicateOrSubstring(norm)) {
      return;
    }

    if (sentenceQueue.some(item => item.norm === norm)) {
      return;
    }

    registerSpokenText(norm);

    // Ograniczenie bufora do MAX_QUEUE_SIZE (3 zdań)
    if (sentenceQueue.length >= MAX_QUEUE_SIZE) {
      if (sentenceQueue.length > 1) {
        const removed = sentenceQueue.pop();
        if (removed && removed.blobUrl) {
          try { URL.revokeObjectURL(removed.blobUrl); } catch (e) {}
        }
      }
    }

    const item = {
      id: ++currentSentenceId,
      raw: cleaned,
      norm: norm,
      sourceTag: sourceTag,
      translated: '',
      blobUrl: null,
      ready: false,
      failed: false
    };

    sentenceQueue.push(item);

    // Asynchroniczne tłumaczenie i synteza w tle
    (async () => {
      try {
        let finalText = item.raw;
        if (translateEnabled) {
          finalText = await translateWithRetry(item.raw);
        }
        item.translated = censorText(finalText) || finalText;
        if (isPiperOnline && item.translated) {
          try {
            const blob = await requestPiper(item.translated);
            item.blobUrl = URL.createObjectURL(blob);
          } catch (e) {
            // fallback do Web Speech
          }
        }
      } catch (e) {
        item.failed = true;
      } finally {
        item.ready = true;
        processSentenceQueue();
      }
    })();

    processSentenceQueue();
  }

  function toggleLektor() {
    enabled = !enabled;
    if (enabled) {
      setVideoVolume(duckVolume);
      if (!syncMode && !liveListenMode && !liveSttMode) {
        startLiveListening();
      }
    } else {
      stopSyncSource();
      stopAllSpeech();
      setVideoVolume(1.0);
      updateNowReading('');
    }
    try {
      chrome.storage.local.set({ lektorEnabled: enabled });
    } catch (e) {}
    updateUIState();
  }

  // ==========================================================
  // PEŁNY PŁYWAJĄCY PANEL KONTROLNY NA EKRANIE (GUI)
  // ==========================================================
  let isPanelExpanded = true;

  function ensureUI() {
    if (!document.body) return;
    let box = document.getElementById('piper-chrome-lektor-overlay');
    if (box) return;

    box = document.createElement('div');
    box.id = 'piper-chrome-lektor-overlay';
    box.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 75px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      background: rgba(18, 18, 22, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 10px;
      gap: 7px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 1px rgba(255,255,255,0.2);
      color: #f4f4f5;
      font-size: 11px;
      width: 250px;
      backdrop-filter: blur(10px);
      transition: all 0.2s ease;
      user-select: none;
    `;

    box.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 2px;">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: bold; font-size: 12px; color: #38bdf8;">
          <span>🎙️ Piper Lektor</span>
          <span id="piper-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444; display: inline-block;" title="Status serwera Piper"></span>
        </div>
        <button id="piper-min-btn" style="background: transparent; border: none; color: #a1a1aa; cursor: pointer; font-size: 12px; padding: 2px 4px;">▼</button>
      </div>

      <div id="piper-panel-body" style="display: flex; flex-direction: column; gap: 6px;">
        <!-- Primary Action Buttons Row -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
          <button id="piper-main-toggle-btn" style="background: #27272a; color: #fff; border: 1px solid #3f3f46; border-radius: 7px; padding: 7px; font-weight: bold; font-size: 11px; cursor: pointer; transition: all 0.15s;">
            🔇 LEKTOR OFF
          </button>
          <button id="piper-hybrid-btn" style="background: #2563eb; color: #fff; border: none; border-radius: 7px; padding: 7px; font-weight: bold; font-size: 11px; cursor: pointer; transition: all 0.15s;" title="Zbuforuj cały film do IndexedDB">
            🚀 Hybryda
          </button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
          <button id="piper-live-btn" style="background: #18181b; color: #38bdf8; border: 1px solid #0284c7; border-radius: 6px; padding: 6px; font-size: 10px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;" title="Aktywny nasłuch napisów na żywo bez bufora">
            🎧 Od razu (Napisy)
          </button>
          <button id="piper-stt-btn" style="background: #18181b; color: #a1a1aa; border: 1px solid #3f3f46; border-radius: 6px; padding: 6px; font-size: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;" title="Nasłuchuj mowy audio STT dla filmów bez napisów">
            🎙️ Mowa (STT)
          </button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
          <label style="background: #18181b; color: #a1a1aa; border: 1px solid #3f3f46; border-radius: 6px; padding: 5px; font-size: 10px; font-weight: 600; cursor: pointer; text-align: center; display: block;" title="Wgraj plik z napisami .srt / .vtt">
            📄 Wgraj Plik
            <input type="file" id="piper-file-input" accept=".srt,.vtt,.ass,.json" style="display: none;" />
          </label>
          <button id="piper-censor-btn" style="background: #18181b; color: #10b981; border: 1px solid #3f3f46; border-radius: 6px; padding: 5px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Włącznik filtrowania wulgaryzmów">
            🤬 Cenzura
          </button>
        </div>

        <!-- Przełącznik Tłumacz vs Immersive Direct -->
        <button id="piper-translate-mode-btn" style="background: #1e1b4b; color: #c7d2fe; border: 1px solid #4338ca; border-radius: 6px; padding: 5px; font-size: 10px; font-weight: 700; cursor: pointer; transition: all 0.15s;" title="Przełącznik: Tłumacz Google vs Bezpośredni odczyt napisów PL (Immersive Translate / iQIYI)">
          🌐 Tłumacz Google: WŁ
        </button>

        <!-- Voice Selection -->
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: #a1a1aa;">
            <span>Głos lektora:</span>
            <span id="piper-voice-badge" style="color: #38bdf8; font-weight: bold;">Gosia</span>
          </div>
          <select id="piper-voice-dropdown" style="background: #27272a; color: #fff; border: 1px solid #3f3f46; border-radius: 6px; padding: 4px 6px; font-size: 11px; outline: none; cursor: pointer;">
            ${AVAILABLE_VOICES.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}
          </select>
        </div>

        <!-- Speed & Ducking Sliders -->
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.03); padding: 5px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: #a1a1aa;">
            <span>Prędkość mowy:</span>
            <span id="piper-speed-val" style="color: #fff; font-weight: bold;">1.0x</span>
          </div>
          <input type="range" id="piper-speed-slider" min="0.7" max="1.8" step="0.05" value="1.0" style="width: 100%; height: 3px; cursor: pointer;" />

          <div style="display: flex; justify-content: space-between; font-size: 10px; color: #a1a1aa; margin-top: 2px;">
            <span>Głośność w mowie:</span>
            <span id="piper-duck-val" style="color: #38bdf8; font-weight: bold;">50%</span>
          </div>
          <input type="range" id="piper-duck-slider" min="0.0" max="0.8" step="0.05" value="0.50" style="width: 100%; height: 3px; cursor: pointer;" />
        </div>

        <!-- Progress and Status -->
        <div id="piper-progress-status" style="font-size: 10px; color: #38bdf8; min-height: 14px; font-weight: 500;"></div>
        <div id="piper-now-reading-box" style="font-size: 10px; color: #e4e4e7; background: #09090b; padding: 4px 6px; border-radius: 5px; border-left: 2px solid #38bdf8; max-height: 36px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: none;"></div>
      </div>
    `;

    document.body.appendChild(box);

    // Event listeners
    const mainBtn = document.getElementById('piper-main-toggle-btn');
    const hybridBtn = document.getElementById('piper-hybrid-btn');
    const liveBtn = document.getElementById('piper-live-btn');
    const sttBtn = document.getElementById('piper-stt-btn');
    const censorBtn = document.getElementById('piper-censor-btn');
    const transBtn = document.getElementById('piper-translate-mode-btn');
    const voiceDropdown = document.getElementById('piper-voice-dropdown');
    const speedSlider = document.getElementById('piper-speed-slider');
    const duckSlider = document.getElementById('piper-duck-slider');
    const fileInput = document.getElementById('piper-file-input');
    const minBtn = document.getElementById('piper-min-btn');
    const panelBody = document.getElementById('piper-panel-body');

    mainBtn.addEventListener('click', toggleLektor);
    hybridBtn.addEventListener('click', prepareWholeVideo);
    liveBtn.addEventListener('click', startLiveListening);
    sttBtn.addEventListener('click', toggleLiveStt);
    censorBtn.addEventListener('click', () => {
      filterEnabled = !filterEnabled;
      censorBtn.style.color = filterEnabled ? '#10b981' : '#71717a';
      censorBtn.textContent = filterEnabled ? '🤬 Cenzura' : '😶 Bez cenz.';
      try { chrome.storage.local.set({ filterEnabled }); } catch (e) {}
    });

    transBtn.addEventListener('click', () => {
      translateEnabled = !translateEnabled;
      try { chrome.storage.local.set({ translateEnabled }); } catch (e) {}
      updateUIState();
      if (liveListenMode) {
        updateProgress(translateEnabled ? '🎧 Nasłuch (Tłumaczenie WŁ)' : '⚡ Immersive (Bez tłum. - bezpośredni PL)');
      }
    });

    voiceDropdown.value = selectedVoice;
    voiceDropdown.addEventListener('change', () => {
      selectedVoice = voiceDropdown.value;
      document.getElementById('piper-voice-badge').textContent = AVAILABLE_VOICES.find(v => v.id === selectedVoice)?.name || selectedVoice;
      try { chrome.storage.local.set({ selectedVoice }); } catch (e) {}
      if (syncMode) prepareWholeVideo();
    });

    speedSlider.value = speechRate;
    speedSlider.addEventListener('input', () => {
      speechRate = parseFloat(speedSlider.value);
      document.getElementById('piper-speed-val').textContent = speechRate.toFixed(2) + 'x';
      try { chrome.storage.local.set({ speechRate }); } catch (e) {}
    });

    duckSlider.value = duckVolume;
    duckSlider.addEventListener('input', () => {
      duckVolume = parseFloat(duckSlider.value);
      document.getElementById('piper-duck-val').textContent = Math.round(duckVolume * 100) + '%';
      if (enabled) setVideoVolume(duckVolume);
      try { chrome.storage.local.set({ duckVolume }); } catch (e) {}
    });

    minBtn.addEventListener('click', () => {
      isPanelExpanded = !isPanelExpanded;
      panelBody.style.display = isPanelExpanded ? 'flex' : 'none';
      minBtn.textContent = isPanelExpanded ? '▼' : '▲';
      box.style.width = isPanelExpanded ? '250px' : '170px';
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      updateProgress(`Wczytywanie pliku ${file.name}...`);
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      const segs = [];
      let curStart = 0;
      let curDur = 2;
      let curText = [];
      for (const line of lines) {
        if (line.includes('-->')) {
          const parts = line.split('-->');
          const parseTime = (t) => {
            const p = t.trim().replace(',', '.').split(':');
            return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
          };
          try {
            curStart = parseTime(parts[0]);
            curDur = Math.max(parseTime(parts[1]) - curStart, 0.5);
          } catch (e) {}
        } else if (line.trim() && !/^\d+$/.test(line.trim())) {
          curText.push(line.trim());
        } else if (!line.trim() && curText.length > 0) {
          segs.push({ text: curText.join(' '), start: curStart, duration: curDur });
          curText = [];
        }
      }
      if (curText.length > 0) {
        segs.push({ text: curText.join(' '), start: curStart, duration: curDur });
      }
      if (segs.length > 0) {
        const videoId = getVideoId() || 'uploaded_subtitles';
        const key = videoId + '::' + selectedVoice;
        await prepareHybridStreaming(key, segs, videoId);
      } else {
        alert('Nie udało się sparsować napisów z pliku.');
      }
    });

    checkPiperHealth();
    updateUIState();
  }

  function updateStatusDot() {
    const dot = document.getElementById('piper-status-dot');
    if (dot) {
      dot.style.background = isPiperOnline ? '#10b981' : '#ef4444';
      dot.title = isPiperOnline ? 'Serwer Piper 8765 jest aktywny i połączony' : 'Serwer Piper 8765 jest offline (użyj Web Speech lub uruchom serwer)';
    }
  }

  function updateProgress(text) {
    const el = document.getElementById('piper-progress-status');
    if (el) el.textContent = text || '';
  }

  function updateNowReading(text) {
    const box = document.getElementById('piper-now-reading-box');
    if (box) {
      if (text) {
        box.style.display = 'block';
        box.textContent = '▶️ ' + text;
      } else {
        box.style.display = 'none';
      }
    }
  }

  function updateUIState() {
    const mainBtn = document.getElementById('piper-main-toggle-btn');
    const liveBtn = document.getElementById('piper-live-btn');
    const sttBtn = document.getElementById('piper-stt-btn');
    const transBtn = document.getElementById('piper-translate-mode-btn');
    if (mainBtn) {
      if (enabled) {
        mainBtn.textContent = '🔊 LEKTOR ON';
        mainBtn.style.background = '#059669';
        mainBtn.style.borderColor = '#10b981';
        mainBtn.style.color = '#fff';
      } else {
        mainBtn.textContent = '🔇 LEKTOR OFF';
        mainBtn.style.background = '#27272a';
        mainBtn.style.borderColor = '#3f3f46';
        mainBtn.style.color = '#fff';
      }
    }
    if (transBtn) {
      if (translateEnabled) {
        transBtn.textContent = '🌐 Tłumacz Google: WŁ';
        transBtn.style.color = '#c7d2fe';
        transBtn.style.borderColor = '#4338ca';
        transBtn.style.background = '#1e1b4b';
      } else {
        transBtn.textContent = '⚡ Bez tłum. (Immersive/PL)';
        transBtn.style.color = '#6ee7b7';
        transBtn.style.borderColor = '#059669';
        transBtn.style.background = '#064e3b';
      }
    }
    if (liveBtn) {
      liveBtn.style.borderColor = liveListenMode ? '#38bdf8' : '#3f3f46';
      liveBtn.style.color = liveListenMode ? '#38bdf8' : '#a1a1aa';
      liveBtn.style.background = liveListenMode ? '#0c4a6e' : '#18181b';
    }
    if (sttBtn) {
      sttBtn.style.borderColor = liveSttMode ? '#a855f7' : '#3f3f46';
      sttBtn.style.color = liveSttMode ? '#d8b4fe' : '#a1a1aa';
      sttBtn.style.background = liveSttMode ? '#581c87' : '#18181b';
    }
  }

  setInterval(() => {
    if (syncMode && enabled) syncTick(document.querySelector('video'));
    if (liveListenMode && enabled) {
      scanSubtitlesFromDOM();
      hookAllVideoTextTracks();
    }
  }, 100);

  setInterval(checkPiperHealth, 5000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI);
  } else {
    ensureUI();
  }
})();
