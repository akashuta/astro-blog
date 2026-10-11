import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const origin = inject("siteOrigin");
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

// The real index is covered by webmcp-browser.test.ts. Deterministic results
// here exercise modal focus and a late search response without network timing.
const mockSearch = async (page: Page): Promise<void> => {
  await page.route("**/pagefind/pagefind.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        export const init = async () => {};
        export const debouncedSearch = async (query) => {
          if (query === "slow") await new Promise(resolve => setTimeout(resolve, 250));
          const prefix = document.documentElement.lang === "en" ? "/en" : "";
          return { results: [0, 1].map(index => ({
            id: String(index),
            data: async () => ({
              url: prefix + "/about/",
              excerpt: "Article excerpt",
              meta: { title: query + " result " + index },
            }),
          })) };
        };
      `,
    }),
  );
};

const isFocused = async (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).evaluate((element) => document.activeElement === element);

describe.each([375, 1440])("search keyboard accessibility at %ipx", (width) => {
  it.each(["ru", "en"])("contains and restores focus in %s", async (language) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      await mockSearch(page);
      await page.goto(`${origin}/${language === "en" ? "en/" : ""}about/`);
      await page.locator(".site-header__search").click();
      await expect.poll(() => isFocused(page, "[data-search-input]")).toBe(true);
      for (const key of ["Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        await expect.poll(() => isFocused(page, "[data-search-input]")).toBe(true);
      }
      await page.locator("[data-search-input]").fill("alpha");
      await expect.poll(() => page.getByRole("option").count()).toBe(2);
      await page.getByRole("option").last().focus();
      await page.keyboard.press("Tab");
      await expect.poll(() => isFocused(page, "[data-search-input]")).toBe(true);
      await page.keyboard.press("Shift+Tab");
      expect(
        await page
          .getByRole("option")
          .last()
          .evaluate((el) => document.activeElement === el),
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withRules([
          "aria-input-field-name",
          "aria-required-parent",
          "aria-required-children",
          "landmark-no-duplicate-contentinfo",
          "aria-hidden-focus",
        ])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.keyboard.press("Escape");
      await expect.poll(() => isFocused(page, ".site-header__search")).toBe(true);
      expect(await page.locator("html").evaluate((el) => el.style.overflow)).toBe("");
      await page.locator(".site-header__search").click();
      await page.locator("[data-search-input]").fill("alpha");
      await expect.poll(() => page.getByRole("option").count()).toBe(2);
      await page.keyboard.press("Enter");
      await expect
        .poll(() => page.locator("[data-search]").getAttribute("aria-hidden"))
        .toBe("true");
    } finally {
      await context.close();
    }
  });
});

it.each(["ru", "en"])(
  "includes visible header labels in accessible names in %s",
  async (language) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/${language === "en" ? "en/" : ""}about/`);
      const results = await new AxeBuilder({ page })
        .include(".site-header")
        .withRules(["label-content-name-mismatch"])
        .analyze();
      expect(results.violations).toEqual([]);
    } finally {
      await context.close();
    }
  },
);

it("rebinds search after Astro navigation and ignores results from a closed search", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
  try {
    await mockSearch(page);
    await page.goto(origin + "/blog/");
    for (const path of ["/en/blog/", "/blog/", "/en/blog/"]) {
      await page.locator(".site-header__actions .lang-toggle").click();
      await page.waitForURL(origin + path);
      await page.locator(".site-header__search").focus();
      await page.keyboard.press("ControlOrMeta+k");
      await expect.poll(() => isFocused(page, "[data-search-input]")).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(() => isFocused(page, ".site-header__search")).toBe(true);
    }
    await page.locator(".site-header__search").click();
    await page.locator("[data-search-input]").fill("slow");
    await page.keyboard.press("Escape");
    await page.locator(".site-header__search").click();
    await page.locator("[data-search-input]").fill("fast");
    await expect
      .poll(() => page.getByRole("option").first().textContent())
      .toContain("fast result");
    // Wait for the delayed response, then make a fresh observable assertion.
    await page.waitForTimeout(350);
    expect(await page.getByRole("option").first().textContent()).toContain("fast result");
  } finally {
    await page.close();
  }
});

it("keeps real Pagefind results and Enter navigation in the current Astro locale", async () => {
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(origin + "/blog/");
    for (const language of ["ru", "en", "ru"] as const) {
      const prefix = language === "en" ? "/en" : "";
      if ((await page.locator("html").getAttribute("lang")) !== language) {
        await page.locator(".site-header__actions .lang-toggle").click();
        await page.waitForURL(origin + prefix + "/blog/");
      }
      await page.locator(".site-header__search").click();
      await page.locator("[data-search-input]").fill("Claude");
      await expect.poll(() => page.locator(".search__result").count()).toBeGreaterThan(0);
      const hrefs = await page
        .locator(".search__result")
        .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
      expect(hrefs.every((path) => path.startsWith(prefix + "/blog/"))).toBe(true);
      const destination = await page.locator(".search__result").first().getAttribute("href");
      await page.keyboard.press("Enter");
      await page.waitForURL(new URL(destination!, origin).href);
      expect(await page.locator("html").getAttribute("lang")).toBe(language);
      // Return through the footer, keeping the Pagefind module alive in this tab.
      await page.locator(`.site-footer a[href="${prefix}/blog/"]`).click();
      await page.waitForURL(origin + prefix + "/blog/");
    }
  } finally {
    await context.close();
  }
});

it.each(["ru", "en"])(
  "offers localized server search when Pagefind is unavailable in %s",
  async (language) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route("**/pagefind/pagefind.js", (route) => route.abort());
      await page.goto(`${origin}/${language === "en" ? "en/" : ""}about/`);
      await page.locator(".site-header__search").click();
      const query = "Claude & <agents> " + "x".repeat(220);
      await page.locator("[data-search-input]").fill(query);
      const fallback = page.getByRole("link", {
        name: language === "en" ? "Search on the search page" : "Найти на странице поиска",
      });
      await expect.poll(() => fallback.count()).toBe(1);
      const url = new URL((await fallback.getAttribute("href"))!, origin);
      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe(language === "en" ? "/en/search/" : "/search/");
      expect(url.searchParams.get("q")).toBe(query.slice(0, 200));
      expect(await page.locator("[data-search-results]").textContent()).not.toContain("pnpm");
    } finally {
      await context.close();
    }
  },
);
