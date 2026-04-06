import { postJSON } from "/authorized/api.js";

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
