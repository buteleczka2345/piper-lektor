import { SubtitleSegment } from '../types';

export function parseSRTText(rawText: string): SubtitleSegment[] {
  const timeRe = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*--?>\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
  const blocks = rawText.replace(/\r/g, '').split(/\n\s*\n/);
  const segments: SubtitleSegment[] = [];
  let idCounter = 1;

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    let idx = 0;
    if (/^\d+$/.test(lines[0])) {
      idx = 1;
    }

    const timeMatch = lines[idx] && lines[idx].match(timeRe);
    if (!timeMatch) continue;

    const start = (+timeMatch[1]) * 3600 + (+timeMatch[2]) * 60 + (+timeMatch[3]) + (+timeMatch[4]) / 1000;
    const end = (+timeMatch[5]) * 3600 + (+timeMatch[6]) * 60 + (+timeMatch[7]) + (+timeMatch[8]) / 1000;
    const textContent = lines.slice(idx + 1).join(' ').replace(/<[^>]+>/g, '').trim();

    if (textContent) {
      segments.push({
        id: idCounter++,
        start,
        end,
        duration: Math.max(end - start, 0.4),
        originalText: textContent,
        text: textContent,
        translatedText: ''
      });
    }
  }

  // If not standard SRT, check line by line
  if (segments.length === 0 && rawText.trim()) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const avgDuration = 3.0;
    lines.forEach((line, i) => {
      segments.push({
        id: i + 1,
        start: i * avgDuration,
        end: (i + 1) * avgDuration,
        duration: avgDuration,
        originalText: line,
        text: line,
        translatedText: ''
      });
    });
  }

  return segments;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export const SAMPLE_MOVIES = [
  {
    title: "Sci-Fi: Obcy Sygnał (Demo)",
    duration: 35,
    srt: `1
00:00:01,000 --> 00:00:04,200
Commander, we are detecting an anomalous frequency from sector seven.

2
00:00:04,500 --> 00:00:08,100
Analyze the waveform immediately. Is it a distress beacon or hostile scan?

3
00:00:08,600 --> 00:00:12,400
The transmission repeats every four seconds. It contains high-density telemetry data.

4
00:00:13,000 --> 00:00:17,500
Prepare the defensive shields and initialize the hyper-drive translator.

5
00:00:18,000 --> 00:00:22,800
Copy that, Captain. Synchronizing audio channels and translation matrix now.

6
00:00:23,200 --> 00:00:28,000
Message decrypted: "We come in peace, travelers of the solar system."`
  },
  {
    title: "Film Akcji: Pościg w Nocy (Demo)",
    duration: 30,
    srt: `1
00:00:01,200 --> 00:00:04,500
Target is moving north towards the downtown highway at high speed.

2
00:00:05,000 --> 00:00:08,800
All units, maintain visual contact and close the perimeter blocks.

3
00:00:09,200 --> 00:00:13,000
He just turned into the industrial dock district! Watch out for obstacles.

4
00:00:13,500 --> 00:00:18,000
I'm right behind him. Requesting immediate aerial surveillance support.

5
00:00:18,500 --> 00:00:23,000
Backup is on the way. Do not let him cross the international bridge.`
  }
];
