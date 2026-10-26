export const SITE_SESSION_COOKIE = "task_flow_site_session";
export const SITE_SESSION_MAX_AGE = 12 * 60 * 60;

const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmacSha256(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(digest);
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export function siteAuthConfigured() {
  return Boolean(process.env.SITE_LOGIN_ID && process.env.SITE_PASSWORD && process.env.SESSION_SECRET);
}

export async function loginIdMatchesSiteLoginId(loginId) {
  const expected = process.env.SITE_LOGIN_ID || "";
  if (!expected) return false;
  const [actualDigest, expectedDigest] = await Promise.all([
    sha256(loginId || ""),
    sha256(expected)
  ]);
  return sameBytes(actualDigest, expectedDigest);
}

export async function passwordMatchesSitePassword(password) {
  const expected = process.env.SITE_PASSWORD || "";
  if (!expected) return false;
  const [actualDigest, expectedDigest] = await Promise.all([
    sha256(password || ""),
    sha256(expected)
  ]);
  return sameBytes(actualDigest, expectedDigest);
}

export async function createSiteSessionToken() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  const expiresAt = Date.now() + SITE_SESSION_MAX_AGE * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = await hmacSha256(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySiteSessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expectedSignature = await hmacSha256(payload, secret);
  return parts[2] === expectedSignature;
}
