import * as echarts from 'echarts';
import { seasonOf } from './season';
import { CATEGORIES, COLORS } from './colors';
import type { MapView } from './map';

interface RawSeries { name: string; region?: string; municipality?: string; category?: string; values: (number | null)[]; }
interface Raw { frames: string[]; regions?: string[]; series: RawSeries[]; }
interface Item { key: string; name: string; group: string; municipality: string; values: (number | null)[]; }
interface Dataset {
  frames: string[]; items: Item[]; lag: number; interval: number;
  label: (f: string) => string; unit: string; groups: string[]; allowYears: boolean;
}
type Mode = 'monthly' | 'annual' | 'spots' | 'category';
type View = 'race' | 'map';
interface AnnualCat { frames: string[]; regions: string[]; series: { name: string; region: string; values: Record<string, (number | null)[]> }[]; }

const BREAK_YEAR = '2020';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number) => Math.round(v).toLocaleString('ja-JP');
const man = (v: number) =>
  v >= 1e8 ? (v / 1e8).toFixed(2) + '億' : (v >= 1e6 ? (v / 1e4).toFixed(0) : (v / 1e4).toFixed(1)) + '万';
const get = async <T>(f: string): Promise<T> => (await fetch(`./data/${f}`)).json();

async function main() {
  const [monthly, annual, spots, annualCat, annotations] = await Promise.all([
    get<Raw>('monthly.json'), get<Raw>('annual.json'), get<Raw>('spots.json'), get<AnnualCat>('annual_category.json'),
    get<{ ym: string; target: string; text: string }[]>('annotations.json'),
  ]);
  const regions = monthly.regions!;
  const muniOrder = monthly.series.map((s) => s.name);

  const fromRegional = (r: Raw): Item[] =>
    r.series.map((s) => ({ key: s.name, name: s.name, group: s.region!, municipality: s.name, values: s.values }));

  const ymMonthly = (f: string) => { const [y, m] = f.split('-'); return `${y}年${Number(m)}月`; };
  const datasets: Record<Mode, () => Dataset> = {
    monthly: () => ({ frames: monthly.frames, items: fromRegional(monthly), lag: 12, interval: 700,
      label: ymMonthly, unit: '同月', groups: regions, allowYears: true }),
    annual: () => ({ frames: annual.frames, items: fromRegional(annual), lag: 1, interval: 1400,
      label: (f) => `${f}年`, unit: '', groups: regions, allowYears: false }),
    category: () => {   // 地図専用: 分類別（年間）
      const c = $<HTMLSelectElement>('mapcat').value;
      return { frames: annualCat.frames, lag: 1, interval: 1400, label: (f) => `${f}年`, unit: '', groups: regions,
        allowYears: false, items: annualCat.series.map((x) => ({ key: x.name, name: x.name, group: x.region,
          municipality: x.name, values: x.values[c] })) };
    },
    spots: () => {
      const cat = $<HTMLSelectElement>('cat').value, mu = $<HTMLSelectElement>('muni').value;
      const list = spots.series.filter((s) => (!cat || s.category === cat) && (!mu || s.municipality === mu));
      const cnt = new Map<string, number>();
      list.forEach((s) => cnt.set(s.name, (cnt.get(s.name) ?? 0) + 1));
      const items = list.map((s) => ({
        key: `${s.municipality}/${s.name}`,
        name: (cnt.get(s.name)! > 1 || spots.series.some((o) => o !== s && o.name === s.name && !list.includes(o)))
          ? `${s.name}（${s.municipality}）` : s.name,
        group: s.category!, municipality: s.municipality!, values: s.values,
      }));
      return { frames: spots.frames, items, lag: 1, interval: 1400, label: (f) => `${f}年`, unit: '',
        groups: CATEGORIES, allowYears: false };
    },
  };

  // --- state ---
  let mode: Mode = 'monthly';
  let ds = datasets.monthly();
  let start = 0, end = ds.frames.length - 1, idx = 0, playing = false, topN = 10, speed = 2;   // speed は間隔の倍率（2 = 0.5x が既定）
  let timer: number | undefined;
  let cumulative = false;
  let view: View = 'race';
  let mapView: MapView | null = null;
  let vmax = 1;                          // 地図の固定スケール（選択指標の全期間最大）
  const shared = { y: 2011, m: 1 };      // レースと地図で共有する年月
  let cum: number[][] = [];   // 累計（範囲の先頭から。欠損・対象外は0として加算）
  const slider = $<HTMLInputElement>('slider'), playBtn = $('play');
  const rangeSel = $<HTMLSelectElement>('range');
  const chart = echarts.init($('chart'));
  const noAnim = /(^|&)a=0/.test(location.hash.slice(1)); // 検証用: アニメーション無効
  const intervalMs = () => ds.interval * speed;
  const animMs = () => (noAnim ? 0 : intervalMs());

  $<HTMLSelectElement>('mapcat').innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');
  // spots 絞り込みの選択肢
  $<HTMLSelectElement>('cat').innerHTML = '<option value="">全分類</option>' +
    CATEGORIES.map((c) => `<option>${c}</option>`).join('');
  const spotMunis = new Set(spots.series.map((s) => s.municipality));
  $<HTMLSelectElement>('muni').innerHTML = '<option value="">全市町村</option>' +
    muniOrder.filter((m) => spotMunis.has(m)).map((m) => `<option>${m}</option>`).join('');

  function renderLegend() {
    $('legend').innerHTML = ds.groups
      .map((g) => `<span><i style="background:${COLORS[g]}"></i>${g}</span>`).join('');
  }

  function setRangeOptions() {
    const years = [...new Set(ds.frames.map((f) => f.slice(0, 4)))];
    rangeSel.innerHTML = `<option value="all">全期間（${years[0]}〜${years[years.length - 1]}）</option>` +
      (ds.allowYears ? years.map((y) => `<option value="${y}">${y}年（12か月で循環）</option>`).join('') : '');
    rangeSel.disabled = !ds.allowYears;
  }

  function buildCum() {
    cum = ds.items.map((it) => { let sum = 0; return it.values.map((v, j) => (j < start ? 0 : (sum += v ?? 0))); });
  }
  // 現在のモードでの値（累計なら累計値。単月で欠損なら null）
  const raw = (k: number, i: number): number | null => (cumulative ? cum[k][i] : ds.items[k].values[i]);
  const dataFor = (i: number) =>
    ds.items.map((it, k) => ({ name: it.name, value: raw(k, i) ?? 0, itemStyle: { color: COLORS[it.group] } }));

  function option(): echarts.EChartsOption {
    return {
      grid: { top: 8, bottom: 30, left: 4, right: 70, containLabel: true },
      xAxis: { max: 'dataMax', axisLabel: { fontSize: 12, formatter: (n: number) => man(n) },
        splitLine: { lineStyle: { opacity: 0.3 } } },
      yAxis: { type: 'category', inverse: true, max: Math.min(topN, ds.items.length) - 1,
        data: ds.items.map((it) => it.name),
        axisLabel: { fontSize: 14, interval: 0, width: mode === 'spots' ? 130 : 84, overflow: 'truncate' },
        animationDuration: 300, animationDurationUpdate: 300 },
      series: [{
        type: 'bar', realtimeSort: true, data: dataFor(idx), barCategoryGap: '25%',
        label: { show: true, position: 'right', fontSize: 14, valueAnimation: true,
          textBorderWidth: 0, color: 'inherit', formatter: (p: any) => man(Number(p.value)) },
      }],
      animationDuration: 0, animationDurationUpdate: animMs(),
      animationEasing: 'linear', animationEasingUpdate: 'linear',
      tooltip: {
        trigger: 'item', confine: true, textStyle: { fontSize: 14 },
        formatter: (p: any) => {
          const k = ds.items.findIndex((x) => x.name === p.name);
          if (k < 0) return '';
          const it = ds.items[k];
          const v = it.values[idx];
          const head = mode === 'spots' ? `${it.municipality}／${it.group}` : it.group;
          const lines = [`<b>${it.name}</b>（${head}）`];
          if (cumulative) lines.push(`累計（${ds.label(ds.frames[start])}〜${ds.label(ds.frames[idx])}）: ${fmt(cum[k][idx])}人`);
          lines.push(`${ds.label(ds.frames[idx])}: ` + (v == null ? 'データなし' + (mode === 'spots' ? '（集計対象外）' : '') : `${fmt(v)}人`));
          const pv = idx >= ds.lag ? it.values[idx - ds.lag] : null;
          if (v != null && pv != null && pv > 0) {
            const r = (v / pv - 1) * 100;
            lines.push(`前年${ds.unit}: ${fmt(pv)}人（${r >= 0 ? '+' : ''}${r.toFixed(1)}%）`);
          }
          return lines.join('<br/>');
        },
      },
    };
  }

  // --- 自動キャプション（優先: 1位交代 > 前年同月比の急変 > TOP10新規入り、最大2件） ---
  function topOrder(i: number): number[] {
    return ds.items.map((_, k) => k)
      .sort((a, b) => (raw(b, i) ?? 0) - (raw(a, i) ?? 0));
  }
  function captions(i: number): string[] {
    const out: string[] = [];
    if (!ds.items.length) return out;
    const cur = topOrder(i);
    const hasPrev = i > start;
    const prev = hasPrev ? topOrder(i - 1) : null;
    if (prev && raw(cur[0], i) != null && cur[0] !== prev[0]) {
      out.push(`🥇 ${ds.items[cur[0]].name}が1位に（前は${ds.items[prev[0]].name}）`);
    }
    // 前年（同月）比の急変: 表示中の上位N件のみ。変化の大きい1件
    if (!cumulative && i >= ds.lag) {   // 累計では前年比の急変は出さない
      let best: { k: number; r: number } | null = null;
      for (const k of cur.slice(0, topN)) {
        const v = ds.items[k].values[i], pv = ds.items[k].values[i - ds.lag];
        if (v == null || pv == null || pv <= 0) continue;
        const r = v / pv - 1;
        if ((r >= 0.5 || r <= -0.3) && (!best || Math.abs(r) > Math.abs(best.r))) best = { k, r };
      }
      if (best) out.push(`📈 ${ds.items[best.k].name}が前年${ds.unit}比 ${best.r >= 0 ? '+' : ''}${(best.r * 100).toFixed(0)}%`);
    }
    if (prev) {
      const was = new Set(prev.slice(0, 10));
      const k = cur.slice(0, 10).find((x) => !was.has(x) && raw(x, i) != null);
      if (k !== undefined) out.push(`⬆ ${ds.items[k].name}がTOP10入り`);
    }
    return out.slice(0, 2);
  }

  function renderCaptions(i: number) {
    const f = ds.frames[i];
    const ann = annotations.filter((a) => a.ym === f)
      .map((a) => `<div class="ann">📝 ${a.target ? a.target + ': ' : ''}${a.text}</div>`);
    $('captions').innerHTML = ann.concat(captions(i).map((c) => `<div>${c}</div>`)).join('');
  }

  function renderNotice(i: number) {
    const el = $('notice');
    el.hidden = mode !== 'spots';
    if (mode !== 'spots') return;
    const count = (y: string) => { const k = ds.frames.indexOf(y); return spots.series.filter((s) => s.values[k] != null).length; };
    const hot = ds.frames[i] === BREAK_YEAR;
    el.className = hot ? 'hot' : '';
    el.textContent = `※年により集計対象が異なります。${BREAK_YEAR}年に集計対象が変わり、掲載地点が` +
      `${count('2019')}件（2019年）→${count(BREAK_YEAR)}件（${BREAK_YEAR}年）になりました。` +
      '前年が対象外の地点は途中から現れ、0から伸びます。' +
      (cumulative ? '累計は、掲載対象になった年の値のみの合計です。' : '');
  }

  // 季節の背景色と絵文字（月別フレームのときのみ。年次モードは季節なし）
  function renderSeason(frame: string) {
    const stage = $('stage'), box = $('season'), icon = $('season-icon');
    if (view === 'map' || mode !== 'monthly') { box.hidden = true; delete stage.dataset.season; return; }
    const se = seasonOf(frame);
    box.hidden = false;
    stage.dataset.season = se.season;
    if (icon.textContent !== se.icon) {
      icon.textContent = se.icon;
      icon.classList.remove('pop'); void icon.offsetWidth; icon.classList.add('pop');
    }
    $('season-label').textContent = `${se.season}・${se.motif}`;
  }

  // --- 共有する年月 / 地図 ---
  function syncShared(frame: string) {
    const p = frame.split('-').map(Number);
    shared.y = p[0];
    if (p.length > 1) shared.m = p[1];
  }
  function frameIndexFor(t: { y: number; m: number }): number {
    return ds.frames.indexOf(ds.frames[0].includes('-') ? `${t.y}-${String(t.m).padStart(2, '0')}` : String(t.y));
  }
  const metricLabel = () => (mode === 'category' ? `分類「${$<HTMLSelectElement>('mapcat').value}」` : mode === 'monthly' ? '月別' : '年間');
  const computeVmax = () => { vmax = Math.max(1, ...ds.items.flatMap((it) => it.values.map((v) => v ?? 0))); };

  function describe(name: string): string {
    const it = ds.items.find((x) => x.name === name)!;
    const v = it.values[idx];
    const ranked = ds.items.map((x) => x.values[idx]).filter((x): x is number => x != null).sort((a, b) => b - a);
    const lines = [`<b>${it.name}</b>（${it.group}）`,
      `${ds.label(ds.frames[idx])}・${metricLabel()}: ` + (v == null ? 'データなし' : `${fmt(v)}人`)];
    if (v != null) lines.push(`順位: ${ranked.indexOf(v) + 1}位 / ${ranked.length}`);
    const pv = idx >= ds.lag ? it.values[idx - ds.lag] : null;
    if (v != null && pv != null && pv > 0) {
      const r = (v / pv - 1) * 100;
      lines.push(`前年${ds.unit}: ${fmt(pv)}人（${r >= 0 ? '+' : ''}${r.toFixed(1)}%）`);
    }
    return lines.join('<br/>');
  }

  function renderTable() {
    const rows = ds.items.map((it) => ({ it, v: it.values[idx] }))
      .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    $('maptable-cap').textContent = `${ds.label(ds.frames[idx])}・${metricLabel()}の入込客数（多い順）`;
    $('maptable').querySelector('tbody')!.innerHTML = rows.map(({ it, v }, n) =>
      `<tr data-name="${it.name}"><td>${v == null ? '–' : n + 1}</td><td><i style="background:${COLORS[it.group]}"></i>${it.name}</td>` +
      `<td>${it.group}</td><td class="num">${v == null ? 'データなし' : fmt(v)}</td></tr>`).join('');
  }

  let mapPromise: Promise<MapView> | null = null;
  const ensureMap = () => (mapPromise ??= import('./map').then((m) => m.createMapView($('mapbox'), $('maplegend')))
    .then((mv) => { mapView = mv; mv.setBoundaries($<HTMLInputElement>('bounds').checked); return mv; })
    .catch((e) => { $('mapnote').textContent = '地図を表示できませんでした（WebGL が使えない環境の可能性があります）。下の表で値を確認できます。'; throw e; }));

  async function renderMapFrame() {
    renderTable();
    let mv: MapView;
    try { mv = await ensureMap(); } catch { return; }
    if (view !== 'map') return;
    mv.update({ names: ds.items.map((x) => x.name), values: ds.items.map((x) => x.values[idx]),
      vmax, animMs: animMs(), describe });
  }

  function render(i: number, full = false) {
    idx = i;
    syncShared(ds.frames[i]);
    if (view === 'map') {
      $('ym').textContent = ds.label(ds.frames[i]);
      slider.value = String(i);
      renderSeason(ds.frames[i]);
      void renderMapFrame();
      return;
    }
    $('ym').textContent = ds.label(ds.frames[i]) + (cumulative ? '\n累計' : '');
    renderSeason(ds.frames[i]);
    slider.value = String(i);
    renderCaptions(i);
    renderNotice(i);
    if (full) chart.setOption(option(), true);
    else chart.setOption({ series: [{ type: 'bar', data: dataFor(i) }], animationDurationUpdate: animMs() });
  }

  function setRange(key: string) {
    if (key === 'all') { start = 0; end = ds.frames.length - 1; }
    else { start = ds.frames.findIndex((f) => f.startsWith(key)); end = start + 11; }
    slider.min = String(start); slider.max = String(end);
    buildCum();
    computeVmax();
    render(start, true);
  }

  function tick() {
    if (!playing) return;
    if (idx >= end) {
      if (rangeSel.value === 'all') { pause(); return; }
      render(start);
    } else render(idx + 1);
    timer = window.setTimeout(tick, intervalMs());
  }
  function play() {
    if (playing) return;
    if (idx >= end && rangeSel.value === 'all') render(start);
    playing = true; playBtn.textContent = '⏸'; playBtn.setAttribute('aria-label', '一時停止');
    timer = window.setTimeout(tick, intervalMs());
  }
  function pause() {
    playing = false; playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', '再生');
    if (timer) clearTimeout(timer);
  }

  function setMode(m: Mode, keepTime = false) {
    const t = { ...shared };   // setRange の描画で共有年月が上書きされる前に控える
    pause();
    mode = m;
    ds = datasets[m]();
    applyViewUi();
    renderLegend();
    setRangeOptions();
    setRange('all');
    if (keepTime) { const k = frameIndexFor(t); if (k >= 0) render(k); }
  }

  // タブごとの表示要素の切り替え
  function applyViewUi() {
    const map = view === 'map';
    for (const id of ['chart', 'captions', 'modeWrap', 'aggWrap', 'topnWrap']) $(id).hidden = map;
    for (const id of ['mapbox', 'metricWrap', 'boundsWrap', 'maplegend', 'mapnote', 'maptable']) $(id).hidden = !map;
    $('mapcatWrap').hidden = !map || mode !== 'category';
    $('catWrap').hidden = $('muniWrap').hidden = map || mode !== 'spots';
    if (map) $('notice').hidden = true;
    $<HTMLSelectElement>('mode').value = mode === 'category' ? 'annual' : mode;
    $<HTMLSelectElement>('metric').value = mode === 'spots' ? 'monthly' : mode;
    $('stage').dataset.view = view;
    $('tab-race').setAttribute('aria-selected', String(!map));
    $('tab-map').setAttribute('aria-selected', String(map));
  }

  // レース/地図の切り替え。年月・再生状態は引き継ぐ
  function setView(v: View) {
    if (v === view) return;
    const wasPlaying = playing;
    view = v;
    const need: Mode = v === 'map' ? (mode === 'spots' ? 'monthly' : mode) : (mode === 'category' ? 'annual' : mode);
    setMode(need, true);
    if (v === 'race') chart.resize();
    if (wasPlaying) play();
  }

  playBtn.onclick = () => (playing ? pause() : play());
  $('restart').onclick = () => render(start);
  slider.oninput = () => render(Number(slider.value));
  $<HTMLSelectElement>('speed').onchange = (e) => {
    speed = Number((e.target as HTMLSelectElement).value);
    chart.setOption({ animationDurationUpdate: intervalMs() });
  };
  $<HTMLSelectElement>('topn').onchange = (e) => { topN = Number((e.target as HTMLSelectElement).value); render(idx, true); };
  rangeSel.onchange = () => { pause(); setRange(rangeSel.value); };
  $('tab-race').onclick = () => setView('race');
  $('tab-map').onclick = () => setView('map');
  $<HTMLSelectElement>('metric').onchange = (e) => setMode((e.target as HTMLSelectElement).value as Mode, true);
  $('mapcat').onchange = () => {
    const t = { ...shared };
    pause(); ds = datasets.category(); setRange('all');
    const k = frameIndexFor(t); if (k >= 0) render(k);
  };
  $('maptable').querySelector('tbody')!.addEventListener('click', (e) => {
    const name = (e.target as HTMLElement).closest('tr')?.dataset.name;
    if (name) mapView?.open(name);
  });
  $('bounds').onchange = () => mapView?.setBoundaries($<HTMLInputElement>('bounds').checked);
  $<HTMLSelectElement>('mode').onchange = (e) => setMode((e.target as HTMLSelectElement).value as Mode);
  const refilter = () => { pause(); ds = datasets.spots(); setRange('all'); };
  $<HTMLSelectElement>('agg').onchange = (e) => {
    cumulative = (e.target as HTMLSelectElement).value === 'cum';
    render(idx, true);
  };
  $('cat').onchange = refilter; $('muni').onchange = refilter;
  window.addEventListener('resize', () => { chart.resize(); mapView?.resize(); });

  renderLegend();
  setRangeOptions();
  setRange('all');
  // 共有・検証用ハッシュ: #m=annual|spots&i=<frame>&p=1&c=<分類>&u=<市町村>
  const hash = new URLSearchParams(location.hash.slice(1));
  const hm = hash.get('m') as Mode | null;
  if (hm && hm in datasets) {
    $<HTMLSelectElement>('mode').value = hm;
    if (hash.get('c')) $<HTMLSelectElement>('cat').value = hash.get('c')!;
    if (hash.get('u')) $<HTMLSelectElement>('muni').value = hash.get('u')!;
    setMode(hm);
  }
  if (hash.get('mc')) $<HTMLSelectElement>('mapcat').value = hash.get('mc')!;
  if (hash.get('v') === 'map') setView('map');
  if (hash.get('pop')) ensureMap().then((mv) => setTimeout(() => mv.open(hash.get('pop')!), 500));  // 検証用: ポップアップを開く
  if (hash.get('s') === 'cum') { cumulative = true; $<HTMLSelectElement>('agg').value = 'cum'; }
  if (hash.get('i')) render(Math.min(Number(hash.get('i')), ds.frames.length - 1));
  if (hash.get('p') === '1') play();
}

main();
