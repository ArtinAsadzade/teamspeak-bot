import { normalizeForModeration } from '../../utils/text';

const DEFAULT_BLACKLIST = ['admin', 'مالک', 'fuck', 'کسکش'];

export class BlacklistService {
  private words: string[] = DEFAULT_BLACKLIST.map(normalizeForModeration);

  reload(customWords?: string[]): void {
    this.words = (customWords ?? DEFAULT_BLACKLIST).map(normalizeForModeration);
  }

  hasBlacklistedTerm(input: string): boolean {
    const normalized = normalizeForModeration(input);
    return this.words.some((w) => normalized.includes(w));
  }

  list(): string[] {
    return [...this.words];
  }
}
