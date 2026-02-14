import { AUTH_URL } from "./config.js";

const TOKEN_KEY = "jwt";

function base64UrlDecodeToString(input) {
  const s = String(input).replaceAll("-", "+").replaceAll("_", "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = s + pad;
  const binary = atob(b64);
  // UTF-8 decode
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    const json = base64UrlDecodeToString(parts[1]);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getUserIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  const raw = payload?.sub ?? payload?.userId ?? payload?.id;
  const id = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(id) ? id : null;
}

export function isTokenExpired(token, skewSeconds = 30) {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (!Number.isFinite(exp)) return false; // if exp missing, don't force logout
  const now = Math.floor(Date.now() / 1000);
  return now >= exp - skewSeconds;
}

function parseTokenResponse(text) {
  const t = text.trim();

  // 1) إذا السيرفر يرجع JWT كنص مباشر
  if (t.startsWith("eyJ")) return t;

  // 2) إذا يرجع JSON (قد يكون "eyJ..." أو {token:"..."} )
  try {
    const parsed = JSON.parse(t);

    // مهم جدًا: أحيانًا JSON.parse يرجّع string مباشرة
    if (typeof parsed === "string" && parsed.startsWith("eyJ")) return parsed;

    if (parsed && typeof parsed === "object") {
      const token = parsed.token || parsed.access_token || parsed.jwt;
      if (typeof token === "string" && token.startsWith("eyJ")) return token;
    }
  } catch {
    // ignore
  }

  // 3) إذا كان token بين علامات اقتباس بدون JSON
  const cleaned = t.replace(/^"(.+)"$/, "$1");
  if (cleaned.startsWith("eyJ")) return cleaned;

  return null;
}


export function getToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  if (isTokenExpired(token)) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return token;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

function safeBtoa(s) {
  // Avoid issues with non-ascii credentials
  const bytes = new TextEncoder().encode(String(s));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function login(loginValue, password) {
  const basic = safeBtoa(`${loginValue}:${password}`);

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
    },
  });

  const text = await res.text();

  if (!res.ok) {
    // لا تطبع التوكن ولا أي شيء حساس
    throw new Error("Invalid credentials or unauthorized.");
  }

  const token = parseTokenResponse(text);

  if (!token) {
    throw new Error("Login succeeded but token format is unexpected.");
  }

  localStorage.setItem(TOKEN_KEY, token);
  return token;
}
