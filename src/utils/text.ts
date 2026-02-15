const ZERO_WIDTH = /[\u200B-\u200F\uFEFF]/g;
const SPACE_LIKE = /[\s_\-.,~`!@#$%^&*()+={}\[\]|\\/:;"'<>?]+/g;

const mapArabicToPersian = (input: string): string =>
  input
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/ۀ/g, 'ه');

export function normalizeForModeration(input: string): string {
  return mapArabicToPersian(input)
    .toLowerCase()
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(SPACE_LIKE, '');
}

export function sanitizeChannelName(input: string, maxLen = 40): string {
  const clean = input.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return 'temp-channel';
  return clean.slice(0, maxLen);
}
