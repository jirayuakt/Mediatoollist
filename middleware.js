import { NextResponse } from "next/server";
import { SITE_SESSION_COOKIE, siteAuthConfigured, verifySiteSessionToken } from "./lib/site-auth.js";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/api/logout",
  "/favicon.ico"
]);

function isPublicAsset(pathname) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    pathname.match(/\.(?:css|js|map|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/)
  );
}

function loginUrl(request) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return url;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || isPublicAsset(pathname)) {
    if (pathname !== "/login") return NextResponse.next();

    const token = request.cookies.get(SITE_SESSION_COOKIE)?.value;
    if (siteAuthConfigured() && await verifySiteSessionToken(token)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SITE_SESSION_COOKIE)?.value;
  if (siteAuthConfigured() && await verifySiteSessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Login required." }, { status: 401 });
  }

  return NextResponse.redirect(loginUrl(request));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
