/**
 * Thin fetch wrapper for the /api routes.
 *
 * Every route answers with { error: string } on failure, so this turns a
 * non-2xx response into a thrown Error carrying the server's own message —
 * which is what the screens show the user.
 */

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (${response.status}).`);
  }

  return payload as T;
}

export function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function getJson<T>(url: string): Promise<T> {
  return request<T>(url, { method: "GET" });
}
