import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromium, type Browser } from "playwright";

const origin = inject("siteOrigin");
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe.each([375, 1440])("article diagram theme at %ipx", (width) => {
  it.each(["paper", "dark"])("renders only the %s variant without page overflow", async (theme) => {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();
      await page.goto(origin + "/blog/claude-md-12-rules/");
      if (theme === "dark") await page.locator(".site-header [data-theme-toggle]").click();
      const diagram = page.locator(".diagram__canvas").first();
      await diagram.scrollIntoViewIfNeeded();
      expect(await diagram.locator(".diagram__img--light").isVisible()).toBe(theme === "paper");
      expect(await diagram.locator(".diagram__img--dark").isVisible()).toBe(theme === "dark");
      expect(await diagram.locator("img:visible").count()).toBe(1);
      await expect
        .poll(() =>
          diagram
            .locator("img:visible")
            .evaluate(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      await context.close();
    }
  });
});
