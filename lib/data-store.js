import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeData } from "./data-utils.js";

const seedPath = path.join(process.cwd(), "data", "seed.json");
const localDataPath = path.join(process.cwd(), ".local-data", "data.json");
const blobPath = process.env.BLOB_DATA_PATH || "task-flow/data.json";
const blobToken = process.env.DMD_TOOL_READ_WRITE_TOKEN;
const blobAccess = "private";

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readBlobData() {
  if (!blobToken) return null;
  try {
    const { get } = await import("@vercel/blob");
    const result = await get(blobPath, { access: blobAccess, token: blobToken });
    if (result?.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text());
  } catch (error) {
    console.warn("Blob read failed, falling back to local/seed data:", error.message);
    return null;
  }
}

async function writeBlobData(data) {
  if (!blobToken) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("DMD_TOOL_READ_WRITE_TOKEN is not configured for this deployment.");
    }
    return false;
  }
  const { put } = await import("@vercel/blob");
  await put(blobPath, JSON.stringify(data, null, 2), {
    access: blobAccess,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    token: blobToken
  });
  return true;
}

export async function getData() {
  const blobData = await readBlobData();
  if (blobData) return normalizeData(blobData);

  try {
    return normalizeData(await readJsonFile(localDataPath));
  } catch {
    return normalizeData(await readJsonFile(seedPath));
  }
}

export async function setData(data) {
  const normalized = normalizeData(data);
  if (await writeBlobData(normalized)) return normalized;

  await fs.mkdir(path.dirname(localDataPath), { recursive: true });
  await fs.writeFile(localDataPath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function assertAdmin(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 500, message: "ADMIN_PASSWORD is not configured." };
    }
    return { ok: true };
  }
  const actual = request.headers.get("x-admin-password") || "";
  if (actual !== expected) {
    return { ok: false, status: 401, message: "Invalid admin password." };
  }
  return { ok: true };
}
