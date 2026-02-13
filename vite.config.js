import { defineConfig } from "vite";

// Dev-only proxy to avoid CORS when calling Reboot01 APIs from localhost.
// In code, you can use relative URLs like:
// - /api/auth/signin
// - /api/graphql-engine/v1/graphql
export default defineConfig(() => {
  // GitHub Pages serves from /<repo>/, not from /. We derive <repo> automatically
  // in CI using the GITHUB_REPOSITORY env var (owner/repo).
  const isGitHubPages = process.env.GITHUB_PAGES === "true";
  const repoFromEnv = String(process.env.GITHUB_REPOSITORY || "").split("/").pop();
  const base = isGitHubPages && repoFromEnv ? `/${repoFromEnv}/` : "/";

  return {
    base,
    server: {
      proxy: {
        "/api": {
          target: "https://learn.reboot01.com",
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
