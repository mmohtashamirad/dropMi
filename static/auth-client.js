import { postJSON } from "/static/api.js";

export async function login(username, password) {
  const result = await postJSON(
    "/login",
    { username, password },
    "Login failed."
  );

  if (result.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: result.error
  };
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
