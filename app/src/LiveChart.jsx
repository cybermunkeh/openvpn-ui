import { useId, useState } from "react";

export function LiveChart({ title, subtitle, series, footer, className = "", labels = [], formatValue = String, ceiling }) {
  const id = useId();
  const [hidden, setHidden] = useState([]);
  const [cursor, setCursor] = useState(null);
  const visible = series.filter((line) => !hidden.includes(line.key));
  const count = Math.max(0, ...series.map((line) => line.values.length));
  const maximum = ceiling ?? Math.max(1, ...visible.flatMap((line) => line.values).filter(Number.isFinite));
  const selected = cursor === null ? count - 1 : Math.min(cursor, count - 1);
  const width = 640;
  const height = 208;
  const x = (index) => 12 + index / Math.max(1, count - 1) * (width - 24);
  const y = (value) => height - 12 - Math.min(maximum, Math.max(0, value)) / maximum * (height - 24);

  function toggle(key) {
    setHidden((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  }

  return (
    <section className={`detail-card dashboard-chart-card ${className}`} aria-labelledby={id}>
      <div className="dashboard-card-head">
        <div><h3 id={id} className="detail-card-title">{title}</h3><p className="dashboard-card-subtitle">{subtitle}</p></div>
        <span className="chart-unit">{ceiling ? "%" : "B / s"}</span>
      </div>
      <div className="chart-readings">
        {series.map((line) => (
          <button key={line.key} type="button" className={`chart-reading${hidden.includes(line.key) ? " chart-reading-hidden" : ""}`}
            aria-pressed={!hidden.includes(line.key)} onClick={() => toggle(line.key)} title={`Toggle ${line.label}`}>
            <span className="chart-key" style={{ background: line.color }} /><span>{line.label}</span>
            <strong>{Number.isFinite(line.values[selected]) ? formatValue(line.values[selected]) : "--"}</strong>
          </button>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-scale" aria-hidden="true"><span>{formatValue(maximum)}</span><span>{formatValue(maximum / 2)}</span><span>{formatValue(0)}</span></div>
        <div className="chart-surface">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${title}. ${count} samples. Current values are listed above.`}>
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1="12" x2={width - 12} y1={y(maximum * fraction)} y2={y(maximum * fraction)} className="dashboard-grid-line" />)}
            {visible.map((line, lineIndex) => {
              let penDown = false;
              const path = line.values.map((value, index) => {
                if (!Number.isFinite(value)) { penDown = false; return ""; }
                const command = penDown ? "L" : "M";
                penDown = true;
                return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
              }).join(" ");
              return <g key={line.key}>
                <path d={path} fill="none" stroke={line.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeDasharray={lineIndex === 1 ? "6 3" : undefined} />
                {Number.isFinite(line.values[selected]) && <circle cx={x(selected)} cy={y(line.values[selected])} r="4" fill={line.color} />}
              </g>;
            })}
            {cursor !== null && count > 1 && <line x1={x(selected)} x2={x(selected)} y1="12" y2={height - 12} stroke="#8190a0" strokeDasharray="3 4" />}
          </svg>
          {count < 2 && <div className="chart-placeholder">{count ? "Collecting the next measurement…" : "Waiting for measurements"}</div>}
          {!visible.length && <div className="chart-placeholder">Select a series above to show its trend.</div>}
        </div>
      </div>
      <div className="chart-times"><span>{labels[0] || "--:--"}</span><span>{labels.at(-1) || "--:--"}</span></div>
      <div className="chart-inspector">
        <label htmlFor={`${id}-sample`}>{cursor === null ? "Latest" : "Inspect"} <strong>{labels[selected] || "--:--"}</strong></label>
        <input id={`${id}-sample`} aria-label={`Inspect ${title} sample`} type="range" min="0" max={Math.max(0, count - 1)} value={Math.max(0, selected)} disabled={count < 2}
          onChange={(event) => setCursor(Number(event.target.value))} />
        <button type="button" onClick={() => setCursor(null)} disabled={cursor === null}>Latest</button>
      </div>
      {footer && <div className="dashboard-card-foot">{footer}</div>}
    </section>
  );
}
