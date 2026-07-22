import { useCallback, useEffect, useRef } from 'react';
import styles from './SliderCanvas.module.css';

export type SliderSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, number>,
) => void;

type SliderCanvasProps = {
  sliders: SliderSpec[];
  params: Record<string, number>;
  onParamsChange: (params: Record<string, number>) => void;
  draw: DrawFn;
  verdict: (params: Record<string, number>) => string;
  height?: number;
};

// Generic "sliders + canvas draw function" playground, after the old
// graph-explainer pattern. Known pitfall carried over from that work: the
// canvas base height is stored in dataset.baseH on first fit — re-reading
// `height` after DPR scaling would compound the scale on every redraw.
// Redraws on input, change, and resize. The verdict line above the canvas
// states the takeaway in plain language.
export function SliderCanvas({
  sliders,
  params,
  onParamsChange,
  draw,
  verdict,
  height = 200,
}: SliderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!canvas.dataset.baseH) canvas.dataset.baseH = String(height);
    const baseH = Number(canvas.dataset.baseH);
    const baseW = canvas.clientWidth || canvas.parentElement?.clientWidth || 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = baseW * dpr;
    canvas.height = baseH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, baseW, baseH);
    draw(ctx, baseW, baseH, params);
  }, [draw, params, height]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    window.addEventListener('resize', redraw);
    return () => window.removeEventListener('resize', redraw);
  }, [redraw]);

  return (
    <div className={styles.playground}>
      <p className={styles.verdict}>{verdict(params)}</p>
      <canvas ref={canvasRef} className={styles.canvas} style={{ height }} />
      {sliders.map((s) => (
        <label key={s.key} className={styles.slider}>
          <span className={styles.sliderLabel}>
            {s.label}
            <b>
              {params[s.key]}
              {s.unit ?? ''}
            </b>
          </span>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={params[s.key] ?? s.min}
            onInput={(e) => onParamsChange({ ...params, [s.key]: Number(e.currentTarget.value) })}
          />
        </label>
      ))}
    </div>
  );
}
