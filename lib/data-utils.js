export function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function unique(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

export function parseTags(value) {
  return unique(String(value || "").split(/[,;|/]+/).map((tag) => tag.trim()));
}

export function parseNewFlag(value) {
  return ["1", "true", "yes", "y", "new"].includes(normalize(value));
}

export function normalizeMainTask(value) {
  const cleaned = String(value || "").trim();
  return cleaned === "Data Preparation?" ? "Data Preparation" : cleaned;
}

export function canonicalHeader(value) {
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
    updatecontent: "Update Content",
    versionupdatecontent: "Update Content",
    newversioncontent: "Update Content",
    whatsnew: "Update Content",
    tooltag: "Tool Tag",
    tooltags: "Tool Tag"
  };
  return aliases[key] || String(value || "").trim();
}

export function slugify(value, used = new Set()) {
  const base = normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "process";
  let slug = base;
  let counter = 2;
  while (used.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

export function processTags(process) {
  return unique((process.tools || []).flatMap((tool) => tool.tags || []));
}

export function processIsNew(process) {
  return (process.tools || []).some((tool) => tool.isNew);
}

export function processHasNewVersion(process) {
  return (process.tools || []).some((tool) => tool.isNewVersion);
}

export function processToolCount(process) {
  return (process.tools || []).filter((tool) => tool.name).length;
}

export function totalToolCount(processes) {
  return (processes || []).reduce((total, process) => total + processToolCount(process), 0);
}

export function uniqueToolCount(processes) {
  return unique((processes || []).flatMap((process) => (
    (process.tools || []).map((tool) => normalize(tool.name)).filter(Boolean)
  ))).length;
}

export function toolAnchorId(tool, index = 0) {
  const name = String(tool?.name || "tool").trim();
  return `tool-${slugify(name)}-${index + 1}`;
}

export function toolUpdateSummary(processes) {
  const byNewTool = new Map();
  const byNewVersion = new Map();

  function addTool(map, process, tool, toolIndex) {
    const name = String(tool.name || "").trim();
    if (!name) return;
    const version = String(tool.version || "").trim();
    const key = normalize(`${name}|${version}`);
    if (!map.has(key)) {
      map.set(key, { name, version, updateContent: tool.updateContent || "", processes: [] });
    }
    map.get(key).processes.push({
      name: process.taskName,
      href: `/process/${process.slug}#${toolAnchorId(tool, toolIndex)}`
    });
  }

  (processes || []).forEach((process) => {
    (process.tools || []).forEach((tool, toolIndex) => {
      if (tool.isNew) addTool(byNewTool, process, tool, toolIndex);
      if (tool.isNewVersion) addTool(byNewVersion, process, tool, toolIndex);
    });
  });

  function uniqueProcesses(processes) {
    const seen = new Set();
    return (processes || []).filter((process) => {
      if (seen.has(process.href)) return false;
      seen.add(process.href);
      return true;
    });
  }

  const sortByName = (left, right) => left.name.localeCompare(right.name);
  return {
    newTools: Array.from(byNewTool.values()).map((item) => ({ ...item, processes: uniqueProcesses(item.processes) })).sort(sortByName),
    newVersions: Array.from(byNewVersion.values()).map((item) => ({ ...item, processes: uniqueProcesses(item.processes) })).sort(sortByName)
  };
}

export function toolBadge(process) {
  const count = processToolCount(process);
  if (count === 0) return "0 tools available";
  return `${count} ${count === 1 ? "tool" : "tools"} available`;
}

export function tagChipsText(tags) {
  const values = tags || [];
  return values.length ? values.join(", ") : "No tag";
}

export function groupedProcesses(processes) {
  const groups = [];
  const byStage = new Map();
  (processes || []).forEach((process) => {
    const stage = process.mainTask || "Unassigned";
    if (!byStage.has(stage)) {
      byStage.set(stage, []);
      groups.push([stage, byStage.get(stage)]);
    }
    byStage.get(stage).push(process);
  });
  return groups;
}

export function searchText(process) {
  return normalize([
    process.mainTask,
    process.taskName,
    process.taskType,
    toolBadge(process),
    processTags(process).join(" "),
    ...(process.tools || []).flatMap((tool) => [
      tool.name,
      tool.explanation,
      tool.updateContent,
      tool.version,
      tool.filePath,
      (tool.tags || []).join(" ")
    ])
  ].join(" "));
}

export function normalizeData(data) {
  const used = new Set();
  const processes = (data.processes || []).map((process, index) => {
    const slug = process.slug || slugify(process.taskName, used);
    const finalSlug = used.has(slug) ? slugify(slug, used) : slug;
    used.add(finalSlug);
    return {
      order: index + 1,
      mainTask: process.mainTask || "Unassigned",
      taskName: process.taskName || "Untitled process",
      taskType: process.taskType || "Main",
      slug: finalSlug,
      tools: (process.tools || []).map((tool) => ({
        name: tool.name || "",
        explanation: tool.explanation || "",
        updateContent: tool.updateContent || "",
        version: tool.version || "",
        filePath: tool.filePath || "",
        tags: Array.isArray(tool.tags) ? tool.tags : parseTags(tool.tags),
        isNew: Boolean(tool.isNew),
        isNewVersion: Boolean(tool.isNewVersion)
      }))
    };
  });
  return {
    version: data.version || 1,
    updatedAt: new Date().toISOString(),
    warnings: data.warnings || [],
    processes
  };
}
