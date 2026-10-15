// 月 → 季節・モチーフ（表示用）。市場レースの season.ts（market-race-spec）の対応に準拠。
export type SeasonName = '春' | '夏' | '秋' | '冬';
export interface Season { season: SeasonName; icon: string; motif: string; }

const BY_MONTH: Record<number, [SeasonName, string, string]> = {
  1: ['冬', '⛄', '雪'],
  2: ['冬', '🌸', '梅'],
  3: ['春', '🌸', '桜'],
  4: ['春', '🌸', '桜'],
  5: ['春', '🎏', '鯉のぼり'],
  6: ['夏', '☔', '梅雨'],
  7: ['夏', '🎋', '七夕'],
  8: ['夏', '🌻', 'ひまわり'],
  9: ['秋', '🎑', '月見'],
  10: ['秋', '🍁', '紅葉'],
  11: ['秋', '🍂', '紅葉'],
  12: ['冬', '❄️', '雪'],
};

/** `YYYY-MM` から季節情報を返す */
export function seasonOf(frame: string): Season {
  const [season, icon, motif] = BY_MONTH[Number(frame.split('-')[1])];
  return { season, icon, motif };
}
