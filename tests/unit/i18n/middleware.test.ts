import type { APIContext } from "astro";
import { describe, expect, it, vi } from "vitest";
import { i18nRootRedirect } from "~/lib/i18n/middleware";

const contextFor = (pathname: string, pref?: string, isPrerendered = false) =>
  ({
    url: new URL(pathname, "https://artka.dev"),
    isPrerendered,
    cookies: { get: () => (pref ? { value: pref } : undefined) },
    redirect: (location: string, status: number) =>
      new Response(null, { status, headers: { Location: location } }),
  }) as unknown as APIContext;

const requireResponse = (value: void | Response): Response => {
  if (!(value instanceof Response)) throw new Error("Middleware did not return a Response");
  return value;
};

describe("language preference cache variance", () => {
  it.each([undefined, "ru", "invalid"])(
    "varies the root page on Cookie for preference %s",
    async (pref) => {
      const next = vi.fn(
        async () =>
          new Response("home", {
            headers: { Vary: "Accept", "Cache-Control": "public, max-age=300" },
          }),
      );
      const response = requireResponse(await i18nRootRedirect(contextFor("/", pref), next));
      expect(response.status).toBe(200);
      expect(response.headers.get("Vary")).toBe("Accept, Cookie");
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
      expect(await response.text()).toBe("home");
    },
  );

  it("varies the EN preference redirect on Cookie", async () => {
    const next = vi.fn();
    const response = requireResponse(await i18nRootRedirect(contextFor("/", "en"), next));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/en/");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves an existing case-insensitive Cookie token without duplicating it", async () => {
    const next = vi.fn(async () => new Response("home", { headers: { Vary: "Accept, cookie" } }));
    const response = requireResponse(await i18nRootRedirect(contextFor("/"), next));
    expect(response.headers.get("Vary")).toBe("Accept, cookie");
  });

  it.each([
    ["/en/", false],
    ["/blog/", false],
    ["/", true],
  ] as const)("leaves %s (prerendered=%s) unchanged", async (path, prerendered) => {
    const original = new Response("page", { headers: { Vary: "Accept" } });
    const next = vi.fn(async () => original);
    const response = requireResponse(
      await i18nRootRedirect(contextFor(path, "en", prerendered), next),
    );
    expect(response).toBe(original);
    expect(response.headers.get("Vary")).toBe("Accept");
  });
});
