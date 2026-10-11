import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchNode } from "~/lib/search/pagefind-node";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("~/lib/public-content/server", () => ({ publicContent: { search: searchMock } }));

describe("public search page adapter", () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it.each([
    [
      "ru",
      "https://artka.dev/blog/mermaid-svg-playwright-build-time/",
      "/blog/mermaid-svg-playwright-build-time/",
    ],
    [
      "en",
      "https://artka.dev/en/blog/mermaid-svg-playwright-build-time/",
      "/en/blog/mermaid-svg-playwright-build-time/",
    ],
  ] as const)(
    "keeps the canonical %s result path from the shared read model",
    async (locale, canonicalUrl, url) => {
      searchMock.mockResolvedValue({
        articles: [{ canonicalUrl, title: "Mermaid SVG", description: "Build-time diagrams" }],
      });
      await expect(searchNode("Mermaid", locale)).resolves.toEqual([
        { url, title: "Mermaid SVG", excerpt: "Build-time diagrams" },
      ]);
      expect(searchMock).toHaveBeenCalledWith({ query: "Mermaid", language: locale, limit: 20 });
    },
  );

  it("does not search for a blank query", async () => {
    await expect(searchNode("   ", "en")).resolves.toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("does not pass an oversized URL query to the constrained content service", async () => {
    await expect(searchNode("x".repeat(201), "en")).resolves.toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("trims whitespace before applying the query limit", async () => {
    searchMock.mockResolvedValue({ articles: [] });
    await expect(searchNode(` ${"x".repeat(200)} `, "en")).resolves.toEqual([]);
    expect(searchMock).toHaveBeenCalledWith({ query: "x".repeat(200), language: "en", limit: 20 });
  });

  it("preserves a configured content-service failure instead of reporting no results", async () => {
    searchMock.mockRejectedValue(new Error("content metadata unavailable"));
    await expect(searchNode("Mermaid", "en")).rejects.toThrow("content metadata unavailable");
  });
});
