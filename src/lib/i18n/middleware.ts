import { defineMiddleware } from "astro:middleware";
import { isLocale } from "~/i18n";

const COOKIE_NAME = "lang-pref";

/**
 * On root path /, redirect to /en/ if the visitor has previously chosen EN.
 * Direct article links never auto-redirect — visitors get the language they clicked on.
 */
export const i18nRootRedirect = defineMiddleware(async (context, next) => {
  if (context.url.pathname !== "/") return next();
  if (context.isPrerendered) return next();

  const pref = context.cookies.get(COOKIE_NAME)?.value;
  const response = isLocale(pref) && pref === "en" ? context.redirect("/en/", 302) : await next();
  // Both representations depend on the preference cookie, including its absence.
  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  const tokens = vary?.split(",").map((token) => token.trim().toLowerCase()) ?? [];
  if (tokens.includes("cookie") || tokens.includes("*")) return response;
  headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
