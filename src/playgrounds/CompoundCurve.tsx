import { SliderCanvas, type DrawFn, type SliderSpec } from './SliderCanvas';
import { compoundAt, simpleAt, verdict } from './compound';
import type { PlaygroundComponentProps } from './registry';

// Palette constants (canvas can't resolve CSS custom properties).
// Must stay in sync with src/styles/global.css — the palette is fixed forever.
const INK = '#12202E';
const MUTED = '#5B6B7B';
const GRID = '#D5DDE4';
const ALIAS = '#0B8F8C'; // compound — the real, observed curve
const BRANCH = '#C2185B'; // simple — the intuition that goes wrong

export const compoundCurveSliders: SliderSpec[] = [
  { key: 'rate', label: '年利', min: 1, max: 15, step: 0.5, unit: '%' },
  { key: 'years', label: '期間', min: 5, max: 50, step: 1, unit: '年' },
];

export const compoundCurveDefaults = { rate: 6, years: 30 };

const PAD = { left: 34, right: 10, top: 10, bottom: 20 };

const draw: DrawFn = (ctx, w, h, params) => {
  const rate = params.rate ?? 6;
  const years = params.years ?? 30;
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const maxY = compoundAt(rate, years) * 1.05;

  const x = (t: number) => PAD.left + (t / years) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / maxY) * plotH;

  // grid + axis labels
  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const v = (maxY / ySteps) * i;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y(v));
    ctx.lineTo(w - PAD.right, y(v));
    ctx.stroke();
    ctx.fillText(`×${v.toFixed(1)}`, 2, y(v) + 3);
  }
  for (let t = 0; t <= years; t += Math.ceil(years / 5)) {
    ctx.fillText(`${t}年`, x(t) - 8, h - 6);
  }

  // ×2 guide line
  ctx.strokeStyle = MUTED;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PAD.left, y(2));
  ctx.lineTo(w - PAD.right, y(2));
  ctx.stroke();
  ctx.setLineDash([]);

  const curve = (f: (r: number, t: number) => number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let t = 0; t <= years; t += years / 120) {
      const px = x(t);
      const py = y(f(rate, t));
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  curve(simpleAt, BRANCH);
  curve(compoundAt, ALIAS);

  // legend
  ctx.fillStyle = ALIAS;
  ctx.fillText('複利', PAD.left + 6, PAD.top + 10);
  ctx.fillStyle = BRANCH;
  ctx.fillText('単利', PAD.left + 40, PAD.top + 10);
  ctx.fillStyle = INK;
};

export function CompoundCurve({ params, onParamsChange }: PlaygroundComponentProps) {
  return (
    <SliderCanvas
      sliders={compoundCurveSliders}
      params={params}
      onParamsChange={onParamsChange}
      draw={draw}
      verdict={verdict as (p: Record<string, number>) => string}
    />
  );
}
