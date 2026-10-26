import assert from "node:assert/strict";
import { parseWorkbook } from "../lib/xlsx-parser.js";
import { exportTaskFlowWorkbook } from "../lib/xlsx-export.js";

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
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

function zipStored(entries) {
  const files = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);

    const header = Buffer.alloc(46 + nameBuffer.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt32LE(0, 32);
    header.writeUInt32LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    nameBuffer.copy(header, 46);

    files.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((total, item) => total + item.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, ...central, eocd]);
}

const workbook = zipStored([[
  "xl/worksheets/sheet1.xml",
  sheetXml([
    ["Main Task", "Task Name", "Task Type", "Automation Tool", "Function Explain", "Version", "File Path", "New_flag", "Tool Tag", "New_version", "Update Content"],
    ["Stage", "Version Process", "Main", "Version Tool", "Explain", "1.2", "", "", "", "1", "Added feature"],
    ["Stage", "New Process", "Main", "New Tool", "Explain", "1.0", "", "1", "", "", ""],
    ["Stage", "Suspicious Process", "Main", "Suspicious Tool", "Explain", "2.0", "", "1", "", "", "Fixed bug"],
    ["Stage", "Both Process", "Main", "Both Tool", "Explain", "3.0", "", "1", "", "1", "Changed behavior"]
  ])
]]);

const data = await parseWorkbook(workbook);
const tools = data.processes.map((process) => process.tools[0]);

assert.equal(tools[0].isNew, false);
assert.equal(tools[0].isNewVersion, true);
assert.equal(tools[1].isNew, true);
assert.equal(tools[1].isNewVersion, false);
assert.equal(tools[2].isNew, true);
assert.equal(tools[2].isNewVersion, false);
assert.equal(tools[3].isNew, true);
assert.equal(tools[3].isNewVersion, true);
assert.equal(data.warnings.length, 2);
assert.match(data.warnings[0], /Row 4: Suspicious Tool/);
assert.match(data.warnings[1], /Row 5: Both Tool/);

const exported = await parseWorkbook(exportTaskFlowWorkbook({
  version: 1,
  processes: [{
    mainTask: "Stage",
    taskName: "Editable Process",
    taskType: "Main",
    tools: [{
      name: "Editable Tool",
      explanation: "Explain",
      updateContent: "Changed",
      version: "4.0",
      filePath: "C:\\Tool\\Editable.exe",
      tags: ["QC", "RPA"],
      isNew: false,
      isNewVersion: true
    }]
  }]
}));

assert.equal(exported.processes[0].tools[0].name, "Editable Tool");
assert.equal(exported.processes[0].tools[0].isNew, false);
assert.equal(exported.processes[0].tools[0].isNewVersion, true);
assert.deepEqual(exported.processes[0].tools[0].tags, ["QC", "RPA"]);

console.log("xlsx parser flag warnings ok");
