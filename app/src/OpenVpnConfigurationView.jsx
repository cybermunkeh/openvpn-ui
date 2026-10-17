import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyOpenVpnConfiguration,
  fetchOpenVpnConfiguration,
  validateOpenVpnConfiguration,
} from "./api.js";

import IconAlertTriangle from "@tabler/icons-react/dist/esm/icons/IconAlertTriangle.mjs";
import IconBook2 from "@tabler/icons-react/dist/esm/icons/IconBook2.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconDeviceFloppy from "@tabler/icons-react/dist/esm/icons/IconDeviceFloppy.mjs";
import IconFileDiff from "@tabler/icons-react/dist/esm/icons/IconFileDiff.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconRefresh from "@tabler/icons-react/dist/esm/icons/IconRefresh.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconShieldLock from "@tabler/icons-react/dist/esm/icons/IconShieldLock.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";

function editableDirectives(content) {
  const entries = [];
  const lines = content.split("\n");
  let hiddenBlock = null;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    const openBlock = trimmed.match(/^<([a-zA-Z0-9_-]+)>$/);
    const closeBlock = trimmed.match(/^<\/([a-zA-Z0-9_-]+)>$/);
    if (openBlock) {
      const name = openBlock[1].toLowerCase();
      entries.push({ type: "block", name, lineIndex, arguments: "Inline block" });
      if (name !== "connection") hiddenBlock = name;
      return;
    }
    if (closeBlock) {
      if (closeBlock[1].toLowerCase() === hiddenBlock) hiddenBlock = null;
      return;
    }
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";") || hiddenBlock) return;
    const name = trimmed.split(/\s+/, 1)[0].replace(/^--/, "").toLowerCase();
    const nameOffset = trimmed.indexOf(name);
    entries.push({
      type: "directive",
      name,
      lineIndex,
      arguments: trimmed.slice(nameOffset + name.length).trim(),
    });
  });

  return entries;
}

function updateLine(content, lineIndex, nextLine) {
  const lines = content.split("\n");
  lines[lineIndex] = nextLine;
  return lines.join("\n");
}

function removeLine(content, lineIndex) {
  const lines = content.split("\n");
  lines.splice(lineIndex, 1);
  return lines.join("\n");
}

function insertDirective(content, directive) {
  const lines = content.split("\n");
  const firstInlineBlock = lines.findIndex((line) => /^<[a-zA-Z0-9_-]+>$/.test(line.trim()));
  const insertionIndex = firstInlineBlock >= 0 ? firstInlineBlock : Math.max(0, lines.length - (lines.at(-1) === "" ? 1 : 0));
  lines.splice(insertionIndex, 0, directive);
  return lines.join("\n");
}

function countChangedLines(before, after) {
  const previous = before.split("\n");
  const next = after.split("\n");
  const length = Math.max(previous.length, next.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (previous[index] !== next[index]) changed += 1;
  }
  return changed;
}

function riskLabel(risk) {
  if (risk === "critical") return "executes code";
  if (risk === "sensitive") return "sensitive";
  if (risk === "deprecated") return "deprecated";
  return "standard";
}

export function OpenVpnConfigurationView({ onStatus, onDashboard }) {
  const [configuration, setConfiguration] = useState(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("all");
  const [directiveName, setDirectiveName] = useState("");
  const [directiveArguments, setDirectiveArguments] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [restartAfterApply, setRestartAfterApply] = useState(true);

  async function loadConfiguration(targetId) {
    setLoading(true);
    onStatus("Loading OpenVPN configuration...");
    try {
      const response = await fetchOpenVpnConfiguration(targetId);
      const next = response.configuration;
      setConfiguration(next);
      setContent(next.content);
      setOriginalContent(next.content);
      setValidation(next.validation);
      setRestartAfterApply(next.target.restartAvailable);
      setDirectiveName((current) => current || next.catalog[0]?.name || "");
      onStatus(`Loaded ${next.target.label} from ${next.target.path}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "OpenVPN configuration could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfiguration();
  }, []);

  const changed = configuration ? content !== originalContent : false;
  const directives = editableDirectives(content);
  const categories = configuration
    ? [...new Set(configuration.catalog.map((entry) => entry.category))].sort((left, right) => left.localeCompare(right))
    : [];
  const normalizedQuery = catalogQuery.trim().toLowerCase();
  const filteredCatalog = (configuration?.catalog ?? []).filter((entry) => {
    if (catalogCategory !== "all" && entry.category !== catalogCategory) return false;
    if (!normalizedQuery) return true;
    return `${entry.name} ${entry.syntax} ${entry.description} ${entry.category}`.toLowerCase().includes(normalizedQuery);
  });
  const selectedDirective = configuration?.catalog.find((entry) => entry.name === directiveName);

  function updateContent(nextContent) {
    setContent(nextContent);
    setValidation(null);
  }

  function handleDirectiveArguments(lineIndex, name, nextArguments) {
    updateContent(updateLine(content, lineIndex, `${name}${nextArguments.trim() ? ` ${nextArguments}` : ""}`));
  }

  function handleAddDirective() {
    if (!directiveName) return;
    const directive = `${directiveName}${directiveArguments.trim() ? ` ${directiveArguments.trim()}` : ""}`;
    updateContent(insertDirective(content, directive));
    setDirectiveArguments("");
    onStatus(`Added '${directiveName}' to the editor. Validate before applying.`);
  }

  async function handleValidate() {
    if (!configuration) return null;
    setValidating(true);
    onStatus("Validating configuration structure and directives...");
    try {
      const response = await validateOpenVpnConfiguration(configuration.target.id, content);
      setValidation(response.result.validation);
      const result = response.result.validation;
      onStatus(result.valid
        ? `Validation passed with ${result.warnings.length} warning(s).`
        : `Validation failed with ${result.errors.length} error(s).`);
      return result;
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Configuration validation failed.");
      return null;
    } finally {
      setValidating(false);
    }
  }

  async function handleReview() {
    const result = await handleValidate();
    if (!result?.valid) return;
    setRiskAcknowledged(false);
    setReviewOpen(true);
  }

  async function handleApply() {
    if (!configuration || !riskAcknowledged) return;
    setSaving(true);
    onStatus("Applying OpenVPN configuration with backup and rollback protection...");
    try {
      const response = await applyOpenVpnConfiguration({
        targetId: configuration.target.id,
        content,
        revision: configuration.revision,
        acknowledgeRisk: true,
        restart: restartAfterApply,
      });
      const next = response.configuration;
      setConfiguration(next);
      setContent(next.content);
      setOriginalContent(next.content);
      setValidation(next.validation);
      setReviewOpen(false);
      if (response.dashboard) onDashboard(response.dashboard);
      onStatus(`${next.apply.message} Backup: ${next.apply.backupPath}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Configuration apply failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !configuration) {
    return <div className="config-loading">Loading OpenVPN configuration...</div>;
  }

  if (!configuration) {
    return (
      <div className="config-loading config-loading-error">
        <IconAlertTriangle size={22} />
        Configuration backend unavailable.
        <button className="secondary-action" type="button" onClick={() => loadConfiguration()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="view-stack config-workspace">
      <section className="config-hero">
        <div>
          <div className="dashboard-kicker">OpenVPN 2.6 directive control</div>
          <h2>Configuration Studio</h2>
          <p>Edit every directive exposed by the installed OpenVPN build, including repeatable options and inline blocks.</p>
        </div>
        <div className="config-hero-stats">
          <span><strong>{configuration.catalogCount}</strong> documented directives</span>
          <span><strong>{validation?.directiveCount ?? directives.length}</strong> configured</span>
          <span className={`config-validity config-validity-${validation ? (validation.valid ? "valid" : "invalid") : "dirty"}`}>
            {validation ? (validation.valid ? "Validated" : "Invalid") : "Needs validation"}
          </span>
        </div>
      </section>

      <section className="detail-card config-target-bar">
        <label>
          <span>Configuration target</span>
          <select value={configuration.target.id} onChange={(event) => loadConfiguration(event.target.value)} disabled={loading || saving}>
            {configuration.targets.map((target) => (
              <option key={target.id} value={target.id}>{target.label}</option>
            ))}
          </select>
        </label>
        <div className="config-target-meta">
          <span className={`config-service-state config-service-state-${configuration.target.serviceState}`}>{configuration.target.serviceState}</span>
          <code>{configuration.target.path}</code>
          {configuration.target.containsSecrets ? <span className="config-secret-warning"><IconShieldLock size={15} /> Contains private key material</span> : null}
        </div>
        <button className="icon-button" type="button" onClick={() => loadConfiguration(configuration.target.id)} aria-label="Reload configuration">
          <IconRefresh size={17} />
        </button>
      </section>

      <div className="config-editor-grid">
        <section className="detail-card config-editor-card">
          <div className="config-section-head">
            <div>
              <div className="detail-card-title">Raw Configuration</div>
              <p>Lossless editor for comments, ordering, connection profiles and certificate blocks.</p>
            </div>
            <span>{content.split("\n").length} lines / {new Blob([content]).size} bytes</span>
          </div>
          <textarea
            className="config-raw-editor"
            value={content}
            onChange={(event) => updateContent(event.target.value)}
            spellCheck="false"
            aria-label="OpenVPN raw configuration"
          />
          <div className="config-editor-actions">
            <button className="secondary-action" type="button" onClick={() => { setContent(originalContent); setValidation(configuration.validation); }} disabled={!changed || saving}>
              Revert editor
            </button>
            <button className="secondary-action" type="button" onClick={handleValidate} disabled={validating || saving}>
              <IconCheck size={16} /> {validating ? "Validating..." : "Validate"}
            </button>
            <button className="primary-action compact-action" type="button" onClick={handleReview} disabled={!changed || validating || saving}>
              <IconFileDiff size={16} /> Review changes
            </button>
          </div>
        </section>

        <section className="detail-card config-catalog-card">
          <div className="config-section-head">
            <div>
              <div className="detail-card-title">Documented Directive Catalog</div>
              <p>Generated from <code>openvpn --help</code> on this host.</p>
            </div>
            <a href={configuration.manualUrl} target="_blank" rel="noreferrer" className="config-doc-link"><IconBook2 size={16} /> Manual</a>
          </div>
          <div className="config-catalog-filters">
            <label className="config-search">
              <IconSearch size={15} />
              <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search directives..." />
            </label>
            <select value={catalogCategory} onChange={(event) => setCatalogCategory(event.target.value)} aria-label="Directive category">
              <option value="all">All categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>

          <div className="config-directive-builder">
            <select value={directiveName} onChange={(event) => setDirectiveName(event.target.value)} aria-label="Directive to add">
              {configuration.catalog.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
            </select>
            <input
              value={directiveArguments}
              onChange={(event) => setDirectiveArguments(event.target.value)}
              placeholder={selectedDirective?.arguments || "No arguments"}
              aria-label="Directive arguments"
            />
            <button type="button" onClick={handleAddDirective}><IconPlus size={16} /> Add</button>
          </div>

          <div className="config-catalog-list">
            {filteredCatalog.slice(0, 120).map((entry) => (
              <button key={entry.name} type="button" className="config-catalog-entry" onClick={() => setDirectiveName(entry.name)}>
                <span className="config-catalog-title"><code>{entry.name}</code><span className={`config-risk config-risk-${entry.risk}`}>{riskLabel(entry.risk)}</span></span>
                <span>{entry.syntax}</span>
                <small>{entry.description || "No short description supplied by this build."}</small>
                <span className="config-catalog-meta">{entry.category} / {entry.context}{entry.repeatable ? " / repeatable" : ""}</span>
              </button>
            ))}
            {filteredCatalog.length > 120 ? <div className="empty-note">Showing the first 120 of {filteredCatalog.length} matches. Refine the search.</div> : null}
          </div>
        </section>
      </div>

      <section className="detail-card config-directives-card">
        <div className="config-section-head">
          <div>
            <div className="detail-card-title">Configured Directives</div>
            <p>Edit arguments without disturbing comments or inline secret blocks.</p>
          </div>
          <span>{directives.length} entries</span>
        </div>
        <div className="config-current-list">
          {directives.map((entry) => (
            <div key={`${entry.lineIndex}-${entry.name}`} className={`config-current-row config-current-row-${entry.type}`}>
              <span className="config-line-number">{entry.lineIndex + 1}</span>
              <code>{entry.type === "block" ? `<${entry.name}>` : entry.name}</code>
              {entry.type === "directive" ? (
                <input
                  value={entry.arguments}
                  onChange={(event) => handleDirectiveArguments(entry.lineIndex, entry.name, event.target.value)}
                  aria-label={`${entry.name} arguments`}
                />
              ) : <span className="config-block-copy">Inline content remains in the raw editor.</span>}
              <button type="button" onClick={() => updateContent(removeLine(content, entry.lineIndex))} aria-label={`Remove ${entry.name}`} disabled={entry.type === "block"}>
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {validation ? (
        <section className={`detail-card config-validation config-validation-${validation.valid ? "valid" : "invalid"}`}>
          <div className="config-section-head">
            <div>
              <div className="detail-card-title">Validation Result</div>
              <p>{validation.valid ? "Structure accepted." : "Apply is blocked until all structural errors are fixed."}</p>
            </div>
            <span>{validation.errors.length} errors / {validation.warnings.length} warnings</span>
          </div>
          {[...validation.errors, ...validation.warnings].map((issue, index) => (
            <div key={`${issue.code}-${issue.line ?? index}`} className="config-issue">
              <IconAlertTriangle size={16} />
              <strong>{issue.line ? `Line ${issue.line}` : issue.code}</strong>
              <span>{issue.message}</span>
            </div>
          ))}
          {!validation.errors.length && !validation.warnings.length ? <div className="config-validation-clean"><IconCheck size={17} /> No structural or catalog warnings.</div> : null}
        </section>
      ) : null}

      {reviewOpen ? createPortal((
        <div className="modal-scrim" onClick={() => !saving && setReviewOpen(false)}>
          <div className="modal-card config-review-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="dashboard-kicker">Transactional apply</div>
                <h3>Review {configuration.target.label}</h3>
              </div>
              <button className="icon-button subtle" type="button" onClick={() => setReviewOpen(false)} disabled={saving} aria-label="Close review"><IconX size={17} /></button>
            </div>
            <div className="config-review-summary">
              <span><IconFileDiff size={17} /> {countChangedLines(originalContent, content)} changed line positions</span>
              <span><IconDeviceFloppy size={17} /> Backup before write</span>
              <span><IconChevronRight size={17} /> Automatic rollback on service failure</span>
            </div>
            <div className="config-review-diff">
              <label><span>Current</span><textarea value={originalContent} readOnly spellCheck="false" /></label>
              <label><span>Proposed</span><textarea value={content} readOnly spellCheck="false" /></label>
            </div>
            {configuration.target.restartAvailable ? (
              <label className="config-review-check">
                <input type="checkbox" checked={restartAfterApply} onChange={(event) => setRestartAfterApply(event.target.checked)} />
                Restart and verify <code>{configuration.target.serviceName}</code> after writing
              </label>
            ) : null}
            <label className="config-review-check config-review-risk">
              <input type="checkbox" checked={riskAcknowledged} onChange={(event) => setRiskAcknowledged(event.target.checked)} />
              I understand that OpenVPN directives can expose secrets, alter routing, or execute root-level scripts.
            </label>
            <div className="config-review-actions">
              <button className="secondary-action" type="button" onClick={() => setReviewOpen(false)} disabled={saving}>Cancel</button>
              <button className="primary-action compact-action" type="button" onClick={handleApply} disabled={!riskAcknowledged || saving}>
                <IconDeviceFloppy size={16} /> {saving ? "Applying..." : "Apply configuration"}
              </button>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}
