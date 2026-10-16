// 円の大きさ地図（MapLibre GL JS）。main.ts から動的 import で遅延ロードされる。
import { Map as MapLibre, Popup, NavigationControl, setWorkerUrl } from 'maplibre-gl';
// MapLibre 6 のワーカーは別ファイル。Vite に成果物として出力させ、URL を明示する
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { REGION_COLORS } from './colors';
import { circleFor, legendValues, maxRadiusFor, peopleLabel } from './radius';

export interface MapFrame {
  names: string[];                 // 市町村名（座標データの municipality と一致）
  values: (number | null)[];       // names と同じ並び
  vmax: number;                    // 選択指標の全期間最大（固定スケール）
  animMs: number;                  // 半径の変化にかける時間
  describe: (name: string) => string;   // ポップアップの HTML
}
export interface MapView {
  update(f: MapFrame): void;
  resize(): void;
  setBoundaries(on: boolean): void;
  open(name: string): void;          // 市町村のポップアップを開く（表の行タップ用）
}

const GSI_TILE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>（淡色地図）';
const NIIGATA_BOUNDS: [[number, number], [number, number]] = [[137.7, 36.8], [139.8, 38.65]];
const HIT_MIN_RADIUS = 22;   // タップ領域は直径44px以上

const regionMatch = (fallback: string) => ['match', ['get', 'region'],
  ...Object.entries(REGION_COLORS).flat(), fallback] as unknown as ExpressionSpecification;

export async function createMapView(el: HTMLElement, legendEl: HTMLElement): Promise<MapView> {
  setWorkerUrl(workerUrl);
  const [points, bounds] = await Promise.all([
    fetch('./data/municipality_points.geojson').then((r) => r.json()),
    fetch('./data/municipality_boundaries.geojson').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const map = new MapLibre({
    container: el,
    style: {
      version: 8,
      sources: {
        gsi: { type: 'raster', tiles: [GSI_TILE], tileSize: 256, maxzoom: 18, attribution: GSI_ATTR },
        pts: { type: 'geojson', data: points, promoteId: 'municipality' },
        ...(bounds ? { bounds: { type: 'geojson', data: bounds } } : {}),
      },
      layers: [
        { id: 'gsi', type: 'raster', source: 'gsi' },
        ...(bounds ? [{ id: 'bounds', type: 'line' as const, source: 'bounds', layout: { visibility: 'none' as const },
          paint: { 'line-color': '#6b7488', 'line-width': 0.8, 'line-opacity': 0.7 } }] : []),
        {
          id: 'circles', type: 'circle', source: 'pts',
          layout: { 'circle-sort-key': ['get', 'sk'] },   // 小さいキー=下。sk=-値 なので大きい円ほど下
          paint: {
            'circle-radius': ['coalesce', ['feature-state', 'r'], 0],
            'circle-color': regionMatch('#888'),
            'circle-opacity': ['case', ['==', ['feature-state', 'k'], 'value'], 0.5, 0],
            'circle-stroke-color': ['case', ['==', ['feature-state', 'k'], 'zero'], regionMatch('#888'), '#ffffff'],
            'circle-stroke-width': ['case', ['==', ['feature-state', 'k'], 'none'], 0, 1],
            'circle-stroke-opacity': 0.9,
          },
        },
        {
          id: 'hit', type: 'circle', source: 'pts',          // 見えないタップ判定用（直径44px以上）
          layout: { 'circle-sort-key': ['get', 'sk'] },
          paint: { 'circle-radius': ['coalesce', ['feature-state', 'hr'], HIT_MIN_RADIUS], 'circle-opacity': 0.001 },
        },
      ],
    },
    bounds: NIIGATA_BOUNDS, fitBoundsOptions: { padding: 6, animate: false },
    minZoom: 5, maxZoom: 12, attributionControl: { compact: true },
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.touchZoomRotate.disableRotation();
  // スタイル（ソース・レイヤー）が使えるようになれば十分。'load' は全タイル取得後なので待たない
  await new Promise<void>((res) => {
    if (map.getSource('pts') && map.getLayer('hit')) return res();
    map.once('style.load', () => res());
    map.once('load', () => res());
  });

  // 作成時にコンテナが非表示/未確定だと初期範囲が仮サイズで計算されるため、表示後に県全域へ合わせ直す
  map.resize();
  map.fitBounds(NIIGATA_BOUNDS, { padding: 6, animate: false });

  let frame: MapFrame | null = null;
  let selected: string | null = null;
  const popup = new Popup({ closeButton: true, maxWidth: '260px', offset: 8, focusAfterOpen: false })   // フォーカス移動によるスクロールを防ぐ;
  const coords = new globalThis.Map<string, [number, number]>(
    points.features.map((f: any) => [f.properties.municipality, f.geometry.coordinates]));

  const open = (name: string) => {
    selected = name;
    popup.setLngLat(coords.get(name)!).setHTML(frame!.describe(name)).addTo(map);
  };
  popup.on('close', () => { selected = null; });
  map.on('click', 'hit', (e) => { const f = e.features?.[0]; if (f && frame) open(f.properties.municipality); });
  map.on('mouseenter', 'hit', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'hit', () => { map.getCanvas().style.cursor = ''; });

  // --- 半径のアニメーション（feature-state を rAF で補間。setData は並び順 sk の更新時のみ） ---
  const cur = new globalThis.Map<string, number>();       // 現在の半径
  let raf = 0;
  const setState = (name: string, r: number, kind: string) =>
    map.setFeatureState({ source: 'pts', id: name }, { r, hr: Math.max(r, HIT_MIN_RADIUS), k: kind });

  function tween(targets: { name: string; r: number; kind: string }[], ms: number) {
    cancelAnimationFrame(raf);
    const from = targets.map((t) => cur.get(t.name) ?? 0);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
      targets.forEach((t, i) => {
        const r = from[i] + (t.r - from[i]) * p;
        cur.set(t.name, r);
        setState(t.name, r, t.kind);
      });
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function renderLegend(vmax: number, rmax: number) {
    const vals = legendValues(vmax, rmax);
    const h = Math.ceil(rmax * 2) + 4, cx = rmax + 2, w = Math.ceil(rmax * 2) + 100;
    const circles = vals.map((v) => {
      const r = circleFor(v, vmax, rmax).r;
      const top = h - 2 * r - 2;
      // 円は下端をそろえて入れ子に描き、ラベルは円の頂点から右へ引き出し線で示す（地図と同じ式の半径）
      return `<circle cx="${cx}" cy="${(h - r - 2).toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(120,130,150,.25)" stroke="#8a93a6" stroke-width="1"/>` +
        `<line x1="${cx}" y1="${top.toFixed(1)}" x2="${2 * rmax + 8}" y2="${top.toFixed(1)}" stroke="#8a93a6" stroke-width="0.8"/>` +
        `<text x="${2 * rmax + 10}" y="${(top + 4).toFixed(1)}" font-size="12" fill="currentColor">${peopleLabel(v)}</text>`;
    }).join('');
    legendEl.querySelector('.legend-body')!.innerHTML =
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="円の大きさの目安">${circles}</svg>`;
  }

  return {
    update(f) {
      frame = f;
      const rmax = maxRadiusFor(el.clientWidth);
      const circles = f.names.map((name, i) => ({ name, v: f.values[i], ...circleFor(f.values[i], f.vmax, rmax) }));
      // 並び順（大きい円ほど下）を更新
      const sk = new globalThis.Map(circles.map((c) => [c.name, -(c.v ?? 0)]));
      (map.getSource('pts') as any).setData({
        ...points,
        features: points.features.map((ft: any) => ({
          ...ft, properties: { ...ft.properties, sk: sk.get(ft.properties.municipality) ?? 0 } })),
      });
      tween(circles.map((c) => ({ name: c.name, r: c.r, kind: c.kind })), f.animMs);
      renderLegend(f.vmax, rmax);
      if (selected) popup.setHTML(f.describe(selected));
    },
    resize() { map.resize(); },
    open(name) { if (frame && coords.has(name)) open(name); },
    setBoundaries(on) {
      if (map.getLayer('bounds')) map.setLayoutProperty('bounds', 'visibility', on ? 'visible' : 'none');
    },
  };
}
