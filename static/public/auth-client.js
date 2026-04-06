import { postJSON } from "/public/api.js";

export async function login(username, password) {
  const result = await postJSON(
    "/login",
    { username, password },
    "Login failed."
  );

  if (result.ok) {
    return {
      ok: true,
      username: result.payload?.username || username.trim()
    };
  }

  return {
    ok: false,
    error: result.error
  };
}

export async function checkSession() {
  try {
    const response = await fetch("/session", {
      method: "GET",
      credentials: "same-origin"
    });

    const data = await response.json();
    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}
