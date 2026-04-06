import { postJSON } from "/static/api.js";

export async function login(username, password) {
  const result = await postJSON(
    "/login",
    { username, password },
    "Login failed."
  );

  if (result.ok) {
    return {
      ok: true,
      username: result.data.username || username.trim()
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
    return {
      authenticated: Boolean(data.authenticated),
      username: data.username || ""
    };
  } catch {
    return {
      authenticated: false,
      username: ""
    };
  }
}

export async function logout() {
  const result = await postJSON("/logout", null, "Logout failed.");

  if (result.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: result.error
  };
}
