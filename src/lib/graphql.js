import { GQL_URL } from "./config.js";

export class GraphQLAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "GraphQLAuthError";
  }
}

export class GraphQLRequestError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = "GraphQLRequestError";
    this.info = info;
  }
}

export async function gql(token, query, variables = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new GraphQLRequestError("Request timed out.");
    }
    throw new GraphQLRequestError("Network error while contacting GraphQL.");
  } finally {
    clearTimeout(t);
  }

  if (res.status === 401 || res.status === 403) {
    throw new GraphQLAuthError("Session expired or unauthorized.");
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphQLRequestError("GraphQL returned a non-JSON response.", {
      status: res.status,
      bodyPreview: text.slice(0, 300),
    });
  }

  if (!res.ok) {
    const msg = json?.message || "GraphQL request failed.";
    throw new GraphQLRequestError(msg, { status: res.status, body: json });
  }

  if (json.errors?.length) {
    throw new GraphQLRequestError(
      json.errors.map((e) => e.message).join(", "),
      { errors: json.errors }
    );
  }

  return json.data;
}
