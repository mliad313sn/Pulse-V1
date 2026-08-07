"use strict";
// SPM Phase 4 — pure earned-value mathematics. All money in base currency.
//   BAC = budget at completion (total planned)
//   PV  = planned value through the as-of period (cumulative cost plan)
//   EV  = earned value = BAC × progress
//   AC  = actual cost to date
//   CPI = EV/AC, SPI = EV/PV, ETC = (BAC−EV)/CPI, EAC = AC+ETC, VAC = BAC−EAC
// Every number carries its formula so any screen can explain itself.
function computeEvm({ costPlan = [], progressPct = 0, actualCost = 0, asOfPeriod }) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const BAC = r2(costPlan.reduce((s, p) => s + Number(p.planned), 0));
  const PV = r2(costPlan
    .filter((p) => !asOfPeriod || p.period <= asOfPeriod)
    .reduce((s, p) => s + Number(p.planned), 0));
  const progress = Math.min(Math.max(Number(progressPct) / 100, 0), 1);
  const EV = r2(BAC * progress);
  const AC = r2(Number(actualCost));
  const CPI = AC > 0 ? r2(EV / AC) : null;
  const SPI = PV > 0 ? r2(EV / PV) : null;
  const ETC = CPI ? r2((BAC - EV) / CPI) : null;
  const EAC = ETC != null ? r2(AC + ETC) : null;
  const VAC = EAC != null ? r2(BAC - EAC) : null;
  const fmt = (v) => v == null ? "n/a" : v.toLocaleString("en-US");
  return {
    asOfPeriod: asOfPeriod || null,
    BAC, PV, EV, AC, CPI, SPI, ETC, EAC, VAC,
    health: {
      cost: CPI == null ? "UNKNOWN" : CPI >= 0.95 ? "GOOD" : CPI >= 0.85 ? "WATCH" : "BAD",
      schedule: SPI == null ? "UNKNOWN" : SPI >= 0.95 ? "GOOD" : SPI >= 0.85 ? "WATCH" : "BAD",
    },
    explanation: [
      `BAC ${fmt(BAC)} (total planned)`,
      `PV ${fmt(PV)} (planned through ${asOfPeriod || "all periods"})`,
      `EV ${fmt(EV)} = BAC × ${Math.round(progress * 100)}% progress`,
      `AC ${fmt(AC)} (actuals to date)`,
      CPI != null ? `CPI ${CPI} = EV/AC (${CPI >= 1 ? "under" : "over"} spend for work done)` : "CPI n/a (no actuals)",
      SPI != null ? `SPI ${SPI} = EV/PV (${SPI >= 1 ? "ahead of" : "behind"} plan)` : "SPI n/a (no plan through period)",
      EAC != null ? `EAC ${fmt(EAC)} = AC + (BAC−EV)/CPI; VAC ${fmt(VAC)}` : "EAC n/a",
    ].join(" · "),
  };
}

module.exports = { computeEvm };
