# Customizing The Web Page Without Excel

The site now works from `dist/assets/data.json` and can be edited in the browser.

Open:

```text
http://127.0.0.1:8765/customize.html
```

You can upload a new Excel file or manually add/edit:

- Process stage
- Process name
- Process type
- Tool name
- Function explanation
- Version
- File path
- Tool tags
- NEW badge status

## How Saving Works

The Customize page saves edits to browser storage on the current device/browser.

Use **Upload Excel** to replace the browser data with a new `.xlsx` file. The workbook should include:

```text
Main Task
Task Name
Task Type
Automation Tool
Function Explain
Version
File Path
New_flag
Tool Tag
```

`New_flag` accepts `Yes`, `Y`, `True`, `1`, or `New`.

For Vercel, this means:

- The public deployed seed data comes from `dist/assets/data.json`.
- Browser edits are local to the person editing.
- Uploading Excel changes the data in the current browser only.
- To make edits become the deployed default for everyone, use **Export JSON**, replace `dist/assets/data.json` with that exported file, then redeploy.

For shared multi-user editing directly on the website, the project would need a backend database and authentication. Static Vercel hosting alone cannot save shared edits for all users.
