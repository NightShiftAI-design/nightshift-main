/* KPI bubbles (rendered by app.js) */
.kpi{
  border-radius: 18px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,.04);
  padding: 12px;
  min-width: 0;
}
.kpiTop{
  display:flex;
  align-items:center;
  gap: 10px;
  margin-bottom: 8px;
}
.kpiIcon{
  width: 34px;
  height: 34px;
  border-radius: 14px;
  display:flex;
  align-items:center;
  justify-content:center;
  background: rgba(110,168,255,.14);
  border: 1px solid rgba(110,168,255,.25);
  color: rgba(110,168,255,.95);
}
.kpi .name{
  margin:0;
  font-size: 12px;
  color: var(--muted);
  font-weight: 900;
  letter-spacing: .02em;
}
.kpi .value{
  margin:0;
  font-size: 22px;
  font-weight: 950;
  letter-spacing: .01em;
}
