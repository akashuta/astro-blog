import type { APIRoute } from "astro";
import { ZodError } from "zod";
import { contentInputs, type ContentOperation } from "~/lib/public-content/contracts";
import { publicContent } from "~/lib/public-content/server";
import { logger } from "~/lib/logger";

export const prerender = false;
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });

export const GET: APIRoute = async ({ params, url }) => {
  if (!params.operation || !Object.hasOwn(contentInputs, params.operation)) {
    return json({ error: "unknown_operation" }, 404);
  }
  const operation = params.operation as ContentOperation;
  if (
    url.search.length > 2048 ||
    [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length > 1)
  ) {
    return json({ error: "invalid_arguments" }, 400);
  }
  const args = Object.fromEntries(
    [...url.searchParams].map(([key, value]) => [
      key,
      ["limit", "offset", "maxChars"].includes(key) && /^\d+$/.test(value) ? Number(value) : value,
    ]),
  );
  try {
    const input = contentInputs[operation].parse(args);
    const result = await publicContent[operation](input);
    return result === null ? json({ error: "article_not_found" }, 404) : json(result);
  } catch (error) {
    if (error instanceof ZodError) return json({ error: "invalid_arguments" }, 400);
    logger.error({ err: error, operation }, "Public article access unavailable");
    return json({ error: "content_unavailable" }, 503);
  }
};
