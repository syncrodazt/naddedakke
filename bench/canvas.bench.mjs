// Canvas performance benchmark against the CLAUDE.md target: "60fps pan with
// 200+ nodes". Runs the PRODUCTION build (vite preview) — a dev build measures
// React's development overhead, not the app.
//
//   npm run build && npm run bench
//
// Absolute numbers depend on the machine; what matters is the before/after on
// the same one. Reported per interaction: frames slower than 16.7ms (the 60fps
// budget), the worst frame, and the median.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const FIXTURE = resolve(process.argv[2] ?? 'bench/fixtures/bench-240.json');
// The preinstalled Chromium may not match this playwright build's expected
// revision; point at it directly rather than downloading another one.
const CHROME = process.env.BENCH_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const BUDGET_MS = 1000 / 60;

/** Start `vite preview` and read back whichever port it actually bound. */
function startPreview() {
  const child = spawn('npx', ['vite', 'preview', '--port', '4319'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('preview did not start')), 60000);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      // Not --strictPort: a leftover preview from an interrupted run would
      // otherwise fail the whole benchmark. Take the port vite reports.
      const found = /http:\/\/localhost:(\d+)/.exec(out);
      if (found) {
        clearTimeout(timer);
        res({ child, port: Number(found[1]) });
      }
    });
  });
}

/** Frame deltas while `action` runs, sampled with rAF inside the page. */
async function record(page, action) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__rec = true;
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__rec) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  return page.evaluate(() => {
    window.__rec = false;
    // Drop the first frame: it spans the gap before the interaction began.
    return window.__frames.slice(1);
  });
}

function report(label, frames) {
  if (frames.length === 0) return console.log(`${label}: no frames recorded`);
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // A frame that lands one vsync late is a genuine dropped frame; the display
  // ticks at ~16.7ms, so anything under ~1.5 vsyncs kept pace. Counting
  // "> 16.666" would flag every on-time frame as over budget.
  const dropped = frames.filter((f) => f > BUDGET_MS * 1.5).length;
  // Where the bad frames are matters: one hitch at the start of a gesture is a
  // different bug from sustained jank all the way through it.
  const worstAt = frames.indexOf(Math.max(...frames));
  console.log(
    `${label.padEnd(22)} frames=${String(frames.length).padStart(4)}  ` +
      `median=${median.toFixed(1)}  p95=${p95.toFixed(0)}  ` +
      `worst=${Math.max(...frames).toFixed(0)}ms@${worstAt}  ` +
      `dropped=${dropped} (${((dropped / frames.length) * 100).toFixed(0)}%)`,
  );
}

/** Pointer drag in small steps with a real gap between them, so rAF can run. */
async function drag(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
}

const { child: preview, port } = await startPreview();
const browser = await chromium.launch({
  ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
  // Required in containers: the default sandbox has no privileges to drop into
  // and Chromium dies on launch without a word.
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => m.type() === 'error' && console.log('  [page error]', m.text()));

try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.react-flow__node', { timeout: 20000 });

  // Import the benchmark session through the app's own Import button, so the
  // measured path is the real one.
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', FIXTURE);
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node').length > 200,
    undefined,
    { timeout: 60000 },
  );
  const count = await page.locator('.react-flow__node').count();
  console.log(`\nimported ${count} nodes in ${Date.now() - t0}ms\n`);

  // Let the initial layout and fitView settle.
  await page.waitForTimeout(1500);

  report(
    'pan (empty canvas)',
    await record(page, () => drag(page, { x: 720, y: 500 }, { x: 200, y: 300 }, 40)),
  );

  await page.waitForTimeout(300);
  report(
    'zoom out',
    await record(page, async () => {
      await page.mouse.move(720, 450);
      for (let i = 0; i < 20; i += 1) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(16);
      }
    }),
  );

  await page.waitForTimeout(300);
  report(
    'pan (zoomed out)',
    await record(page, () => drag(page, { x: 720, y: 500 }, { x: 300, y: 300 }, 40)),
  );

  // Drag a node: this is the path that writes to the store on every pointer
  // move, so it exercises re-render cost rather than just compositing.
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const handle = page.locator('.drag-handle').first();
  await handle.scrollIntoViewIfNeeded().catch(() => {});
  const box = await handle.boundingBox();
  if (box) {
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    report(
      'drag one node',
      await record(page, () => drag(page, from, { x: from.x + 260, y: from.y + 160 }, 40)),
    );
  } else {
    console.log('drag one node        : no drag handle visible, skipped');
  }
} finally {
  await browser.close();
  preview.kill();
}
