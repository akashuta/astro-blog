import { describe, expect, inject, it } from "vitest";
import { fetchWithTimeout } from "../support/production-server";

const origin = inject("siteOrigin");

describe("public search without a database index", () => {
  it.each([
    ["/search/", "Mermaid", "/blog/mermaid-svg-playwright-build-time/"],
    ["/en/search/", "Mermaid", "/en/blog/mermaid-svg-playwright-build-time/"],
    ["/en/search/", "hardware", "/en/blog/local-coding-agent/"],
  ])("finds current localized article text on %s for %s", async (path, query, articleUrl) => {
    const response = await fetchWithTimeout(`${origin}${path}?q=${encodeURIComponent(query)}`, {
      redirect: "manual",
    });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toMatch(/<meta\b[^>]*name="robots"[^>]*content="noindex,follow"/);
    const results = html.match(/<ul\b[^>]*class="search-page__results"[^>]*>([\s\S]*?)<\/ul>/)?.[1];
    expect(results, `search results for ${query}`).toBeDefined();
    expect(results).toContain(`href="${articleUrl}"`);
    expect(results).not.toMatch(/href="[^"]*\/courses\//);
  });

  it.each(["/search/", "/en/search/"])("keeps an oversized URL query safe on %s", async (path) => {
    const response = await fetchWithTimeout(`${origin}${path}?q=${"x".repeat(201)}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toMatch(/<meta\b[^>]*name="robots"[^>]*content="noindex,follow"/);
    expect(html).not.toContain('class="search-page__results"');
  });
});
