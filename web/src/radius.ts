// 円の半径（px）。面積が値に比例するよう半径は値の平方根に比例させる。
// 地図の円と凡例の円は必ずこの関数で描く（同じ式）。
export const MIN_RADIUS = 3;

export type CircleKind = 'value' | 'zero' | 'none';
export interface Circle { r: number; kind: CircleKind; }

/** 最大半径: 画面（地図）幅の約15%。幅360pxで54px。広い画面では80pxで頭打ち。 */
export function maxRadiusFor(width: number): number {
  return Math.min(Math.max(width * 0.15, 24), 80);
}

/**
 * 値 → 円。vmax は選択指標の全期間最大値（固定スケール）。
 * null/undefined: 描かない。0: 塗りなしの小さな輪郭（最小半径）。
 * 正の値: rmax*sqrt(v/vmax) を [rmin, rmax] にクランプ（クランプ内では面積が値に比例）。
 */
export function circleFor(v: number | null | undefined, vmax: number, rmax: number, rmin = MIN_RADIUS): Circle {
  if (v == null || Number.isNaN(v)) return { r: 0, kind: 'none' };
  if (v <= 0 || vmax <= 0) return { r: rmin, kind: 'zero' };
  return { r: Math.min(rmax, Math.max(rmin, rmax * Math.sqrt(v / vmax))), kind: 'value' };
}

const LADDER = [1e3, 5e3, 1e4, 5e4, 1e5, 5e5, 1e6, 5e6, 1e7, 5e7];

/** 凡例の基準円の値（最大 vmax 以下の切りのよい値を、小さくなる順に最大3つ）。 */
export function legendValues(vmax: number, rmax: number, rmin = MIN_RADIUS): number[] {
  const out: number[] = [];
  let limit = vmax;
  while (out.length < 3) {
    const v = [...LADDER].reverse().find((x) => x <= limit);
    if (v === undefined) break;
    if (circleFor(v, vmax, rmax, rmin).r <= rmin + 0.5) break;   // 最小半径に張り付く値は基準にしない
    out.push(v);
    limit = v / 4;
  }
  return out;
}

/** 「10万人」「1,000万人」形式。 */
export function peopleLabel(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toLocaleString('ja-JP')}億人`;
  if (v >= 1e4) return `${(v / 1e4).toLocaleString('ja-JP')}万人`;
  return `${v.toLocaleString('ja-JP')}人`;
}
