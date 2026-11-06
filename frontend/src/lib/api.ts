import { getToken, clearSession } from "@/lib/session";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function detailMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors: [{loc, msg}, ...]
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  }
  return fallback;
}

/**
 * Call the backend. `json` sends a JSON body (POST by default); a FormData `body` is sent as a
 * multipart upload; `raw` returns the response as a Blob (for protected files).
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
  const { json, headers, raw, ...rest } = init;
  const token = getToken();
  let resp: Response;
  try {
    resp = await fetch(`${API_URL}${path}`, {
      ...rest,
      method: rest.method ?? (json !== undefined ? "POST" : "GET"),
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is the backend running?`);
  }

  if (raw && resp.ok) return (await resp.blob()) as T;
  const body = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (!resp.ok) {
    if (resp.status === 401 && token) clearSession();
    throw new ApiError(resp.status, detailMessage(body, `Request failed (${resp.status})`));
  }
  return body as T;
}

/** SWR fetcher: the key is the API path. */
export const fetcher = <T>(path: string) => api<T>(path);
