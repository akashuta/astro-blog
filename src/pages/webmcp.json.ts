import type { APIRoute } from "astro";
import { createWebMCPTools } from "~/lib/webmcp/register";

// The adapter does not retain arbitrary response headers on static files.
export const prerender = false;

/** Documentation generated from the registered definitions, not an MCP transport. */
export const GET: APIRoute = () =>
  Response.json(
    {
      kind: "webmcp_documentation",
      browserApi: "document.modelContext.registerTool",
      remoteMcpEndpoint: false,
      documentation: { ru: "https://artka.dev/webmcp/", en: "https://artka.dev/en/webmcp/" },
      toolsByLanguage: Object.fromEntries(
        (["ru", "en"] as const).map((language) => [
          language,
          createWebMCPTools(language).map(({ name, description, inputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            annotations,
          })),
        ]),
      ),
    },
    { headers: { "x-robots-tag": "noindex" } },
  );
