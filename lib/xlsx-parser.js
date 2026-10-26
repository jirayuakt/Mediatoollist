import { inflateRawSync } from "node:zlib";
import { canonicalHeader, normalizeData, normalizeMainTask, parseNewFlag, parseTags, slugify } from "./data-utils.js";

function textDecoder() {
  return new TextDecoder("utf-8");
}

function unzipEntries(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file.");

  const totalEntries = view.getUint16(eocd + 10, true);
  let centralOffset = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) {
      throw new Error("Invalid XLSX central directory.");
    }
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = textDecoder().decode(buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : inflateRawSync(compressed);
    entries.set(name, textDecoder().decode(content));

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attrs(nodeText) {
  const result = {};
  for (const match of nodeText.matchAll(/([:\w]+)="([^"]*)"/g)) {
    result[match[1]] = xmlDecode(match[2]);
  }
  return result;
}

function sharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml");
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map(([si]) => {
    return Array.from(si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => xmlDecode(match[1]))
      .join("");
  });
}

function firstWorksheet(entries) {
  if (entries.has("xl/worksheets/sheet1.xml")) return entries.get("xl/worksheets/sheet1.xml");
  const key = Array.from(entries.keys()).find((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"));
  if (!key) throw new Error("No worksheet found in XLSX file.");
  return entries.get(key);
}

function columnNameToNumber(name) {
  return String(name || "").split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function cellText(cellXml, strings) {
  const cellAttrs = attrs(cellXml.match(/<c\b[^>]*>/)?.[0] || "");
  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
  if (!value) {
    return Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => xmlDecode(match[1]))
      .join("")
      .trim();
  }
  if (cellAttrs.t === "s") return strings[Number(value)] || "";
  return xmlDecode(value).trim();
}

export async function parseWorkbook(arrayBuffer) {
  const buffer = Buffer.from(arrayBuffer);
  const entries = unzipEntries(buffer);
  const strings = sharedStrings(entries);
  const sheet = firstWorksheet(entries);
  const matrix = new Map();

  for (const rowMatch of sheet.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(rowMatch[1]);
    const row = new Map();
    for (const cellMatch of rowMatch[2].matchAll(/<c\b[^>]*r="([A-Z]+)\d+"[^>]*>[\s\S]*?<\/c>/g)) {
      row.set(columnNameToNumber(cellMatch[1]), cellText(cellMatch[0], strings));
    }
    matrix.set(rowIndex, row);
  }

  const headerRow = matrix.get(1);
  if (!headerRow) throw new Error("Workbook must have a header row.");
  const headers = {};
  headerRow.forEach((value, column) => {
    if (value) headers[canonicalHeader(value)] = column;
  });

  ["Main Task", "Task Name", "Task Type"].forEach((required) => {
    if (!headers[required]) throw new Error(`Missing required column: ${required}`);
  });

  const processes = [];
  const byKey = new Map();
  const usedSlugs = new Set();
  const warnings = [];
  const rowNumbers = Array.from(matrix.keys()).filter((row) => row > 1).sort((a, b) => a - b);

  rowNumbers.forEach((rowNumber) => {
    const row = matrix.get(rowNumber);
    const get = (header) => {
      const column = headers[header];
      return column ? String(row.get(column) || "").trim() : "";
    };
    const mainTask = normalizeMainTask(get("Main Task"));
    const taskName = get("Task Name");
    const taskType = get("Task Type");
    if (!mainTask || !taskName || !taskType) return;

    const key = `${mainTask}||${taskName}`;
    let process = byKey.get(key);
    if (!process) {
      const slug = slugify(taskName, usedSlugs);
      usedSlugs.add(slug);
      process = {
        order: processes.length + 1,
        mainTask,
        taskName,
        taskType,
        slug,
        tools: []
      };
      byKey.set(key, process);
      processes.push(process);
    }

    const toolName = get("Automation Tool");
    const updateContent = get("Update Content");
    const newFlag = get("New_flag");
    const newVersion = get("New_version");
    const isNew = parseNewFlag(newFlag);
    const isNewVersion = parseNewFlag(newVersion);

    if (isNew && updateContent && !isNewVersion) {
      warnings.push(`Row ${rowNumber}: ${toolName || taskName} has Update Content and New_flag, but New_version is blank.`);
    }
    if (isNew && isNewVersion) {
      warnings.push(`Row ${rowNumber}: ${toolName || taskName} has both New_flag and New_version set, so both badges will show.`);
    }

    process.tools.push({
      name: toolName,
      explanation: get("Function Explain"),
      updateContent,
      version: get("Version"),
      filePath: get("File Path"),
      tags: parseTags(get("Tool Tag") || get("Tool Tags")),
      isNew,
      isNewVersion
    });
  });

  if (!processes.length) throw new Error("No valid process rows found in workbook.");
  return normalizeData({ version: 1, warnings, processes });
}
