# Webapp Version

This folder now contains a Next.js webapp version of the task flow chart.

## Pages

- `/` - viewer flow chart with search, filters, and auto-refresh.
- `/process/[slug]` - process detail page.
- `/admin` - admin page for Excel upload and manual edits.
- `/login` - site password login page for the whole webapp.

## API

- `GET /api/data` - returns the latest process/tool data.
- `POST /api/admin/upload` - uploads an Excel workbook and replaces shared data.
- `POST /api/admin/data` - saves edited JSON data.

## Local Setup

Install dependencies first:

```powershell
npm install
```

Create `.env.local`:

```text
SITE_LOGIN_ID=your-site-id
SITE_PASSWORD=your-site-password
SESSION_SECRET=your-random-long-session-secret
ADMIN_PASSWORD=your-admin-password
DMD_TOOL_READ_WRITE_TOKEN=your-vercel-blob-read-write-token
```

Run locally:

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/admin
```

Local saves use `.local-data/data.json`.

## Vercel Setup

1. Deploy this repository as a Next.js project.
2. In Vercel project settings, leave **Output Directory** empty. Do not set it to `dist` for the webapp version.
3. Add site login environment variables:

```text
SITE_LOGIN_ID=your-site-id
SITE_PASSWORD=your-site-password
SESSION_SECRET=your-random-long-session-secret
```

`SITE_LOGIN_ID` and `SITE_PASSWORD` control access to the whole website. `SESSION_SECRET` signs the secure login cookie; use a long random value and keep it private.

4. Add the admin environment variable:

```text
ADMIN_PASSWORD=your-admin-password
```

5. Add Vercel Blob storage to the project.
6. Copy the Blob read/write token value into this project variable:

```text
DMD_TOOL_READ_WRITE_TOKEN=vercel_blob_rw_...
```

7. Optional:

```text
BLOB_DATA_PATH=task-flow/data.json
```

On Vercel, the app stores uploaded Excel data as JSON in Vercel Blob. Viewers auto-check for updates every 30 seconds, so they see new data after refresh or the next auto-check.

The app writes to a private Blob store. Keep `DMD_TOOL_READ_WRITE_TOKEN` configured so the server can read and write `task-flow/data.json`.

## Excel Columns

The admin upload expects:

```text
Main Task
Task Name
Task Type
Automation Tool
Function Explain
Version
Update Content
File Path
New_flag
New_version
Tool Tag
```

`New_flag` and `New_version` accept `Yes`, `Y`, `True`, `1`, or `New`.

Use `Update Content` to describe what changed in a tool version. It is shown when `New_version` is flagged.

Use the existing `Tool Tag` column for clickable tool categories. For the Spec Collection task, enter:

```text
Data Crawler by Brand
```

Tags are clickable on both the main flow chart and the process detail page. On the detail page, tag chips appear under the tool search controls and filter the visible tools inside that process.

Detail pages show file paths with a `Copy path` button so users can paste the path into File Explorer.
