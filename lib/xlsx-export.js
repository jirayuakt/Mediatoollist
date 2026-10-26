import { normalizeData } from "./data-utils.js";

const columns = [
  "Main Task",
  "Task Name",
  "Task Type",
  "Automation Tool",
  "Function Explain",
  "Version",
  "File Path",
  "New_flag",
  "Tool Tag",
  "New_version",
  "Update Content"
];

function cellRef(columnIndex, rowIndex) {
  let column = "";
  let value = columnIndex;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return `${column}${rowIndex}`;
}

function xml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => (
      `<c r="${cellRef(columnIndex + 1, rowIndex + 1)}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`
    )).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastCell = cellRef(columns.length, Math.max(rows.length, 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function zipStored(entries) {
  const encoder = new TextEncoder();
  const files = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 8, 0);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    writeUint32(headerView, 0, 0x02014b50);
    writeUint16(headerView, 4, 20);
    writeUint16(headerView, 6, 20);
    writeUint16(headerView, 10, 0);
    writeUint32(headerView, 16, checksum);
    writeUint32(headerView, 20, data.length);
    writeUint32(headerView, 24, data.length);
    writeUint16(headerView, 28, nameBytes.length);
    writeUint32(headerView, 42, offset);
    header.set(nameBytes, 46);

    files.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeUint32(eocdView, 0, 0x06054b50);
  writeUint16(eocdView, 8, entries.length);
  writeUint16(eocdView, 10, entries.length);
  writeUint32(eocdView, 12, centralSize);
  writeUint32(eocdView, 16, offset);
  return concat([...files, ...central, eocd]);
}

function dataRows(data) {
  const normalized = normalizeData(data);
  const rows = [columns];
  for (const process of normalized.processes) {
    const tools = process.tools?.length ? process.tools : [{}];
    for (const tool of tools) {
      rows.push([
        process.mainTask,
        process.taskName,
        process.taskType,
        tool.name,
        tool.explanation,
        tool.version,
        tool.filePath,
        tool.isNew ? "1" : "",
        (tool.tags || []).join(", "),
        tool.isNewVersion ? "1" : "",
        tool.updateContent
      ]);
    }
  }
  return rows;
}

export function exportTaskFlowWorkbook(data) {
  return zipStored([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Task list" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`],
    ["xl/worksheets/sheet1.xml", sheetXml(dataRows(data))]
  ]);
}

export function excelFileName() {
  return `task-flow-data-${new Date().toISOString().slice(0, 10)}.xlsx`;
}
