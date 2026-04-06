export async function postJSON(url, body, fallbackError) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json().catch(() => null);
    if (response.ok) {
      return { ok: true, payload };
    }

    return {
      ok: false,
      error: payload?.error || fallbackError
    };
  } catch {
    return {
      ok: false,
      error: "The browser could not reach the server."
    };
  }
}

export function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
