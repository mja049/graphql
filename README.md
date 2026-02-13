# GraphQL Profile (Reboot01)

A Vite + vanilla JS profile dashboard that logs into Reboot01, queries the GraphQL API, and renders a profile + statistic graphs using SVG.

## Run locally

```bash
cd graphql-profile
npm install
npm run dev -- --host
```

Open the URL printed by Vite (usually `http://localhost:5173/`).

## API / Auth

- Sign in endpoint: `https://learn.reboot01.com/api/auth/signin` (Basic Auth)
- GraphQL endpoint: `https://learn.reboot01.com/api/graphql-engine/v1/graphql` (Bearer JWT)

In **dev**, this project defaults to calling **relative** URLs:
- `/api/auth/signin`
- `/api/graphql-engine/v1/graphql`

…and uses the Vite proxy in [vite.config.js](vite.config.js) to avoid CORS.

## Environment variables

For production hosting (Netlify / GitHub Pages), you’ll usually need to call the full HTTPS endpoints (no Vite proxy). Copy `.env.example` to `.env` and set:

- `VITE_AUTH_URL`
- `VITE_GQL_URL`

## Build

```bash
npm run build
npm run preview
```

This produces a `dist/` folder.

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml` that builds the Vite site and publishes `dist/` to GitHub Pages.

1) Push this project to a GitHub repository (github.com)

- Create a repo on GitHub (example: `graphql`)
- Add it as a remote (or replace your current `origin` if it’s not GitHub):

```bash
git remote add github https://github.com/<YOUR_USER>/<YOUR_REPO>.git
git push -u github master
```

2) Enable Pages (one-time)

- GitHub repo → **Settings** → **Pages**
- Under **Build and deployment**, choose **Source: GitHub Actions**

3) Get your link

After the workflow finishes, your site will be available at:

`https://<YOUR_USER>.github.io/<YOUR_REPO>/`

Notes:
- GitHub Pages is static hosting: the Vite dev proxy in `vite.config.js` only works locally.
- If the Reboot01 API blocks requests from `github.io` via CORS, you’ll need a proxy backend (or host somewhere that can proxy) for login/GraphQL to work.
