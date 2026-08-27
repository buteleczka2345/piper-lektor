/**
 * Subtitle Parsers supporting SRT, VTT, ASS, SBV, LRC and plain TXT
 */
import { SubtitleSegment } from '../types';

export function cleanSubtitleText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/gi, ' ')
    .replace(/\\n/gi, ' ')
    .replace(/\s+\d{1,4}\s*$/, '')
    .replace(/\b\d{1,4}\b(?=\s*[.,!?]|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectFormat(text: string): 'srt' | 'vtt' | 'ass' | 'sbv' | 'lrc' | 'txt' {
  if (/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*--?>\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text)) return 'srt';
  if (/WEBVTT/i.test(text) && /-->/.test(text)) return 'vtt';
  if (/\[Script Info\]/i.test(text) && /\[Events\]/i.test(text)) return 'ass';
  if (/\d{2}:\d{2}:\d{2}\.\d{3},\d{2}:\d{2}:\d{2}\.\d{3}/.test(text)) return 'sbv';
  if (/\[\d{2}:\d{2}\.\d{2}\]/.test(text) || /\[\d{2}:\d{2}:\d{2}\]/.test(text)) return 'lrc';
  return 'txt';
}

export function parseSRT(text: string): SubtitleSegment[] {
  const timeRe = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*--?>\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
  const lines = text.replace(/\r/g, '').split('\n');
  const segments: SubtitleSegment[] = [];
  let i = 0;
  let id = 1;

  while (i < lines.length) {
    const m = lines[i].match(timeRe);
    if (!m) {
      i++;
      continue;
    }
    const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    i++;
    const textLines: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.match(timeRe)) break;
      if (line.trim() !== '') textLines.push(line);
      i++;
    }
    const cleanText = cleanSubtitleText(textLines.join(' '));
    if (cleanText) {
      segments.push({
        id: id++,
        start,
        duration: Math.max(end - start, 0.4),
        end,
        originalText: cleanText,
        text: cleanText,
      });
    }
  }
  return segments;
}

export function parseVTT(text: string): SubtitleSegment[] {
  const lines = text.split('\n');
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('-->')) {
      startIdx = i;
      break;
    }
  }
  return parseSRT(lines.slice(startIdx).join('\n'));
}

export function parseASS(text: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  const lines = text.split('\n');
  let inEvents = false;
  let id = 1;

  for (const line of lines) {
    if (line.trim().startsWith('[Events]')) {
      inEvents = true;
      continue;
    }
    if (inEvents && line.trim().startsWith('Dialogue:')) {
      const parts = line.split(',');
      if (parts.length >= 10) {
        const start = parseTimeAss(parts[1].trim());
        const end = parseTimeAss(parts[2].trim());
        const raw = cleanSubtitleText(parts.slice(9).join(','));
        if (raw && start !== null && end !== null) {
          segments.push({
            id: id++,
            start,
            duration: Math.max(end - start, 0.4),
            end,
            originalText: raw,
            text: raw,
          });
        }
      }
    }
  }
  return segments;
}

function parseTimeAss(timeStr: string): number | null {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return (
      (parseInt(parts[0], 10) || 0) * 3600 +
      (parseInt(parts[1], 10) || 0) * 60 +
      (parseFloat(parts[2].replace(',', '.')) || 0)
    );
  }
  return null;
}

export function parseSBV(text: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  let id = 1;

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;
    const timeMatch = lines[0].match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3}),(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (!timeMatch) continue;
    const start = (+timeMatch[1]) * 3600 + (+timeMatch[2]) * 60 + (+timeMatch[3]) + (+timeMatch[4]) / 1000;
    const end = (+timeMatch[5]) * 3600 + (+timeMatch[6]) * 60 + (+timeMatch[7]) + (+timeMatch[8]) / 1000;
    const cleanText = cleanSubtitleText(lines.slice(1).join(' '));
    if (cleanText) {
      segments.push({
        id: id++,
        start,
        duration: Math.max(end - start, 0.4),
        end,
        originalText: cleanText,
        text: cleanText,
      });
    }
  }
  return segments;
}

export function parseLRC(text: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  const lines = text.split('\n');
  let currentText = '';
  let currentStart = 0;
  let id = 1;

  for (const line of lines) {
    const matches = line.match(/\[(\d{2}):(\d{2})\.(\d{2})\](.*)/);
    if (matches) {
      if (currentText) {
        segments.push({
          id: id++,
          start: currentStart,
          duration: 2.0,
          end: currentStart + 2.0,
          originalText: cleanSubtitleText(currentText),
          text: cleanSubtitleText(currentText),
        });
      }
      const minutes = parseInt(matches[1], 10);
      const seconds = parseInt(matches[2], 10);
      const centiseconds = parseInt(matches[3], 10);
      currentStart = minutes * 60 + seconds + centiseconds / 100;
      currentText = matches[4] || '';
    } else if (line.trim()) {
      currentText += ' ' + line.trim();
    }
  }
  if (currentText) {
    segments.push({
      id: id++,
      start: currentStart,
      duration: 2.0,
      end: currentStart + 2.0,
      originalText: cleanSubtitleText(currentText),
      text: cleanSubtitleText(currentText),
    });
  }

  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].duration = Math.max(segments[i + 1].start - segments[i].start, 0.4);
    segments[i].end = segments[i].start + segments[i].duration;
  }
  return segments;
}

export function parseAnySubtitle(text: string, duration?: number): SubtitleSegment[] {
  const format = detectFormat(text);
  switch (format) {
    case 'srt':
      return parseSRT(text);
    case 'vtt':
      return parseVTT(text);
    case 'ass':
      return parseASS(text);
    case 'sbv':
      return parseSBV(text);
    case 'lrc':
      return parseLRC(text);
    default: {
      const lines = text.split('\n').map(l => cleanSubtitleText(l)).filter(l => l.length > 0);
      const totalDur = duration && duration > 0 ? duration : Math.max(lines.length * 3.5, 10);
      const per = totalDur / Math.max(lines.length, 1);
      return lines.map((l, idx) => ({
        id: idx + 1,
        start: idx * per,
        duration: Math.max(per, 0.4),
        end: (idx + 1) * per,
        originalText: l,
        text: l,
      }));
    }
  }
}
