import { describe, expect, it } from 'vitest';
import { circleFor, legendValues, maxRadiusFor, MIN_RADIUS, peopleLabel } from './radius';

const RMAX = 54;
const VMAX = 20_000_000;

describe('circleFor', () => {
  it('最大値で最大半径になる', () => {
    expect(circleFor(VMAX, VMAX, RMAX)).toEqual({ r: RMAX, kind: 'value' });
  });
  it('クランプ内では面積が値に比例する（面積比 = 値の比）', () => {
    const a = circleFor(1_000_000, VMAX, RMAX).r, b = circleFor(4_000_000, VMAX, RMAX).r;
    expect((b * b) / (a * a)).toBeCloseTo(4, 6);
    const c = circleFor(10_000_000, VMAX, RMAX).r;
    expect((c * c) / (a * a)).toBeCloseTo(10, 6);
  });
  it('単調増加', () => {
    let prev = -1;
    for (const v of [1, 100, 1e4, 1e5, 1e6, 5e6, 2e7]) {
      const r = circleFor(v, VMAX, RMAX).r;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
  it('小さい値は最小半径に張り付く', () => {
    const c = circleFor(5, VMAX, RMAX);
    expect(c).toEqual({ r: MIN_RADIUS, kind: 'value' });
  });
  it('0 は塗りなしの輪郭（最小半径）、null/undefined は描かない', () => {
    expect(circleFor(0, VMAX, RMAX)).toEqual({ r: MIN_RADIUS, kind: 'zero' });
    expect(circleFor(null, VMAX, RMAX)).toEqual({ r: 0, kind: 'none' });
    expect(circleFor(undefined, VMAX, RMAX)).toEqual({ r: 0, kind: 'none' });
  });
  it('最大値を超えても最大半径で頭打ち', () => {
    expect(circleFor(VMAX * 4, VMAX, RMAX).r).toBe(RMAX);
  });
});

describe('maxRadiusFor', () => {
  it('幅360pxで約15%（54px）、広い画面では80pxで頭打ち、極小でも下限あり', () => {
    expect(maxRadiusFor(360)).toBeCloseTo(54, 6);
    expect(maxRadiusFor(2000)).toBe(80);
    expect(maxRadiusFor(50)).toBe(24);
  });
});

describe('legendValues', () => {
  it('降順で最大3つ、vmax 以下、地図と同じ式で最小半径より大きい', () => {
    const v = legendValues(20_056_710, RMAX);
    expect(v.length).toBe(3);
    expect(v[0]).toBeLessThanOrEqual(20_056_710);
    expect([...v].sort((a, b) => b - a)).toEqual(v);
    v.forEach((x) => expect(circleFor(x, 20_056_710, RMAX).r).toBeGreaterThan(MIN_RADIUS));
  });
  it('最大値が小さい指標でも空にならない', () => {
    expect(legendValues(7_729_080, RMAX).length).toBeGreaterThan(0);
  });
});

describe('peopleLabel', () => {
  it('万・億で表記', () => {
    expect(peopleLabel(100_000)).toBe('10万人');
    expect(peopleLabel(10_000_000)).toBe('1,000万人');
    expect(peopleLabel(5000)).toBe('5,000人');
  });
});
