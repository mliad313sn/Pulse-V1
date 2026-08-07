"use strict";
// Tiny DOM helpers — no framework, no build (plan §6).
import { t } from "./i18n.js";

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, isError = false) {
  let elx = document.querySelector(".toast");
  if (!elx) {
    elx = document.createElement("div");
    elx.className = "toast";
    document.body.appendChild(elx);
  }
  elx.textContent = msg;
  elx.classList.toggle("error", isError);
  elx.classList.add("show");
  clearTimeout(elx._t);
  elx._t = setTimeout(() => elx.classList.remove("show"), 3200);
}

// Standard error reporter — surfaces 409s with guidance
export function showError(err) {
  if (err.queued) toast(err.message); // queued offline — informative, not an error
  else if (err.status === 409) toast(t("err.conflict"), true);
  else toast(err.message || t("err.generic"), true);
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// "12 Aug 26" (plan §5) — all dates GMT
export function fmtDate(d) {
  if (!d) return "—";
  const x = new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${String(x.getUTCFullYear()).slice(2)}`;
}
export function isoDate(d) {
  return d ? String(d).slice(0, 10) : "";
}
export function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - Date.now()) / 86400000);
}
export function monthYear(d = new Date()) {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const RAG_LABEL = { get G() { return t("rag.G"); }, get A() { return t("rag.A"); }, get R() { return t("rag.R"); } };
export const effectiveRag = (p) => p.rag_override || p.rag_computed;

export function ragDot(p, size = "") {
  const rag = effectiveRag(p);
  const sig = p.rag_signals_json || {};
  const label = { schedule: "Schedule", roadblocks: "Roadblocks", actions: "Actions", freshness: "Freshness" };
  const rows = Object.entries(label).map(([k, name]) => {
    const s = sig[k];
    if (!s) return "";
    return `<div class="trow"><b>${name}</b><span><span class="sig ${s.value}"></span>${esc(s.detail || RAG_LABEL[s.value])}</span></div>`;
  }).join("");
  const overrideRow = p.rag_override
    ? `<div class="trow" style="margin-top:4px"><span style="opacity:.85">Override by PM/Lead (computed ${RAG_LABEL[p.rag_computed]}):<br>“${esc(p.rag_override_reason)}”</span></div>`
    : `<div class="trow" style="border-top:1px solid rgba(255,255,255,.25);margin-top:5px;padding-top:5px"><b>Overall = worst of 4</b><span>${RAG_LABEL[rag]}</span></div>`;
  return `<span class="rag-dot ${rag}" ${size ? `style="width:${size}px;height:${size}px"` : ""}>
    <span class="tip">${rows}${overrideRow}</span></span>${p.rag_override ? `<span class="manual-badge" title="${esc(p.rag_override_reason)}">MANUAL</span>` : ""}`;
}

export function avatar(name, alt = false, size = 26) {
  const initials = String(name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return `<span class="avatar ${alt ? "alt" : ""}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc(initials)}</span>`;
}

export function emptyState(icon, title, hint) {
  return `<div class="empty-state"><div class="big">${icon}</div><b>${esc(title)}</b>${hint ? `<br>${esc(hint)}` : ""}</div>`;
}

// Minimal modal. fields render inside; onSave called with the modal element.
export function modal({ title, body, saveLabel = "Save", onSave, wide }) {
  const back = el(`<div class="modal-back"><div class="modal" ${wide ? 'style="width:820px"' : ""}>
    <header><h2>${esc(title)}</h2><button class="x" type="button">✕</button></header>
    <div class="m-body">${body}</div>
    <footer>
      <button class="btn" type="button" data-act="cancel">Cancel</button>
      <button class="btn primary" type="button" data-act="save">${esc(saveLabel)}</button>
    </footer></div></div>`);
  const close = () => back.remove();
  back.querySelector(".x").onclick = close;
  back.querySelector('[data-act="cancel"]').onclick = close;
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  back.querySelector('[data-act="save"]').onclick = async () => {
    const btn = back.querySelector('[data-act="save"]');
    btn.disabled = true;
    try {
      const keep = await onSave(back);
      if (keep !== true) close();
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  };
  document.body.appendChild(back);
  return back;
}

export function optionList(items, valueKey, labelFn, selected, emptyLabel) {
  const opts = items.map((i) =>
    `<option value="${i[valueKey]}" ${String(i[valueKey]) === String(selected) ? "selected" : ""}>${esc(labelFn(i))}</option>`);
  return (emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : "") + opts.join("");
}
