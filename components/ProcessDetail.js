"use client";

import { useMemo, useState } from "react";
import { normalize, processHasNewVersion, processIsNew, processToolCount, tagChipsText, toolAnchorId, toolBadge, unique } from "../lib/data-utils.js";

function toolSearchText(tool) {
  return normalize([
    tool.name,
    tool.explanation,
    tool.updateContent,
    tool.version,
    tool.filePath,
    (tool.tags || []).join(" ")
  ].join(" "));
}

export default function ProcessDetail({ process }) {
  const [query, setQuery] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [newVersionOnly, setNewVersionOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [copiedPath, setCopiedPath] = useState("");

  const toolsWithIndex = useMemo(() => {
    return (process.tools || []).map((tool, index) => ({ tool, index }));
  }, [process]);

  const tagOptions = useMemo(() => {
    return unique((process.tools || []).flatMap((tool) => tool.tags || [])).sort((left, right) => left.localeCompare(right));
  }, [process]);

  const visibleTools = useMemo(() => {
    return toolsWithIndex.filter(({ tool }) => {
      const toolTags = (tool.tags || []).map(normalize);
      return (
        (!query || toolSearchText(tool).includes(normalize(query))) &&
        (!selectedTag || toolTags.includes(normalize(selectedTag))) &&
        (!newOnly || tool.isNew) &&
        (!newVersionOnly || tool.isNewVersion)
      );
    });
  }, [toolsWithIndex, query, selectedTag, newOnly, newVersionOnly]);

  const visibleRegisteredCount = visibleTools.filter(({ tool }) => tool.name).length;

  async function copyFilePath(filePath) {
    const value = String(filePath || "").trim();
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedPath(value);
    window.setTimeout(() => setCopiedPath((current) => current === value ? "" : current), 1800);
  }

  return (
    <>
      <section className="process-hero">
        <div>
          <p className="eyebrow">{process.mainTask}</p>
          <h1>{process.taskName}</h1>
          <p className="detail-subtext">{toolBadge(process)}</p>
        </div>
        <div className="detail-meta">
          {processIsNew(process) ? <span className="new-logo">NEW</span> : null}
          {processHasNewVersion(process) ? <span className="version-logo">NEW VERSION</span> : null}
          <span>{String(process.order || 0).padStart(2, "0")}</span>
          <span>{process.taskType}</span>
          <span>{processToolCount(process)} {processToolCount(process) === 1 ? "tool" : "tools"}</span>
        </div>
      </section>

      <section className="filter-panel tool-filter-panel" aria-label="Tool search and filter controls">
        <label className="search-control">
          <span>Search tools</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search tool, function, version, path, tag..." />
        </label>
        <label className="check-control">
          <input checked={newOnly} onChange={(event) => setNewOnly(event.target.checked)} type="checkbox" />
          <span>New tool only</span>
        </label>
        <label className="check-control">
          <input checked={newVersionOnly} onChange={(event) => setNewVersionOnly(event.target.checked)} type="checkbox" />
          <span>New version only</span>
        </label>
        <output>{visibleRegisteredCount} {visibleRegisteredCount === 1 ? "tool" : "tools"} shown</output>
      </section>

      {tagOptions.length ? (
        <section className="detail-tag-panel" aria-label="Tool tag filters">
          <span>Tool tag</span>
          <div>
            {tagOptions.map((tag) => (
              <button
                className={`tag-chip tag-button ${selectedTag === tag ? "is-selected" : ""}`}
                type="button"
                key={tag}
                aria-pressed={selectedTag === tag}
                onClick={() => setSelectedTag((current) => current === tag ? "" : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {visibleTools.length === 0 ? <p className="tool-empty-results">No matching tools. Clear filters or try another search term.</p> : null}

      <section className="tool-grid" aria-label="Available automation tools">
        {visibleTools.map(({ tool, index }) => (
          <article id={toolAnchorId(tool, index)} className={`tool-card ${tool.isNew || tool.isNewVersion ? "is-new-tool" : ""}`} key={`${tool.name}-${index}`}>
            <div className="tool-card-head">
              <span>Tool {String(index + 1).padStart(2, "0")}</span>
              {tool.isNew ? <span className="new-logo">NEW</span> : null}
              {tool.isNewVersion ? <span className="version-logo">NEW VERSION</span> : null}
              <h2>{tool.name || "Not registered yet"}</h2>
            </div>
            <dl>
              <div>
                <dt>Process task</dt>
                <dd>{process.taskName}</dd>
              </div>
              <div>
                <dt>Function explain</dt>
                <dd>{tool.explanation || "Not registered yet"}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{tool.version || "Not registered yet"}</dd>
              </div>
              {tool.isNewVersion ? (
                <div className="version-update-content">
                  <dt>What's new in this version</dt>
                  <dd>{tool.updateContent || "Not registered yet"}</dd>
                </div>
              ) : null}
              <div>
                <dt>File path</dt>
                <dd>
                  {tool.filePath ? (
                    <div className="file-path-control">
                      <code className="file-path">{tool.filePath}</code>
                      <span className="file-path-actions">
                        <button type="button" onClick={() => copyFilePath(tool.filePath)}>
                          {copiedPath === tool.filePath ? "Copied" : "Copy path"}
                        </button>
                      </span>
                    </div>
                  ) : "Not registered yet"}
                </dd>
              </div>
              <div>
                <dt>Tool tag</dt>
                <dd>{tagChipsText(tool.tags)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </>
  );
}
