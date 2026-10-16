// 色定義（レースと地図で共有）。地域色は5地域で固定。
export const REGION_COLORS: Record<string, string> = {
  下越: '#2f6fdb', 中越: '#e8892b', 魚沼: '#1b9e77', 上越: '#c0408f', 佐渡: '#8a6d1f',
};
export const CATEGORY_COLORS: Record<string, string> = {
  自然: '#2e9e5b', '歴史・文化': '#a35d2c', '温泉・健康': '#d6453d', 'スポーツ・レクリエーション': '#2f6fdb',
  都市型観光: '#8f5bd0', その他: '#7b8394', '行祭事・イベント': '#d19a00',
};
export const CATEGORIES = Object.keys(CATEGORY_COLORS);
export const COLORS: Record<string, string> = { ...REGION_COLORS, ...CATEGORY_COLORS };
