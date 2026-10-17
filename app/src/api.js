const JSON_HEADERS = {
  "Content-Type": "application/json",
};

async function request(path, options = {}) {
  const response = await fetch(path, options);

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      throw new Error(payload?.detail || `${response.status} ${response.statusText}`);
    }
    const errorText = await response.text();
    throw new Error(errorText || `${response.status} ${response.statusText}`);
  }

  const successType = response.headers.get("content-type") ?? "";
  return successType.includes("application/json") ? response.json() : null;
}

export async function fetchDashboard() {
  const snapshot = await request("/api/dashboard", { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!snapshot?.profiles || !snapshot?.pki || !Array.isArray(snapshot.navigation)) {
    throw new Error("The server returned an invalid dashboard response.");
  }
  return snapshot;
}

export function runDiagnostics() {
  return request("/api/diagnostics/run", { method: "POST" });
}

export function fetchOpenVpnConfiguration(targetId) {
  const query = targetId ? `?target=${encodeURIComponent(targetId)}` : "";
  return request(`/api/openvpn/configuration${query}`);
}

export function validateOpenVpnConfiguration(targetId, content) {
  return request("/api/openvpn/configuration/validate", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ targetId, content }),
  });
}

export function applyOpenVpnConfiguration(payload) {
  return request("/api/openvpn/configuration", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function connectProfile(profileId) {
  return request(`/api/profiles/${profileId}/connect`, { method: "POST" });
}

export function disconnectProfile(profileId) {
  return request(`/api/profiles/${profileId}/disconnect`, { method: "POST" });
}

export function selectProfile(profileId) {
  return request(`/api/profiles/${profileId}/select`, { method: "POST" });
}

export function deleteProfile(profileId) {
  return request(`/api/profiles/${profileId}`, { method: "DELETE" });
}

export function patchRouting(profileId, payload) {
  return request(`/api/profiles/${profileId}/routing`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function patchSecurity(profileId, payload) {
  return request(`/api/profiles/${profileId}/security`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function patchSubnets(profileId, payload) {
  return request(`/api/profiles/${profileId}/subnets`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function importProfile(formData) {
  return request("/api/profiles/import", {
    method: "POST",
    body: formData,
  });
}

export function createProfile(payload) {
  return request("/api/profiles", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function profileDownloadUrl(profileId) {
  return `/api/profiles/${profileId}/download`;
}

export function initializePki(payload) {
  return request("/api/pki/init", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function controlServer(action) {
  return request(`/api/pki/server/${action}`, {
    method: "POST",
  });
}

export function configurePkiDns(payload) {
  return request("/api/pki/dns", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function installPiHole(payload) {
  return request("/api/pki/pihole/install", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function controlUfw(action) {
  return request(`/api/ufw/control/${action}`, {
    method: "POST",
  });
}

export function addUfwRule(payload) {
  return request("/api/ufw/rules", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function deleteUfwRule(index) {
  return request(`/api/ufw/rules/${index}`, {
    method: "DELETE",
  });
}

export function createUser(payload) {
  return request("/api/users", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export function revokeUser(userId) {
  return request(`/api/users/${userId}/revoke`, {
    method: "POST",
  });
}

export function deleteUser(userId) {
  return request(`/api/users/${userId}`, {
    method: "DELETE",
  });
}

export function userDownloadUrl(userId) {
  return `/api/users/${userId}/download`;
}

export function resetManagedOpenVpn() {
  return request("/api/reset", {
    method: "POST",
  });
}
