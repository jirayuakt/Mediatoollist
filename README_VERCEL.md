# Deploying The Flow Chart To Vercel

This project now has two deploy paths:

- Static site: deploy the generated `dist/` folder.
- Webapp: deploy the Next.js app at the repository root.

For the webapp version, see `README_WEBAPP.md`.

## Important Notes

- Vercel Hobby is best for a non-confidential pilot or personal use.
- Production URLs on the Hobby plan are publicly accessible.
- The custom login page only applies when deploying the Next.js webapp from the repository root. It does not protect the generated static `dist/` site.
- If this is for company-only access, use Vercel Pro/Enterprise protection, SharePoint/Azure, or an internal server instead.

## Before Deploying

Regenerate the site after editing the workbook:

```powershell
python tools\build_site.py
```

Confirm these files exist:

```text
dist/index.html
dist/assets/styles.css
dist/assets/app.js
dist/processes/*.html
```

## Option 1: Deploy From Git

1. Create a GitHub repository.
2. Push this folder to the repository, including `dist/`.
3. In Vercel, import the repository.
4. In the Vercel project settings, use:
   - Framework Preset: `Other`
   - Build Command: leave blank
   - Output Directory: `dist`
5. Deploy.

When the workbook changes, run `python tools\build_site.py`, commit the updated workbook and `dist/`, then push again.

## Option 2: Deploy With Vercel CLI

From this folder:

```powershell
npx vercel deploy dist --prod
```

Use this only if Node/npm and Vercel CLI access are available on the machine.
