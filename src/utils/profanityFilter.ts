const BASE_BAD_WORDS = [
  "kurw", "chuj", "pizd", "pierd", "jeb", "skurv", "skurw", "huj",
  "cip", "piz", "chut", "frajer", "pedal", "pedau", "cwel", "dziwka",
  "suka", "sukinsyn", "chlejus", "menda", "gnj", "gniot", "choryskurw",
  "fuck", "shit", "bitch", "cunt", "asshole", "motherfucker", "dick"
];

const STORAGE_KEY = 'piperCustomBadWords';

export function getCustomBadWords(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomBadWords(words: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  } catch (e) {
    console.error("Failed to save custom bad words", e);
  }
}

export function getAllBadWords(): string[] {
  const custom = getCustomBadWords();
  return Array.from(new Set([...BASE_BAD_WORDS, ...custom]));
}

export function normalizeForCheck(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove polish diacritics
    .replace(/[^a-z0-9]/g, ''); // remove non-alphanumerics
}

export function filterProfanityText(
  text: string, 
  replacementType: 'cenzura' | 'beep' | 'stars' | 'remove' = 'cenzura',
  customList?: string[]
): { cleanedText: string; filteredCount: number } {
  if (!text) return { cleanedText: '', filteredCount: 0 };

  const badList = customList || getAllBadWords();
  const words = text.split(/\s+/);
  let count = 0;

  const resultWords = words.map(word => {
    const cleanW = normalizeForCheck(word);
    if (!cleanW) return word;

    for (const bad of badList) {
      if (cleanW.includes(bad)) {
        count++;
        if (replacementType === 'stars') return '***';
        if (replacementType === 'beep') return '[BEEP]';
        if (replacementType === 'remove') return '';
        return 'cenzura';
      }
    }
    return word;
  }).filter(Boolean);

  return {
    cleanedText: resultWords.join(' '),
    filteredCount: count
  };
}
