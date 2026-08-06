"use strict";
// Fetch wrapper: JSON, CSRF header on mutations, 401 -> login, 409 surfaced
// with the server's current record for the merge UI.

export const state = {
  user: null,
  csrf: null,
  meta: null, // {divisions, sites, users}
};

async function call(method, url, body) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (state.csrf && method !== "GET") headers["X-CSRF-Token"] = state.csrf;
  const res = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* html or empty */ }
  if (res.status === 401) {
    state.user = null;
    if (location.hash !== "#/login") location.hash = "#/login";
    const e = new Error(data.error || "Not signed in");
    e.status = 401;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

export const api = {
  get: (url) => call("GET", url),
  post: (url, body) => call("POST", url, body),
  put: (url, body) => call("PUT", url, body),
  del: (url) => call("DELETE", url),
};

export async function bootstrapSession() {
  try {
    const me = await api.get("/api/v1/auth/me");
    state.user = me.user;
    state.csrf = me.csrfToken;
    if (!me.user.mustChangePassword) state.meta = await api.get("/api/v1/meta");
    return true;
  } catch {
    return false;
  }
}

export async function loadMeta() {
  state.meta = await api.get("/api/v1/meta");
}

export const divisionById = (id) => state.meta?.divisions.find((d) => d.id === id);
export const siteById = (id) => state.meta?.sites.find((s) => s.id === id);
export const userById = (id) => state.meta?.users.find((u) => u.id === id);
