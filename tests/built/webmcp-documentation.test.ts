import { describe, expect, inject, it } from "vitest";
import { createWebMCPTools } from "~/lib/webmcp/register";

const origin = inject("siteOrigin");
describe("public WebMCP documentation without bundle inspection", () => {
  it("publishes exact schemas from registration without claiming a remote MCP endpoint", async () => {
    const response = await fetch(origin + "/webmcp.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const manifest = await response.json();
    expect(manifest.browserApi).toBe("document.modelContext.registerTool");
    expect(manifest.remoteMcpEndpoint).toBe(false);
    for (const language of ["ru", "en"] as const) {
      const registered = createWebMCPTools(language).map(
        ({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations,
        }),
      );
      expect(manifest.toolsByLanguage[language]).toEqual(registered);
      expect(manifest.toolsByLanguage[language]).toHaveLength(4);
    }
  });
  it.each(["/webmcp/", "/en/webmcp/"])(
    "%s renders schemas and an honest booking limit with JS disabled",
    async (path) => {
      const response = await fetch(origin + path);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('content="noindex,follow"');
      expect(html).toContain('href="/webmcp.json"');
      expect(html).toContain("document.modelContext.registerTool");
      expect(html).toContain("bookingCreated");
      expect(html).toContain("false");
      for (const tool of createWebMCPTools(path.startsWith("/en/") ? "en" : "ru")) {
        expect(html).toContain(`id="tool-${tool.name}"`);
        expect(html).toContain("additionalProperties");
      }
    },
  );
});
