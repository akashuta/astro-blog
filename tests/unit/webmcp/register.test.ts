import { describe, expect, it, vi } from "vitest";
import {
  createWebMCPTools,
  registerWebMCPTools,
  type WebMCPDocument,
  type WebMCPTool,
} from "~/lib/webmcp/register";

it("does nothing without document.modelContext", async () => {
  await expect(
    registerWebMCPTools({} as WebMCPDocument, new AbortController()),
  ).resolves.toBeUndefined();
});
it("registers four read-only tools with strict input schemas and owned abort signals", async () => {
  const registerTool = vi.fn().mockResolvedValue(undefined);
  const controller = new AbortController();
  await registerWebMCPTools(
    {
      documentElement: { lang: "en" },
      modelContext: { registerTool },
    } as unknown as WebMCPDocument,
    controller,
  );
  expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
    "search_articles",
    "read_article",
    "list_topics",
    "get_meeting_booking_link",
  ]);
  for (const [tool, options] of registerTool.mock.calls) {
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.properties.language.default).toBe("en");
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(options.signal).toBe(controller.signal);
  }
});
it("rolls back partial registration without breaking the page", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const registerTool = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error("tools policy"));
  const controller = new AbortController();
  await registerWebMCPTools(
    {
      documentElement: { lang: "ru" },
      modelContext: { registerTool },
    } as unknown as WebMCPDocument,
    controller,
  );
  expect(controller.signal.aborted).toBe(true);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
it("stops registering after navigation aborts a pending registration", async () => {
  const controller = new AbortController();
  const registerTool = vi.fn(async () => {
    controller.abort();
  });
  await registerWebMCPTools(
    {
      documentElement: { lang: "ru" },
      modelContext: { registerTool },
    } as unknown as WebMCPDocument,
    controller,
  );
  expect(registerTool).toHaveBeenCalledTimes(1);
});

describe("tool execution", () => {
  const find = (tools: readonly WebMCPTool[], name: string): WebMCPTool => {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(name);
    return tool;
  };
  it("defaults to page language, permits explicit RU/EN, and forwards cancellation without credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ articles: [] }));
    const tool = find(createWebMCPTools("en", fetcher), "search_articles");
    const controller = new AbortController();
    expect(
      JSON.parse(await tool.execute({ query: "agent" }, { signal: controller.signal })),
    ).toEqual({ articles: [] });
    expect(fetcher.mock.calls[0]?.[0]).toContain("language=en");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      signal: controller.signal,
    });
    await tool.execute({ language: "ru" });
    expect(fetcher.mock.calls[1]?.[0]).toContain("language=ru");
    controller.abort();
    await expect(tool.execute({}, { signal: controller.signal })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("validates even if a browser skips schema validation", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const tool = find(createWebMCPTools("ru", fetcher), "read_article");
    await expect(tool.execute({ slug: "../../admin", language: "de" })).rejects.toThrow();
    await expect(tool.execute({ slug: "one", maxChars: 100_000 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports failed article access without claiming successful retrieval", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private failure", { status: 503 }));
    const tool = find(createWebMCPTools("en", fetcher), "list_topics");
    expect(JSON.parse(await tool.execute({}))).toEqual({ error: "content_unavailable" });
  });
  it.each(["ru", "en"] as const)(
    "hands off booking in %s without fetching, opening or claiming a reservation",
    async (language) => {
      const fetcher = vi.fn<typeof fetch>();
      const tool = find(createWebMCPTools(language, fetcher), "get_meeting_booking_link");
      expect(JSON.parse(await tool.execute({}))).toMatchObject({
        language,
        status: "booking_link",
        schedulerUrl: "https://cal.com/kashuta",
        siteUrl: `https://artka.dev/${language === "en" ? "en/" : ""}contact/#book`,
        bookingCreated: false,
        userConfirmationRequired: true,
      });
      expect(fetcher).not.toHaveBeenCalled();
      await expect(tool.execute({ language: "de" })).rejects.toThrow();
    },
  );
});
