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
