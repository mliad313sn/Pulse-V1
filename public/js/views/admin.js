"use strict";
import { api, state } from "../lib/api.js";
import { esc, modal, toast, optionList, fmtDate } from "../lib/ui.js";
import { icon } from "../lib/icons.js";

export async function renderAdmin(container) {
  const [usersRes, auditRes] = await Promise.all([
    api.get("/api/v1/auth/users?limit=200"),
    api.get("/api/v1/audit?limit=25"),
  ]);
  const m = state.meta;

  container.innerHTML = `
    <div class="page-head"><h1>Admin</h1>
      <span class="sub">Users, roles &amp; audit trail</span>
      <button class="btn navy" id="new-user" style="margin-left:auto">${icon("plus")}New user</button></div>
    <div class="panel" style="margin-bottom:20px"><table class="dtable">
      <tr><th>Name</th><th>Email</th><th>Role</th><th>Division</th><th>Site</th><th>Status</th><th></th></tr>
      ${usersRes.users.map((u) => `<tr>
        <td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td>
        <td>${esc(u.role.replace("_", " "))}</td>
        <td>${esc(u.division_code || "—")}</td><td>${esc(u.site_code || "—")}</td>
        <td>${u.active ? (u.locked_until && new Date(u.locked_until) > new Date() ? '<span class="pill MAJOR">LOCKED</span>' : '<span class="pill DONE">ACTIVE</span>') : '<span class="pill SLIPPED">DISABLED</span>'}
            ${u.must_change_password ? '<span class="muted">pwd change pending</span>' : ""}</td>
        <td class="row-actions">
          <button class="btn small" data-edit="${u.id}">Edit</button>
          <button class="btn small" data-reset="${u.id}">Reset pwd</button>
          ${u.id !== state.user.id ? `<button class="btn small ghost-danger" data-del="${u.id}">Delete</button>` : ""}
        </td></tr>`).join("")}</table></div>

    <div class="section-title">Audit trail (latest ${auditRes.entries.length} of ${auditRes.total}) — every write, no secrets</div>
    <div class="panel"><table class="dtable">
      <tr><th>When (GMT)</th><th>Who</th><th>Entity</th><th>Field</th><th>Old → New</th></tr>
      ${auditRes.entries.map((a) => `<tr>
        <td class="muted">${new Date(a.timestamp).toISOString().replace("T", " ").slice(0, 19)}</td>
        <td>${esc(a.user_name || "system")}</td>
        <td>${esc(a.entity)} #${a.entity_id ?? ""}</td>
        <td>${esc(a.field || "")}</td>
        <td class="muted">${esc(a.old_value ?? "∅")} → ${esc(a.new_value ?? "∅")}</td></tr>`).join("")}</table></div>`;

  const reload = () => renderAdmin(container);

  const userForm = (u = {}) => `
    <div class="frow"><div class="field"><label>Name</label><input name="name" value="${esc(u.name || "")}"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(u.email || "")}"></div></div>
    <div class="frow">
      <div class="field"><label>Role</label><select name="role">${["ADMIN", "DIVISION_LEAD", "CONTRIBUTOR", "VIEWER"].map((r) =>
        `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      <div class="field"><label>Division</label><select name="division">${optionList(m.divisions, "id", (d) => d.code, u.division_id ?? "", "—")}</select></div>
      <div class="field"><label>Site</label><select name="site">${optionList(m.sites, "id", (s) => s.code, u.site_id ?? "", "—")}</select></div></div>
    ${u.id ? `<div class="field"><label><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Active</label>
      <label><input type="checkbox" name="steering" ${u.is_steering_committee ? "checked" : ""}> Steering Committee (approves PLANNING → EXECUTION gates)</label>
      <label><input type="checkbox" name="enterprise" ${u.enterprise_access !== false ? "checked" : ""}> Enterprise access (unchecked = sees own site only)</label></div>`
      : `<div class="field"><label>Initial password (min 10 chars — user must change at first login)</label><input name="password" value="Endeavour-${new Date().getUTCFullYear()}!"></div>`}`;

  container.querySelector("#new-user").onclick = () => modal({
    title: "New user",
    body: userForm(),
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`).value;
      await api.post("/api/v1/auth/users", {
        name: v("name"), email: v("email"), password: v("password"), role: v("role"),
        divisionId: v("division") ? Number(v("division")) : null,
        siteId: v("site") ? Number(v("site")) : null,
      });
      toast("User created — they must change the password at first login");
      reload();
    },
  });

  container.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    const u = usersRes.users.find((x) => x.id === Number(b.dataset.edit));
    modal({
      title: `Edit ${u.name}`,
      body: userForm(u),
      onSave: async (box) => {
        const v = (n) => box.querySelector(`[name=${n}]`).value;
        await api.put(`/api/v1/auth/users/${u.id}`, {
          name: v("name"), email: v("email"), role: v("role"),
          divisionId: v("division") ? Number(v("division")) : null,
          siteId: v("site") ? Number(v("site")) : null,
          active: box.querySelector("[name=active]").checked,
          isSteeringCommittee: box.querySelector("[name=steering]").checked,
          enterpriseAccess: box.querySelector("[name=enterprise]").checked,
        });
        toast("User updated");
        reload();
      },
    });
  });

  container.querySelectorAll("[data-reset]").forEach((b) => b.onclick = () => modal({
    title: "Reset password",
    body: `<div class="field"><label>New temporary password (min 10 chars)</label>
      <input name="pwd" value="Endeavour-${new Date().getUTCFullYear()}!"></div>
      <p class="muted">The user must change it at next login. Also clears any lockout.</p>`,
    saveLabel: "Reset",
    onSave: async (box) => {
      await api.post(`/api/v1/auth/users/${b.dataset.reset}/reset-password`, {
        newPassword: box.querySelector("[name=pwd]").value,
      });
      toast("Password reset — forced change at next login");
      reload();
    },
  }));

  container.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => modal({
    title: "Delete user",
    body: `<p>Soft delete — the account is deactivated and hidden, history stays intact. Continue?</p>`,
    saveLabel: "Delete",
    onSave: async () => {
      await api.del(`/api/v1/auth/users/${b.dataset.del}`);
      toast("User deleted (soft)");
      reload();
    },
  }));
}
