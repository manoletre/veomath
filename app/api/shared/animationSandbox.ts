import { chromium, Browser, Page } from 'playwright';
import { storeCode } from '../agentic/sandbox-code/route';

const BASE_URL = process.env.SANDBOX_URL || 'http://localhost:3000';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

export interface SandboxResult {
  screenshots: string[];
  errors: string[];
  success: boolean;
}

export async function testAnimation(code: string): Promise<SandboxResult> {
  const id = crypto.randomUUID();
  storeCode(id, code);

  const screenshots: string[] = [];
  const errors: string[] = [];
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto(`${BASE_URL}/sandbox?id=${id}`, { waitUntil: 'domcontentloaded' });

    // Wait for __animationReady with timeout
    try {
      await page.waitForFunction('window.__animationReady === true', { timeout: 15000 });
    } catch {
      errors.push('Animation timed out after 15s');
    }

    // Collect errors from the page
    const pageErrors: string[] = await page.evaluate(() => window.__animationErrors || []);
    errors.push(...pageErrors);

    // Wait a beat for rendering to settle
    await page.waitForTimeout(500);

    // Take initial screenshot
    const initialShot = await page.screenshot({ type: 'jpeg', quality: 80 });
    screenshots.push(`data:image/jpeg;base64,${initialShot.toString('base64')}`);

    // Simulate interactivity: find sliders and wiggle them
    const sliders = await page.$$('input[type="range"]');
    for (const slider of sliders) {
      try {
        const currentVal = await slider.evaluate((el: HTMLInputElement) => parseFloat(el.value));
        const min = await slider.evaluate((el: HTMLInputElement) => parseFloat(el.min));
        const max = await slider.evaluate((el: HTMLInputElement) => parseFloat(el.max));

        // Move slider to ~70% of range
        const newVal = min + (max - min) * 0.7;
        if (newVal !== currentVal) {
          await slider.evaluate((el: HTMLInputElement, v: number) => {
            el.value = String(v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, newVal);
        }
      } catch {}
    }

    // Simulate a drag in the canvas center (for draggable elements)
    const canvas = await page.$('canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        try {
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx + 60, cy + 30, { steps: 5 });
          await page.mouse.up();
        } catch {}
      }
    }

    await page.waitForTimeout(800);

    // Collect any new runtime errors that appeared after interaction
    const postErrors: string[] = await page.evaluate(() => window.__animationErrors || []);
    for (const e of postErrors) {
      if (!errors.includes(e)) errors.push(e);
    }

    // Take post-interaction screenshot
    const postShot = await page.screenshot({ type: 'jpeg', quality: 80 });
    screenshots.push(`data:image/jpeg;base64,${postShot.toString('base64')}`);

  } catch (err) {
    errors.push(`Sandbox error: ${String(err)}`);
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }

  return {
    screenshots,
    errors,
    success: errors.length === 0,
  };
}
