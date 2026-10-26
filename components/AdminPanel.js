"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import LogoutButton from "./LogoutButton.js";
import { normalizeData, parseTags, slugify } from "../lib/data-utils.js";
import { excelFileName, exportTaskFlowWorkbook } from "../lib/xlsx-export.js";

function blankTool() {
  return { name: "", explanation: "", updateContent: "", version: "", filePath: "", tags: [], isNew: true, isNewVersion: false };
}

function blankProcess(existingSlugs) {
  return {
    order: 1,
    mainTask: "New Stage",
    taskName: "New Process",
    taskType: "Main",
    slug: slugify("New Process", existingSlugs),
    tools: [blankTool()]
  };
}

export default function AdminPanel({ initialData }) {
  const [data, setData] = useState(initialData);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Enter the admin password before saving or uploading.");
  const selected = data.processes[selectedIndex] || data.processes[0];

  const existingSlugs = useMemo(() => new Set(data.processes.map((process, index) => index === selectedIndex ? "" : process.slug)), [data, selectedIndex]);

  function updateSelected(patch) {
    setData((current) => {
      const next = structuredClone(current);
      next.processes[selectedIndex] = { ...next.processes[selectedIndex], ...patch };
      return next;
    });
  }

  function updateTool(toolIndex, patch) {
    setData((current) => {
      const next = structuredClone(current);
      next.processes[selectedIndex].tools[toolIndex] = {
        ...next.processes[selectedIndex].tools[toolIndex],
        ...patch
      };
      return next;
    });
  }

  async function requestJson(url, options) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text || `Request failed with HTTP ${response.status}.` };
      }
      if (!response.ok) {
        throw new Error(body.error || `Request failed with HTTP ${response.status}.`);
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Request timed out after 30 seconds. Check Vercel Function logs and Blob environment variables.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function saveData(nextData = data) {
    try {
      setStatus("Saving...");
      const body = await requestJson("/api/admin/data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password
        },
        body: JSON.stringify(normalizeData(nextData))
      });
      setData(body);
      setStatus("Saved. Viewers will see the updated data after refresh or the next auto-check.");
    } catch (error) {
      setStatus(`Save failed: ${error.message}`);
    }
  }

  async function uploadExcel(file) {
    if (!file) return;
    try {
      setStatus("Uploading Excel...");
      const form = new FormData();
      form.append("file", file);
      const body = await requestJson("/api/admin/upload", {
        method: "POST",
        headers: { "x-admin-password": password },
        body: form
      });
      setData(body);
      setSelectedIndex(0);
      const warnings = body.warnings || [];
      const warningText = warnings.length
        ? ` ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.slice(0, 3).join(" ")}${warnings.length > 3 ? " ..." : ""}`
        : "";
      setStatus(`Uploaded ${body.processes.length} processes from Excel.${warningText}`);
    } catch (error) {
      setStatus(`Upload failed: ${error.message}`);
    }
  }

  function addProcess() {
    const next = structuredClone(data);
    next.processes.push(blankProcess(new Set(next.processes.map((process) => process.slug))));
    setData(next);
    setSelectedIndex(next.processes.length - 1);
  }

  function duplicateProcess() {
    const next = structuredClone(data);
    const copy = structuredClone(selected);
    copy.taskName = `${copy.taskName} Copy`;
    copy.slug = slugify(copy.taskName, new Set(next.processes.map((process) => process.slug)));
    next.processes.push(copy);
    setData(next);
    setSelectedIndex(next.processes.length - 1);
  }

  function deleteProcess() {
    if (data.processes.length <= 1) return;
    const next = structuredClone(data);
    next.processes.splice(selectedIndex, 1);
    setData(next);
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(normalizeData(data), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "task-flow-data.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportExcel() {
    const blob = new Blob([exportTaskFlowWorkbook(data)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = excelFileName();
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = JSON.parse(String(reader.result));
      setData(normalizeData(imported));
      setSelectedIndex(0);
      setStatus("Imported JSON locally. Click Save changes to publish it.");
    };
    reader.readAsText(file);
  }

  if (!selected) return null;

  return (
    <main className="app-shell editor-shell">
      <header className="topbar">
        <div>
          <h1>Admin Upload And Edit</h1>
        </div>
        <div className="metrics">
          <Link className="toolbar-link" href="/">View flow</Link>
          <LogoutButton />
        </div>
      </header>

      <aside className="notice">
        This page changes the shared app data. Configure <code>ADMIN_PASSWORD</code> in Vercel, then use the same password here.
      </aside>

      <section className="admin-auth">
        <label>
          <span>Admin password</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Required for save/upload" />
        </label>
        <strong>{status}</strong>
      </section>

      <section className="editor-layout">
        <aside className="editor-list">
          <div className="editor-actions">
            <button type="button" onClick={addProcess}>Add process</button>
            <button type="button" onClick={duplicateProcess}>Duplicate</button>
            <button type="button" onClick={deleteProcess}>Delete</button>
          </div>
          <div className="process-picker">
            {data.processes.map((process, index) => (
              <button className={index === selectedIndex ? "is-selected" : ""} type="button" onClick={() => setSelectedIndex(index)} key={`${process.slug}-${index}`}>
                <strong>{process.taskName}</strong>
                <span>{process.mainTask}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="editor-panel">
          <form onSubmit={(event) => { event.preventDefault(); saveData(); }}>
            <div className="form-grid">
              <label><span>Main Task</span><input value={selected.mainTask} onChange={(event) => updateSelected({ mainTask: event.target.value })} required /></label>
              <label><span>Task Name</span><input value={selected.taskName} onChange={(event) => updateSelected({ taskName: event.target.value })} required /></label>
              <label>
                <span>Task Type</span>
                <select value={selected.taskType} onChange={(event) => updateSelected({ taskType: event.target.value })}>
                  <option>Main</option>
                  <option>Additional</option>
                </select>
              </label>
              <label><span>Slug</span><input value={selected.slug} onChange={(event) => updateSelected({ slug: slugify(event.target.value, existingSlugs) })} required /></label>
            </div>

            <div className="editor-section-head">
              <h2>Tools</h2>
              <button type="button" onClick={() => updateSelected({ tools: [...(selected.tools || []), blankTool()] })}>Add tool</button>
            </div>

            <div className="tool-editor-list">
              {(selected.tools || []).map((tool, index) => (
                <article className="tool-edit-card" key={index}>
                  <header>
                    <strong>Tool {String(index + 1).padStart(2, "0")}</strong>
                    <button type="button" onClick={() => updateSelected({ tools: selected.tools.filter((_, toolIndex) => toolIndex !== index) })}>Remove</button>
                  </header>
                  <div className="form-grid">
                    <label><span>Tool name</span><input value={tool.name} onChange={(event) => updateTool(index, { name: event.target.value })} /></label>
                    <label><span>Version</span><input value={tool.version} onChange={(event) => updateTool(index, { version: event.target.value })} /></label>
                    <label className="wide"><span>File path</span><input value={tool.filePath} onChange={(event) => updateTool(index, { filePath: event.target.value })} /></label>
                    <label className="wide"><span>Tags</span><input value={(tool.tags || []).join(", ")} onChange={(event) => updateTool(index, { tags: parseTags(event.target.value) })} placeholder="RPA, QC, Data prep" /></label>
                    <label className="wide"><span>Function explain</span><textarea value={tool.explanation} onChange={(event) => updateTool(index, { explanation: event.target.value })} rows="3" /></label>
                    <label className="wide"><span>Update content</span><textarea value={tool.updateContent || ""} onChange={(event) => updateTool(index, { updateContent: event.target.value })} rows="3" placeholder="What changed in this new version" /></label>
                    <label className="check-control editor-check"><input checked={tool.isNew} onChange={(event) => updateTool(index, { isNew: event.target.checked })} type="checkbox" /><span>Show NEW badge</span></label>
                    <label className="check-control editor-check"><input checked={Boolean(tool.isNewVersion)} onChange={(event) => updateTool(index, { isNewVersion: event.target.checked })} type="checkbox" /><span>Show NEW VERSION badge</span></label>
                  </div>
                </article>
              ))}
            </div>

            <div className="editor-footer">
              <button type="submit">Save changes</button>
              <label className="import-button"><span>Upload Excel</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => uploadExcel(event.target.files?.[0])} /></label>
              <button type="button" onClick={exportExcel}>Export Excel</button>
              <button type="button" onClick={exportJson}>Export JSON</button>
              <label className="import-button"><span>Import JSON</span><input type="file" accept="application/json" onChange={(event) => importJson(event.target.files?.[0])} /></label>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
