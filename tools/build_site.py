from __future__ import annotations

import html
import json
import posixpath
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
WORKBOOK_PATH = ROOT / "Task list_Tool.xlsx"
DIST_DIR = ROOT / "dist"

REQUIRED_COLUMNS = [
    "Main Task",
    "Task Name",
    "Task Type",
    "Automation Tool",
    "Function Explain",
    "Version",
    "File Path",
    "Tool Tag",
    "New_flag",
    "New_version",
]

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ET.register_namespace("", NS_MAIN)
ET.register_namespace("r", NS_REL)


@dataclass
class ToolEntry:
    name: str
    explanation: str
    version: str
    file_path: str
    tags: list[str]
    is_new: bool
    is_new_version: bool


@dataclass
class Process:
    order: int
    main_task: str
    task_name: str
    task_type: str
    slug: str
    tools: list[ToolEntry] = field(default_factory=list)


def qn(name: str) -> str:
    return f"{{{NS_MAIN}}}{name}"


def col_to_number(col: str) -> int:
    value = 0
    for char in col:
        value = value * 26 + ord(char.upper()) - 64
    return value


def number_to_col(number: int) -> str:
    chars: list[str] = []
    while number:
        number, rem = divmod(number - 1, 26)
        chars.append(chr(65 + rem))
    return "".join(reversed(chars))


def split_ref(cell_ref: str) -> tuple[str, int]:
    match = re.fullmatch(r"([A-Z]+)(\d+)", cell_ref)
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    return match.group(1), int(match.group(2))


def slugify(value: str, used: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    base = base or "process"
    slug = base
    counter = 2
    while slug in used:
        slug = f"{base}-{counter}"
        counter += 1
    used.add(slug)
    return slug


def normalize_main_task(value: str) -> str:
    cleaned = value.strip()
    if cleaned == "Data Preparation?":
        return "Data Preparation"
    return cleaned


def canonical_header(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "", value.lower())
    aliases = {
        "maintask": "Main Task",
        "taskname": "Task Name",
        "tasktype": "Task Type",
        "automationtool": "Automation Tool",
        "functionexplain": "Function Explain",
        "functionexplanation": "Function Explain",
        "version": "Version",
        "filepath": "File Path",
        "newflag": "New_flag",
        "newtool": "New_flag",
        "newversion": "New_version",
        "versionnew": "New_version",
        "tooltag": "Tool Tag",
        "tooltags": "Tool Tag",
    }
    return aliases.get(key, value.strip())


def parse_tags(value: str) -> list[str]:
    tags = [tag.strip() for tag in re.split(r"[,;|/]+", value) if tag.strip()]
    return list(dict.fromkeys(tags))


def parse_new_flag(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "new"}


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for si in root.findall(qn("si")):
        parts = [node.text or "" for node in si.iter(qn("t"))]
        strings.append("".join(parts))
    return strings


def sheet_path(zf: zipfile.ZipFile, sheet_index: int = 0) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    sheets = workbook.find(qn("sheets"))
    if sheets is None:
        raise ValueError("Workbook has no sheets.")
    sheet = sheets.findall(qn("sheet"))[sheet_index]
    rel_id = sheet.attrib[f"{{{NS_REL}}}id"]

    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    for rel in rels.findall(f"{{{rel_ns}}}Relationship"):
        if rel.attrib["Id"] == rel_id:
            target = rel.attrib["Target"]
            return posixpath.normpath(posixpath.join("xl", target))
    raise ValueError(f"Could not resolve worksheet relationship {rel_id}.")


def cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value_node = cell.find(qn("v"))
    if value_node is None:
        inline = cell.find(qn("is"))
        if inline is None:
            return ""
        return "".join(node.text or "" for node in inline.iter(qn("t"))).strip()
    raw = value_node.text or ""
    if cell_type == "s":
        return shared_strings[int(raw)] if raw else ""
    return raw.strip()


def load_rows(workbook_path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(workbook_path) as zf:
        shared_strings = read_shared_strings(zf)
        worksheet_path = sheet_path(zf)
        sheet = ET.fromstring(zf.read(worksheet_path))

    sheet_data = sheet.find(qn("sheetData"))
    if sheet_data is None:
        return []

    matrix: dict[int, dict[int, str]] = {}
    for row in sheet_data.findall(qn("row")):
        row_index = int(row.attrib["r"])
        matrix[row_index] = {}
        for cell in row.findall(qn("c")):
            col_letters, _ = split_ref(cell.attrib["r"])
            matrix[row_index][col_to_number(col_letters)] = cell_text(cell, shared_strings)

    headers = [canonical_header(matrix.get(1, {}).get(i, "")) for i in range(1, len(REQUIRED_COLUMNS) + 1)]
    rows: list[dict[str, str]] = []
    for row_index in sorted(index for index in matrix if index > 1):
        record = {
            header: matrix.get(row_index, {}).get(i, "").strip()
            for i, header in enumerate(headers, start=1)
            if header
        }
        if any(record.values()):
            rows.append(record)
    return rows


def write_shared_string(parent: ET.Element, value: str) -> None:
    si = ET.SubElement(parent, qn("si"))
    t = ET.SubElement(si, qn("t"))
    t.text = value


def cell_value(cell: ET.Element, string_index: int) -> None:
    for child in list(cell):
        cell.remove(child)
    cell.attrib["t"] = "s"
    v = ET.SubElement(cell, qn("v"))
    v.text = str(string_index)


def ensure_workbook_schema(workbook_path: Path) -> bool:
    with zipfile.ZipFile(workbook_path) as zf:
        names = zf.namelist()
        shared_strings = read_shared_strings(zf)
        worksheet_path = sheet_path(zf)
        sheet = ET.fromstring(zf.read(worksheet_path))
        shared_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        sheet_xml_original = zf.read(worksheet_path)
        shared_xml_original = zf.read("xl/sharedStrings.xml")

    sheet_data = sheet.find(qn("sheetData"))
    if sheet_data is None:
        raise ValueError("Worksheet has no sheetData.")

    header_row = sheet_data.find(f"{qn('row')}[@r='1']")
    if header_row is None:
        raise ValueError("Worksheet has no header row.")

    existing_headers: dict[str, int] = {}
    for cell in header_row.findall(qn("c")):
        col_letters, _ = split_ref(cell.attrib["r"])
        text = cell_text(cell, shared_strings)
        if text:
            existing_headers[text] = col_to_number(col_letters)

    missing = [column for column in REQUIRED_COLUMNS if column not in existing_headers]
    if not missing:
        return False

    next_col = max(existing_headers.values(), default=0) + 1
    string_index = len(shared_strings)
    for column in missing:
        col_name = number_to_col(next_col)
        cell = ET.SubElement(header_row, qn("c"), {"r": f"{col_name}1", "s": "3", "t": "s"})
        cell_value(cell, string_index)
        write_shared_string(shared_root, column)
        shared_strings.append(column)
        string_index += 1
        next_col += 1

    final_col = number_to_col(max(len(REQUIRED_COLUMNS), next_col - 1))
    max_row = max(int(row.attrib["r"]) for row in sheet_data.findall(qn("row")))
    dimension = sheet.find(qn("dimension"))
    if dimension is not None:
        dimension.attrib["ref"] = f"A1:{final_col}{max_row}"

    cols = sheet.find(qn("cols"))
    if cols is not None:
        existing_col_nums = {
            int(col.attrib["min"])
            for col in cols.findall(qn("col"))
            if col.attrib.get("min") == col.attrib.get("max")
        }
        widths = {5: "34", 6: "14", 7: "52", 8: "24", 9: "14"}
        for col_num in range(5, len(REQUIRED_COLUMNS) + 1):
            if col_num not in existing_col_nums:
                ET.SubElement(
                    cols,
                    qn("col"),
                    {
                        "min": str(col_num),
                        "max": str(col_num),
                        "width": widths.get(col_num, "24"),
                        "customWidth": "1",
                    },
                )

    shared_root.attrib["count"] = str(len(shared_strings))
    shared_root.attrib["uniqueCount"] = str(len(shared_strings))

    new_sheet_xml = ET.tostring(sheet, encoding="utf-8", xml_declaration=True)
    new_shared_xml = ET.tostring(shared_root, encoding="utf-8", xml_declaration=True)
    if new_sheet_xml == sheet_xml_original and new_shared_xml == shared_xml_original:
        return False

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx", dir=workbook_path.parent) as tmp:
        tmp_path = Path(tmp.name)

    try:
        with zipfile.ZipFile(workbook_path) as source, zipfile.ZipFile(
            tmp_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as target:
            for item in source.infolist():
                if item.filename == worksheet_path:
                    target.writestr(item, new_sheet_xml)
                elif item.filename == "xl/sharedStrings.xml":
                    target.writestr(item, new_shared_xml)
                else:
                    target.writestr(item, source.read(item.filename))
        try:
            shutil.move(str(tmp_path), workbook_path)
        except PermissionError:
            print(
                "Workbook schema update skipped: close Task list_Tool.xlsx and rerun to add missing columns."
            )
            return False
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    return True


def build_processes(rows: Iterable[dict[str, str]]) -> tuple[list[Process], list[str]]:
    warnings: list[str] = []
    processes: list[Process] = []
    process_by_key: dict[tuple[str, str], Process] = {}
    used_slugs: set[str] = set()

    for index, row in enumerate(rows, start=1):
        main_task = normalize_main_task(row.get("Main Task", ""))
        task_name = row.get("Task Name", "").strip()
        task_type = row.get("Task Type", "").strip()

        if not main_task or not task_name or not task_type:
            warnings.append(f"Row {index + 1}: missing required process data.")
            continue

        key = (main_task, task_name)
        process = process_by_key.get(key)
        if process is None:
            process = Process(
                order=len(processes) + 1,
                main_task=main_task,
                task_name=task_name,
                task_type=task_type,
                slug=slugify(task_name, used_slugs),
            )
            process_by_key[key] = process
            processes.append(process)

        tool = ToolEntry(
            name=row.get("Automation Tool", "").strip(),
            explanation=row.get("Function Explain", "").strip(),
            version=row.get("Version", "").strip(),
            file_path=row.get("File Path", "").strip(),
            tags=parse_tags(row.get("Tool Tag", "")),
            is_new=parse_new_flag(row.get("New_flag", "") or row.get("New Tool", "")),
            is_new_version=parse_new_flag(row.get("New_version", "") or row.get("New Version", "")),
        )
        process.tools.append(tool)

        if not tool.name or not tool.explanation or not tool.version or not tool.file_path:
            warnings.append(f"Row {index + 1}: one or more tool detail fields are blank.")

    return processes, warnings


def stage_groups(processes: list[Process]) -> list[tuple[str, list[Process]]]:
    groups: list[tuple[str, list[Process]]] = []
    by_stage: dict[str, list[Process]] = {}
    for process in processes:
        if process.main_task not in by_stage:
            by_stage[process.main_task] = []
            groups.append((process.main_task, by_stage[process.main_task]))
        by_stage[process.main_task].append(process)
    return groups


def esc(value: str) -> str:
    return html.escape(value or "Not registered yet")


def attr(value: str) -> str:
    return html.escape(value, quote=True)


def process_tags(process: Process) -> list[str]:
    tags: list[str] = []
    for tool in process.tools:
        tags.extend(tool.tags)
    return list(dict.fromkeys(tags))


def process_is_new(process: Process) -> bool:
    return any(tool.is_new for tool in process.tools)


def process_has_new_version(process: Process) -> bool:
    return any(tool.is_new_version for tool in process.tools)


def process_tool_count(process: Process) -> int:
    return sum(1 for tool in process.tools if tool.name)


def total_tool_count(processes: list[Process]) -> int:
    return sum(process_tool_count(process) for process in processes)


def tag_chips(tags: list[str]) -> str:
    if not tags:
        return '<span class="tag-chip is-empty">No tag</span>'
    return "".join(f'<span class="tag-chip">{esc(tag)}</span>' for tag in tags)


def tool_badge(process: Process) -> str:
    count = process_tool_count(process)
    if count == 0:
        return "0 tools available"
    return f"{count} {'tool' if count == 1 else 'tools'} available"


def data_payload(processes: list[Process], warnings: list[str]) -> dict:
    return {
        "version": 1,
        "warnings": warnings,
        "processes": [
            {
                "order": process.order,
                "mainTask": process.main_task,
                "taskName": process.task_name,
                "taskType": process.task_type,
                "slug": process.slug,
                "tools": [
                    {
                        "name": tool.name,
                        "explanation": tool.explanation,
                        "version": tool.version,
                        "filePath": tool.file_path,
                        "tags": tool.tags,
                        "isNew": tool.is_new,
                        "isNewVersion": tool.is_new_version,
                    }
                    for tool in process.tools
                ],
            }
            for process in processes
        ],
    }


def page_shell(title: str, body: str, depth: str = ".") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23202a2f'/%3E%3Cpath d='M8 10h16v4H8zm0 8h10v4H8z' fill='%23ffffff'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="{depth}/assets/styles.css">
</head>
<body>
{body}
  <script src="{depth}/assets/data.js"></script>
  <script src="{depth}/assets/app.js"></script>
</body>
</html>
"""


def render_index(processes: list[Process], warnings: list[str]) -> str:
    groups = stage_groups(processes)
    tools_total = total_tool_count(processes)
    body = f"""  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">MSM Project Tool Map</p>
        <h1>Media Tool List</h1>
      </div>
      <div class="metrics" aria-label="Flow summary">
        <span><strong id="process-total">{len(processes)}</strong> processes</span>
        <span><strong id="stage-total">{len(groups)}</strong> stages</span>
        <span><strong id="tool-total">{tools_total}</strong> tools</span>
        <a class="toolbar-link" href="customize.html">Customize</a>
      </div>
    </header>
    <aside class="notice" id="data-notice" hidden></aside>
    <div class="legend" aria-label="Quick filters">
      <button class="legend-filter" type="button" data-filter-type="main" aria-pressed="false"><i class="legend-main"></i>Main</button>
      <button class="legend-filter" type="button" data-filter-type="additional" aria-pressed="false"><i class="legend-additional"></i>Additional</button>
      <button class="legend-filter" type="button" data-filter-new="true" aria-pressed="false"><i class="legend-new"></i>New tool</button>
      <button class="legend-filter" type="button" data-filter-new-version="true" aria-pressed="false"><i class="legend-version"></i>New version</button>
    </div>
    <section class="filter-panel" aria-label="Search and filter controls">
      <label class="search-control">
        <span>Search</span>
        <input id="flow-search" type="search" placeholder="Search process, tool, tag, path..." autocomplete="off">
      </label>
      <label>
        <span>Stage</span>
        <select id="stage-filter">
          <option value="">All stages</option>
        </select>
      </label>
      <label>
        <span>Type</span>
        <select id="type-filter">
          <option value="">All types</option>
          <option value="main">Main</option>
          <option value="additional">Additional</option>
        </select>
      </label>
      <label>
        <span>Tag</span>
        <select id="tag-filter">
          <option value="">All tags</option>
        </select>
      </label>
      <label class="check-control">
        <input id="new-filter" type="checkbox">
        <span>New only</span>
      </label>
      <label class="check-control">
        <input id="new-version-filter" type="checkbox">
        <span>New version only</span>
      </label>
      <button id="clear-filters" type="button">Clear</button>
      <output id="result-count">{len(processes)} processes shown</output>
    </section>
    <p class="empty-results" hidden>No matching processes. Clear filters or try another search term.</p>
    <div class="flow" id="flow-root" aria-label="Process flow chart" data-view="flow"></div>
  </main>"""
    return page_shell("Media Tool List", body)


def render_detail_page() -> str:
    body = """  <main class="detail-shell" data-view="detail">
    <a class="back-link" href="index.html">Back to flow chart</a>
    <section id="detail-root"></section>
  </main>"""
    return page_shell("Process Detail", body)


def render_customize_page() -> str:
    body = """  <main class="app-shell editor-shell" data-view="editor">
    <header class="topbar">
      <div>
        <p class="eyebrow">MSM Project Tool Map</p>
        <h1>Customize Data</h1>
      </div>
      <div class="metrics">
        <a class="toolbar-link" href="index.html">View flow</a>
      </div>
    </header>
    <aside class="notice">
      Edits are saved in this browser. Use Export JSON to share or back up updates before deploying.
    </aside>
    <section class="editor-layout">
      <aside class="editor-list">
        <div class="editor-actions">
          <button id="add-process" type="button">Add process</button>
          <button id="duplicate-process" type="button">Duplicate</button>
          <button id="delete-process" type="button">Delete</button>
        </div>
        <div id="process-list" class="process-picker"></div>
      </aside>
      <section class="editor-panel">
        <form id="process-form">
          <div class="form-grid">
            <label><span>Main Task</span><input name="mainTask" required></label>
            <label><span>Task Name</span><input name="taskName" required></label>
            <label><span>Task Type</span><select name="taskType"><option>Main</option><option>Additional</option></select></label>
            <label><span>Slug</span><input name="slug" required></label>
          </div>
          <div class="editor-section-head">
            <h2>Tools</h2>
            <button id="add-tool" type="button">Add tool</button>
          </div>
          <div id="tool-editor-list" class="tool-editor-list"></div>
          <div class="editor-footer">
            <button type="submit">Save changes</button>
            <button id="reset-data" type="button">Reset to seed</button>
            <button id="export-data" type="button">Export JSON</button>
            <label class="import-button"><span>Upload Excel</span><input id="upload-excel" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
            <label class="import-button"><span>Import JSON</span><input id="import-data" type="file" accept="application/json"></label>
          </div>
        </form>
      </section>
    </section>
  </main>"""
    return page_shell("Customize Data", body)


def write_static_assets() -> None:
    assets = DIST_DIR / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    (assets / "styles.css").write_text(
        """* {
  box-sizing: border-box;
}

:root {
  color-scheme: light;
  --bg: #f6f7f8;
  --panel: #ffffff;
  --text: #172026;
  --muted: #64727c;
  --line: #d8dee3;
  --main: #1f7a5b;
  --main-soft: #e6f3ee;
  --additional: #4666a5;
  --additional-soft: #edf2fb;
  --accent: #b84a3b;
  --new: #b42318;
  --new-soft: #fff1f0;
  --version: #9a5b12;
  --version-soft: #fff7e6;
  --shadow: 0 18px 45px rgba(28, 36, 42, 0.08);
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}

a {
  color: inherit;
}

.app-shell,
.detail-shell {
  width: min(1360px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}

.topbar,
.process-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
  line-height: 1.1;
}

h1 {
  font-size: clamp(1.7rem, 2.5vw, 2.6rem);
}

.metrics,
.detail-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.metrics span,
.detail-meta span,
.legend span,
.legend button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--muted);
  font: inherit;
  font-size: 0.88rem;
}

.metrics strong {
  color: var(--text);
}

.toolbar-link {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #202a2f;
  color: #fff;
  font-size: 0.88rem;
  font-weight: 800;
  text-decoration: none;
}

.legend {
  display: flex;
  gap: 10px;
  margin: 0 0 18px;
  flex-wrap: wrap;
}

.legend i {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend button {
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease, color 160ms ease, background 160ms ease;
}

.legend button:hover,
.legend button:focus-visible,
.legend button.is-active {
  border-color: #9db4c3;
  background: #f4f8fa;
  color: var(--text);
  box-shadow: 0 8px 24px rgba(28, 36, 42, 0.08);
  outline: none;
}

.legend button.is-active {
  font-weight: 800;
}

.legend-main {
  background: var(--main);
}

.legend-additional {
  background: var(--additional);
}

.legend-new {
  background: var(--new);
}

.legend-version {
  background: var(--version);
}

.filter-panel {
  display: grid;
  grid-template-columns: minmax(240px, 1.4fr) repeat(3, minmax(150px, 0.8fr)) auto auto;
  gap: 10px;
  align-items: end;
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.filter-panel label {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.tool-filter-panel {
  grid-template-columns: minmax(240px, 1fr) auto auto auto;
  margin-top: 18px;
}

.filter-panel input,
.filter-panel select,
.filter-panel button {
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  font: inherit;
  text-transform: none;
}

.filter-panel input,
.filter-panel select {
  width: 100%;
  padding: 8px 10px;
}

.filter-panel button {
  padding: 8px 13px;
  font-weight: 800;
  cursor: pointer;
}

.check-control {
  min-height: 38px;
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center;
  gap: 8px !important;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.check-control input {
  width: 16px;
  min-height: auto;
}

#result-count {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--muted);
  font-size: 0.88rem;
  white-space: nowrap;
}

.empty-results {
  margin: 0 0 18px;
  padding: 14px 16px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--muted);
  background: #fff;
}

.notice {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid #ead5a7;
  border-radius: 8px;
  background: #fff8e7;
  color: #5f4a1d;
}

.notice strong {
  display: block;
  margin-bottom: 6px;
}

.notice ul {
  margin: 0;
  padding-left: 20px;
}

.flow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(245px, 1fr));
  gap: 18px;
  align-items: start;
}

.stage {
  position: relative;
  min-width: 0;
  animation: rise 420ms ease both;
  animation-delay: calc(var(--stage-index) * 70ms);
}

.stage:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 46px;
  right: -18px;
  width: 18px;
  height: 1px;
  background: var(--line);
}

.stage-header {
  min-height: 76px;
  padding: 14px 14px 12px;
  border: 1px solid var(--line);
  border-radius: 8px 8px 0 0;
  background: #202a2f;
  color: #fff;
}

.stage-header span {
  display: block;
  margin-bottom: 8px;
  color: #b9c4cb;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.stage-header h2 {
  font-size: 1.05rem;
}

.process-list {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-top: 0;
  border-radius: 0 0 8px 8px;
  background: #eef1f3;
}

.process-card {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  min-height: 118px;
  padding: 14px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--main);
  border-radius: 8px;
  background: var(--panel);
  text-decoration: none;
  box-shadow: 0 1px 0 rgba(23, 32, 38, 0.03);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.process-card::after {
  content: "›";
  position: absolute;
  right: 13px;
  top: 13px;
  color: var(--muted);
  font-size: 1.2rem;
}

.process-card:hover,
.process-card:focus-visible,
.process-card.is-active {
  border-color: #b8c2ca;
  box-shadow: var(--shadow);
  transform: translateY(-2px);
  outline: none;
}

.process-card.is-additional {
  border-left-color: var(--additional);
}

.process-card[hidden],
.stage[hidden],
.empty-results[hidden] {
  display: none;
}

.process-order {
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.new-logo {
  justify-self: end;
  margin-right: 22px;
  padding: 3px 8px;
  border: 1px solid #f1a8a2;
  border-radius: 999px;
  background: var(--new-soft);
  color: var(--new);
  font-size: 0.7rem;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0.05em;
}

.version-logo {
  justify-self: end;
  margin-right: 22px;
  padding: 3px 8px;
  border: 1px solid #efc27c;
  border-radius: 999px;
  background: var(--version-soft);
  color: var(--version);
  font-size: 0.7rem;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0.05em;
}

.process-type {
  justify-self: start;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--main-soft);
  color: var(--main);
  font-size: 0.74rem;
  font-weight: 800;
}

.is-additional .process-type {
  background: var(--additional-soft);
  color: var(--additional);
}

.process-card strong {
  grid-column: 1 / -1;
  padding-right: 20px;
  line-height: 1.28;
  overflow-wrap: anywhere;
}

.process-card small {
  grid-column: 1 / -1;
  color: var(--muted);
  line-height: 1.35;
}

.tag-row {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.tag-chip {
  display: inline-flex;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid #cfd7dd;
  border-radius: 999px;
  background: #f7f9fa;
  color: #42515b;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.tag-chip.is-empty {
  color: var(--muted);
  font-weight: 700;
}

.back-link {
  display: inline-flex;
  margin-bottom: 26px;
  color: var(--muted);
  font-weight: 700;
  text-decoration: none;
}

.back-link:hover,
.back-link:focus-visible {
  color: var(--text);
}

.process-hero {
  align-items: center;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: var(--shadow);
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 16px;
  margin-top: 18px;
}

.tool-card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  animation: rise 360ms ease both;
}

.tool-card[hidden],
.tool-empty-results[hidden] {
  display: none;
}

.tool-empty-results {
  margin: 18px 0 0;
  padding: 14px 16px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--muted);
  background: #fff;
}

.tool-card.is-new-tool {
  border-color: #f1a8a2;
  box-shadow: 0 14px 35px rgba(180, 35, 24, 0.08);
}

.tool-card-head span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.tool-card-head .new-logo,
.tool-card-head .version-logo,
.detail-meta .new-logo,
.detail-meta .version-logo {
  margin-right: 0;
}

.tool-card-head h2 {
  margin-top: 6px;
  font-size: 1.18rem;
  overflow-wrap: anywhere;
}

dl {
  display: grid;
  gap: 14px;
  margin: 18px 0 0;
}

dt {
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

dd {
  margin: 0;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.file-path {
  font-family: "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
  font-size: 0.9rem;
}

.editor-layout {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.editor-list,
.editor-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.editor-list {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 12px;
}

.editor-actions,
.editor-footer,
.editor-section-head {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.editor-actions {
  margin-bottom: 12px;
}

.editor-panel {
  padding: 18px;
}

.process-picker {
  display: grid;
  gap: 8px;
}

.process-picker button {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.process-picker button.is-selected {
  border-color: #9db4c3;
  background: #eef5f8;
}

.process-picker span {
  color: var(--muted);
  font-size: 0.82rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-grid label,
.import-button {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.form-grid .wide {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid select,
.form-grid textarea {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  font: inherit;
  text-transform: none;
}

.editor-actions button,
.editor-footer button,
.editor-section-head button,
.import-button {
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.import-button input {
  display: none;
}

.editor-section-head {
  justify-content: space-between;
  margin: 22px 0 12px;
}

.editor-section-head h2 {
  font-size: 1.1rem;
}

.tool-editor-list {
  display: grid;
  gap: 12px;
}

.tool-edit-card {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f8fafb;
}

.tool-edit-card header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.editor-check {
  justify-content: flex-start;
  text-transform: none;
}

.editor-footer {
  margin-top: 18px;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}

@media (max-width: 760px) {
  .app-shell,
  .detail-shell {
    width: min(100% - 24px, 720px);
    padding-top: 22px;
  }

  .topbar,
  .process-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .metrics,
  .detail-meta {
    justify-content: flex-start;
  }

  .filter-panel {
    grid-template-columns: 1fr;
  }

  .editor-layout,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .editor-list {
    position: static;
    max-height: none;
  }

  #result-count {
    justify-content: flex-start;
  }

  .flow {
    display: block;
  }

  .stage {
    margin-bottom: 16px;
  }

  .stage:not(:last-child)::after {
    top: auto;
    right: auto;
    left: 28px;
    bottom: -16px;
    width: 1px;
    height: 16px;
  }

  .process-card {
    min-height: 104px;
  }
}
""",
        encoding="utf-8",
    )
    (assets / "app.js").write_text(
        """const STORAGE_KEY = "taskFlowDataV1";
const appRoot = document.querySelector("[data-view]");
let appData = null;
let selectedIndex = 0;

const normalize = (value) => (value || "").trim().toLowerCase();
const escapeHtml = (value) => String(value || "Not registered yet")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function slugify(value, used = new Set()) {
  const base = normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "process";
  let slug = base;
  let counter = 2;
  while (used.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

function processTags(process) {
  return unique((process.tools || []).flatMap((tool) => tool.tags || []));
}

function processIsNew(process) {
  return (process.tools || []).some((tool) => tool.isNew);
}

function processHasNewVersion(process) {
  return (process.tools || []).some((tool) => tool.isNewVersion);
}

function processToolCount(process) {
  return (process.tools || []).filter((tool) => tool.name).length;
}

function totalToolCount(processes) {
  return (processes || []).reduce((total, process) => total + processToolCount(process), 0);
}

function toolBadge(process) {
  const count = processToolCount(process);
  if (count === 0) return "0 tools available";
  return `${count} ${count === 1 ? "tool" : "tools"} available`;
}

function searchText(process) {
  return normalize([
    process.mainTask,
    process.taskName,
    process.taskType,
    toolBadge(process),
    processTags(process).join(" "),
    ...(process.tools || []).flatMap((tool) => [
      tool.name,
      tool.explanation,
      tool.version,
      tool.filePath,
      (tool.tags || []).join(" "),
    ]),
  ].join(" "));
}

function tagChips(tags) {
  if (!tags || tags.length === 0) return '<span class="tag-chip is-empty">No tag</span>';
  return tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("");
}

async function loadSeedData() {
  try {
    const response = await fetch("assets/data.json", { cache: "no-store" });
    if (response.ok) return response.json();
  } catch {
    // Direct file opens and some locked-down static hosts block fetch().
  }
  if (window.TASK_FLOW_SEED_DATA) return structuredClone(window.TASK_FLOW_SEED_DATA);
  throw new Error("Could not load embedded or JSON page data.");
}

async function loadData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return JSON.parse(stored);
  return loadSeedData();
}

function saveData(data) {
  data.processes.forEach((process, index) => {
    process.order = index + 1;
    process.tools = process.tools || [];
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  appData = data;
}

function parseTagsValue(value) {
  return unique(String(value || "").split(/[,;|/]+/).map((tag) => tag.trim()));
}

function parseNewFlag(value) {
  return ["1", "true", "yes", "y", "new"].includes(normalize(value));
}

function normalizeMainTask(value) {
  const cleaned = String(value || "").trim();
  return cleaned === "Data Preparation?" ? "Data Preparation" : cleaned;
}

function canonicalHeader(value) {
  const key = normalize(value).replace(/[^a-z0-9]+/g, "");
  const aliases = {
    maintask: "Main Task",
    taskname: "Task Name",
    tasktype: "Task Type",
    automationtool: "Automation Tool",
    functionexplain: "Function Explain",
    functionexplanation: "Function Explain",
    version: "Version",
    filepath: "File Path",
    newflag: "New_flag",
    newtool: "New_flag",
    newversion: "New_version",
    versionnew: "New_version",
    tooltag: "Tool Tag",
    tooltags: "Tool Tag",
  };
  return aliases[key] || String(value || "").trim();
}

function columnNumberToName(number) {
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function columnNameToNumber(name) {
  return name.split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot decompress XLSX files. Use Chrome or Edge.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file.");

  const totalEntries = view.getUint16(eocd + 10, true);
  let centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("Invalid XLSX central directory.");
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const fileName = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : await inflateRaw(compressed);
    entries.set(fileName, content);

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXml(bytes) {
  return new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
}

function readCellText(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  const valueNode = cell.getElementsByTagName("v")[0];
  if (!valueNode) {
    const inlineText = Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
    return inlineText.trim();
  }
  const raw = valueNode.textContent || "";
  if (type === "s") return sharedStrings[Number(raw)] || "";
  return raw.trim();
}

function firstWorksheetPath(entries) {
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const worksheet = Array.from(entries.keys()).find((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"));
  if (!worksheet) throw new Error("No worksheet found in XLSX file.");
  return worksheet;
}

async function parseWorkbookFile(file) {
  const entries = await readZipEntries(await file.arrayBuffer());
  const sharedStrings = [];
  if (entries.has("xl/sharedStrings.xml")) {
    const sharedXml = parseXml(entries.get("xl/sharedStrings.xml"));
    sharedXml.querySelectorAll("si").forEach((si) => {
      sharedStrings.push(Array.from(si.querySelectorAll("t")).map((node) => node.textContent || "").join(""));
    });
  }

  const sheetXml = parseXml(entries.get(firstWorksheetPath(entries)));
  const matrix = new Map();
  sheetXml.querySelectorAll("sheetData row").forEach((row) => {
    const rowIndex = Number(row.getAttribute("r"));
    const record = new Map();
    row.querySelectorAll("c").forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const match = ref.match(/^([A-Z]+)(\\d+)$/);
      if (!match) return;
      record.set(columnNameToNumber(match[1]), readCellText(cell, sharedStrings));
    });
    matrix.set(rowIndex, record);
  });

  const headerRow = matrix.get(1);
  if (!headerRow) throw new Error("Workbook must have a header row.");
  const headers = {};
  headerRow.forEach((value, column) => {
    if (value) headers[canonicalHeader(value)] = column;
  });

  ["Main Task", "Task Name", "Task Type"].forEach((required) => {
    if (!headers[required]) throw new Error(`Missing required column: ${required}`);
  });

  const usedSlugs = new Set();
  const processMap = new Map();
  const processes = [];
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
    let process = processMap.get(key);
    if (!process) {
      process = {
        order: processes.length + 1,
        mainTask,
        taskName,
        taskType,
        slug: slugify(taskName, usedSlugs),
        tools: [],
      };
      usedSlugs.add(process.slug);
      processMap.set(key, process);
      processes.push(process);
    }
    process.tools.push({
      name: get("Automation Tool"),
      explanation: get("Function Explain"),
      version: get("Version"),
      filePath: get("File Path"),
      tags: parseTagsValue(get("Tool Tag") || get("Tool Tags")),
      isNew: parseNewFlag(get("New_flag") || get("New Tool")),
      isNewVersion: parseNewFlag(get("New_version") || get("New Version")),
    });
  });

  if (!processes.length) throw new Error("No valid process rows found in workbook.");
  return { version: 1, warnings: [], processes };
}

function groupedProcesses(processes) {
  const groups = [];
  const byStage = new Map();
  processes.forEach((process) => {
    const stage = process.mainTask || "Unassigned";
    if (!byStage.has(stage)) {
      byStage.set(stage, []);
      groups.push([stage, byStage.get(stage)]);
    }
    byStage.get(stage).push(process);
  });
  return groups;
}

function renderFlow() {
  const flowRoot = document.querySelector("#flow-root");
  if (!flowRoot || !appData) return;
  const groups = groupedProcesses(appData.processes);
  const total = document.querySelector("#process-total");
  const stages = document.querySelector("#stage-total");
  const tools = document.querySelector("#tool-total");
  if (total) total.textContent = String(appData.processes.length);
  if (stages) stages.textContent = String(groups.length);
  if (tools) tools.textContent = String(totalToolCount(appData.processes));

  const stageFilter = document.querySelector("#stage-filter");
  const tagFilter = document.querySelector("#tag-filter");
  if (stageFilter) {
    stageFilter.innerHTML = '<option value="">All stages</option>' + groups
      .map(([stage]) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`)
      .join("");
  }
  if (tagFilter) {
    const tags = unique(appData.processes.flatMap(processTags)).sort((a, b) => a.localeCompare(b));
    tagFilter.innerHTML = '<option value="">All tags</option>' + tags
      .map((tag) => `<option value="${escapeHtml(normalize(tag))}">${escapeHtml(tag)}</option>`)
      .join("");
  }

  flowRoot.innerHTML = groups.map(([stage, processes], stageIndex) => `
    <section class="stage" style="--stage-index: ${stageIndex + 1}" data-stage-section="${escapeHtml(stage)}">
      <header class="stage-header">
        <span>Stage ${String(stageIndex + 1).padStart(2, "0")}</span>
        <h2>${escapeHtml(stage)}</h2>
      </header>
      <div class="process-list">
        ${processes.map((process) => {
          const tags = processTags(process);
          const isNew = processIsNew(process);
          const hasNewVersion = processHasNewVersion(process);
          const toolCount = processToolCount(process);
          return `<a class="process-card ${normalize(process.taskType) === "additional" ? "is-additional" : "is-main"}"
            href="detail.html?process=${encodeURIComponent(process.slug)}"
            data-stage="${escapeHtml(process.mainTask)}"
            data-type="${escapeHtml(normalize(process.taskType))}"
            data-tags="${escapeHtml(tags.map(normalize).join("||"))}"
            data-new="${isNew ? "true" : "false"}"
            data-new-version="${hasNewVersion ? "true" : "false"}"
            data-tool-count="${toolCount}"
            data-search="${escapeHtml(searchText(process))}">
            <span class="process-order">${String(process.order || 0).padStart(2, "0")}</span>
            ${isNew ? '<span class="new-logo" aria-label="New tool">NEW</span>' : ""}
            ${hasNewVersion ? '<span class="version-logo" aria-label="New version">NEW VERSION</span>' : ""}
            <span class="process-type">${escapeHtml(process.taskType)}</span>
            <strong>${escapeHtml(process.taskName)}</strong>
            <small>${escapeHtml(toolBadge(process))}</small>
            <span class="tag-row">${tagChips(tags)}</span>
          </a>`;
        }).join("")}
      </div>
    </section>
  `).join("");

  bindCardHover();
  bindFilters();
  applyFilters();
}

function bindCardHover() {
  document.querySelectorAll(".process-card").forEach((card) => {
    card.addEventListener("mouseenter", () => card.classList.add("is-active"));
    card.addEventListener("mouseleave", () => card.classList.remove("is-active"));
    card.addEventListener("focus", () => card.classList.add("is-active"));
    card.addEventListener("blur", () => card.classList.remove("is-active"));
  });
}

function bindFilters() {
  ["#flow-search", "#stage-filter", "#type-filter", "#tag-filter", "#new-filter", "#new-version-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound) return;
    control.dataset.bound = "true";
    control.addEventListener("input", applyFilters);
    control.addEventListener("change", applyFilters);
  });
  const clearButton = document.querySelector("#clear-filters");
  if (clearButton && !clearButton.dataset.bound) {
    clearButton.dataset.bound = "true";
    clearButton.addEventListener("click", () => {
      ["#flow-search", "#stage-filter", "#type-filter", "#tag-filter"].forEach((selector) => {
        const control = document.querySelector(selector);
        if (control) control.value = "";
      });
      const newFilter = document.querySelector("#new-filter");
      const newVersionFilter = document.querySelector("#new-version-filter");
      if (newFilter) newFilter.checked = false;
      if (newVersionFilter) newVersionFilter.checked = false;
      applyFilters();
      document.querySelector("#flow-search")?.focus();
    });
  }
  document.querySelectorAll(".legend-filter").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const typeFilter = document.querySelector("#type-filter");
      const newFilter = document.querySelector("#new-filter");
      const newVersionFilter = document.querySelector("#new-version-filter");
      if (button.dataset.filterType && typeFilter) {
        typeFilter.value = typeFilter.value === button.dataset.filterType ? "" : button.dataset.filterType;
      }
      if (button.dataset.filterNew && newFilter) {
        newFilter.checked = !newFilter.checked;
      }
      if (button.dataset.filterNewVersion && newVersionFilter) {
        newVersionFilter.checked = !newVersionFilter.checked;
      }
      applyFilters();
    });
  });
}

function applyFilters() {
  const cards = Array.from(document.querySelectorAll(".process-card"));
  const query = normalize(document.querySelector("#flow-search")?.value);
  const selectedStage = normalize(document.querySelector("#stage-filter")?.value);
  const selectedType = normalize(document.querySelector("#type-filter")?.value);
  const selectedTag = normalize(document.querySelector("#tag-filter")?.value);
  const onlyNew = Boolean(document.querySelector("#new-filter")?.checked);
  const onlyNewVersion = Boolean(document.querySelector("#new-version-filter")?.checked);
  let visibleCount = 0;
  let visibleToolCount = 0;

  cards.forEach((card) => {
    const matchesQuery = !query || normalize(card.dataset.search).includes(query);
    const matchesStage = !selectedStage || normalize(card.dataset.stage) === selectedStage;
    const matchesType = !selectedType || normalize(card.dataset.type) === selectedType;
    const matchesTag = !selectedTag || normalize(card.dataset.tags).split("||").includes(selectedTag);
    const matchesNew = !onlyNew || card.dataset.new === "true";
    const matchesNewVersion = !onlyNewVersion || card.dataset.newVersion === "true";
    const isVisible = matchesQuery && matchesStage && matchesType && matchesTag && matchesNew && matchesNewVersion;
    card.hidden = !isVisible;
    if (isVisible) {
      visibleCount += 1;
      visibleToolCount += Number(card.dataset.toolCount || 0);
    }
  });

  document.querySelectorAll(".stage").forEach((stage) => {
    stage.hidden = stage.querySelectorAll(".process-card:not([hidden])").length === 0;
  });

  const resultCount = document.querySelector("#result-count");
  if (resultCount) {
    resultCount.textContent = `${visibleCount} ${visibleCount === 1 ? "process" : "processes"} / ${visibleToolCount} ${visibleToolCount === 1 ? "tool" : "tools"} shown`;
  }
  const emptyResults = document.querySelector(".empty-results");
  if (emptyResults) emptyResults.hidden = visibleCount !== 0;
  document.querySelectorAll(".legend-filter").forEach((button) => {
    const isActive = (button.dataset.filterType && selectedType === button.dataset.filterType) ||
      (button.dataset.filterNew && onlyNew) ||
      (button.dataset.filterNewVersion && onlyNewVersion);
    button.classList.toggle("is-active", Boolean(isActive));
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function renderDetail() {
  const root = document.querySelector("#detail-root");
  if (!root || !appData) return;
  const slug = new URLSearchParams(window.location.search).get("process");
  const process = appData.processes.find((item) => item.slug === slug) || appData.processes[0];
  if (!process) {
    root.innerHTML = '<section class="process-hero"><h1>No process data found</h1></section>';
    return;
  }
  document.title = process.taskName;
  root.innerHTML = `
    <section class="process-hero">
      <div>
        <p class="eyebrow">${escapeHtml(process.mainTask)}</p>
        <h1>${escapeHtml(process.taskName)}</h1>
        <p class="detail-subtext">${escapeHtml(toolBadge(process))}</p>
      </div>
      <div class="detail-meta">
        ${processIsNew(process) ? '<span class="new-logo">NEW</span>' : ""}
        ${processHasNewVersion(process) ? '<span class="version-logo">NEW VERSION</span>' : ""}
        <span>${String(process.order || 0).padStart(2, "0")}</span>
        <span>${escapeHtml(process.taskType)}</span>
        <span>${processToolCount(process)} ${processToolCount(process) === 1 ? "tool" : "tools"}</span>
      </div>
    </section>
    <section class="filter-panel tool-filter-panel" aria-label="Tool search and filter controls">
      <label class="search-control">
        <span>Search tools</span>
        <input id="tool-search" type="search" placeholder="Search tool, function, version, path, tag..." autocomplete="off">
      </label>
      <label class="check-control">
        <input id="tool-new-filter" type="checkbox">
        <span>New tool only</span>
      </label>
      <label class="check-control">
        <input id="tool-version-filter" type="checkbox">
        <span>New version only</span>
      </label>
      <output id="tool-result-count">${processToolCount(process)} ${processToolCount(process) === 1 ? "tool" : "tools"} shown</output>
    </section>
    <p class="tool-empty-results" hidden>No matching tools. Clear filters or try another search term.</p>
    <section class="tool-grid" aria-label="Available automation tools">
      ${(process.tools || []).map((tool, index) => `
        <article class="tool-card ${tool.isNew || tool.isNewVersion ? "is-new-tool" : ""}"
          data-new="${tool.isNew ? "true" : "false"}"
          data-new-version="${tool.isNewVersion ? "true" : "false"}"
          data-search="${escapeHtml(normalize([tool.name, tool.explanation, tool.version, tool.filePath, (tool.tags || []).join(" ")].join(" ")))}">
          <div class="tool-card-head">
            <span>Tool ${String(index + 1).padStart(2, "0")}</span>
            ${tool.isNew ? '<span class="new-logo">NEW</span>' : ""}
            ${tool.isNewVersion ? '<span class="version-logo">NEW VERSION</span>' : ""}
            <h2>${escapeHtml(tool.name)}</h2>
          </div>
          <dl>
            <div><dt>Function explain</dt><dd>${escapeHtml(tool.explanation)}</dd></div>
            <div><dt>Version</dt><dd>${escapeHtml(tool.version)}</dd></div>
            <div><dt>File path</dt><dd class="file-path">${escapeHtml(tool.filePath)}</dd></div>
            <div><dt>Tool tag</dt><dd><span class="tag-row">${tagChips(tool.tags || [])}</span></dd></div>
          </dl>
        </article>
      `).join("")}
    </section>`;
  bindToolFilters();
  applyToolFilters();
}

function bindToolFilters() {
  ["#tool-search", "#tool-new-filter", "#tool-version-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound) return;
    control.dataset.bound = "true";
    control.addEventListener("input", applyToolFilters);
    control.addEventListener("change", applyToolFilters);
  });
}

function applyToolFilters() {
  const cards = Array.from(document.querySelectorAll(".tool-card"));
  if (!cards.length) return;
  const query = normalize(document.querySelector("#tool-search")?.value);
  const onlyNew = Boolean(document.querySelector("#tool-new-filter")?.checked);
  const onlyNewVersion = Boolean(document.querySelector("#tool-version-filter")?.checked);
  let visibleCount = 0;

  cards.forEach((card) => {
    const matchesQuery = !query || normalize(card.dataset.search).includes(query);
    const matchesNew = !onlyNew || card.dataset.new === "true";
    const matchesNewVersion = !onlyNewVersion || card.dataset.newVersion === "true";
    const isVisible = matchesQuery && matchesNew && matchesNewVersion;
    card.hidden = !isVisible;
    if (isVisible && card.querySelector(".tool-card-head h2")?.textContent?.trim() !== "Not registered yet") {
      visibleCount += 1;
    }
  });

  const result = document.querySelector("#tool-result-count");
  if (result) {
    result.textContent = `${visibleCount} ${visibleCount === 1 ? "tool" : "tools"} shown`;
  }
  const empty = document.querySelector(".tool-empty-results");
  if (empty) empty.hidden = cards.some((card) => !card.hidden);
}

function renderEditorList() {
  const list = document.querySelector("#process-list");
  if (!list || !appData) return;
  list.innerHTML = appData.processes.map((process, index) => `
    <button type="button" class="${index === selectedIndex ? "is-selected" : ""}" data-index="${index}">
      <strong>${escapeHtml(process.taskName)}</strong>
      <span>${escapeHtml(process.mainTask)}</span>
    </button>
  `).join("");
  list.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedIndex = Number(button.dataset.index);
      renderEditor();
    });
  });
}

function renderToolEditor(tool = {}, index = 0) {
  return `<article class="tool-edit-card" data-tool-index="${index}">
    <header>
      <strong>Tool ${String(index + 1).padStart(2, "0")}</strong>
      <button type="button" class="remove-tool">Remove</button>
    </header>
    <div class="form-grid">
      <label><span>Tool name</span><input name="toolName" value="${escapeHtml(tool.name || "")}"></label>
      <label><span>Version</span><input name="toolVersion" value="${escapeHtml(tool.version || "")}"></label>
      <label class="wide"><span>File path</span><input name="toolPath" value="${escapeHtml(tool.filePath || "")}"></label>
      <label class="wide"><span>Tags</span><input name="toolTags" value="${escapeHtml((tool.tags || []).join(", "))}" placeholder="RPA, QC, Data prep"></label>
      <label class="wide"><span>Function explain</span><textarea name="toolExplain" rows="3">${escapeHtml(tool.explanation || "")}</textarea></label>
      <label class="check-control editor-check"><input name="toolNew" type="checkbox" ${tool.isNew ? "checked" : ""}><span>Show NEW badge</span></label>
      <label class="check-control editor-check"><input name="toolNewVersion" type="checkbox" ${tool.isNewVersion ? "checked" : ""}><span>Show NEW VERSION badge</span></label>
    </div>
  </article>`;
}

function renderEditor() {
  if (!appData) return;
  if (selectedIndex >= appData.processes.length) selectedIndex = appData.processes.length - 1;
  if (selectedIndex < 0) selectedIndex = 0;
  const process = appData.processes[selectedIndex];
  renderEditorList();
  const form = document.querySelector("#process-form");
  if (!form || !process) return;
  form.mainTask.value = process.mainTask || "";
  form.taskName.value = process.taskName || "";
  form.taskType.value = process.taskType || "Main";
  form.slug.value = process.slug || slugify(process.taskName || "process");
  document.querySelector("#tool-editor-list").innerHTML = (process.tools || []).map(renderToolEditor).join("");
  document.querySelectorAll(".remove-tool").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.closest(".tool-edit-card").dataset.toolIndex);
      process.tools.splice(index, 1);
      saveData(appData);
      renderEditor();
    });
  });
}

function readEditorForm() {
  const form = document.querySelector("#process-form");
  const used = new Set(appData.processes.map((process, index) => index === selectedIndex ? "" : process.slug));
  const process = appData.processes[selectedIndex];
  process.mainTask = form.mainTask.value.trim();
  process.taskName = form.taskName.value.trim();
  process.taskType = form.taskType.value;
  process.slug = slugify(form.slug.value || process.taskName, used);
  process.tools = Array.from(document.querySelectorAll(".tool-edit-card")).map((card) => ({
    name: card.querySelector('[name="toolName"]').value.trim(),
    explanation: card.querySelector('[name="toolExplain"]').value.trim(),
    version: card.querySelector('[name="toolVersion"]').value.trim(),
    filePath: card.querySelector('[name="toolPath"]').value.trim(),
    tags: parseTagsValue(card.querySelector('[name="toolTags"]').value),
    isNew: card.querySelector('[name="toolNew"]').checked,
    isNewVersion: card.querySelector('[name="toolNewVersion"]').checked,
  }));
}

function bindEditor() {
  const form = document.querySelector("#process-form");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    readEditorForm();
    saveData(appData);
    renderEditor();
  });
  document.querySelector("#add-process")?.addEventListener("click", () => {
    selectedIndex = appData.processes.length;
    appData.processes.push({
      order: selectedIndex + 1,
      mainTask: "New Stage",
      taskName: "New Process",
      taskType: "Main",
      slug: slugify("New Process", new Set(appData.processes.map((process) => process.slug))),
      tools: [{ name: "", explanation: "", version: "", filePath: "", tags: [], isNew: true, isNewVersion: false }],
    });
    saveData(appData);
    renderEditor();
  });
  document.querySelector("#duplicate-process")?.addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(appData.processes[selectedIndex]));
    copy.taskName = `${copy.taskName} Copy`;
    copy.slug = slugify(copy.taskName, new Set(appData.processes.map((process) => process.slug)));
    selectedIndex = appData.processes.length;
    appData.processes.push(copy);
    saveData(appData);
    renderEditor();
  });
  document.querySelector("#delete-process")?.addEventListener("click", () => {
    if (appData.processes.length <= 1) return;
    appData.processes.splice(selectedIndex, 1);
    selectedIndex = Math.max(0, selectedIndex - 1);
    saveData(appData);
    renderEditor();
  });
  document.querySelector("#add-tool")?.addEventListener("click", () => {
    appData.processes[selectedIndex].tools.push({ name: "", explanation: "", version: "", filePath: "", tags: [], isNew: true, isNewVersion: false });
    saveData(appData);
    renderEditor();
  });
  document.querySelector("#reset-data")?.addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY);
    appData = await loadSeedData();
    selectedIndex = 0;
    renderEditor();
  });
  document.querySelector("#export-data")?.addEventListener("click", () => {
    readEditorForm();
    saveData(appData);
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "task-flow-data.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });
  document.querySelector("#import-data")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported.processes)) throw new Error("Imported JSON must contain a processes array.");
      saveData(imported);
      selectedIndex = 0;
      renderEditor();
    };
    reader.readAsText(file);
  });
  document.querySelector("#upload-excel")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await parseWorkbookFile(file);
      saveData(imported);
      selectedIndex = 0;
      renderEditor();
      event.target.value = "";
    } catch (error) {
      alert(error.message);
    }
  });
}

async function start() {
  appData = await loadData();
  const view = appRoot?.dataset.view;
  if (view === "flow") renderFlow();
  if (view === "detail") renderDetail();
  if (view === "editor") {
    bindEditor();
    renderEditor();
  }
}

start().catch((error) => {
  console.error(error);
  const notice = document.querySelector("#data-notice") || document.querySelector(".notice");
  if (notice) {
    notice.hidden = false;
    notice.textContent = `Could not load page data: ${error.message}`;
  }
});
""",
        encoding="utf-8",
    )


def clear_dist_dir() -> None:
    if not DIST_DIR.exists():
        return
    for child in DIST_DIR.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def build_site() -> None:
    rows = load_rows(WORKBOOK_PATH)
    processes, warnings = build_processes(rows)

    if not processes:
        raise ValueError("No valid process rows found in workbook.")

    clear_dist_dir()
    write_static_assets()

    payload = data_payload(processes, warnings)
    (DIST_DIR / "assets" / "data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DIST_DIR / "assets" / "data.js").write_text(
        "window.TASK_FLOW_SEED_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    (DIST_DIR / "index.html").write_text(render_index(processes, warnings), encoding="utf-8")
    (DIST_DIR / "detail.html").write_text(render_detail_page(), encoding="utf-8")
    (DIST_DIR / "customize.html").write_text(render_customize_page(), encoding="utf-8")

    print("Workbook schema updated: no (read-only mode)")
    print(f"Generated static app with {len(processes)} processes in {DIST_DIR}")
    if warnings:
        print(f"Warnings: {len(warnings)} blank or incomplete data rows")


if __name__ == "__main__":
    build_site()
