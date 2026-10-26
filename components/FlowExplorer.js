"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LogoutButton from "./LogoutButton.js";
import { groupedProcesses, normalize, processHasNewVersion, processIsNew, processTags, searchText, toolAnchorId, toolBadge, toolUpdateSummary, totalToolCount, uniqueToolCount } from "../lib/data-utils.js";

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

export default function FlowExplorer({ initialData }) {
  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState({ query: "", stage: "", type: "", tag: "", newOnly: false, newVersionOnly: false });
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function refreshData() {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) return;
    setData(await response.json());
    setLastRefresh(new Date());
  }

  useEffect(() => {
    const id = window.setInterval(refreshData, 30000);
    return () => window.clearInterval(id);
  }, []);

  const groups = useMemo(() => groupedProcesses(data.processes), [data]);
  const stages = groups.map(([stage]) => stage);
  const tags = useMemo(() => {
    return Array.from(new Set(data.processes.flatMap(processTags))).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleProcesses = useMemo(() => {
    return data.processes.filter((process) => {
      const processTagValues = processTags(process).map(normalize);
      return (
        (!filters.query || searchText(process).includes(normalize(filters.query))) &&
        (!filters.stage || normalize(process.mainTask) === normalize(filters.stage)) &&
        (!filters.type || normalize(process.taskType) === normalize(filters.type)) &&
        (!filters.tag || processTagValues.includes(normalize(filters.tag))) &&
        (!filters.newOnly || processIsNew(process)) &&
        (!filters.newVersionOnly || processHasNewVersion(process))
      );
    });
  }, [data, filters]);

  const visibleSlugs = new Set(visibleProcesses.map((process) => process.slug));
  const updates = useMemo(() => toolUpdateSummary(data.processes), [data]);
  const shownToolUses = totalToolCount(visibleProcesses);
  const shownUniqueTools = uniqueToolCount(visibleProcesses);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function selectTag(tag) {
    setFilters((current) => ({ ...current, tag: normalize(current.tag) === normalize(tag) ? "" : tag }));
  }

  function toolMatchesActiveFilters(tool) {
    const toolTags = (tool.tags || []).map(normalize);
    return (
      (!filters.query || toolSearchText(tool).includes(normalize(filters.query))) &&
      (!filters.tag || toolTags.includes(normalize(filters.tag))) &&
      (!filters.newOnly || tool.isNew) &&
      (!filters.newVersionOnly || tool.isNewVersion)
    );
  }

  const shouldShowToolMatches = Boolean(filters.query || filters.tag || filters.newOnly || filters.newVersionOnly);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Media Tool List</h1>
        </div>
        <div className="metrics" aria-label="Flow summary">
          <span><strong>{data.processes.length}</strong> processes</span>
          <span><strong>{groups.length}</strong> stages</span>
          <span><strong>{uniqueToolCount(data.processes)}</strong> unique tools</span>
          <span><strong>{totalToolCount(data.processes)}</strong> tool uses</span>
          <Link className="toolbar-link" href="/admin">Admin</Link>
          <LogoutButton />
        </div>
      </header>

      <div className="legend" aria-label="Quick filters">
        <button
          className={`legend-filter ${filters.type === "main" ? "is-active" : ""}`}
          type="button"
          aria-pressed={filters.type === "main"}
          onClick={() => updateFilter("type", filters.type === "main" ? "" : "main")}
        >
          <i className="legend-main" />Main
        </button>
        <button
          className={`legend-filter ${filters.type === "additional" ? "is-active" : ""}`}
          type="button"
          aria-pressed={filters.type === "additional"}
          onClick={() => updateFilter("type", filters.type === "additional" ? "" : "additional")}
        >
          <i className="legend-additional" />Additional
        </button>
        <button
          className={`legend-filter ${filters.newOnly ? "is-active" : ""}`}
          type="button"
          aria-pressed={filters.newOnly}
          onClick={() => updateFilter("newOnly", !filters.newOnly)}
        >
          <i className="legend-new" />New tool
        </button>
        <button
          className={`legend-filter ${filters.newVersionOnly ? "is-active" : ""}`}
          type="button"
          aria-pressed={filters.newVersionOnly}
          onClick={() => updateFilter("newVersionOnly", !filters.newVersionOnly)}
        >
          <i className="legend-version" />New version
        </button>
      </div>

      {(updates.newTools.length || updates.newVersions.length) ? (
        <section className="update-panel" aria-label="Tool update notifications">
          {updates.newTools.length ? (
            <details className="update-card is-new">
              <summary>
                <span className="new-logo">NEW</span>
                <strong>{updates.newTools.length} new {updates.newTools.length === 1 ? "tool" : "tools"} available</strong>
              </summary>
              <ul>
                {updates.newTools.map((tool) => (
                  <li key={`${tool.name}-${tool.version || "no-version"}`}>
                    <Link href={tool.processes[0]?.href || "#"} aria-label={`Open ${tool.name} tool detail`}>
                      <span>{tool.name}</span>
                    </Link>
                    {tool.version ? <small>Version {tool.version}</small> : null}
                    {tool.processes.length > 1 ? <small>{tool.processes.length} processes</small> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {updates.newVersions.length ? (
            <details className="update-card is-version">
              <summary>
                <span className="version-logo">NEW VERSION</span>
                <strong>{updates.newVersions.length} new {updates.newVersions.length === 1 ? "version" : "versions"} available</strong>
              </summary>
              <ul>
                {updates.newVersions.map((tool) => (
                  <li key={`${tool.name}-${tool.version || "no-version"}`}>
                    <Link href={tool.processes[0]?.href || "#"} aria-label={`Open ${tool.name} new version detail`}>
                      <span>{tool.name}</span>
                    </Link>
                    {tool.version ? <small>Version {tool.version}</small> : null}
                    {tool.processes.length > 1 ? <small>{tool.processes.length} processes</small> : null}
                    {tool.updateContent ? <p>{tool.updateContent}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="filter-panel" aria-label="Search and filter controls">
        <label className="search-control">
          <span>Search</span>
          <input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} type="search" placeholder="Search process, tool, tag, path..." />
        </label>
        <label>
          <span>Stage</span>
          <select value={filters.stage} onChange={(event) => updateFilter("stage", event.target.value)}>
            <option value="">All stages</option>
            {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
            <option value="">All types</option>
            <option value="main">Main</option>
            <option value="additional">Additional</option>
          </select>
        </label>
        <label>
          <span>Tag</span>
          <select value={filters.tag} onChange={(event) => updateFilter("tag", event.target.value)}>
            <option value="">All tags</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
        <label className="check-control">
          <input checked={filters.newOnly} onChange={(event) => updateFilter("newOnly", event.target.checked)} type="checkbox" />
          <span>New only</span>
        </label>
        <label className="check-control">
          <input checked={filters.newVersionOnly} onChange={(event) => updateFilter("newVersionOnly", event.target.checked)} type="checkbox" />
          <span>New version only</span>
        </label>
        <button type="button" onClick={() => setFilters({ query: "", stage: "", type: "", tag: "", newOnly: false, newVersionOnly: false })}>Clear</button>
        <output>
          {visibleProcesses.length} {visibleProcesses.length === 1 ? "process" : "processes"} / {shownUniqueTools} unique {shownUniqueTools === 1 ? "tool" : "tools"} / {shownToolUses} tool {shownToolUses === 1 ? "use" : "uses"} shown
        </output>
      </section>

      <p className="refresh-note">
        Data auto-checks every 30 seconds. Last checked {lastRefresh.toLocaleTimeString()}.
        <button type="button" onClick={refreshData}>Refresh now</button>
      </p>

      {visibleProcesses.length === 0 ? <p className="empty-results">No matching processes. Clear filters or try another search term.</p> : null}

      <div className="flow" aria-label="Process flow chart">
        {groups.map(([stage, processes], stageIndex) => {
          const visibleStageProcesses = processes.filter((process) => visibleSlugs.has(process.slug));
          if (visibleStageProcesses.length === 0) return null;
          return (
            <section className="stage" style={{ "--stage-index": stageIndex + 1 }} key={stage}>
              <header className="stage-header">
                <span>Stage {String(stageIndex + 1).padStart(2, "0")}</span>
                <h2>{stage}</h2>
              </header>
              <div className="process-list">
                {visibleStageProcesses.map((process) => {
                  const tagsForProcess = processTags(process);
                  const isNew = processIsNew(process);
                  const hasNewVersion = processHasNewVersion(process);
                  const matchingTools = shouldShowToolMatches ? (process.tools || []).filter(toolMatchesActiveFilters) : [];
                  return (
                    <article className={`process-card ${normalize(process.taskType) === "additional" ? "is-additional" : "is-main"}`} key={process.slug}>
                      <Link className="process-card-link" href={`/process/${process.slug}`}>
                        <span className="process-order">{String(process.order || 0).padStart(2, "0")}</span>
                        {isNew ? <span className="new-logo" aria-label="New tool">NEW</span> : null}
                        {hasNewVersion ? <span className="version-logo" aria-label="New version">NEW VERSION</span> : null}
                        <span className="process-type">{process.taskType}</span>
                        <strong>{process.taskName}</strong>
                        <small>{toolBadge(process)}</small>
                      </Link>
                      <span className="tag-row">
                        {tagsForProcess.length ? tagsForProcess.map((tag) => (
                          <button
                            className={`tag-chip tag-button ${normalize(filters.tag) === normalize(tag) ? "is-selected" : ""}`}
                            type="button"
                            key={tag}
                            aria-pressed={normalize(filters.tag) === normalize(tag)}
                            onClick={() => selectTag(tag)}
                          >
                            {tag}
                          </button>
                        )) : <span className="tag-chip is-empty">No tag</span>}
                      </span>
                      {matchingTools.length ? (
                        <div className="process-tool-results" aria-label={`Matching tools for ${process.taskName}`}>
                          <span>Matching tools</span>
                          {matchingTools.slice(0, 4).map((tool, toolIndex) => (
                            <Link href={`/process/${process.slug}#${toolAnchorId(tool, (process.tools || []).indexOf(tool))}`} key={`${tool.name}-${toolIndex}`}>
                              <strong>{tool.name || "Not registered yet"}</strong>
                              <small>{process.taskName}</small>
                            </Link>
                          ))}
                          {matchingTools.length > 4 ? <em>+{matchingTools.length - 4} more</em> : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
