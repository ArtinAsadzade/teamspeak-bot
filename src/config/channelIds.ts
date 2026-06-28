export const parseCommaSeparatedChannelIds = (multi?: string, single?: string): string[] => {
  const source = multi?.trim() ? multi : single;
  return (source ?? '')
    .split(',')
    .map((value) => String(value).trim())
    .filter(Boolean);
};

export const toChannelIdSet = (ids: string[]): Set<string> => new Set<string>(ids);
