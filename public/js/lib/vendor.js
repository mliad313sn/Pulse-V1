"use strict";
// On-demand loader for the vendored heavyweight libraries (~1.5 MB total).
// Keeping them out of the first paint is what holds the <4s @ 2 Mbps target
// (plan §0) — they fetch only when a chart, deck or XLSX export is requested.

const loaded = new Map();

export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

export const ensureChart = () => loadScript("/vendor/chart.umd.js");
export const ensurePptx = () => loadScript("/vendor/pptxgen.bundle.js");
export const ensureXlsx = () => loadScript("/vendor/xlsx.full.min.js");
