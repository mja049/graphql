// Configure at build-time via Vite env:
// - VITE_DOMAIN=learn.reboot01.com
// - VITE_AUTH_URL=https://.../api/auth/signin
// - VITE_GQL_URL=https://.../api/graphql-engine/v1/graphql

export const DOMAIN = (import.meta.env?.VITE_DOMAIN || "learn.reboot01.com").trim();

const AUTH_URL_ENV = import.meta.env?.VITE_AUTH_URL;
const GQL_URL_ENV = import.meta.env?.VITE_GQL_URL;

// In dev, prefer same-origin calls through Vite proxy to avoid CORS.
// For production hosting (Netlify/GitHub Pages), set VITE_AUTH_URL and VITE_GQL_URL.
export const AUTH_URL = (AUTH_URL_ENV || (import.meta.env?.DEV ? "/api/auth/signin" : `https://${DOMAIN}/api/auth/signin`)).trim();
export const GQL_URL = (GQL_URL_ENV || (import.meta.env?.DEV ? "/api/graphql-engine/v1/graphql" : `https://${DOMAIN}/api/graphql-engine/v1/graphql`)).trim();
