import React, { useState } from 'react';
import { Code2, Copy, Check } from 'lucide-react';

interface TampermonkeyCompanionProps {
  serverStatus: boolean;
}

export const TampermonkeyCompanion: React.FC<TampermonkeyCompanionProps> = () => {
  const [copied, setCopied] = useState(false);

  const FULL_USERSCRIPT_CODE = `// ==UserScript==
// @name        Wszystkie serwisy w locie Piper (8765) + Multi-Voice Lektor
// @namespace   http://tampermonkey.net/
// @version     2.6.0
// @description Polski Lektor w locie (Piper 8765 / Web Speech) z buforem 3 zdań, syntezą wielogłosową, filtrem wulgaryzmów i pływającym GUI dla wszystkich serwisów wideo (Prime Video, Netflix, YouTube, CDA, Disney, Max itp.).
// @author      Fix / Asystent AI
// @match       *://*.youtube.com/*
// @match       *://*.netflix.com/*
// @match       *://*.primevideo.com/*
// @match       *://*.amazon.*/*
// @match       *://*.cda.pl/*
// @match       *://*.iq.com/*
// @match       *://*.iqiyi.com/*
// @match       *://*.hbomax.com/*
// @match       *://*.max.com/*
// @match       *://*.disneyplus.com/*
// @match       *://*/*
// @grant       GM_xmlhttpRequest
// @connect     127.0.0.1
// @connect     localhost
// @connect     translate.googleapis.com
// @run-at      document-start
// ==/UserScript==

(function () {
    'use strict';

    if (window.__PIPER_UNIFIED_LEKTOR_RUNNING__) {
        console.warn('[Piper Unified] Skrypt lektora jest już aktywny.');
        return;
    }
    window.__PIPER_UNIFIED_LEKTOR_RUNNING__ = true;

    const TTS_URL = 'http://127.0.0.1:8765/tts';
    const HEALTH_URL = 'http://127.0.0.1:8765/health';
    const VOICES_URL = 'http://127.0.0.1:8765/voices';
    const PARALLEL_WORKERS = 8;

    const AVAILABLE_VOICES = [
        { id: 'gosia', name: 'Gosia (K)' },
        { id: 'jarvis', name: 'Jarvis (M)' },
        { id: 'bass', name: 'Bass (Niski)' },
        { id: 'justyna', name: 'Justyna (K)' },
        { id: 'meski', name: 'Męski WG' },
        { id: 'zenski', name: 'Żeński WG' },
        { id: 'janusz', name: 'Janusz (Kinowy)' }
    ];

    let selectedVoice = localStorage.getItem('piperVoice') || 'gosia';
    const SPEECH_RATE = 1.0;
    const VIDEO_VOLUME = 1.0;
    let duckVolume = parseFloat(localStorage.getItem('piperDuckVolume')) || 0.50;
    let translateEnabled = localStorage.getItem('piperTranslateEnabled') !== 'false';

    let enabled = false;
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
    let liveListenMode = false;
    let liveSttMode = false;

    // ==========================================================
    // SMART 3-SENTENCE BUFFER QUEUE
    // ==========================================================
    const MAX_QUEUE_SIZE = 3;
    let sentenceQueue = [];
    let isQueuePlaying = false;
    let currentSentenceId = 0;
    let currentSpeechToken = 0;
    let masterAudioElement = null;
    let liveSpeechRecognition = null;
    let liveObserver = null;
    let hookedVideos = new WeakSet();
    let domScanDebounceTimer = null;
    let lastTextTrackTime = 0;
    const recentSpokenHistory = [];

    let isPanelMinimized = localStorage.getItem('piperPanelMin') === 'true';

    const translationCache = new Map();

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==========================================================
    // AGRESYWNY FILTR WULGARYZMÓW + WŁASNE SŁOWA
    // ==========================================================
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

    let filterEnabled = localStorage.getItem('piperFilterEnabled') !== 'false';
    let filterMode = localStorage.getItem('piperFilterMode') || 'remove';
    let customProfanity = [];
    try { customProfanity = JSON.parse(localStorage.getItem('piperCustomProfanity') || '[]'); } catch (e) { customProfanity = []; }

    function saveCustomProfanity() {
        localStorage.setItem('piperCustomProfanity', JSON.stringify(customProfanity));
    }

    function cleanSubtitleText(text) {
        if (!text) return '';
        return String(text)
            .replace(/\\{[^}]*\\}/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\\\\N/gi, ' ')
            .replace(/\\\\n/gi, ' ')
            .replace(/\\s+\\d{1,4}\\s*$/, '')
            .replace(/\\b\\d{1,4}\\b(?=\\s*[.,!?]|$)/g, '')
            .replace(/\\s+/g, ' ')
            .trim();
    }

    function censorText(text) {
        if (!filterEnabled || !text) return text;
        const fullList = PROFANITY_LIST.concat(customProfanity);
        if (!fullList.length) return text;
        let result = text;
        const pattern = new RegExp('(' + fullList.map(w => w.replace(/[.*+?^$\{}()|[\\]\\\\]/g, '\\\\$&')).join('|') + ')', 'gi');
        switch(filterMode) {
            case 'remove': result = result.replace(pattern, ''); break;
            case 'beep': result = result.replace(pattern, '[BEEP]'); break;
            case 'cenzura': result = result.replace(pattern, 'cenzura'); break;
            case 'replace':
            default:
                result = result.replace(pattern, (match) => match[0] + '*'.repeat(match.length - 1));
                break;
        }
        return cleanSubtitleText(result);
    }

    function looksLikePolish(text) {
        if (!text) return false;
        if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return true;
        const words = text.toLowerCase().split(/\\s+/);
        const commonPl = ['nie', 'się', 'jest', 'jak', 'tak', 'ale', 'dla', 'jestem', 'jesteś', 'być', 'był', 'była', 'może', 'tylko', 'przez', 'gdzie', 'kiedy', 'dlaczego', 'dobrze', 'cześć', 'proszę', 'dzięki', 'tutaj', 'tam', 'teraz', 'zawsze', 'nigdy', 'wiem', 'chcę', 'muszę', 'pan', 'pani'];
        let plHits = 0;
        for (const w of words) {
            const clean = w.replace(/[^a-z]/g, '');
            if (commonPl.includes(clean)) plHits++;
        }
        return plHits >= 1;
    }

    // ==========================================================
    // SZYBKIE TŁUMACZENIE GOOGLE TRANSLATE
    // ==========================================================
    function translate(text) {
        if (looksLikePolish(text)) return Promise.resolve(text);
        return new Promise((resolve) => {
            const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pl&dt=t&q=' + encodeURIComponent(text);
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 2000,
                onload(response) {
                    try {
                        if (response.status < 200 || response.status >= 300) { resolve(text); return; }
                        const data = JSON.parse(response.responseText);
                        let result = '';
                        if (Array.isArray(data[0])) {
                            for (const part of data[0]) {
                                if (Array.isArray(part) && part[0]) result += part[0];
                            }
                        }
                        result = cleanSubtitleText(result) || text;
                        resolve(result);
                    } catch (e) { resolve(text); }
                },
                onerror() { resolve(text); },
                ontimeout() { resolve(text); }
            });
        });
    }

    async function translateWithRetry(text) {
        if (!text) return '';
        if (looksLikePolish(text)) return text;
        if (translationCache.has(text)) return translationCache.get(text);
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const result = await translate(text);
                if (result) {
                    translationCache.set(text, result);
                    return result;
                }
            } catch (e) {
                if (attempt < 2) await sleep(200);
            }
        }
        return text;
    }

    function setVideoVolume(v) {
        document.querySelectorAll('video').forEach(video => {
            try { video.volume = v; } catch (e) {}
        });
    }

    function ensureAudioCtx() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function stopSyncSource() {
        if (curSyncAudio) {
            try { curSyncAudio.stop(); } catch (e) {}
            try { curSyncAudio.disconnect(); } catch (e) {}
            curSyncAudio = null;
        }
        curSyncUrl = null;
        curSyncIdx = null;
        setVideoVolume(VIDEO_VOLUME);
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
        setVideoVolume(VIDEO_VOLUME);
        updateNowReadingLabel('');
        updateBufferBadge();
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
        u.rate = SPEECH_RATE;
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
            updateBufferBadge();
            return;
        }

        if (sentenceQueue.length === 0) {
            setVideoVolume(VIDEO_VOLUME);
            updateNowReadingLabel('');
            updateBufferBadge();
            return;
        }

        const item = sentenceQueue[0];
        if (!item.ready && !item.failed) {
            updateBufferBadge();
            return;
        }

        isQueuePlaying = true;
        updateBufferBadge();
        const token = ++currentSpeechToken;

        const spokenText = item.translated || item.raw;
        updateNowReadingLabel(item.sourceTag + ' ' + spokenText);

        const onSentenceDone = () => {
            if (token !== currentSpeechToken) return;
            if (item.blobUrl) {
                try { URL.revokeObjectURL(item.blobUrl); } catch (e) {}
            }
            const idx = sentenceQueue.indexOf(item);
            if (idx !== -1) sentenceQueue.splice(idx, 1);
            isQueuePlaying = false;
            if (sentenceQueue.length === 0) {
                setVideoVolume(VIDEO_VOLUME);
                updateNowReadingLabel('');
            }
            updateBufferBadge();
            processSentenceQueue();
        };

        if (item.blobUrl) {
            playMasterAudio(item.blobUrl, SPEECH_RATE, token, onSentenceDone);
        } else if (spokenText) {
            speakWebSpeechSingle(spokenText, token, onSentenceDone);
        } else {
            onSentenceDone();
        }
    }

    function normalizeForDeduplication(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .replace(/\\[.*?\\]|\\(.*?\\)|♪/g, '')
            .replace(/[^a-ząćęłńóśźż0-9]/gi, '')
            .trim();
    }

    function isDuplicateOrSubstring(normText) {
        if (!normText || normText.length < 2) return true;
        const now = Date.now();
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

    function updateNowReadingLabel(text) {
        const el = document.getElementById('piper-8765-now-reading');
        if (el) el.textContent = text || '';
    }

    function setPrepareStatus(text) {
        const el = document.getElementById('piper-8765-prepare-status');
        if (el) el.textContent = text || '';
    }

    function updateBufferBadge() {
        const badge = document.getElementById('piper-8765-buffer-badge');
        if (badge) {
            const count = sentenceQueue.length;
            badge.textContent = '📥 Bufor: ' + count + '/' + MAX_QUEUE_SIZE + (isQueuePlaying ? ' (Gra 🔊)' : ' (Czeka)');
            badge.style.color = count > 0 ? '#38bdf8' : '#71717a';
        }
    }

    // ==========================================================
    // LIVE AUDIO OBSERWACJA NAPISÓW & IMMERSIVE TRANSLATE
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
        // Prime Video / Amazon
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

    function startLiveListening() {
        liveListenMode = !liveListenMode;
        syncMode = false;
        stopSyncSource();
        clearSpeechQueue();
        ensureUI();

        if (liveListenMode) {
            if (!enabled) toggleLektor();
            initLiveObserver();
            hookAllVideoTextTracks();
            setPrepareStatus(translateEnabled ? '🎧 Aktywny nasłuch (Tłumaczenie WŁ)' : '⚡ Immersive (Bez tłum. - bezpośredni PL)');
        } else {
            if (liveObserver) {
                liveObserver.disconnect();
                liveObserver = null;
            }
            setPrepareStatus('');
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
                       document.querySelector('.iqp-player') ||
                       document.querySelector('[class*="player"]') ||
                       document.body;
        if (target) {
            liveObserver.observe(target, { childList: true, subtree: true, characterData: true });
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
        if (Date.now() - lastTextTrackTime < 800) return;

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

        if (isDuplicateOrSubstring(norm)) return;

        if (sentenceQueue.some(item => item.norm === norm)) return;

        registerSpokenText(norm);

        // Bufor do MAX_QUEUE_SIZE (3 zdań)
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
        updateBufferBadge();

        (async () => {
            try {
                // Gdy translateEnabled jest wyłączone (Tryb Immersive / Czysty Polski), pomiń Google Translate!
                let finalText = item.raw;
                if (translateEnabled) {
                    finalText = await translateWithRetry(item.raw);
                }
                item.translated = censorText(finalText) || finalText;
                if (item.translated) {
                    try {
                        const blob = await requestPiper(item.translated);
                        item.blobUrl = URL.createObjectURL(blob);
                    } catch (err) {
                        // fallback to Web Speech
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

    // ==========================================================
    // HYBRYDOWY PRE-FETCH CAŁEGO FILMU
    // ==========================================================
    async function prepareWholeVideo() {
        if (preparing) return;
        const video = document.querySelector('video');
        if (!video) {
            alert('Nie znaleziono aktywnego odtwarzacza wideo!');
            return;
        }

        preparing = true;
        setPrepareStatus('⏳ Szukanie napisów filmu...');

        let tracks = [];
        if (video.textTracks && video.textTracks.length) {
            for (let i = 0; i < video.textTracks.length; i++) {
                const t = video.textTracks[i];
                if (t.cues && t.cues.length) tracks.push(t);
            }
        }

        let cuesToProcess = [];
        if (tracks.length > 0) {
            const selectedTrack = tracks.find(t => t.language && t.language.startsWith('pl')) ||
                                  tracks.find(t => t.language && t.language.startsWith('en')) ||
                                  tracks[0];
            for (let i = 0; i < selectedTrack.cues.length; i++) {
                const c = selectedTrack.cues[i];
                const text = cleanSubtitleText(c.text);
                if (text) cuesToProcess.push({ start: c.startTime, end: c.endTime, text });
            }
        }

        if (!cuesToProcess.length) {
            setPrepareStatus('⚠️ Brak wczytanych napisów. Włącz napisy w playerze!');
            preparing = false;
            return;
        }

        setPrepareStatus('⚡ Generowanie ' + cuesToProcess.length + ' kwestii lektora (Piper 8765)...');

        let generatedBlobs = [];
        let completed = 0;

        async function worker(queue) {
            while (queue.length > 0) {
                const task = queue.shift();
                if (!task) break;
                try {
                    let translated = await translateWithRetry(task.text);
                    translated = censorText(translated) || translated;
                    const blob = await requestPiper(translated);
                    generatedBlobs[task.index] = blob;
                } catch (e) {
                    console.warn('[Sync prefetch error]', task.index, e);
                }
                completed++;
                setPrepareStatus('⚡ Gotowe: ' + completed + '/' + cuesToProcess.length);
            }
        }

        const taskQueue = cuesToProcess.map((cue, index) => ({ ...cue, index }));
        const workers = [];
        for (let w = 0; w < PARALLEL_WORKERS; w++) {
            workers.push(worker(taskQueue));
        }
        await Promise.all(workers);

        syncSegments = cuesToProcess;
        syncBlobs = generatedBlobs;

        preparing = false;
        syncMode = true;
        liveListenMode = false;
        if (!enabled) toggleLektor();
        setPrepareStatus('✅ Hybryda gotowa! Lektor czyta z zerowym opóźnieniem.');
        ensureUI();
    }

    function syncTick(video) {
        if (!video || !syncMode || !syncSegments || !syncBlobs || !enabled) return;
        const curTime = video.currentTime;

        if (lastSyncTime >= 0 && Math.abs(curTime - lastSyncTime) > RESET_THRESHOLD_SECONDS) {
            stopSyncSource();
            lastPlayedIdx = -1;
        }
        lastSyncTime = curTime;

        let activeIdx = -1;
        for (let i = 0; i < syncSegments.length; i++) {
            const seg = syncSegments[i];
            if (curTime >= seg.start && curTime <= seg.end + 0.5) {
                activeIdx = i;
                break;
            }
        }

        if (activeIdx !== -1 && activeIdx !== lastPlayedIdx) {
            lastPlayedIdx = activeIdx;
            const blob = syncBlobs[activeIdx];
            if (blob) {
                stopSyncSource();
                const url = URL.createObjectURL(blob);
                curSyncUrl = url;
                curSyncIdx = activeIdx;
                playMasterAudio(url, SPEECH_RATE, ++currentSpeechToken, () => {
                    setVideoVolume(VIDEO_VOLUME);
                    updateNowReadingLabel('');
                });
                updateNowReadingLabel('🚀 [Hybryda] ' + syncSegments[activeIdx].text);
            }
        }
    }

    // ==========================================================
    // PŁYWAJĄCE GUI (ODPORNE NA FULLSCREEN I PRZEŁADOWANIA)
    // ==========================================================
    function ensureUI() {
        const rootContainer = document.fullscreenElement || document.body || document.documentElement;
        if (!rootContainer) return;

        let box = document.getElementById('piper-8765-ui-box');
        if (box && box.parentElement !== rootContainer) {
            rootContainer.appendChild(box);
        }

        if (!box) {
            box = document.createElement('div');
            box.id = 'piper-8765-ui-box';
            box.style.cssText = 'position:fixed;right:20px;bottom:85px;z-index:2147483647 !important;display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(18,18,24,0.96);border:1px solid #3b82f6;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.85);color:#fff;width:200px;user-select:none;backdrop-filter:blur(10px);pointer-events:auto;';
            
            // Header z drag & minimize
            const header = document.createElement('div');
            header.id = 'piper-8765-ui-header';
            header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;cursor:move;border-bottom:1px solid #27272a;padding-bottom:5px;';
            header.innerHTML = '<span style="font-size:11px;font-weight:bold;color:#60a5fa;display:flex;align-items:center;gap:4px;">🎙️ Piper Lektor</span>';
            
            const minBtn = document.createElement('button');
            minBtn.id = 'piper-8765-min-btn';
            minBtn.style.cssText = 'background:none;border:none;color:#a1a1aa;font-size:12px;font-weight:bold;cursor:pointer;padding:0 4px;';
            minBtn.textContent = isPanelMinimized ? '➕' : '➖';
            minBtn.addEventListener('click', () => {
                isPanelMinimized = !isPanelMinimized;
                localStorage.setItem('piperPanelMin', String(isPanelMinimized));
                updatePanelVisibility();
            });
            header.appendChild(minBtn);
            box.appendChild(header);

            // Container na zawartość
            const content = document.createElement('div');
            content.id = 'piper-8765-ui-content';
            content.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
            box.appendChild(content);

            // Głos select
            const select = document.createElement('select');
            select.id = 'piper-8765-voice-select';
            select.style.cssText = 'width:100%;height:24px;background:#27272a;color:#f4f4f5;border:1px solid #3f3f46;font:11px sans-serif;border-radius:6px;outline:none;padding:0 4px;';
            AVAILABLE_VOICES.forEach(v => {
                const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; select.appendChild(o);
            });
            select.value = selectedVoice;
            select.addEventListener('change', () => {
                selectedVoice = select.value;
                localStorage.setItem('piperVoice', selectedVoice);
            });
            content.appendChild(select);

            // Przycisk Lektor ON/OFF
            const btn = document.createElement('button');
            btn.id = 'piper-8765-lektor-button';
            btn.style.cssText = 'width:100%;height:28px;background:#1e3a8a;color:#fff;border:1px solid #3b82f6;font:bold 11px sans-serif;cursor:pointer;border-radius:6px;transition:all 0.15s;';
            btn.addEventListener('click', toggleLektor);
            content.appendChild(btn);

            // Przełącznik Tłumacz Google vs Immersive Translate / Bezpośredni PL
            const transBtn = document.createElement('button');
            transBtn.id = 'piper-8765-translate-mode-btn';
            transBtn.style.cssText = 'width:100%;height:22px;font:bold 10px sans-serif;cursor:pointer;border-radius:6px;transition:all 0.15s;';
            transBtn.addEventListener('click', () => {
                translateEnabled = !translateEnabled;
                localStorage.setItem('piperTranslateEnabled', String(translateEnabled));
                updateUIElements();
                if (liveListenMode) {
                    setPrepareStatus(translateEnabled ? '🎧 Nasłuch (Tłumaczenie WŁ)' : '⚡ Immersive (Bez tłum. - bezpośredni PL)');
                }
            });
            content.appendChild(transBtn);

            // Przyciski Trybów
            const row = document.createElement('div');
            row.id = 'piper-8765-btn-row';
            row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;';
            content.appendChild(row);

            const liveBtn = document.createElement('button');
            liveBtn.id = 'piper-8765-live-btn';
            liveBtn.style.cssText = 'height:24px;background:#0c4a6e;color:#38bdf8;border:1px solid #0284c7;font:bold 10px sans-serif;cursor:pointer;border-radius:6px;';
            liveBtn.textContent = '🎧 Na bieżąco';
            liveBtn.addEventListener('click', startLiveListening);
            row.appendChild(liveBtn);

            const prepBtn = document.createElement('button');
            prepBtn.id = 'piper-8765-prepare-button';
            prepBtn.style.cssText = 'height:24px;background:#1e1b4b;color:#a5b4fc;border:1px solid #4338ca;font:bold 10px sans-serif;cursor:pointer;border-radius:6px;';
            prepBtn.textContent = '🚀 Hybryda';
            prepBtn.addEventListener('click', prepareWholeVideo);
            row.appendChild(prepBtn);

            // Suwak Duckingu (Głośność w tle podczas mowy)
            const duckBox = document.createElement('div');
            duckBox.style.cssText = 'display:flex;flex-direction:column;gap:2px;background:#18181b;padding:4px 6px;border-radius:6px;border:1px solid #27272a;';
            
            const duckLabelRow = document.createElement('div');
            duckLabelRow.style.cssText = 'display:flex;justify-content:space-between;font:10px sans-serif;color:#a1a1aa;';
            duckLabelRow.innerHTML = '<span>Film w mowie:</span><span id="piper-8765-duck-val" style="color:#38bdf8;font-weight:bold;">' + Math.round(duckVolume * 100) + '%</span>';
            duckBox.appendChild(duckLabelRow);

            const duckSlider = document.createElement('input');
            duckSlider.type = 'range';
            duckSlider.min = '0.0';
            duckSlider.max = '0.8';
            duckSlider.step = '0.05';
            duckSlider.value = String(duckVolume);
            duckSlider.style.cssText = 'width:100%;height:3px;cursor:pointer;accent-color:#38bdf8;';
            duckSlider.addEventListener('input', () => {
                duckVolume = parseFloat(duckSlider.value);
                const valEl = document.getElementById('piper-8765-duck-val');
                if (valEl) valEl.textContent = Math.round(duckVolume * 100) + '%';
                localStorage.setItem('piperDuckVolume', String(duckVolume));
            });
            duckBox.appendChild(duckSlider);
            content.appendChild(duckBox);

            // Wskaźnik bufora 3 zdań
            const bufferBadge = document.createElement('div');
            bufferBadge.id = 'piper-8765-buffer-badge';
            bufferBadge.style.cssText = 'width:100%;color:#71717a;font:10px monospace;text-align:center;padding:2px 0;background:#18181b;border-radius:4px;border:1px solid #27272a;';
            bufferBadge.textContent = '📥 Bufor: 0/' + MAX_QUEUE_SIZE;
            content.appendChild(bufferBadge);

            const statusEl = document.createElement('div');
            statusEl.id = 'piper-8765-prepare-status';
            statusEl.style.cssText = 'width:100%;color:#38bdf8;font:10px sans-serif;min-height:12px;margin-top:2px;line-height:1.2;';
            content.appendChild(statusEl);

            const readingEl = document.createElement('div');
            readingEl.id = 'piper-8765-now-reading';
            readingEl.style.cssText = 'width:100%;color:#e4e4e7;font:9px sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-height:24px;';
            content.appendChild(readingEl);

            rootContainer.appendChild(box);

            // Obsługa przeciągania okna (Drag & Drop)
            let isDragging = false, startX, startY, origX, origY;
            header.addEventListener('mousedown', (e) => {
                if (e.target === minBtn) return;
                isDragging = true;
                startX = e.clientX; startY = e.clientY;
                const rect = box.getBoundingClientRect();
                origX = rect.left; origY = rect.top;
                e.preventDefault();
            });
            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                box.style.left = (origX + dx) + 'px';
                box.style.top = (origY + dy) + 'px';
                box.style.right = 'auto';
                box.style.bottom = 'auto';
            });
            window.addEventListener('mouseup', () => { isDragging = false; });
        }

        updateUIElements();
        updatePanelVisibility();
    }

    function updatePanelVisibility() {
        const content = document.getElementById('piper-8765-ui-content');
        const minBtn = document.getElementById('piper-8765-min-btn');
        const box = document.getElementById('piper-8765-ui-box');
        if (content && minBtn && box) {
            content.style.display = isPanelMinimized ? 'none' : 'flex';
            minBtn.textContent = isPanelMinimized ? '➕' : '➖';
            box.style.width = isPanelMinimized ? '130px' : '200px';
        }
    }

    function updateUIElements() {
        const btn = document.getElementById('piper-8765-lektor-button');
        if (btn) {
            btn.textContent = enabled ? '🔊 LEKTOR WŁĄCZONY' : '🔇 LEKTOR WYŁĄCZONY';
            btn.style.color = enabled ? '#10b981' : '#ffffff';
            btn.style.borderColor = enabled ? '#10b981' : '#52525b';
            btn.style.background = enabled ? '#064e3b' : '#27272a';
        }

        const transBtn = document.getElementById('piper-8765-translate-mode-btn');
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

        const liveBtn = document.getElementById('piper-8765-live-btn');
        if (liveBtn) {
            liveBtn.style.borderColor = liveListenMode ? '#38bdf8' : '#3f3f46';
            liveBtn.style.color = liveListenMode ? '#38bdf8' : '#a1a1aa';
            liveBtn.style.background = liveListenMode ? '#0c4a6e' : '#18181b';
        }

        const prepBtn = document.getElementById('piper-8765-prepare-button');
        if (prepBtn) {
            prepBtn.style.borderColor = syncMode ? '#818cf8' : '#3f3f46';
            prepBtn.style.color = syncMode ? '#c7d2fe' : '#a1a1aa';
            prepBtn.style.background = syncMode ? '#312e81' : '#18181b';
        }

        updateBufferBadge();
    }

    async function toggleLektor() {
        if (enabled) {
            enabled = false;
            stopSyncSource();
            clearSpeechQueue();
            setVideoVolume(VIDEO_VOLUME);
            updateUIElements();
            return;
        }

        enabled = true;
        ensureAudioCtx();
        setVideoVolume(DUCK_VOLUME);
        updateUIElements();
        if (!syncMode && !liveListenMode) {
            startLiveListening();
        }
    }

    function requestPiper(text) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: TTS_URL,
                headers: { 'Content-Type': 'application/json', 'Accept': 'audio/wav' },
                data: JSON.stringify({ text, voice: selectedVoice, speed: SPEECH_RATE }),
                responseType: 'blob',
                timeout: 30000,
                onload(res) {
                    if (res.status >= 200 && res.status < 300 && res.response && res.response.size > 100) resolve(res.response);
                    else reject(new Error('HTTP ' + res.status));
                },
                onerror() { reject(new Error('Offline')); },
                ontimeout() { reject(new Error('Timeout')); }
            });
        });
    }

    setInterval(() => {
        if (syncMode && enabled) syncTick(document.querySelector('video'));
        if (liveListenMode && enabled) {
            scanSubtitlesFromDOM();
            hookAllVideoTextTracks();
        }
        ensureUI();
    }, 1000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureUI);
    } else {
        ensureUI();
    }
})();`;

  const handleCopy = () => {
    navigator.clipboard.writeText(FULL_USERSCRIPT_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 text-purple-800 text-xs font-semibold border border-purple-200">
            <Code2 className="w-3.5 h-3.5" />
            Zunifikowany Skrypt Tampermonkey (Wszystko w Jednym)
          </div>
          <h2 className="text-xl font-bold text-zinc-900">
            Połączony Skrypt Tampermonkey (Wszystkie Serwisy & Głosy)
          </h2>
          <p className="text-xs text-zinc-500">
            Zawiera wszystkie funkcje: Piper 8765, bufor 3 zdań (nie urywa głosu), pływające GUI, Live Listen i cenzurę wulgaryzmów.
          </p>
        </div>

        <button
          onClick={handleCopy}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Skopiowano pełny skrypt!' : 'Skopiuj 1-plikiem do Tampermonkey'}
        </button>
      </div>

      {/* Steps Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs space-y-2">
          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm">
            1
          </div>
          <h4 className="text-sm font-bold text-zinc-900">Zainstaluj Tampermonkey</h4>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Dodaj wtyczkę <strong>Tampermonkey</strong> w Chrome, Edge, Brave lub Firefox z Chrome Web Store.
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs space-y-2">
          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm">
            2
          </div>
          <h4 className="text-sm font-bold text-zinc-900">Wklej skrypt w całości</h4>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Kliknij ikonę Tampermonkey &rarr; <em>Utwórz nowy skrypt...</em>, zaznacz wszystko i wklej ten kod, a następnie naciśnij <code>Ctrl + S</code>.
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs space-y-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-sm">
            3
          </div>
          <h4 className="text-sm font-bold text-zinc-900">Oglądaj z lektorem & GUI</h4>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Otwórz <strong>Prime Video</strong>, <strong>Netflix</strong>, <strong>YouTube</strong>, <strong>CDA</strong> lub dowolny serwis – w prawym rogu pojawi się pływające GUI z lektorem i buforem 3 zdań!
          </p>
        </div>
      </div>

      {/* Code Viewer Box */}
      <div className="bg-zinc-950 rounded-2xl p-4 border border-zinc-800 shadow-lg text-zinc-300 font-mono text-xs overflow-x-auto max-h-[460px]">
        <pre>{FULL_USERSCRIPT_CODE}</pre>
      </div>
    </div>
  );
};
