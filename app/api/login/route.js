import { NextResponse } from "next/server";
import {
  SITE_SESSION_COOKIE,
  SITE_SESSION_MAX_AGE,
  createSiteSessionToken,
  loginIdMatchesSiteLoginId,
  passwordMatchesSitePassword,
  siteAuthConfigured
} from "../../../lib/site-auth.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!siteAuthConfigured()) {
    return NextResponse.json(
      { error: "SITE_LOGIN_ID, SITE_PASSWORD, and SESSION_SECRET are not configured." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const [loginIdOk, passwordOk] = await Promise.all([
    loginIdMatchesSiteLoginId(body.loginId || ""),
    passwordMatchesSitePassword(body.password || "")
  ]);
  if (!loginIdOk || !passwordOk) {
    return NextResponse.json({ error: "Invalid ID or password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SITE_SESSION_COOKIE,
    value: await createSiteSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SITE_SESSION_MAX_AGE
  });
  return response;
}
