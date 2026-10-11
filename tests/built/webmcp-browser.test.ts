import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { WebMCPTool } from "~/lib/webmcp/register";

const origin = inject("siteOrigin");
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

interface TestWindow extends Window {
  readonly webmcpTest: { readonly tools: Map<string, WebMCPTool>; registrations: number };
}
interface NativeContext {
  readonly getTools: () => Promise<readonly NativeTool[]>;
  readonly executeTool: (
    tool: NativeTool,
    args: string | Record<string, unknown>,
  ) => Promise<string>;
}
type NativeTool = Omit<WebMCPTool, "execute" | "inputSchema"> & {
  readonly inputSchema: string | Record<string, unknown>;
};
type NativeDocument = Document & { readonly modelContext?: NativeContext };
const mockAPI = async (page: Page) => {
  await page.addInitScript(() => {
    const tools = new Map<string, { name: string }>();
    const state = { tools, registrations: 0 };
    Object.defineProperty(window, "webmcpTest", { value: state });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: async (tool: { name: string }, { signal }: { signal: AbortSignal }) => {
          if (signal.aborted) return;
          if (tools.has(tool.name)) throw new Error("Duplicate registration");
          tools.set(tool.name, tool);
          state.registrations++;
          signal.addEventListener(
            "abort",
            () => {
              if (tools.get(tool.name) === tool) tools.delete(tool.name);
            },
            { once: true },
          );
        },
      },
    });
  });
};
const execute = async (page: Page, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(
    await page.evaluate(
      async ({ name, args }) => {
        const tool = (window as unknown as TestWindow).webmcpTest.tools.get(name);
        if (!tool) throw new Error(`Missing tool ${name}`);
        return tool.execute(args);
      },
      { name, args },
    ),
  );
const ready = async (page: Page) => {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as TestWindow).webmcpTest.tools.size))
    .toBe(4);
};

describe("bundled browser WebMCP adapter (documented API test double)", () => {
  it.each(["ru", "en"])(
    "searches, reads and lists topics in %s; returns an honest scheduling handoff",
    async (language) => {
      const page = await browser.newPage();
      try {
        await mockAPI(page);
        const schedulerRequests: string[] = [];
        page.on("request", (request) => {
          if (/https:\/\/(?:app\.)?cal\.com\//.test(request.url()))
            schedulerRequests.push(request.url());
        });
        await page.goto(`${origin}/${language === "en" ? "en/" : ""}contact/`);
        await ready(page);
        const search = await execute(page, "search_articles", { query: "Claude", limit: 2 });
        expect(search.language).toBe(language);
        expect(search.articles.length).toBeGreaterThan(0);
        expect(search.articles.length).toBeLessThanOrEqual(2);
        const article = search.articles[0];
        const read = await execute(page, "read_article", { slug: article.slug, maxChars: 100 });
        expect(read.canonicalUrl).toBe(article.canonicalUrl);
        expect(read.language).toBe(language);
        expect(read.text.length).toBeLessThanOrEqual(100);
        expect(read.text).not.toContain("<script");
        expect(read.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const topics = await execute(page, "list_topics", { limit: 20 });
        expect(topics.topics.length).toBeGreaterThan(0);
        const tagged = await execute(page, "search_articles", { tag: topics.topics[0].tag });
        expect(
          tagged.articles.every((article: { tags: string[] }) =>
            article.tags.includes(topics.topics[0].tag),
          ),
        ).toBe(true);
        const handoff = await execute(page, "get_meeting_booking_link");
        expect(handoff).toMatchObject({
          bookingCreated: false,
          userConfirmationRequired: true,
          status: "booking_link",
          schedulerUrl: "https://cal.com/kashuta",
        });
        expect(handoff.schedulerUrl).toBe(
          await page.locator("[data-booking-fallback]").getAttribute("href"),
        );
        expect(handoff.siteUrl).toBe(
          `https://artka.dev/${language === "en" ? "en/" : ""}contact/#book`,
        );
        expect(schedulerRequests).toEqual([]);
        await expect(execute(page, "read_article", { slug: "../admin" })).rejects.toThrow();
        expect(await execute(page, "read_article", { slug: "unknown-public-article" })).toEqual({
          error: "article_not_found",
        });
      } finally {
        await page.close();
      }
    },
  );

  it("aborts old registrations and picks up locale through Astro navigation, history and reload", async () => {
    const page = await browser.newPage();
    try {
      await mockAPI(page);
      await page.goto(origin + "/contact/");
      await ready(page);
      expect(
        await page.evaluate(() => (window as unknown as TestWindow).webmcpTest.registrations),
      ).toBe(4);
      await page.locator('.site-header a[href="/en/contact/"]').click();
      await page.waitForURL(origin + "/en/contact/");
      await ready(page);
      expect(
        await page.evaluate(() => (window as unknown as TestWindow).webmcpTest.registrations),
      ).toBe(8);
      expect((await execute(page, "get_meeting_booking_link")).language).toBe("en");
      expect((await execute(page, "search_articles", { language: "ru" })).language).toBe("ru");
      await page.goBack();
      await page.waitForURL(origin + "/contact/");
      await expect
        .poll(() => page.evaluate(() => (window as unknown as TestWindow).webmcpTest.registrations))
        .toBe(12);
      await ready(page);
      expect((await execute(page, "get_meeting_booking_link")).language).toBe("ru");
      await page.goForward();
      await page.waitForURL(origin + "/en/contact/");
      await expect
        .poll(() => page.evaluate(() => (window as unknown as TestWindow).webmcpTest.registrations))
        .toBe(16);
      await ready(page);
      expect((await execute(page, "get_meeting_booking_link")).language).toBe("en");
      await page.reload();
      await ready(page);
      expect(
        await page.evaluate(() => (window as unknown as TestWindow).webmcpTest.registrations),
      ).toBe(4);
    } finally {
      await page.close();
    }
  });

  it("preserves ordinary search, contact navigation and booking fallback without the API", async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        Object.defineProperty(document, "modelContext", { value: undefined });
      });
      const contentRequests: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/public/articles/")) contentRequests.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/contact/");
      await page.locator(".site-header__search").click();
      await page.locator("[data-search-input]").fill("Claude");
      await expect.poll(() => page.locator(".search__result").count()).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      expect(await page.locator("[data-booking-fallback]").getAttribute("href")).toBe(
        "https://cal.com/kashuta",
      );
      await page.locator('.site-header a[href="/en/contact/"]').click();
      await page.waitForURL(origin + "/en/contact/");
      expect(await page.locator("html").getAttribute("lang")).toBe("en");
      expect(contentRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

it("public JSON routes enforce limits/validation with uncacheable generic failures", async () => {
  for (const path of [
    "search/?limit=21",
    "search/?query=a&query=b",
    "read/?slug=..%2Fadmin",
    "topics/?language=de",
    "topics/?extra=true",
    "read/?slug=one&maxChars=100000",
  ]) {
    const response = await fetch(`${origin}/api/public/articles/${path}`);
    expect(response.status, path).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_arguments" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  }
});

it("discovers and executes RU/EN tools through native browser WebMCP when available", async ({
  skip,
}) => {
  const nativeBrowser = await chromium.launch({ args: ["--enable-blink-features=WebMCP"] });
  try {
    const page = await nativeBrowser.newPage();
    const schedulerRequests: string[] = [];
    page.on("request", (request) => {
      if (/https:\/\/(?:app\.)?cal\.com\//.test(request.url()))
        schedulerRequests.push(request.url());
    });
    await page.goto(origin + "/contact/");
    if (
      !(await page.evaluate(
        () => typeof (document as NativeDocument).modelContext?.getTools === "function",
      ))
    )
      skip();
    // Chrome 153/154 executeTool takes JSON text; object arguments supersede it in 155.
    // This is the test consumer only. The registered application callbacks receive objects.
    const serializedArgs = Number(nativeBrowser.version().split(".")[0]) < 155;
    const invoke = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(
        await page.evaluate(
          async ({ name, args, serializedArgs }) => {
            const context = (document as NativeDocument).modelContext;
            if (!context) throw new Error("Native API unavailable");
            const tool = (await context.getTools()).find((tool) => tool.name === name);
            if (!tool) throw new Error(`Missing tool ${name}`);
            return context.executeTool(tool, serializedArgs ? JSON.stringify(args) : args);
          },
          { name, args, serializedArgs },
        ),
      );
    for (const language of ["ru", "en"]) {
      // Older native consumers return JSON text schemas; later Chrome returns objects.
      // Poll the awaited result outside the page, so readiness is actually checked.
      await expect
        .poll(() =>
          page.evaluate(async (language) => {
            const tools = await (document as NativeDocument).modelContext?.getTools();
            return (
              tools?.length === 4 &&
              tools.every((tool) => {
                const schema =
                  typeof tool.inputSchema === "string"
                    ? (JSON.parse(tool.inputSchema) as Record<string, unknown>)
                    : tool.inputSchema;
                const properties = schema.properties as Record<string, { default?: unknown }>;
                return properties.language?.default === language;
              })
            );
          }, language),
        )
        .toBe(true);
      const search = await invoke("search_articles", { query: "Claude", limit: 1 });
      expect(search.language).toBe(language);
      expect(search.articles).toHaveLength(1);
      const read = await invoke("read_article", { slug: search.articles[0].slug, maxChars: 100 });
      expect(read.canonicalUrl).toBe(search.articles[0].canonicalUrl);
      expect(read.text).toHaveLength(100);
      expect((await invoke("list_topics")).topics.length).toBeGreaterThan(0);
      expect(await invoke("get_meeting_booking_link")).toMatchObject({
        language,
        schedulerUrl: "https://cal.com/kashuta",
        bookingCreated: false,
      });
      if (language === "ru") {
        await page.locator('.site-header a[href="/en/contact/"]').click();
        await page.waitForURL(origin + "/en/contact/");
      }
    }
    await expect(invoke("read_article", { slug: "../admin" })).rejects.toThrow();
    expect(schedulerRequests).toEqual([]);
  } finally {
    await nativeBrowser.close();
  }
});
