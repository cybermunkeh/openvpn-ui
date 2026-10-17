import { startTransition, useEffect, useState } from "react";
import { LiveChart } from "./LiveChart.jsx";
import { OpenVpnConfigurationView } from "./OpenVpnConfigurationView.jsx";
import {
  addUfwRule,
  configurePkiDns,
  controlServer,
  controlUfw,
  connectProfile,
  createProfile,
  createUser,
  deleteUfwRule,
  deleteProfile,
  deleteUser,
  disconnectProfile,
  fetchDashboard,
  importProfile,
  initializePki,
  installPiHole,
  patchRouting,
  patchSecurity,
  patchSubnets,
  profileDownloadUrl,
  resetManagedOpenVpn,
  revokeUser,
  runDiagnostics,
  selectProfile as selectProfileRequest,
  userDownloadUrl,
} from "./api.js";

import IconActivityHeartbeat from "@tabler/icons-react/dist/esm/icons/IconActivityHeartbeat.mjs";
import IconAdjustmentsHorizontal from "@tabler/icons-react/dist/esm/icons/IconAdjustmentsHorizontal.mjs";
import IconAlertTriangle from "@tabler/icons-react/dist/esm/icons/IconAlertTriangle.mjs";
import IconArrowRight from "@tabler/icons-react/dist/esm/icons/IconArrowRight.mjs";
import IconBuildingSkyscraper from "@tabler/icons-react/dist/esm/icons/IconBuildingSkyscraper.mjs";
import IconCertificate from "@tabler/icons-react/dist/esm/icons/IconCertificate.mjs";
import IconChartHistogram from "@tabler/icons-react/dist/esm/icons/IconChartHistogram.mjs";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconCircleCheck from "@tabler/icons-react/dist/esm/icons/IconCircleCheck.mjs";
import IconCircleFilled from "@tabler/icons-react/dist/esm/icons/IconCircleFilled.mjs";
import IconCircleX from "@tabler/icons-react/dist/esm/icons/IconCircleX.mjs";
import IconCloudComputing from "@tabler/icons-react/dist/esm/icons/IconCloudComputing.mjs";
import IconCode from "@tabler/icons-react/dist/esm/icons/IconCode.mjs";
import IconDashboard from "@tabler/icons-react/dist/esm/icons/IconDashboard.mjs";
import IconDeviceLaptop from "@tabler/icons-react/dist/esm/icons/IconDeviceLaptop.mjs";
import IconFileDescription from "@tabler/icons-react/dist/esm/icons/IconFileDescription.mjs";
import IconGauge from "@tabler/icons-react/dist/esm/icons/IconGauge.mjs";
import IconLock from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconMap2 from "@tabler/icons-react/dist/esm/icons/IconMap2.mjs";
import IconMinus from "@tabler/icons-react/dist/esm/icons/IconMinus.mjs";
import IconPlayerPause from "@tabler/icons-react/dist/esm/icons/IconPlayerPause.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconRefresh from "@tabler/icons-react/dist/esm/icons/IconRefresh.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconServer2 from "@tabler/icons-react/dist/esm/icons/IconServer2.mjs";
import IconSettings from "@tabler/icons-react/dist/esm/icons/IconSettings.mjs";
import IconShieldCheck from "@tabler/icons-react/dist/esm/icons/IconShieldCheck.mjs";
import IconShieldLock from "@tabler/icons-react/dist/esm/icons/IconShieldLock.mjs";
import IconStethoscope from "@tabler/icons-react/dist/esm/icons/IconStethoscope.mjs";
import IconTopologyComplex from "@tabler/icons-react/dist/esm/icons/IconTopologyComplex.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconUpload from "@tabler/icons-react/dist/esm/icons/IconUpload.mjs";
import IconWaveSine from "@tabler/icons-react/dist/esm/icons/IconWaveSine.mjs";
import IconWorld from "@tabler/icons-react/dist/esm/icons/IconWorld.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";

const kindIcons = {
  hub: IconServer2,
  site: IconBuildingSkyscraper,
  cloud: IconCloudComputing,
  roadwarrior: IconDeviceLaptop,
};

const navIcons = {
  dashboard: IconDashboard,
  configuration: IconCode,
  diagnostics: IconStethoscope,
  topology: IconTopologyComplex,
  profiles: IconFileDescription,
  policies: IconMap2,
  ufw: IconShieldLock,
  certificates: IconCertificate,
  logs: IconFileDescription,
  settings: IconSettings,
};

const viewTitles = {
  dashboard: "Overview",
  configuration: "OpenVPN Configuration Studio",
  diagnostics: "VPN Diagnostics",
  topology: "Network Topology Workspace",
  profiles: "Profiles Workspace",
  policies: "Policies Workspace",
  ufw: "UFW Firewall Workspace",
  certificates: "Certificate Workspace",
  logs: "Runtime Logs",
  settings: "Runtime Settings",
};

const DASHBOARD_POLL_MS = 5000;

const emptySystemTelemetry = {
  available: false,
  observedAtEpoch: null,
  host: {
    cpu: { totalTicks: 0, idleTicks: 0, cores: 0 },
    load: { oneMinute: 0, fiveMinutes: 0, fifteenMinutes: 0 },
    memory: { totalBytes: 0, availableBytes: 0, usedBytes: 0, usedPercent: 0 },
    disk: { totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPercent: 0 },
    uptimeSeconds: 0,
  },
  interfaces: {
    tunnel: { available: false, name: "tun0", state: "unavailable", rxBytes: 0, txBytes: 0, rxDropped: 0, txDropped: 0 },
    egress: { available: false, name: "", state: "unavailable", rxBytes: 0, txBytes: 0, rxDropped: 0, txDropped: 0 },
  },
  openvpnProcess: { available: false, pid: 0, memoryBytes: 0, cpuUsageNanoseconds: 0, tasks: 0, serviceUptimeSeconds: 0 },
};

const emptyDashboard = {
  generatedAt: "Waiting for backend",
  operator: "operator",
  serviceVersion: "OpenVPN",
  selectedProfileId: null,
  legend: [
    { label: "Active", tone: "active" },
    { label: "Standby", tone: "standby" },
    { label: "Down", tone: "down" },
    { label: "Route", tone: "route" },
  ],
  navigation: [
    { id: "dashboard", label: "Dashboard" },
    { id: "topology", label: "Topology" },
    { id: "profiles", label: "Profiles" },
    { id: "policies", label: "Policies" },
    { id: "configuration", label: "OpenVPN Config" },
    { id: "diagnostics", label: "Diagnostics" },
    { id: "ufw", label: "UFW" },
    { id: "certificates", label: "Certificates" },
    { id: "logs", label: "Logs" },
    { id: "settings", label: "Settings" },
  ],
  profileGroups: [
    { id: "hub", label: "Hub (This Device)", profileIds: [] },
    { id: "remote-sites", label: "Remote Sites", profileIds: [] },
    { id: "road-warriors", label: "Road Warriors", profileIds: [] },
  ],
  profiles: {},
  pki: {
    initialized: false,
    serverConfigured: false,
    serverServiceName: "openvpn-server@codex-server.service",
    serverServiceState: "inactive",
    firewallServiceName: "openvpn-ui-firewall.service",
    firewallServiceState: "inactive",
    serverName: "codex-server",
    publicHost: "",
    protocol: "udp",
    port: 1194,
    tunnelNetwork: "10.8.0.0/24",
    dnsMode: "custom",
    dnsServer: "1.1.1.1",
    effectiveDnsServer: "1.1.1.1",
    vpnGatewayDns: "10.8.0.1",
    piHoleInstalled: false,
    piHoleServiceState: "not-installed",
    piHoleUpstreamDns: ["1.1.1.1", "1.0.0.1"],
    egressInterface: "",
    firewallBackend: "unavailable",
    vpnPortAllowed: false,
    uiPortAllowed: false,
    piHoleUiAllowed: false,
    vpnDnsAllowed: false,
    vpnRoutingAllowed: false,
    forwardingEnabled: false,
    natConfigured: false,
    createdAt: null,
    updatedAt: null,
    certificateAuthority: false,
    userCount: 0,
    revokedCount: 0,
    activeUserCount: 0,
    runtime: {
      available: false,
      sourcePath: "",
      updatedAt: null,
      updatedAtEpoch: null,
      connectedClients: 0,
      routedClients: 0,
      totalBytesReceived: 0,
      totalBytesSent: 0,
      totalBytesReceivedDisplay: "0 B",
      totalBytesSentDisplay: "0 B",
      maxBroadcastQueue: "unknown",
      dcoEnabled: "unknown",
      clients: [],
    },
    telemetry: emptySystemTelemetry,
    users: [],
  },
  ufw: {
    installed: false,
    available: false,
    status: "not-installed",
    logging: "unknown",
    defaultIncoming: "unknown",
    defaultOutgoing: "unknown",
    defaultRouted: "unknown",
    newProfiles: "unknown",
    ruleCount: 0,
    rules: [],
    rawStatus: "",
  },
};

const emptyDiagnostics = {
  generatedAt: null,
  durationMs: 0,
  overall: "idle",
  summary: { pass: 0, warn: 0, fail: 0 },
  checks: [],
};

const DASHBOARD_HISTORY_LIMIT = 48;

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatBytes(value) {
  const bytes = Math.max(0, toFiniteNumber(value));
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const digits = amount >= 100 || unitIndex === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatRate(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatPercent(value) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function formatPercentValue(value) {
  return `${Math.round(Math.max(0, toFiniteNumber(value)))}%`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(toFiniteNumber(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatSampleTime(timestamp) {
  if (!timestamp) {
    return "--:--";
  }
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatWindowLabel(sampleCount) {
  const totalSeconds = Math.max(0, Math.round(((sampleCount - 1) * DASHBOARD_POLL_MS) / 1000));
  if (!totalSeconds) {
    return "current snapshot";
  }
  if (totalSeconds < 60) {
    return `last ${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `last ${minutes}m ${seconds}s` : `last ${minutes}m`;
}

function runtimeClientKey(client) {
  return `${client.name ?? "client"}|${client.virtualAddress ?? "virtual"}|${client.realAddress ?? "real"}|${client.connectedSinceEpoch ?? ""}`;
}

function interfaceMetrics(value = {}) {
  return {
    ...value,
    rxBytes: value.rxBytes ?? value.rx_bytes ?? 0,
    txBytes: value.txBytes ?? value.tx_bytes ?? 0,
    rxDropped: value.rxDropped ?? value.rx_dropped ?? 0,
    txDropped: value.txDropped ?? value.tx_dropped ?? 0,
  };
}

function buildRuntimeSample(runtime, telemetry, observedAtEpoch) {
  if (!runtime?.available && !telemetry?.available) {
    return null;
  }

  const sourceTimestamp = toFiniteNumber(runtime.updatedAtEpoch);
  const observedTimestamp = toFiniteNumber(observedAtEpoch);

  return {
    timestamp: observedTimestamp || sourceTimestamp,
    sourceTimestamp,
    connectedClients: toFiniteNumber(runtime.connectedClients),
    routedClients: toFiniteNumber(runtime.routedClients),
    totalBytesReceived: toFiniteNumber(runtime.totalBytesReceived),
    totalBytesSent: toFiniteNumber(runtime.totalBytesSent),
    hostCpuTotalTicks: toFiniteNumber(telemetry?.host?.cpu?.totalTicks),
    hostCpuIdleTicks: toFiniteNumber(telemetry?.host?.cpu?.idleTicks),
    memoryUsedPercent: toFiniteNumber(telemetry?.host?.memory?.usedPercent),
    loadOneMinute: toFiniteNumber(telemetry?.host?.load?.oneMinute),
    tunnelRxBytes: toFiniteNumber(telemetry?.interfaces?.tunnel?.rxBytes),
    tunnelTxBytes: toFiniteNumber(telemetry?.interfaces?.tunnel?.txBytes),
    egressRxBytes: interfaceMetrics(telemetry?.interfaces?.egress).rxBytes,
    egressTxBytes: interfaceMetrics(telemetry?.interfaces?.egress).txBytes,
    openVpnCpuUsageNanoseconds: toFiniteNumber(telemetry?.openvpnProcess?.cpuUsageNanoseconds),
    clients: (runtime.clients ?? []).map((client) => ({
      key: runtimeClientKey(client),
      bytesReceived: toFiniteNumber(client.bytesReceived),
      bytesSent: toFiniteNumber(client.bytesSent),
    })),
  };
}

function mergeRuntimeHistory(history, sample) {
  if (!sample) {
    return history;
  }

  if (!history.length) {
    return [sample];
  }

  const previous = history[history.length - 1];
  const nextHistory = previous.timestamp === sample.timestamp ? [...history.slice(0, -1), sample] : [...history, sample];
  return nextHistory.slice(-DASHBOARD_HISTORY_LIMIT);
}

function buildThroughputSeries(history) {
  if (history.length < 2) {
    return [];
  }

  const series = [];
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const elapsedSeconds = Math.max(1, current.timestamp - previous.timestamp);
    const baselines = new Map(previous.clients.map((client) => [client.key, client]));
    let rxRate = 0;
    let txRate = 0;
    for (const client of current.clients) {
      const baseline = baselines.get(client.key);
      if (!baseline) continue;
      rxRate += Math.max(0, client.bytesReceived - baseline.bytesReceived) / elapsedSeconds;
      txRate += Math.max(0, client.bytesSent - baseline.bytesSent) / elapsedSeconds;
    }

    series.push({
      label: formatSampleTime(current.timestamp),
      rxRate,
      txRate,
      combinedRate: rxRate + txRate,
    });
  }

  return series;
}

function buildConnectionSeries(history) {
  return history.map((sample) => ({
    label: formatSampleTime(sample.timestamp),
    connectedClients: sample.connectedClients,
    routedClients: sample.routedClients,
  }));
}

function buildHostNetworkSeries(history) {
  if (history.length < 2) {
    return [];
  }

  const series = [];
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const elapsedSeconds = Math.max(1, current.timestamp - previous.timestamp);
    series.push({
      label: formatSampleTime(current.timestamp),
      rxRate: Math.max(0, (current.egressRxBytes - previous.egressRxBytes) / elapsedSeconds),
      txRate: Math.max(0, (current.egressTxBytes - previous.egressTxBytes) / elapsedSeconds),
    });
  }

  return series;
}

function buildResourceSeries(history) {
  return history.map((current, index) => {
    const previous = history[index - 1];
    const elapsedSeconds = previous ? Math.max(1, current.timestamp - previous.timestamp) : 0;
    const totalDelta = previous ? current.hostCpuTotalTicks - previous.hostCpuTotalTicks : 0;
    const idleDelta = previous ? current.hostCpuIdleTicks - previous.hostCpuIdleTicks : 0;
    const processCpuDelta = previous ? current.openVpnCpuUsageNanoseconds - previous.openVpnCpuUsageNanoseconds : 0;
    const hostCpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - (idleDelta / totalDelta)) * 100)) : 0;
    const openVpnCpuPercent = elapsedSeconds > 0
      ? Math.max(0, Math.min(100, (processCpuDelta / (elapsedSeconds * 1_000_000_000)) * 100))
      : 0;

    return {
      label: formatSampleTime(current.timestamp),
      hostCpuPercent,
      openVpnCpuPercent,
      memoryUsedPercent: current.memoryUsedPercent,
      loadOneMinute: current.loadOneMinute,
    };
  });
}

function buildClientRateMap(history) {
  if (history.length < 2) {
    return {};
  }

  const previous = history[history.length - 2];
  const current = history[history.length - 1];
  const elapsedSeconds = Math.max(1, current.timestamp - previous.timestamp);
  const previousClients = Object.fromEntries(previous.clients.map((client) => [client.key, client]));

  return Object.fromEntries(
    current.clients.map((client) => {
      const baseline = previousClients[client.key];
      const rxRate = baseline ? Math.max(0, (client.bytesReceived - baseline.bytesReceived) / elapsedSeconds) : 0;
      const txRate = baseline ? Math.max(0, (client.bytesSent - baseline.bytesSent) / elapsedSeconds) : 0;

      return [
        client.key,
        {
          rxRate,
          txRate,
          combinedRate: rxRate + txRate,
        },
      ];
    }),
  );
}

function buildLineCoordinates(values, width, height, maxValue, padding = 14) {
  if (!values.length) {
    return [];
  }

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const divisor = Math.max(1, values.length - 1);

  return values
    .map((value, index) => {
      const x = padding + (innerWidth * index) / divisor;
      const normalized = maxValue > 0 ? Math.max(0, value) / maxValue : 0;
      const y = height - padding - normalized * innerHeight;
      return { x, y };
    });
}

function buildLinePoints(values, width, height, maxValue, padding = 14) {
  return buildLineCoordinates(values, width, height, maxValue, padding)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function summarizeRuntime(pki, runtime, history) {
  const telemetry = pki.telemetry ?? emptySystemTelemetry;
  const throughputSeries = buildThroughputSeries(history);
  const connectionSeries = buildConnectionSeries(history);
  const hostNetworkSeries = buildHostNetworkSeries(history);
  const resourceSeries = buildResourceSeries(history);
  const latestThroughput = throughputSeries[throughputSeries.length - 1] ?? {
    label: "Live",
    rxRate: 0,
    txRate: 0,
    combinedRate: 0,
  };
  const clientRateMap = buildClientRateMap(history);
  const activeClients = [...(runtime.clients ?? [])]
    .map((client) => {
      const rate = clientRateMap[runtimeClientKey(client)] ?? { rxRate: 0, txRate: 0, combinedRate: 0 };
      const totalBytes = toFiniteNumber(client.bytesReceived) + toFiniteNumber(client.bytesSent);

      return {
        ...client,
        totalBytes,
        rxRate: rate.rxRate,
        txRate: rate.txRate,
        combinedRate: rate.combinedRate,
      };
    })
    .sort((left, right) => right.totalBytes - left.totalBytes || right.combinedRate - left.combinedRate);

  const totalClientTraffic = activeClients.reduce((sum, client) => sum + client.totalBytes, 0);
  const routeCoverage = runtime.connectedClients ? toFiniteNumber(runtime.routedClients) / toFiniteNumber(runtime.connectedClients) : 1;
  const activeUserShare = pki.userCount ? toFiniteNumber(pki.activeUserCount) / toFiniteNumber(pki.userCount) : 0;
  const latestHostNetwork = hostNetworkSeries[hostNetworkSeries.length - 1] ?? { label: "Live", rxRate: 0, txRate: 0 };
  const latestResources = resourceSeries[resourceSeries.length - 1] ?? {
    label: "Live",
    hostCpuPercent: 0,
    openVpnCpuPercent: 0,
    memoryUsedPercent: toFiniteNumber(telemetry.host?.memory?.usedPercent),
    loadOneMinute: toFiniteNumber(telemetry.host?.load?.oneMinute),
  };
  const tunnelInterface = interfaceMetrics(telemetry.interfaces?.tunnel ?? emptySystemTelemetry.interfaces.tunnel);
  const egressInterface = interfaceMetrics(telemetry.interfaces?.egress ?? emptySystemTelemetry.interfaces.egress);
  const openVpnProcess = telemetry.openvpnProcess ?? emptySystemTelemetry.openvpnProcess;

  return {
    hasRuntime: Boolean(runtime.available),
    hasSystemTelemetry: Boolean(telemetry.available),
    observedAtEpoch: toFiniteNumber(telemetry.observedAtEpoch),
    windowLabel: formatWindowLabel(history.length),
    throughputSeries,
    connectionSeries,
    hostNetworkSeries,
    resourceSeries,
    latestThroughput,
    latestHostNetwork,
    latestResources,
    activeClients,
    topTalkers: activeClients.slice(0, 5),
    totalClientTraffic,
    routeCoverage,
    activeUserShare,
    tunnelInterface,
    egressInterface,
    openVpnProcess,
    host: telemetry.host ?? emptySystemTelemetry.host,
    packetDrops: toFiniteNumber(tunnelInterface.rxDropped) + toFiniteNumber(tunnelInterface.txDropped) + toFiniteNumber(egressInterface.rxDropped) + toFiniteNumber(egressInterface.txDropped),
  };
}

function getProfileGroupId(dashboard, profileId) {
  for (const group of dashboard.profileGroups) {
    if (group.profileIds.includes(profileId)) {
      return group.id;
    }
  }
  return "remote-sites";
}

function statusTone(status) {
  if (status === "connected") return "connected";
  if (status === "connecting") return "connecting";
  return "disconnected";
}

function labelizeMode(mode) {
  return mode === "full" ? "Full Tunnel" : "Split Tunnel";
}

function cloneDashboard(next) {
  return JSON.parse(JSON.stringify(next));
}

function initialViewFromUrl() {
  if (typeof window === "undefined") {
    return "dashboard";
  }
  const requestedView = new URLSearchParams(window.location.search).get("view");
  return requestedView && viewTitles[requestedView] ? requestedView : "dashboard";
}

function profileSummary(profile) {
  if (profile.status === "connected") return "Connected";
  if (profile.status === "connecting") return "Connecting...";
  if (profile.profileRole === "issued-client") return "Ready to download";
  if (profile.configState === "draft") return "Draft";
  return "Disconnected";
}

function isIssuedProfile(profile) {
  return profile?.profileRole === "issued-client";
}

function buildUfwPreview(rule) {
  const mode = rule.mode === "route" ? "ufw route" : "ufw";
  const action = rule.action || "allow";
  const source = rule.source?.trim() || "any";
  const destination = rule.destination?.trim() || "any";
  const segments = [mode, action];

  if (rule.mode === "route") {
    if (rule.inInterface?.trim()) segments.push("in on", rule.inInterface.trim());
    if (rule.outInterface?.trim()) segments.push("out on", rule.outInterface.trim());
  }

  segments.push("from", source, "to", destination);
  if (rule.port?.trim()) segments.push("port", rule.port.trim());
  if (rule.protocol && rule.protocol !== "any") segments.push("proto", rule.protocol);
  return segments.join(" ");
}

function TopologyNode({ title, subtitle, icon: Icon, active = false, metric }) {
  return (
    <div className={`topology-node${active ? " topology-node-active" : ""}`}>
      <div className="topology-node-icon">
        <Icon size={24} stroke={1.8} />
      </div>
      <div>
        <div className="topology-node-title">{title}</div>
        <div className="topology-node-subtitle">{subtitle}</div>
        {metric ? <div className="topology-node-metric">{metric}</div> : null}
      </div>
    </div>
  );
}

function EmptyView({ title, copy, primaryLabel, secondaryLabel, onPrimary, onSecondary }) {
  return (
    <div className="topology-empty">
      <div className="topology-empty-icon">
        <IconFileDescription size={28} stroke={1.8} />
      </div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <div className="action-row">
        <button className="primary-action topology-empty-action" type="button" onClick={onPrimary}>
          {primaryLabel}
        </button>
        {secondaryLabel ? (
          <button className="secondary-action" type="button" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DashboardStatCard({ icon: Icon, label, value, note, tone = "default" }) {
  return (
    <article className={`dashboard-stat-card dashboard-stat-card-${tone}`}>
      <div className="dashboard-stat-card-head">
        <span>{label}</span>
        <Icon size={18} stroke={1.9} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function DashboardSignalRow({ label, detail, state, tone = "ok" }) {
  return (
    <div className={`dashboard-signal-row dashboard-signal-row-${tone}`}>
      <span className="dashboard-signal-dot" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span>{state}</span>
    </div>
  );
}

const DashboardTrendCard = LiveChart;

export function App() {
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [mode, setMode] = useState("connecting");
  const [historyWindow, setHistoryWindow] = useState(240);
  const [clientSearch, setClientSearch] = useState("");
  const [receivedAt, setReceivedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [statusMessage, setStatusMessage] = useState("Waiting for backend connection.");
  const [activeView, setActiveView] = useState(initialViewFromUrl);
  const [runtimeHistory, setRuntimeHistory] = useState([]);
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [logPaused, setLogPaused] = useState(false);
  const [clearedLogProfiles, setClearedLogProfiles] = useState({});
  const [modalMode, setModalMode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [topologyZoom, setTopologyZoom] = useState(1);
  const [subnetForm, setSubnetForm] = useState({
    included: "",
    excluded: "",
  });
  const [createForm, setCreateForm] = useState({
    name: "",
    group: "road-warriors",
  });
  const [importForm, setImportForm] = useState({
    name: "",
    group: "remote-sites",
    file: null,
  });
  const [pkiForm, setPkiForm] = useState({
    publicHost: "",
    protocol: "udp",
    port: "1194",
    tunnelNetwork: "10.8.0.0/24",
    dnsMode: "custom",
    dnsServer: "1.1.1.1",
    piHoleUpstreamDns: "1.1.1.1, 1.0.0.1",
  });
  const [userForm, setUserForm] = useState({
    name: "",
  });
  const [ufwRuleForm, setUfwRuleForm] = useState({
    mode: "host",
    action: "allow",
    protocol: "tcp",
    port: "",
    source: "any",
    destination: "any",
    inInterface: "tun0",
    outInterface: "",
  });

  const allProfiles = Object.values(dashboard.profiles);
  const selectedProfile = dashboard.selectedProfileId ? dashboard.profiles[dashboard.selectedProfileId] : null;
  const pki = dashboard.pki ?? emptyDashboard.pki;
  const runtime = pki.runtime ?? emptyDashboard.pki.runtime;
  const ufw = dashboard.ufw ?? emptyDashboard.ufw;
  const otherProfiles = allProfiles.filter((profile) => profile.id !== dashboard.selectedProfileId);
  const profileCount = allProfiles.length;
  const connectedCount = allProfiles.filter((profile) => profile.status === "connected").length;
  const issuedCount = allProfiles.filter((profile) => isIssuedProfile(profile)).length;
  const lastSampleTime = runtimeHistory.at(-1)?.timestamp ?? 0;
  const visibleHistory = runtimeHistory.filter((sample) => sample.timestamp >= lastSampleTime - historyWindow);
  const runtimeTelemetry = summarizeRuntime(pki, runtime, visibleHistory);
  const feedAge = receivedAt ? Math.max(0, Math.floor((now - receivedAt) / 1000)) : null;
  const sampleAge = runtime.updatedAtEpoch && runtimeTelemetry.observedAtEpoch
    ? Math.max(0, runtimeTelemetry.observedAtEpoch - runtime.updatedAtEpoch) + (feedAge ?? 0) : null;
  const feedStale = mode !== "server" || (feedAge !== null && feedAge > 15);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (dashboard.source === "server") setReceivedAt(Date.now());
  }, [dashboard]);
  const filteredGroups = dashboard.profileGroups.map((group) => ({
    ...group,
    profileIds: group.profileIds.filter((profileId) => {
      if (!searchQuery.trim()) {
        return true;
      }
      const profile = dashboard.profiles[profileId];
      return profile?.name?.toLowerCase().includes(searchQuery.trim().toLowerCase());
    }),
  }));

  useEffect(() => {
    const telemetry = pki.telemetry ?? emptySystemTelemetry;
    const sample = buildRuntimeSample(runtime, telemetry, Math.floor(Date.now() / 1000));
    if (!sample) {
      return;
    }

    setRuntimeHistory((current) => mergeRuntimeHistory(current, sample));
  }, [
    dashboard.generatedAt,
    runtime.available,
    runtime.updatedAtEpoch,
    runtime.totalBytesReceived,
    runtime.totalBytesSent,
    runtime.connectedClients,
    runtime.routedClients,
    runtime.clients.length,
    pki.telemetry?.available,
    pki.telemetry?.observedAtEpoch,
    pki.telemetry?.host?.cpu?.totalTicks,
    pki.telemetry?.host?.cpu?.idleTicks,
    pki.telemetry?.host?.memory?.usedPercent,
    pki.telemetry?.host?.load?.oneMinute,
    pki.telemetry?.interfaces?.tunnel?.rxBytes,
    pki.telemetry?.interfaces?.tunnel?.txBytes,
    pki.telemetry?.interfaces?.egress?.rxBytes,
    pki.telemetry?.interfaces?.egress?.txBytes,
    pki.telemetry?.openvpnProcess?.cpuUsageNanoseconds,
  ]);

  async function refreshDashboard() {
    try {
      const remoteDashboard = await fetchDashboard();
      if (!remoteDashboard) {
        return;
      }

      startTransition(() => {
        setDashboard(remoteDashboard);
        setMode("server");
        if (remoteDashboard.selectedProfileId && remoteDashboard.profiles?.[remoteDashboard.selectedProfileId]) {
          setStatusMessage("Backend connected. Controls operate against the server runtime.");
        } else {
          setStatusMessage("Backend connected. No profiles imported yet.");
        }
      });
    } catch {
      setMode("offline");
      setStatusMessage("Backend unavailable. Controls are read-only until it responds.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    let pending = false;

    async function sync() {
      if (pending) return;
      pending = true;
      try {
        const remoteDashboard = await fetchDashboard();
        if (cancelled || !remoteDashboard) {
          return;
        }

        startTransition(() => {
          setDashboard(remoteDashboard);
          setMode("server");
          if (remoteDashboard.selectedProfileId && remoteDashboard.profiles?.[remoteDashboard.selectedProfileId]) {
            setStatusMessage("Backend connected. Controls operate against the server runtime.");
          } else {
            setStatusMessage("Backend connected. No profiles imported yet.");
          }
        });
      } catch {
        if (!cancelled) {
          setMode("offline");
          setStatusMessage("Backend unavailable. Controls are read-only until it responds.");
        }
      } finally {
        pending = false;
      }
    }

    sync();
    const timerId = window.setInterval(sync, DASHBOARD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    setPkiForm((current) => ({
      publicHost: current.publicHost || pki.publicHost || pki.detectedPublicIpv4 || "",
      protocol: pki.protocol || current.protocol,
      port: String(pki.port || current.port || "1194"),
      tunnelNetwork: pki.tunnelNetwork || current.tunnelNetwork,
      dnsMode: pki.dnsMode || current.dnsMode,
      dnsServer: pki.dnsServer || current.dnsServer,
      piHoleUpstreamDns: Array.isArray(pki.piHoleUpstreamDns) && pki.piHoleUpstreamDns.length
        ? pki.piHoleUpstreamDns.join(", ")
        : current.piHoleUpstreamDns,
    }));
  }, [pki.publicHost, pki.detectedPublicIpv4, pki.protocol, pki.port, pki.tunnelNetwork, pki.dnsMode, pki.dnsServer, pki.piHoleUpstreamDns]);

  useEffect(() => {
    if (!pki.egressInterface) {
      return;
    }
    setUfwRuleForm((current) => ({
      ...current,
      outInterface: current.outInterface || pki.egressInterface,
    }));
  }, [pki.egressInterface]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const nextUrl = new URL(window.location.href);
    if (activeView === "dashboard") {
      nextUrl.searchParams.delete("view");
    } else {
      nextUrl.searchParams.set("view", activeView);
    }
    window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    window.scrollTo(0, 0);
  }, [activeView]);

  function mutateDashboard(mutator) {
    setDashboard((current) => {
      const draft = cloneDashboard(current);
      mutator(draft);
      return draft;
    });
  }

  function openCreateModal() {
    setModalMode("create");
    setActiveView("profiles");
  }

  function openImportModal() {
    if (selectedProfile) {
      setImportForm({
        name: selectedProfile.name,
        group: selectedProfile.group ?? getProfileGroupId(dashboard, selectedProfile.id),
        file: null,
      });
    } else {
      setImportForm({
        name: "",
        group: "remote-sites",
        file: null,
      });
    }
    setModalMode("import");
    setActiveView("profiles");
  }

  function closeModal() {
    setModalMode(null);
  }

  async function selectProfile(profileId, nextView = activeView) {
    mutateDashboard((draft) => {
      draft.selectedProfileId = profileId;
    });
    setActiveView(nextView);
    try {
      const response = await selectProfileRequest(profileId);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "Profile selection failed.");
    }
  }

  async function handleConnection(action) {
    const profileId = dashboard.selectedProfileId;
    if (!profileId || !dashboard.profiles[profileId]) {
      return;
    }

    mutateDashboard((draft) => {
      Object.values(draft.profiles).forEach((profile) => {
        if (profile.status === "connected" && profile.id !== profileId) {
          profile.status = "disconnected";
        }
      });
      draft.profiles[profileId].status = action === "connect" ? "connected" : "disconnected";
    });

    try {
      const response = action === "connect" ? await connectProfile(profileId) : await disconnectProfile(profileId);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage(response?.apply?.message ?? `Profile ${profileId} ${action === "connect" ? "connected" : "disconnected"} on the server.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "Connection change failed.");
    }
  }

  async function handleSecurityChange(key, value) {
    if (!dashboard.selectedProfileId || !dashboard.profiles[dashboard.selectedProfileId]) {
      return;
    }

    mutateDashboard((draft) => {
      draft.profiles[draft.selectedProfileId].security[key] = value;
    });

    try {
      const response = await patchSecurity(dashboard.selectedProfileId, { [key]: value });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setStatusMessage(response?.apply?.message ?? `Security control ${key} updated on the server.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : `Security control ${key} failed.`);
    }
  }

  async function handleRouteMode(modeValue) {
    if (!dashboard.selectedProfileId || !dashboard.profiles[dashboard.selectedProfileId]) {
      return;
    }

    mutateDashboard((draft) => {
      draft.profiles[draft.selectedProfileId].routeMode = modeValue;
    });

    try {
      const response = await patchRouting(dashboard.selectedProfileId, { route_mode: modeValue });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setStatusMessage(response?.apply?.message ?? `Routing mode changed to ${labelizeMode(modeValue)} on the server.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "Routing update failed.");
    }
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();

    try {
      const response = await createProfile({
        name: createForm.name.trim(),
        group: createForm.group,
      });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
        setMode("server");
        const createdName = createForm.name.trim();
        setCreateForm({
          name: "",
          group: "road-warriors",
        });
        closeModal();
        if (response.downloadUrl) {
          beginDownload(response.downloadUrl, `VPN profile ${createdName} created; download started.`);
        } else {
          setStatusMessage(`VPN profile ${createdName} created and ready to download.`);
        }
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "VPN profile creation failed.");
    }
  }

  async function handleDeleteProfile(profileId) {
    try {
      const response = await deleteProfile(profileId);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setStatusMessage(`Profile ${profileId} removed from the server.`);
      if (!Object.keys(response?.dashboard?.profiles ?? {}).length) {
        setActiveView("profiles");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Profile deletion failed.");
    }
  }

  function handleDownloadProfile(profileId) {
    const url = profileDownloadUrl(profileId);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setStatusMessage(`Profile ${profileId} download started.`);
  }

  function beginDownload(url, label) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setStatusMessage(label);
  }

  async function handleInitializePkiSubmit(event) {
    event.preventDefault();

    try {
      const response = await initializePki({
        publicHost: pkiForm.publicHost.trim(),
        protocol: pkiForm.protocol,
        port: Number(pkiForm.port),
        tunnelNetwork: pkiForm.tunnelNetwork.trim(),
        dnsMode: pkiForm.dnsMode,
        dnsServer: pkiForm.dnsServer.trim(),
        piHoleUpstreamDns: pkiForm.piHoleUpstreamDns,
      });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage(`PKI and OpenVPN server initialized for ${pkiForm.publicHost.trim()}.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "PKI initialization failed.");
    }
  }

  async function handleCreateUserSubmit(event) {
    event.preventDefault();

    try {
      const response = await createUser({ name: userForm.name.trim() });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setUserForm({ name: "" });
      setStatusMessage(`VPN user ${userForm.name.trim()} created.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "User creation failed.");
    }
  }

  async function handleServerControl(action) {
    try {
      const response = await controlServer(action);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setStatusMessage(`OpenVPN server ${action} completed.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "OpenVPN server action failed.");
    }
  }

  async function handleUfwControl(action) {
    try {
      const response = await controlUfw(action);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage(`UFW ${action} completed.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "UFW action failed.");
    }
  }

  async function handleCreateUfwRule(event) {
    event.preventDefault();

    try {
      const response = await addUfwRule(ufwRuleForm);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage(`UFW rule added: ${buildUfwPreview(ufwRuleForm)}.`);
      setUfwRuleForm((current) => ({
        ...current,
        port: "",
        source: current.mode === "route" ? current.source : "any",
        destination: "any",
      }));
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "UFW rule creation failed.");
    }
  }

  async function handleDeleteUfwRule(index) {
    try {
      const response = await deleteUfwRule(index);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage(`UFW rule ${index} removed.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "UFW rule deletion failed.");
    }
  }

  async function handleApplyDnsSettings(event) {
    event.preventDefault();

    try {
      const response = await configurePkiDns({
        dnsMode: pkiForm.dnsMode,
        dnsServer: pkiForm.dnsServer.trim(),
        piHoleUpstreamDns: pkiForm.piHoleUpstreamDns,
      });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage(`VPN DNS updated to ${pkiForm.dnsMode === "pihole" ? "Pi-hole" : pkiForm.dnsServer.trim()}.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "VPN DNS update failed.");
    }
  }

  async function handleInstallPiHole() {
    try {
      const response = await installPiHole({
        piHoleUpstreamDns: pkiForm.piHoleUpstreamDns,
      });
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setMode("server");
      setStatusMessage("Pi-hole installed on the server and attached as VPN DNS.");
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "Pi-hole installation failed.");
    }
  }

  async function handleRevokeUser(userId) {
    try {
      const response = await revokeUser(userId);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setStatusMessage(`VPN user ${userId} revoked.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "User revocation failed.");
    }
  }

  async function handleDeleteUser(userId) {
    try {
      const response = await deleteUser(userId);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setStatusMessage(`VPN user ${userId} deleted.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "User deletion failed.");
    }
  }

  async function handleResetManagedOpenVpn() {
    if (!window.confirm("Remove all managed profiles, VPN users, PKI material, and runtime overrides?")) {
      return;
    }

    try {
      const response = await resetManagedOpenVpn();
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      setActiveView("settings");
      setMode("server");
      setStatusMessage("Managed OpenVPN state removed. The host is back to a clean managed baseline.");
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "Managed reset failed.");
    }
  }

  async function handleSubnetChange(listKey, operation, subnet) {
    if (!selectedProfile) {
      return;
    }

    const draftValue = subnet?.trim() ?? subnetForm[listKey].trim();
    const currentValues = selectedProfile[listKey === "included" ? "includedSubnets" : "excludedSubnets"];
    let nextValues = currentValues;

    if (operation === "add") {
      if (!draftValue) {
        setStatusMessage("Enter a CIDR subnet before adding it.");
        return;
      }
      nextValues = [...currentValues, draftValue];
    } else {
      nextValues = currentValues.filter((entry) => entry !== subnet);
    }

    const payload = {
      includedSubnets: listKey === "included" ? nextValues : selectedProfile.includedSubnets,
      excludedSubnets: listKey === "excluded" ? nextValues : selectedProfile.excludedSubnets,
    };

    try {
      const response = await patchSubnets(selectedProfile.id, payload);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
      }
      if (operation === "add") {
        setSubnetForm((current) => ({ ...current, [listKey]: "" }));
      }
      setStatusMessage(response?.apply?.message ?? `Subnet policy updated for ${selectedProfile.name}.`);
    } catch (error) {
      await refreshDashboard();
      setStatusMessage(error instanceof Error ? error.message : "Subnet policy update failed.");
    }
  }

  function handleTopologyZoom(direction) {
    setTopologyZoom((current) => {
      if (direction === "fit") {
        setStatusMessage("Topology zoom reset to 100%.");
        return 1;
      }
      const delta = direction === "in" ? 0.1 : -0.1;
      const next = Math.min(1.4, Math.max(0.7, Math.round((current + delta) * 10) / 10));
      setStatusMessage(`Topology zoom set to ${Math.round(next * 100)}%.`);
      return next;
    });
  }

  function clearVisibleLogs() {
    if (!selectedProfile) {
      return;
    }
    setClearedLogProfiles((current) => ({ ...current, [selectedProfile.id]: true }));
    setStatusMessage(`Visible log rows cleared for ${selectedProfile.name}.`);
  }

  async function handleImportSubmit(event) {
    event.preventDefault();

    if (!importForm.name.trim() || !importForm.file) {
      setStatusMessage("Import requires a profile name and a real profile file.");
      return;
    }

    const payload = new FormData();
    payload.append("name", importForm.name.trim());
    payload.append("group", importForm.group);
    payload.append("profile", importForm.file);

    try {
      const response = await importProfile(payload);
      if (response?.dashboard) {
        setDashboard(response.dashboard);
        setMode("server");
        setStatusMessage(`Profile ${importForm.name.trim()} imported on the server.`);
        setImportForm({ name: "", group: "remote-sites", file: null });
        closeModal();
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Profile import failed.");
    }
  }

  function renderProfileCards() {
    return filteredGroups.flatMap((group) => (
      group.profileIds.map((profileId) => {
        const profile = dashboard.profiles[profileId];
        if (!profile) {
          return null;
        }
        const ProfileIcon = kindIcons[profile.kind] ?? IconWorld;
        const active = profile.id === dashboard.selectedProfileId;

        return (
          <button
            key={profile.id}
            type="button"
            className={`profile-list-card${active ? " profile-list-card-active" : ""}`}
            onClick={() => selectProfile(profile.id, "profiles")}
          >
            <div className="profile-list-card-head">
              <span className="profile-leading"><ProfileIcon size={18} stroke={1.8} /></span>
              <span className={`profile-state profile-state-${statusTone(profile.status)}`}>
                <IconCircleFilled size={8} fill="currentColor" stroke={0} />
                {profileSummary(profile)}
              </span>
            </div>
            <div className="profile-list-card-title">{profile.name}</div>
            <div className="profile-list-card-copy">{group.label}</div>
            <div className="profile-list-card-copy">{profile.protocol} / {profile.remoteAddress}:{profile.port}</div>
          </button>
        );
      })
    ));
  }

  function renderEventTable(entries) {
    if (!entries.length) {
      return (
        <div className="event-row event-row-empty">
          <span>--:--:--</span>
          <span>---</span>
          <span className="event-level">INFO</span>
          <span className="event-message">No runtime events recorded.</span>
        </div>
      );
    }

    return entries.map((entry, index) => (
      <div key={`${entry.time}-${index}`} className="event-row">
        <span>{entry.time}</span>
        <span>{entry.date}</span>
        <span className={`event-level event-level-${entry.level.toLowerCase()}`}>{entry.level}</span>
        <span className="event-message">{entry.message}</span>
      </div>
    ));
  }

  function renderTopologyView() {
    if (!selectedProfile) {
      return (
        <EmptyView
          title="No OpenVPN profiles imported"
          copy="Create a complete client profile for this server, or import an existing `.ovpn` or `.conf` file for an outbound tunnel."
          primaryLabel="New profile"
          secondaryLabel="Import config"
          onPrimary={openCreateModal}
          onSecondary={openImportModal}
        />
      );
    }

    return (
      <>
        <div className="canvas-line canvas-line-primary" />
        <div className="canvas-line canvas-line-secondary" />
        <div className="canvas-line canvas-line-tertiary" />

        <div className="canvas-node canvas-node-hub">
          <TopologyNode
            title="This Device (Hub)"
            subtitle={selectedProfile.localIp === "Pending" ? "No active tunnel" : selectedProfile.localIp}
            metric={selectedProfile.localIp === "Pending" ? "Awaiting import" : `${selectedProfile.localIp} / tun0`}
            icon={IconServer2}
          />
        </div>

        <div className="canvas-node canvas-node-tunnel">
          <div className="tunnel-pill">
            <IconLock size={20} stroke={1.8} />
          </div>
          <div className="tunnel-copy">
            <div className="topology-node-title">{isIssuedProfile(selectedProfile) ? "Issued Client Credential" : selectedProfile.configState === "draft" ? "Draft Tunnel Definition" : "OpenVPN Tunnel"}</div>
            <div className="tunnel-meta">{selectedProfile.cipher}</div>
            <div className="tunnel-meta">{selectedProfile.uptime}</div>
          </div>
        </div>

        <div className="canvas-node canvas-node-remote">
          <TopologyNode
            title={selectedProfile.name}
            subtitle={selectedProfile.tunnelIp}
            metric={isIssuedProfile(selectedProfile) ? "Ready to install" : selectedProfile.configState === "draft" ? "No config loaded" : "tun0"}
            icon={kindIcons[selectedProfile.kind] ?? IconBuildingSkyscraper}
            active
          />
        </div>

        <div className="canvas-node canvas-node-networks">
          <div className="topology-card-title">Remote Networks</div>
          <div className="network-list">
            {selectedProfile.networks.length ? (
              selectedProfile.networks.map((network) => (
                <div key={network} className="network-row">
                  <IconCircleFilled size={8} fill="currentColor" stroke={0} />
                  <span>{network}</span>
                </div>
              ))
            ) : (
              <div className="empty-note">No remote networks advertised by this profile.</div>
            )}
          </div>
        </div>

        <div className="canvas-node canvas-node-other">
          <div className="topology-card-title">Other Imported Profiles</div>
          {otherProfiles.length ? (
            <div className="other-site-grid">
              {otherProfiles.map((profile) => {
                const ProfileIcon = kindIcons[profile.kind] ?? IconBuildingSkyscraper;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className="other-site-card"
                    onClick={() => selectProfile(profile.id, "topology")}
                  >
                    <ProfileIcon size={18} stroke={1.8} />
                    <div className="other-site-name">{profile.name}</div>
                    <div className={`other-site-status other-site-status-${statusTone(profile.status)}`}>
                      <IconCircleFilled size={8} fill="currentColor" stroke={0} />
                      {profile.summary}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-note">No other imported profiles.</div>
          )}
        </div>
      </>
    );
  }

  function renderProfilesView() {
    return (
      <div className="view-stack">
        <section className="detail-card">
          <div className="detail-card-title">Profiles</div>
          <div className="action-row action-row-top">
            <button className="primary-action compact-action" type="button" onClick={openCreateModal}>
              <IconPlus size={16} />
              New client profile
            </button>
            <button className="secondary-action" type="button" onClick={openImportModal}>
              <IconUpload size={16} />
              Import config
            </button>
          </div>
          {profileCount ? (
            <div className="profile-list-grid">{renderProfileCards()}</div>
          ) : (
            <div className="empty-note large-empty-note">No profiles exist yet.</div>
          )}
        </section>

        <section className="detail-card">
          <div className="detail-card-title">Inventory</div>
          <div className="stat-grid">
            <div className="stat-card">
              <strong>{profileCount}</strong>
              <span>Total profiles</span>
            </div>
            <div className="stat-card">
              <strong>{connectedCount}</strong>
              <span>Connected</span>
            </div>
            <div className="stat-card">
              <strong>{issuedCount}</strong>
              <span>Issued clients</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderPoliciesView() {
    if (!selectedProfile) {
      return (
        <EmptyView
          title="No policy target selected"
          copy="Create or import a profile first. Policies are scoped to the currently selected profile."
          primaryLabel="New profile"
          secondaryLabel="Import config"
          onPrimary={openCreateModal}
          onSecondary={openImportModal}
        />
      );
    }

    if (isIssuedProfile(selectedProfile)) {
      return (
        <section className="detail-card">
          <div className="detail-card-title">Server-managed client policy</div>
          <p className="empty-note">
            This profile inherits routing, DNS and security policy from the managed OpenVPN server. Download it here and change pushed client policy in OpenVPN Config.
          </p>
          <div className="action-column">
            <button className="primary-action" type="button" onClick={() => handleDownloadProfile(selectedProfile.id)}>Download .ovpn</button>
            <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("configuration")}>Open server configuration</button>
          </div>
        </section>
      );
    }

    const policyRuntime = selectedProfile.policyRuntime ?? {
      state: selectedProfile.configState === "imported" ? "not-applied" : "draft",
      appliedAt: null,
      message: "Connect this profile to enforce its policies.",
      restarted: false,
      rolledBack: false,
    };

    return (
      <div className="view-grid">
        <section className="detail-card">
          <div className="detail-card-title">Routing &amp; Policy</div>
          <div className="segmented-control">
            <button
              type="button"
              className={selectedProfile.routeMode === "full" ? "segment-active" : ""}
              onClick={() => handleRouteMode("full")}
            >
              Full Tunnel
            </button>
            <button
              type="button"
              className={selectedProfile.routeMode === "split" ? "segment-active" : ""}
              onClick={() => handleRouteMode("split")}
            >
              Split Tunnel
            </button>
          </div>

          <div className="subnet-block">
            <div className="subnet-title">Included Subnets</div>
            <div className="action-row">
              <input
                className="inline-input"
                value={subnetForm.included}
                onChange={(event) => setSubnetForm((current) => ({ ...current, included: event.target.value }))}
                placeholder="10.20.0.0/16"
              />
              <button className="secondary-action compact-action" type="button" onClick={() => handleSubnetChange("included", "add")}>
                Add
              </button>
            </div>
            {selectedProfile.includedSubnets.length ? selectedProfile.includedSubnets.map((subnet) => (
              <div key={subnet} className="subnet-row">
                <span>{subnet}</span>
                <button className="text-button" type="button" onClick={() => handleSubnetChange("included", "remove", subnet)}>×</button>
              </div>
            )) : <div className="empty-note">No routed subnets defined.</div>}
          </div>

          <div className="subnet-block">
            <div className="subnet-title">Excluded Subnets</div>
            <div className="action-row">
              <input
                className="inline-input"
                value={subnetForm.excluded}
                onChange={(event) => setSubnetForm((current) => ({ ...current, excluded: event.target.value }))}
                placeholder="192.168.178.0/24"
              />
              <button className="secondary-action compact-action" type="button" onClick={() => handleSubnetChange("excluded", "add")}>
                Add
              </button>
            </div>
            {selectedProfile.excludedSubnets.length ? selectedProfile.excludedSubnets.map((subnet) => (
              <div key={subnet} className="subnet-row">
                <span>{subnet}</span>
                <button className="text-button" type="button" onClick={() => handleSubnetChange("excluded", "remove", subnet)}>×</button>
              </div>
            )) : <div className="empty-note">No local bypasses defined.</div>}
          </div>
        </section>

        <section className="detail-card">
          <div className="detail-card-title">Security Controls</div>
          {[
            ["killSwitch", "Kill Switch"],
            ["blockLanOnVpnDown", "Block LAN access when VPN is down"],
            ["dnsProtection", "DNS leak protection"],
            ["ipv6LeakProtection", "IPv6 leak protection"],
            ["autoReconnect", "Auto reconnect"],
            ["startOnBoot", "Start on boot"],
          ].map(([key, label]) => (
            <label key={key} className="toggle-row">
              <span>{label}</span>
              <button
                type="button"
                className={`toggle${selectedProfile.security[key] ? " toggle-on" : ""}`}
                onClick={() => handleSecurityChange(key, !selectedProfile.security[key])}
                disabled={key === "blockLanOnVpnDown" && !selectedProfile.security.killSwitch}
              >
                <span />
              </button>
            </label>
          ))}

          <div className="dns-row">
            <span>DNS Configuration</span>
            <strong>{selectedProfile.security.dnsMode}</strong>
          </div>
        </section>

        <section className="detail-card policy-runtime-card">
          <div className="detail-card-title">Effective Runtime Policy</div>
          <div className={`policy-runtime-state policy-runtime-state-${policyRuntime.state}`}>
            <span>{policyRuntime.state}</span>
            <strong>{policyRuntime.restarted ? "Restart verified" : "No restart required"}</strong>
          </div>
          <p className="empty-note">{policyRuntime.message}</p>
          <dl className="detail-grid compact-grid">
            <div><dt>Last transaction</dt><dd>{policyRuntime.appliedAt ?? "Never"}</dd></div>
            <div><dt>Routing</dt><dd>{selectedProfile.routeMode === "full" ? "redirect-gateway" : "route-nopull"}</dd></div>
            <div><dt>Kill switch</dt><dd>{selectedProfile.security.killSwitch ? "iptables enforced" : "Disabled"}</dd></div>
            <div><dt>IPv6 protection</dt><dd>{selectedProfile.security.ipv6LeakProtection ? "ip6tables enforced" : "Disabled"}</dd></div>
            <div><dt>DNS leak policy</dt><dd>{selectedProfile.security.dnsProtection ? "Protected" : "Profile default"}</dd></div>
            <div><dt>Rollback</dt><dd>{policyRuntime.rolledBack ? "Performed" : "Ready"}</dd></div>
          </dl>
          <div className="policy-runtime-note">
            Active profiles are applied immediately. Inactive profiles are staged and enforced on their next connection.
          </div>
        </section>
      </div>
    );
  }

  function renderCertificatesView() {
    return (
      <div className="view-stack">
        {!pki.initialized ? (
          <section className="detail-card certificate-workspace">
            <div className="detail-card-title">Server PKI Bootstrap</div>
            <p className="empty-note">
              The host does not have a managed OpenVPN server PKI yet. Initialize the CA, server certificate,
              CRL, and `openvpn-server@codex-server.service` from here.
            </p>
            <form className="modal-form" onSubmit={handleInitializePkiSubmit}>
              <label>
                <span>Public host or IP</span>
                <input value={pkiForm.publicHost} onChange={(event) => setPkiForm((current) => ({ ...current, publicHost: event.target.value }))} required />
              </label>
              <div className="modal-two-col">
                <label>
                  <span>Protocol</span>
                  <select value={pkiForm.protocol} onChange={(event) => setPkiForm((current) => ({ ...current, protocol: event.target.value }))}>
                    <option value="udp">UDP</option>
                    <option value="tcp">TCP</option>
                  </select>
                </label>
                <label>
                  <span>Port</span>
                  <input value={pkiForm.port} onChange={(event) => setPkiForm((current) => ({ ...current, port: event.target.value }))} required />
                </label>
              </div>
              <label>
                <span>Tunnel network</span>
                <input value={pkiForm.tunnelNetwork} onChange={(event) => setPkiForm((current) => ({ ...current, tunnelNetwork: event.target.value }))} required />
              </label>
              <label>
                <span>DNS mode</span>
                <select value={pkiForm.dnsMode} onChange={(event) => setPkiForm((current) => ({ ...current, dnsMode: event.target.value }))}>
                  <option value="custom">Custom resolver</option>
                  <option value="pihole">Pi-hole on VPN gateway</option>
                </select>
              </label>
              <label>
                <span>DNS server pushed to clients</span>
                <input
                  value={pkiForm.dnsServer}
                  onChange={(event) => setPkiForm((current) => ({ ...current, dnsServer: event.target.value }))}
                  required
                  disabled={pkiForm.dnsMode === "pihole"}
                />
              </label>
              <label>
                <span>Pi-hole upstream DNS</span>
                <input
                  value={pkiForm.piHoleUpstreamDns}
                  onChange={(event) => setPkiForm((current) => ({ ...current, piHoleUpstreamDns: event.target.value }))}
                  placeholder="1.1.1.1, 1.0.0.1"
                />
              </label>
              <button type="submit" className="primary-action">Initialize PKI and server</button>
            </form>
          </section>
        ) : (
          <>
            <section className="detail-card certificate-workspace">
              <div className="detail-card-title">Server PKI &amp; Runtime</div>
              <div className={`certificate-pill${pki.serverServiceState === "active" ? "" : " certificate-pill-muted"}`}>
                <IconShieldCheck size={18} stroke={1.8} />
                {pki.serverServiceState === "active" ? "Server PKI active" : "Server PKI present but service inactive"}
              </div>
              <dl className="detail-grid compact-grid">
                <div><dt>Service</dt><dd>{pki.serverServiceName}</dd></div>
                <div><dt>Status</dt><dd>{pki.serverServiceState}</dd></div>
                <div><dt>Firewall Service</dt><dd>{pki.firewallServiceState}</dd></div>
                <div><dt>NAT Backend</dt><dd>{pki.firewallBackend}</dd></div>
                <div><dt>Public Host</dt><dd>{pki.publicHost}</dd></div>
                <div><dt>Protocol</dt><dd>{String(pki.protocol).toUpperCase()}</dd></div>
                <div><dt>Port</dt><dd>{pki.port}</dd></div>
                <div><dt>Tunnel Network</dt><dd>{pki.tunnelNetwork}</dd></div>
                <div><dt>DNS Mode</dt><dd>{pki.dnsMode === "pihole" ? "Pi-hole" : "Custom"}</dd></div>
                <div><dt>DNS Push</dt><dd>{pki.effectiveDnsServer}</dd></div>
                <div><dt>VPN Gateway DNS</dt><dd>{pki.vpnGatewayDns}</dd></div>
                <div><dt>Pi-hole</dt><dd>{pki.piHoleInstalled ? pki.piHoleServiceState : "Not installed"}</dd></div>
                <div><dt>Egress Interface</dt><dd>{pki.egressInterface || "Unavailable"}</dd></div>
                <div><dt>VPN Port Firewall</dt><dd>{pki.vpnPortAllowed == null ? "External firewall · not checked" : pki.vpnPortAllowed ? "Allowed" : "Blocked"}</dd></div>
                <div><dt>UI via VPN</dt><dd>{pki.uiPortAllowed ? "Allowed" : "Blocked"}</dd></div>
                <div><dt>Pi-hole UI via VPN</dt><dd>{pki.piHoleUiAllowed ? "Allowed" : "Blocked"}</dd></div>
                <div><dt>DNS via VPN</dt><dd>{pki.vpnDnsAllowed ? "Allowed" : "Blocked"}</dd></div>
                <div><dt>VPN Routing Firewall</dt><dd>{pki.vpnRoutingAllowed ? "Allowed" : "Blocked"}</dd></div>
                <div><dt>IPv4 Forwarding</dt><dd>{pki.forwardingEnabled ? "Enabled" : "Disabled"}</dd></div>
                <div><dt>Egress NAT</dt><dd>{pki.natConfigured ? "Configured" : "Missing"}</dd></div>
                <div><dt>Created</dt><dd>{pki.createdAt ?? "Unavailable"}</dd></div>
              </dl>
              <div className="stat-grid">
                <div className="stat-card">
                  <strong>{pki.userCount}</strong>
                  <span>Users</span>
                </div>
                <div className="stat-card">
                  <strong>{pki.activeUserCount}</strong>
                  <span>Active Sessions</span>
                </div>
                <div className="stat-card">
                  <strong>{pki.revokedCount}</strong>
                  <span>Revoked</span>
                </div>
              </div>
              <div className="action-row action-row-top">
                <button className="primary-action compact-action" type="button" onClick={() => handleServerControl("start")}>
                  Start server
                </button>
                <button className="secondary-action compact-action" type="button" onClick={() => handleServerControl("restart")}>
                  Restart server
                </button>
                <button className="secondary-action compact-action" type="button" onClick={() => handleServerControl("stop")}>
                  Stop server
                </button>
              </div>
            </section>

            <section className="detail-card">
              <div className="detail-card-title">Live VPN Metrics</div>
              {runtime.available ? (
                <>
                  <div className="runtime-stat-grid">
                    <div className="stat-card">
                      <strong>{runtime.connectedClients}</strong>
                      <span>Connected Clients</span>
                    </div>
                    <div className="stat-card">
                      <strong>{runtime.routedClients}</strong>
                      <span>Active Routes</span>
                    </div>
                    <div className="stat-card">
                      <strong>{runtime.totalBytesReceivedDisplay}</strong>
                      <span>Ingress</span>
                    </div>
                    <div className="stat-card">
                      <strong>{runtime.totalBytesSentDisplay}</strong>
                      <span>Egress</span>
                    </div>
                  </div>
                  <dl className="detail-grid compact-grid">
                    <div><dt>Status Feed</dt><dd>{runtime.sourcePath}</dd></div>
                    <div><dt>Updated</dt><dd>{runtime.updatedAt ?? "Unavailable"}</dd></div>
                    <div><dt>DCO Enabled</dt><dd>{String(runtime.dcoEnabled)}</dd></div>
                    <div><dt>Max Broadcast Queue</dt><dd>{runtime.maxBroadcastQueue}</dd></div>
                  </dl>
                </>
              ) : (
                <div className="empty-note">No live OpenVPN server status file is available yet.</div>
              )}
            </section>

            <section className="detail-card">
              <div className="detail-card-title">Active VPN Clients</div>
              {runtime.clients.length ? (
                <div className="runtime-client-list">
                  {runtime.clients.map((client) => (
                    <div key={`${client.name}-${client.virtualAddress}`} className="runtime-client-row">
                      <div className="runtime-client-copy">
                        <strong>{client.name}</strong>
                        <span>{client.virtualAddress} via {client.realAddress}</span>
                        <span>{client.bytesReceivedDisplay} in / {client.bytesSentDisplay} out</span>
                      </div>
                      <div className="runtime-client-meta">
                        <span>{client.connectedForDisplay}</span>
                        <span>{client.dataChannelCipher}</span>
                        <span>Last ref {client.lastRef}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-note">No VPN clients are currently connected.</div>
              )}
            </section>

            <section className="detail-card">
              <div className="detail-card-title">VPN DNS</div>
              <form className="modal-form" onSubmit={handleApplyDnsSettings}>
                <label>
                  <span>DNS mode</span>
                  <select value={pkiForm.dnsMode} onChange={(event) => setPkiForm((current) => ({ ...current, dnsMode: event.target.value }))}>
                    <option value="custom">Custom resolver</option>
                    <option value="pihole">Pi-hole on VPN gateway</option>
                  </select>
                </label>
                <label>
                  <span>Custom DNS server</span>
                  <input
                    value={pkiForm.dnsServer}
                    onChange={(event) => setPkiForm((current) => ({ ...current, dnsServer: event.target.value }))}
                    disabled={pkiForm.dnsMode === "pihole"}
                  />
                </label>
                <label>
                  <span>Pi-hole upstream DNS</span>
                  <input
                    value={pkiForm.piHoleUpstreamDns}
                    onChange={(event) => setPkiForm((current) => ({ ...current, piHoleUpstreamDns: event.target.value }))}
                    placeholder="1.1.1.1, 1.0.0.1"
                  />
                </label>
                <div className="dns-inline-note">
                  Active resolver for VPN clients: <strong>{pki.effectiveDnsServer}</strong>
                </div>
                <div className="action-row action-row-top">
                  <button type="submit" className="primary-action compact-action">Apply DNS</button>
                  {!pki.piHoleInstalled ? (
                    <button className="secondary-action compact-action" type="button" onClick={handleInstallPiHole}>
                      Install Pi-hole
                    </button>
                  ) : null}
                </div>
              </form>
            </section>

            <section className="detail-card">
              <div className="detail-card-title">VPN Users</div>
              <form className="action-row action-row-top" onSubmit={handleCreateUserSubmit}>
                <input
                  className="inline-input"
                  value={userForm.name}
                  onChange={(event) => setUserForm({ name: event.target.value })}
                  placeholder="new user common name"
                  required
                />
                <button type="submit" className="primary-action compact-action">Create user bundle</button>
              </form>
              {pki.users.length ? (
                <div className="user-list">
                  {pki.users.map((user) => (
                    <div key={user.id} className="user-row">
                      <div className="user-copy">
                        <strong>{user.name}</strong>
                        <span>{user.status} / {user.validTo}</span>
                        {user.online ? <span>{user.virtualAddress} via {user.realAddress}</span> : null}
                        {user.online ? <span>{user.bytesReceivedDisplay} in / {user.bytesSentDisplay} out</span> : null}
                      </div>
                      <div className="user-actions">
                        <button className="secondary-action" type="button" onClick={() => beginDownload(userDownloadUrl(user.id), `VPN user bundle ${user.id} download started.`)}>
                          Download
                        </button>
                        <button className="secondary-action" type="button" onClick={() => handleRevokeUser(user.id)} disabled={user.status === "revoked"}>
                          Revoke
                        </button>
                        <button className="secondary-action danger-action" type="button" onClick={() => handleDeleteUser(user.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-note">No VPN users have been issued yet.</div>
              )}
            </section>

            <section className="detail-card">
              <div className="detail-card-title">Danger Zone</div>
              <p className="empty-note">
                Remove all managed profiles, VPN users, PKI material, server config, firewall bootstrap, and runtime overrides.
              </p>
              <button className="secondary-action secondary-action-wide danger-action" type="button" onClick={handleResetManagedOpenVpn}>
                Reset managed OpenVPN
              </button>
            </section>
          </>
        )}

        {selectedProfile ? (
          <section className="detail-card certificate-workspace">
            <div className="detail-card-title">Selected Profile Trust</div>
            <div className={`certificate-pill${selectedProfile.certificate.valid ? "" : " certificate-pill-muted"}`}>
              <IconShieldCheck size={18} stroke={1.8} />
              {selectedProfile.certificate.valid ? "Certificate valid" : "No imported certificate"}
            </div>
            <dl className="detail-grid compact-grid">
              <div><dt>Profile</dt><dd>{selectedProfile.name}</dd></div>
              <div><dt>Config State</dt><dd>{selectedProfile.configState}</dd></div>
              <div><dt>Peer Certificate</dt><dd>{selectedProfile.certificate.peerCertificate}</dd></div>
              <div><dt>Issued By</dt><dd>{selectedProfile.certificate.issuedBy}</dd></div>
              <div><dt>Valid From</dt><dd>{selectedProfile.certificate.validFrom}</dd></div>
              <div><dt>Valid To</dt><dd>{selectedProfile.certificate.validTo}</dd></div>
            </dl>
            <div className="certificate-bar">
              <div className="certificate-bar-fill" style={{ width: `${Math.min(100, selectedProfile.certificate.daysRemaining / 3)}%` }} />
            </div>
            <div className="certificate-foot">{selectedProfile.certificate.daysRemaining} days remaining</div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderLogsView() {
    const profileEvents = selectedProfile ? selectedProfile.events : [];
    const visibleEvents = selectedProfile && clearedLogProfiles[selectedProfile.id]
      ? []
      : (logPaused ? profileEvents.slice(0, 8) : profileEvents);
    return (
      <section className="detail-card logs-workspace">
        <div className="event-toolbar">
          <div className="event-toolbar-left">
            <span className="toolbar-label">Live Events</span>
            <button className="toolbar-link" type="button" onClick={() => setLogPaused((value) => !value)}>
              <IconPlayerPause size={14} />
              {logPaused ? "Resume" : "Pause"}
            </button>
            <button className="toolbar-link" type="button" onClick={clearVisibleLogs}>
              <IconTrash size={14} />
              Clear
            </button>
          </div>
          <div className="event-toolbar-right">
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                if (selectedProfile) {
                  setClearedLogProfiles((current) => ({ ...current, [selectedProfile.id]: false }));
                }
                refreshDashboard();
              }}
            >
              <IconRefresh size={14} />
              Refresh logs
            </button>
          </div>
        </div>
        <div className="event-table">
          {renderEventTable(visibleEvents)}
        </div>
      </section>
    );
  }

  function renderUfwView() {
    return (
      <div className="view-grid">
        <section className="detail-card">
          <div className="detail-card-title">UFW Runtime</div>
          <div className={`certificate-pill${ufw.status === "active" ? "" : " certificate-pill-muted"}`}>
            <IconShieldCheck size={18} stroke={1.8} />
            {ufw.installed ? `UFW ${ufw.status}` : "UFW not installed"}
          </div>
          <dl className="detail-grid compact-grid">
            <div><dt>Status</dt><dd>{ufw.status}</dd></div>
            <div><dt>Logging</dt><dd>{ufw.logging}</dd></div>
            <div><dt>Default Incoming</dt><dd>{ufw.defaultIncoming}</dd></div>
            <div><dt>Default Outgoing</dt><dd>{ufw.defaultOutgoing}</dd></div>
            <div><dt>Default Routed</dt><dd>{ufw.defaultRouted}</dd></div>
            <div><dt>New Profiles</dt><dd>{ufw.newProfiles}</dd></div>
            <div><dt>Rule Count</dt><dd>{ufw.ruleCount}</dd></div>
          </dl>
          <div className="action-row action-row-top">
            <button className="primary-action compact-action" type="button" onClick={() => handleUfwControl("enable")} disabled={!ufw.installed}>
              Enable
            </button>
            <button className="secondary-action compact-action" type="button" onClick={() => handleUfwControl("reload")} disabled={!ufw.installed}>
              Reload
            </button>
            <button className="secondary-action compact-action" type="button" onClick={() => handleUfwControl("disable")} disabled={!ufw.installed}>
              Disable
            </button>
          </div>
        </section>

        <section className="detail-card">
          <div className="detail-card-title">Add Rule</div>
          <form className="modal-form" onSubmit={handleCreateUfwRule}>
            <div className="modal-two-col">
              <label>
                <span>Rule mode</span>
                <select value={ufwRuleForm.mode} onChange={(event) => setUfwRuleForm((current) => ({ ...current, mode: event.target.value }))}>
                  <option value="host">Host rule</option>
                  <option value="route">Route rule</option>
                </select>
              </label>
              <label>
                <span>Action</span>
                <select value={ufwRuleForm.action} onChange={(event) => setUfwRuleForm((current) => ({ ...current, action: event.target.value }))}>
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                  <option value="reject">reject</option>
                  <option value="limit">limit</option>
                </select>
              </label>
            </div>
            <div className="modal-two-col">
              <label>
                <span>Protocol</span>
                <select value={ufwRuleForm.protocol} onChange={(event) => setUfwRuleForm((current) => ({ ...current, protocol: event.target.value }))}>
                  <option value="tcp">tcp</option>
                  <option value="udp">udp</option>
                  <option value="any">any</option>
                </select>
              </label>
              <label>
                <span>Port</span>
                <input value={ufwRuleForm.port} onChange={(event) => setUfwRuleForm((current) => ({ ...current, port: event.target.value }))} placeholder="80 or 10000:10100" />
              </label>
            </div>
            <label>
              <span>Source</span>
              <input value={ufwRuleForm.source} onChange={(event) => setUfwRuleForm((current) => ({ ...current, source: event.target.value }))} placeholder="any or 10.8.0.0/24" />
            </label>
            <label>
              <span>Destination</span>
              <input value={ufwRuleForm.destination} onChange={(event) => setUfwRuleForm((current) => ({ ...current, destination: event.target.value }))} placeholder="any or 10.8.0.1" />
            </label>
            <div className="modal-two-col">
              <label>
                <span>In interface</span>
                <input
                  value={ufwRuleForm.inInterface}
                  onChange={(event) => setUfwRuleForm((current) => ({ ...current, inInterface: event.target.value }))}
                  placeholder="tun0"
                  disabled={ufwRuleForm.mode !== "route"}
                />
              </label>
              <label>
                <span>Out interface</span>
                <input
                  value={ufwRuleForm.outInterface}
                  onChange={(event) => setUfwRuleForm((current) => ({ ...current, outInterface: event.target.value }))}
                  placeholder="enp1s0"
                  disabled={ufwRuleForm.mode !== "route"}
                />
              </label>
            </div>
            <div className="ufw-preview">{buildUfwPreview(ufwRuleForm)}</div>
            <button type="submit" className="primary-action" disabled={!ufw.installed}>Add UFW rule</button>
          </form>
        </section>

        <section className="detail-card ufw-rules-card">
          <div className="detail-card-title">Current Rules</div>
          {ufw.rules.length ? (
            <div className="ufw-rule-list">
              {ufw.rules.map((rule) => (
                <div key={rule.index} className="ufw-rule-row">
                  <div className="ufw-rule-copy">
                    <strong>#{rule.index} {rule.action}</strong>
                    <span>To: {rule.to}</span>
                    <span>From: {rule.from}</span>
                  </div>
                  <button className="secondary-action danger-action compact-action" type="button" onClick={() => handleDeleteUfwRule(rule.index)}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-note">No active UFW rules found.</div>
          )}
        </section>
      </div>
    );
  }

  function renderSettingsView() {
    return (
      <div className="view-grid">
        <section className="detail-card">
          <div className="detail-card-title">Runtime</div>
          <dl className="detail-grid compact-grid">
            <div><dt>Service Binding</dt><dd>{mode === "server" ? "Backend connected" : "Backend offline"}</dd></div>
            <div><dt>Service Name</dt><dd>{dashboard.serviceVersion}</dd></div>
            <div><dt>Operator</dt><dd>{dashboard.operator}</dd></div>
            <div><dt>Generated At</dt><dd>{dashboard.generatedAt}</dd></div>
          </dl>
        </section>

        <section className="detail-card">
          <div className="detail-card-title">Profile Actions</div>
          <div className="action-column">
            <button className="primary-action" type="button" onClick={openCreateModal}>Create client profile</button>
            <button className="secondary-action secondary-action-wide" type="button" onClick={openImportModal}>Import OpenVPN config</button>
          </div>
        </section>

        <section className="detail-card">
          <div className="detail-card-title">Managed Server</div>
          <dl className="detail-grid compact-grid">
            <div><dt>PKI</dt><dd>{pki.initialized ? "Initialized" : "Not initialized"}</dd></div>
            <div><dt>Server Runtime</dt><dd>{pki.serverServiceState}</dd></div>
            <div><dt>Firewall Runtime</dt><dd>{pki.firewallServiceState}</dd></div>
            <div><dt>NAT</dt><dd>{pki.natConfigured ? "Configured" : "Missing"}</dd></div>
          </dl>
          <div className="action-column">
            <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("ufw")}>
              Open UFW workspace
            </button>
            <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("certificates")}>
              Open certificates workspace
            </button>
            <button className="secondary-action secondary-action-wide danger-action" type="button" onClick={handleResetManagedOpenVpn}>
              Reset managed OpenVPN
            </button>
          </div>
        </section>
      </div>
    );
  }

  async function handleRunDiagnostics() {
    setDiagnosticsRunning(true);
    setStatusMessage("Running VPN path diagnostics...");
    try {
      const response = await runDiagnostics();
      if (response?.diagnostics) {
        startTransition(() => setDiagnostics(response.diagnostics));
        const summary = response.diagnostics.summary;
        setStatusMessage(`Diagnostics complete: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed.`);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "VPN diagnostics failed.");
    } finally {
      setDiagnosticsRunning(false);
    }
  }

  function renderDiagnosticsView() {
    const hasResult = diagnostics.checks.length > 0;
    return (
      <div className="view-stack diagnostics-view">
        <section className={`detail-card diagnostics-hero diagnostics-hero-${diagnostics.overall}`}>
          <div>
            <div className="dashboard-kicker">End-to-end server checks</div>
            <h2>{hasResult ? `Diagnostic result: ${diagnostics.overall}` : "Trace the complete VPN data path"}</h2>
            <p>
              Tests the OpenVPN service, forwarding, NAT, firewall routes, DNS, Pi-hole, HTTPS/TLS and a DF path-MTU ladder.
            </p>
          </div>
          <button className="primary-action compact-action" type="button" onClick={handleRunDiagnostics} disabled={diagnosticsRunning}>
            <IconStethoscope size={17} />
            {diagnosticsRunning ? "Running checks..." : hasResult ? "Run again" : "Run diagnostics"}
          </button>
        </section>

        {hasResult ? (
          <>
            <section className="diagnostics-summary-grid">
              <DashboardStatCard icon={IconCircleCheck} label="Passed" value={String(diagnostics.summary.pass)} note="Healthy path components" tone="active" />
              <DashboardStatCard icon={IconAlertTriangle} label="Warnings" value={String(diagnostics.summary.warn)} note="Needs review, not necessarily broken" tone="warning" />
              <DashboardStatCard icon={IconCircleX} label="Failed" value={String(diagnostics.summary.fail)} note="Breaks the VPN data path" tone={diagnostics.summary.fail ? "warning" : "default"} />
            </section>

            <section className="detail-card diagnostics-results-card">
              <div className="dashboard-card-head">
                <div>
                  <div className="detail-card-title">Diagnostic Checks</div>
                  <div className="dashboard-card-subtitle">
                    Completed in {diagnostics.durationMs} ms at {new Date(diagnostics.generatedAt).toLocaleString()}.
                  </div>
                </div>
              </div>
              <div className="diagnostics-list">
                {diagnostics.checks.map((check) => {
                  const StatusIcon = check.status === "pass" ? IconCircleCheck : check.status === "fail" ? IconCircleX : IconAlertTriangle;
                  return (
                    <article key={check.id} className={`diagnostics-check diagnostics-check-${check.status}`}>
                      <StatusIcon size={21} stroke={1.9} />
                      <div>
                        <div className="diagnostics-check-head">
                          <strong>{check.title}</strong>
                          <span>{check.status}</span>
                        </div>
                        <p>{check.detail}</p>
                        <code>{check.evidence || "No additional evidence"}</code>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="detail-card">
            <div className="empty-note large-empty-note">
              No diagnostic run has been started in this browser session.
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderDashboardView() {
    const throughputPoints = runtimeTelemetry.throughputSeries;
    const hostNetworkPoints = runtimeTelemetry.hostNetworkSeries;
    const resourcePoints = runtimeTelemetry.resourceSeries;
    const observedAge = feedAge;
    const clients = runtimeTelemetry.activeClients.filter((client) => `${client.name} ${client.virtualAddress} ${client.realAddress}`.toLowerCase().includes(clientSearch.toLowerCase().trim()));
    const liveState = mode !== "server"
      ? "offline"
      : !runtimeTelemetry.hasSystemTelemetry || !runtime.available
        ? "partial"
        : feedStale || sampleAge > 30
          ? "stale"
          : "live";
    const liveStateLabel = liveState === "live"
      ? "Live telemetry"
      : liveState === "stale"
        ? "Delayed data"
        : liveState === "partial"
          ? "Partial telemetry"
          : "Last known state";
    const dataPath = [
      {
        label: "OpenVPN server",
        detail: `${pki.protocol.toUpperCase()} ${pki.port} on ${pki.publicHost || "host pending"}`,
        state: pki.serverServiceState,
        tone: pki.serverServiceState === "active" ? "ok" : "warning",
      },
      {
        label: "Forwarding path",
        detail: `${pki.forwardingEnabled ? "IP forwarding" : "Forwarding off"} · ${pki.natConfigured ? "NAT ready" : "NAT missing"}`,
        state: pki.vpnRoutingAllowed ? "ready" : "blocked",
        tone: pki.forwardingEnabled && pki.natConfigured && pki.vpnRoutingAllowed ? "ok" : "warning",
      },
      {
        label: "Firewall",
        detail: `${pki.firewallBackend} · ${pki.vpnPortAllowed ? "VPN port allowed" : "VPN port blocked"}`,
        state: pki.firewallServiceState,
        tone: pki.firewallServiceState === "active" && pki.vpnPortAllowed ? "ok" : "warning",
      },
      {
        label: "DNS for clients",
        detail: pki.dnsMode === "pihole" ? `Pi-hole ${pki.vpnGatewayDns}` : `Resolver ${pki.effectiveDnsServer}`,
        state: pki.dnsMode === "pihole" ? pki.piHoleServiceState : "configured",
        tone: pki.dnsMode !== "pihole" || (pki.piHoleServiceState === "active" && pki.vpnDnsAllowed) ? "ok" : "warning",
      },
    ];

    if (!dashboard.source) {
      return <section className="detail-card ops-empty">
        <IconActivityHeartbeat size={32} />
        <div className="dashboard-kicker">Server connection</div>
        <h2>{mode === "connecting" ? "Connecting to your VPN server" : "Server is unreachable"}</h2>
        <p>{mode === "connecting" ? "Loading service status, connected clients and live measurements." : "No server data has been received. Check the connection to the backend and try again."}</p>
        <button className="primary-action compact-action" type="button" onClick={refreshDashboard}>Retry connection</button>
      </section>;
    }

    if (!pki.initialized) {
      return (
        <div className="view-stack">
          <section className="detail-card dashboard-hero-card">
            <div className="dashboard-kicker">Realtime VPN Dashboard</div>
            <h2>Server PKI is not initialized yet</h2>
            <p className="empty-note">
              The dashboard only becomes meaningful once the managed OpenVPN server, certificates, and runtime status
              file exist.
            </p>
            <div className="action-row action-row-top">
              <button className="primary-action compact-action" type="button" onClick={() => setActiveView("certificates")}>
                Open certificate workspace
              </button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="view-stack dashboard-view">
        {liveState !== "live" && <div className="ops-notice" role="status">
          <div><strong>{mode === "offline" ? "Connection lost" : "Measurements are incomplete or delayed"}</strong>
          <p>Last response {observedAge ?? "--"}s ago. VPN status age: {sampleAge ?? "--"}s. Displayed values are the last received state.</p></div>
          <button type="button" className="secondary-action compact-action" onClick={refreshDashboard}>Retry</button>
        </div>}
        <section className="dashboard-command-bar">
          <div>
            <div className="dashboard-kicker">Operations console</div>
            <h2>{pki.serverName} <span>·</span> {pki.publicHost || "host pending"}</h2>
            <p>VPN state, host pressure and data-path readiness. Sampling every {Math.round(DASHBOARD_POLL_MS / 1000)} seconds.</p>
          </div>
          <div className="dashboard-command-actions">
            <span className={`dashboard-live-state dashboard-live-state-${liveState}`}>
              <span aria-hidden="true" />
              {liveStateLabel}
            </span>
            <button className="secondary-action compact-action" type="button" onClick={() => setActiveView("diagnostics")}>
              Diagnostics
            </button>
            <button className="primary-action compact-action" type="button" onClick={openCreateModal}><IconPlus size={15} /> New profile</button>
          </div>
        </section>

        <section className="dashboard-stat-grid">
          <DashboardStatCard
            icon={IconActivityHeartbeat}
            label="Active sessions"
            value={String(runtime.connectedClients)}
            note={`${runtime.routedClients} routed · ${pki.activeUserCount}/${pki.userCount || 0} issued users`}
            tone={runtime.connectedClients ? "active" : "default"}
          />
          <DashboardStatCard
            icon={IconWaveSine}
            label="Tunnel traffic"
            value={formatRate(runtimeTelemetry.latestThroughput.combinedRate)}
            note={`${formatRate(runtimeTelemetry.latestThroughput.rxRate)} in · ${formatRate(runtimeTelemetry.latestThroughput.txRate)} out`}
            tone="info"
          />
          <DashboardStatCard
            icon={IconGauge}
            label="Host CPU"
            value={runtimeTelemetry.hasSystemTelemetry && visibleHistory.length > 1 ? formatPercentValue(runtimeTelemetry.latestResources.hostCpuPercent) : "--"}
            note={`Load ${runtimeTelemetry.latestResources.loadOneMinute.toFixed(2)} · ${runtimeTelemetry.host.cpu.cores || "?"} cores`}
            tone={runtimeTelemetry.latestResources.hostCpuPercent >= 85 ? "warning" : "default"}
          />
          <DashboardStatCard
            icon={IconChartHistogram}
            label="Host memory"
            value={runtimeTelemetry.hasSystemTelemetry ? formatPercentValue(runtimeTelemetry.host.memory.usedPercent) : "--"}
            note={`${formatBytes(runtimeTelemetry.host.memory.usedBytes)} used · disk ${formatPercentValue(runtimeTelemetry.host.disk.usedPercent)}`}
            tone={runtimeTelemetry.host.memory.usedPercent >= 85 ? "warning" : "default"}
          />
        </section>

        <div className="ops-tools">
          <span>Live measurements / {visibleHistory.length} samples / refreshed {observedAge ?? "--"}s ago</span>
          <div className="ops-range" role="group" aria-label="Chart time window">
            {[60, 240].map((seconds) => <button key={seconds} type="button" aria-pressed={historyWindow === seconds} onClick={() => setHistoryWindow(seconds)}>Last {seconds / 60} min</button>)}
          </div>
        </div>
        <section className="dashboard-primary-grid">
          <DashboardTrendCard
            className="dashboard-flow-card"
            title="Tunnel throughput"
            labels={throughputPoints.map((point) => point.label)}
            formatValue={formatRate}
            subtitle={`OpenVPN status counters · ${runtimeTelemetry.windowLabel}`}
            series={[
              {
                key: "rx",
                label: "Ingress",
                color: "#2f6dff",
                values: throughputPoints.map((point) => point.rxRate),
                value: formatRate(runtimeTelemetry.latestThroughput.rxRate),
              },
              {
                key: "tx",
                label: "Egress",
                color: "#28b96d",
                values: throughputPoints.map((point) => point.txRate),
                value: formatRate(runtimeTelemetry.latestThroughput.txRate),
              },
            ]}
            footer={
              throughputPoints.length
                ? `Total since current client sessions: ${runtime.totalBytesReceivedDisplay} ingress · ${runtime.totalBytesSentDisplay} egress`
                : "Collecting a second valid sample for live rates."
            }
          />

          <aside className="detail-card dashboard-path-card">
            <div className="dashboard-card-head">
              <div>
                <div className="detail-card-title">Data-path readiness</div>
                <div className="dashboard-card-subtitle">The controls required for client traffic to leave the tunnel.</div>
              </div>
            </div>
            <div className="dashboard-signal-list">
              {dataPath.map((signal) => (
                <DashboardSignalRow key={signal.label} {...signal} />
              ))}
            </div>
          </aside>
        </section>

        <section className="dashboard-infrastructure-strip" aria-label="Live infrastructure metrics">
          <article>
            <span>Tunnel interface</span>
            <strong>{runtimeTelemetry.tunnelInterface.name || "tun0"} · {runtimeTelemetry.tunnelInterface.state}</strong>
            <small>{formatBytes(runtimeTelemetry.tunnelInterface.rxBytes)} in · {formatBytes(runtimeTelemetry.tunnelInterface.txBytes)} out</small>
          </article>
          <article>
            <span>Host egress</span>
            <strong>{runtimeTelemetry.egressInterface.name || "not detected"} · {runtimeTelemetry.egressInterface.state}</strong>
            <small>{formatRate(runtimeTelemetry.latestHostNetwork.rxRate)} in · {formatRate(runtimeTelemetry.latestHostNetwork.txRate)} out</small>
          </article>
          <article>
            <span>OpenVPN process</span>
            <strong>{runtimeTelemetry.openVpnProcess.available ? `PID ${runtimeTelemetry.openVpnProcess.pid}` : "not observed"}</strong>
            <small>{formatBytes(runtimeTelemetry.openVpnProcess.memoryBytes)} service memory · running {formatDuration(runtimeTelemetry.openVpnProcess.serviceUptimeSeconds)}</small>
          </article>
          <article>
            <span>Transport health</span>
            <strong>{runtimeTelemetry.packetDrops ? `${runtimeTelemetry.packetDrops} drops` : "No drops observed"}</strong>
            <small>DCO {runtime.dcoEnabled} · queue {runtime.maxBroadcastQueue}</small>
          </article>
        </section>

        <div className="dashboard-chart-grid dashboard-secondary-chart-grid">
          <DashboardTrendCard
            title="Host network edge"
            labels={hostNetworkPoints.map((point) => point.label)}
            formatValue={formatRate}
            subtitle={`Traffic counters on ${runtimeTelemetry.egressInterface.name || "the configured egress interface"}.`}
            series={[
              {
                key: "host-rx",
                label: "Received",
                color: "#12395d",
                values: hostNetworkPoints.map((point) => point.rxRate),
                value: formatRate(runtimeTelemetry.latestHostNetwork.rxRate),
              },
              {
                key: "host-tx",
                label: "Sent",
                color: "#f08a24",
                values: hostNetworkPoints.map((point) => point.txRate),
                value: formatRate(runtimeTelemetry.latestHostNetwork.txRate),
              },
            ]}
            footer={hostNetworkPoints.length ? "Host interface rates include all server traffic, not only VPN packets." : "Collecting a second host network sample."}
          />
          <DashboardTrendCard
            title="Host pressure"
            labels={resourcePoints.map((point) => point.label)}
            formatValue={formatPercentValue}
            ceiling={100}
            subtitle="CPU and memory stay visible while OpenVPN serves connected clients."
            series={[
              {
                key: "cpu",
                label: "CPU",
                color: "#ec5b4a",
                values: resourcePoints.map((point) => point.hostCpuPercent),
                value: formatPercentValue(runtimeTelemetry.latestResources.hostCpuPercent),
              },
              {
                key: "memory",
                label: "Memory",
                color: "#2f6dff",
                values: resourcePoints.map((point) => point.memoryUsedPercent),
                value: formatPercentValue(runtimeTelemetry.host.memory.usedPercent),
              },
              {
                key: "openvpn-cpu",
                label: "OpenVPN",
                color: "#28b96d",
                values: resourcePoints.map((point) => point.openVpnCpuPercent),
                value: formatPercentValue(runtimeTelemetry.latestResources.openVpnCpuPercent),
              },
            ]}
            footer={`Host uptime ${formatDuration(runtimeTelemetry.host.uptimeSeconds)} · OpenVPN uses ${runtimeTelemetry.openVpnProcess.tasks || 0} task${runtimeTelemetry.openVpnProcess.tasks === 1 ? "" : "s"}.`}
          />
        </div>

        <section className="detail-card dashboard-table-card">
          <div className="dashboard-card-head">
            <div>
              <h3 className="detail-card-title">Connected clients <span className="client-count">{runtimeTelemetry.activeClients.length}</span></h3>
              <p className="dashboard-card-subtitle">Session traffic and current transfer rates, viewed from the server.</p>
            </div>
            <label className="client-search"><IconSearch size={16} /><input aria-label="Filter connected clients" type="search" placeholder="Find a client or IP..." value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} /></label>
          </div>
          {clients.length ? (
            <div className="clients-scroll">
              <table className="clients-table">
                <caption>{clients.length} of {runtimeTelemetry.activeClients.length} connected clients</caption>
                <thead><tr>{["Client", "Tunnel", "Connected", "Received", "Sent", "Rate", "Cipher"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{clients.map((client) => (
                  <tr key={runtimeClientKey(client)}>
                    <td data-label="Client"><strong>{client.name}</strong><small>{client.realAddress}</small></td>
                    <td data-label="Tunnel">{client.virtualAddress}</td>
                    <td data-label="Connected">{client.connectedForDisplay}<small>Last activity: {client.lastRef || "unavailable"}</small></td>
                    <td data-label="Received">{client.bytesReceivedDisplay}</td>
                    <td data-label="Sent">{client.bytesSentDisplay}</td>
                    <td data-label="Rate">{formatRate(client.combinedRate)}</td>
                    <td data-label="Cipher">{client.dataChannelCipher}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <div className="empty-note">{clientSearch ? "No connected clients match your search." : "No clients are connected. Their sessions will appear here automatically."}</div>
          )}
        </section>
      </div>
    );
  }

  function renderMainView() {
    if (activeView === "dashboard") return renderDashboardView();
    if (activeView === "diagnostics") return renderDiagnosticsView();
    if (activeView === "profiles") return renderProfilesView();
    if (activeView === "policies") return renderPoliciesView();
    if (activeView === "configuration") return <OpenVpnConfigurationView onStatus={setStatusMessage} onDashboard={setDashboard} />;
    if (activeView === "ufw") return renderUfwView();
    if (activeView === "certificates") return renderCertificatesView();
    if (activeView === "logs") return renderLogsView();
    if (activeView === "settings") return renderSettingsView();

    return (
      <>
        <div className="canvas-toolbar">
          <div className="canvas-toolbar-left">
            <span className="toolbar-label">Topology {Math.round(topologyZoom * 100)}%</span>
            <div className="toolbar-actions">
              <button className="toolbar-button" type="button" onClick={() => handleTopologyZoom("fit")}>Fit to View</button>
              <button className="toolbar-icon" type="button" onClick={() => handleTopologyZoom("in")} aria-label="Zoom in"><IconPlus size={15} /></button>
              <button className="toolbar-icon" type="button" onClick={() => handleTopologyZoom("out")} aria-label="Zoom out"><IconMinus size={15} /></button>
              <button className="toolbar-icon" type="button" onClick={() => setActiveView("policies")} aria-label="Open policies"><IconAdjustmentsHorizontal size={15} /></button>
            </div>
          </div>
          <div className="legend-strip">
            {dashboard.legend.map((item) => (
              <span key={item.label} className={`legend-item legend-item-${item.tone}`}>
                <span className="legend-line" />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        <div className="topology-canvas">
          <div className="topology-stage" style={{ transform: `scale(${topologyZoom})` }}>
            <img className="world-map" src="/world-map-dots.png" alt="" />
            {renderTopologyView()}
          </div>
        </div>
      </>
    );
  }

  function renderDetailPanel() {
    if (activeView === "configuration") {
      return (
        <>
          <section className="detail-card">
            <div className="detail-card-title">Configuration Boundary</div>
            <p className="empty-note">
              This workspace edits OpenVPN configuration files. UFW exposure, NAT, forwarding and Pi-hole remain independently controlled to prevent hidden host-level changes.
            </p>
            <dl className="detail-grid compact-grid">
              <div><dt>Catalog</dt><dd>Installed OpenVPN build</dd></div>
              <div><dt>Secrets</dt><dd>Visible in client bundles</dd></div>
              <div><dt>Writes</dt><dd>Atomic</dd></div>
              <div><dt>Backups</dt><dd>Mode 0600</dd></div>
              <div><dt>Concurrency</dt><dd>Revision protected</dd></div>
              <div><dt>Recovery</dt><dd>Automatic rollback</dd></div>
            </dl>
          </section>
          <section className="detail-card">
            <div className="detail-card-title">Apply Sequence</div>
            <ol className="config-apply-sequence">
              <li>Validate syntax and inline blocks.</li>
              <li>Reject stale editor revisions.</li>
              <li>Create a private backup.</li>
              <li>Write the target atomically.</li>
              <li>Restart and verify when requested.</li>
              <li>Restore the previous file on failure.</li>
            </ol>
          </section>
          <section className="detail-card">
            <div className="detail-card-title">Related Host Controls</div>
            <div className="action-column">
              <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("ufw")}>Open UFW workspace</button>
              <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("diagnostics")}>Run VPN diagnostics</button>
            </div>
          </section>
        </>
      );
    }

    if (activeView === "diagnostics") {
      return (
        <>
          <section className="detail-card">
            <div className="detail-card-title">Diagnostic Scope</div>
            <p className="empty-note">
              These checks run on the VPN server. They prove server egress and control-plane state, but cannot directly inspect a remote client's browser or local firewall.
            </p>
            <dl className="detail-grid compact-grid">
              <div><dt>OpenVPN</dt><dd>Service + runtime</dd></div>
              <div><dt>Packet path</dt><dd>Forwarding + NAT</dd></div>
              <div><dt>Name resolution</dt><dd>DNS + Pi-hole</dd></div>
              <div><dt>Web traffic</dt><dd>Verified HTTPS/TLS</dd></div>
              <div><dt>Packet sizing</dt><dd>DF MTU ladder</dd></div>
            </dl>
          </section>
          <section className="detail-card">
            <div className="detail-card-title">Next Isolation Step</div>
            <p className="empty-note">
              If server HTTPS passes but client HTTPS fails, the fault is downstream of NAT: pushed routes, client DNS, PMTU/MSS or a client security product.
            </p>
            <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("logs")}>
              Open runtime logs
            </button>
          </section>
        </>
      );
    }

    if (activeView === "dashboard") {
      const healthChecks = [
        {
          label: "OpenVPN server",
          tone: pki.serverServiceState === "active" ? "ok" : "warn",
          value: pki.serverServiceState,
        },
        {
          label: "Firewall service",
          tone: pki.firewallServiceState === "active" ? "ok" : "warn",
          value: pki.firewallServiceState,
        },
        {
          label: "Forwarding + NAT",
          tone: pki.forwardingEnabled && pki.natConfigured && pki.vpnRoutingAllowed ? "ok" : "warn",
          value: pki.forwardingEnabled && pki.natConfigured && pki.vpnRoutingAllowed ? "ready" : "incomplete",
        },
        {
          label: "VPN DNS",
          tone:
            pki.dnsMode === "pihole"
              ? pki.piHoleServiceState === "active"
                ? "ok"
                : "warn"
              : pki.effectiveDnsServer
                ? "ok"
                : "warn",
          value: pki.dnsMode === "pihole" ? `Pi-hole ${pki.piHoleServiceState}` : pki.effectiveDnsServer || "missing",
        },
      ];

      return (
        <>
          <section className="detail-card">
            <div className="detail-card-title">Control Plane Health</div>
            <div className="dashboard-health-list">
              {healthChecks.map((check) => (
                <div key={check.label} className="dashboard-health-row">
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.value}</span>
                  </div>
                  <span className={`dashboard-health-pill dashboard-health-pill-${check.tone}`}>
                    {check.tone === "ok" ? "OK" : "Attention"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-card">
            <div className="detail-card-title">Top Talkers</div>
            {runtimeTelemetry.topTalkers.length ? (
              <div className="dashboard-traffic-list">
                {runtimeTelemetry.topTalkers.map((client) => {
                  const share =
                    runtimeTelemetry.totalClientTraffic > 0 ? client.totalBytes / runtimeTelemetry.totalClientTraffic : 0;
                  return (
                    <div key={runtimeClientKey(client)} className="dashboard-traffic-row">
                      <div className="dashboard-traffic-head">
                        <strong>{client.name}</strong>
                        <span>{formatPercent(share)}</span>
                      </div>
                      <div className="dashboard-traffic-meta">
                        <span>{formatBytes(client.totalBytes)} total</span>
                        <span>{formatRate(client.combinedRate)} live</span>
                      </div>
                      <div className="dashboard-traffic-bar">
                        <div className="dashboard-traffic-fill" style={{ width: `${Math.max(6, share * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-note">No traffic distribution is available until at least one VPN client is connected.</div>
            )}
          </section>

          <section className="detail-card">
            <div className="detail-card-title">Runtime Feed</div>
            <dl className="detail-grid compact-grid">
              <div><dt>Status File</dt><dd>{runtime.sourcePath || "Unavailable"}</dd></div>
              <div><dt>Updated</dt><dd>{runtime.updatedAt || "Never"}</dd></div>
              <div><dt>Broadcast Queue</dt><dd>{runtime.maxBroadcastQueue || "unknown"}</dd></div>
              <div><dt>DCO</dt><dd>{runtime.dcoEnabled || "unknown"}</dd></div>
              <div><dt>VPN Port</dt><dd>{pki.vpnPortAllowed ? "Allowed" : "Blocked"}</dd></div>
              <div><dt>UI Reachability</dt><dd>{pki.uiPortAllowed ? "Allowed" : "Blocked"}</dd></div>
            </dl>
            <div className="action-column">
              <button className="primary-action secondary-action-wide" type="button" onClick={() => setActiveView("diagnostics")}>
                Run VPN diagnostics
              </button>
              <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("certificates")}>
                Open certificates workspace
              </button>
              <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("ufw")}>
                Open UFW workspace
              </button>
            </div>
          </section>
        </>
      );
    }

    if (activeView === "ufw") {
      return (
        <>
          <section className="detail-card">
            <div className="detail-card-title">UFW Guide</div>
            <p className="empty-note">
              Use host rules for ordinary port exposure and route rules for forwarded VPN traffic between interfaces.
            </p>
            <dl className="detail-grid compact-grid">
              <div><dt>Suggested VPN In</dt><dd>tun0</dd></div>
              <div><dt>Detected Egress</dt><dd>{pki.egressInterface || "Unavailable"}</dd></div>
              <div><dt>OpenVPN UI</dt><dd>{"10.8.0.0/24 -> 8080/tcp"}</dd></div>
              <div><dt>Pi-hole UI</dt><dd>{"10.8.0.0/24 -> 80/tcp"}</dd></div>
              <div><dt>VPN DNS</dt><dd>{"10.8.0.0/24 -> 53/tcp+udp"}</dd></div>
            </dl>
          </section>

          <section className="detail-card">
            <div className="detail-card-title">Firewall Health</div>
            <dl className="detail-grid compact-grid">
              <div><dt>UFW</dt><dd>{ufw.status}</dd></div>
              <div><dt>Rule Count</dt><dd>{ufw.ruleCount}</dd></div>
              <div><dt>VPN Port</dt><dd>{pki.vpnPortAllowed ? "Allowed" : "Blocked"}</dd></div>
              <div><dt>OpenVPN UI</dt><dd>{pki.uiPortAllowed ? "Allowed" : "Blocked"}</dd></div>
              <div><dt>Pi-hole UI</dt><dd>{pki.piHoleUiAllowed ? "Allowed" : "Blocked"}</dd></div>
              <div><dt>VPN DNS</dt><dd>{pki.vpnDnsAllowed ? "Allowed" : "Blocked"}</dd></div>
            </dl>
          </section>
        </>
      );
    }

    if (!selectedProfile) {
      return (
        <div className="detail-empty">
          <div className="detail-card-title">No active selection</div>
          <p>Create a complete client profile or import an existing outbound OpenVPN config.</p>
          <button className="primary-action" type="button" onClick={openCreateModal}>
            Create first profile
          </button>
        </div>
      );
    }

    return (
      <>
        <div className="detail-header">
          <div>
            <h2>{selectedProfile.name}</h2>
            <div className={`panel-connection panel-connection-${statusTone(selectedProfile.status)}`}>
              <IconCircleFilled size={8} fill="currentColor" stroke={0} />
              {profileSummary(selectedProfile)}
            </div>
          </div>
        </div>

        {isIssuedProfile(selectedProfile) ? (
          <button className="primary-action" type="button" onClick={() => handleDownloadProfile(selectedProfile.id)}>
            Download ready .ovpn
          </button>
        ) : (
          <button
            className={`primary-action${selectedProfile.status === "connected" ? " primary-action-danger" : ""}`}
            type="button"
            onClick={() => handleConnection(selectedProfile.status === "connected" ? "disconnect" : "connect")}
            disabled={selectedProfile.configState !== "imported"}
          >
            {selectedProfile.status === "connected" ? "Disconnect" : selectedProfile.configState === "imported" ? "Connect" : "Import config to connect"}
          </button>
        )}

        <div className="uptime-row">
          <span>Connection Uptime</span>
          <strong>{selectedProfile.metrics.connectionUptime}</strong>
        </div>

        <section className="detail-card">
          <div className="detail-card-title">Endpoint Summary</div>
          <dl className="detail-grid">
            <div><dt>Protocol</dt><dd>{selectedProfile.protocol}</dd></div>
            <div><dt>Remote Address</dt><dd>{selectedProfile.remoteAddress}</dd></div>
            <div><dt>Port</dt><dd>{selectedProfile.port}</dd></div>
            <div><dt>Config State</dt><dd>{selectedProfile.configState}</dd></div>
            <div><dt>Tunnel IP</dt><dd>{selectedProfile.tunnelIp}</dd></div>
            <div><dt>Local IP</dt><dd>{selectedProfile.localIp}</dd></div>
          </dl>
        </section>

        <section className="detail-card">
          <div className="detail-card-title">Quick Actions</div>
          <div className="action-column">
            <button className="secondary-action secondary-action-wide" type="button" onClick={() => handleDownloadProfile(selectedProfile.id)}>
              <IconArrowRight size={15} />
              Download profile
            </button>
            {!isIssuedProfile(selectedProfile) ? (
              <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("policies")}>
                <IconArrowRight size={15} />
                Edit policies
              </button>
            ) : null}
            <button className="secondary-action secondary-action-wide" type="button" onClick={() => setActiveView("certificates")}>
              <IconArrowRight size={15} />
              Inspect certificate
            </button>
            {!isIssuedProfile(selectedProfile) && selectedProfile.configState !== "imported" ? (
              <button className="secondary-action secondary-action-wide" type="button" onClick={openImportModal}>
                <IconUpload size={15} />
                Import real config
              </button>
            ) : null}
            <button className="secondary-action secondary-action-wide danger-action" type="button" onClick={() => handleDeleteProfile(selectedProfile.id)}>
              <IconTrash size={15} />
              Delete profile
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="left-rail">
        <div className="brand-lockup">
          <div className="brand-badge">
            <IconLock size={18} stroke={2} />
          </div>
          <div className="brand-text">OpenVPN Control</div>
        </div>

        <div className="mobile-control-bar">
          <label className="mobile-control-field">
            <span>Workspace</span>
            <select value={activeView} onChange={(event) => setActiveView(event.target.value)}>
              {dashboard.navigation.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="mobile-control-field">
            <span>Profile</span>
            <select
              value={selectedProfile?.id ?? ""}
              onChange={(event) => {
                if (event.target.value) {
                  selectProfile(event.target.value);
                }
              }}
              disabled={!allProfiles.length}
            >
              {!allProfiles.length ? <option value="">No profiles</option> : null}
              {allProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>
          <button className="mobile-control-create" type="button" onClick={openCreateModal} aria-label="Create profile">
            <IconPlus size={18} />
          </button>
        </div>

        <div className="profiles-panel">
          <div className="panel-header">
            <span>Profiles &amp; Sites</span>
            <button className="icon-button" type="button" onClick={openCreateModal} aria-label="Create profile">
              <IconPlus size={17} />
            </button>
          </div>

          <label className="search-box">
            <IconSearch size={16} />
            <input type="search" placeholder="Search profiles..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          </label>

          {filteredGroups.filter((group) => group.profileIds.length > 0).map((group) => (
            <section key={group.id} className="group-block">
              <div className="group-title">{group.label}</div>
              <div className="group-list">
                {group.profileIds.length ? (
                  group.profileIds.map((profileId) => {
                    const profile = dashboard.profiles[profileId];
                    if (!profile) {
                      return null;
                    }
                    const ProfileIcon = kindIcons[profile.kind] ?? IconWorld;
                    const active = profile.id === dashboard.selectedProfileId;

                    return (
                      <button
                        key={profile.id}
                        type="button"
                        className={`profile-row${active ? " profile-row-active" : ""}`}
                        onClick={() => selectProfile(profile.id, "profiles")}
                      >
                        <span className="profile-leading">
                          <ProfileIcon size={17} stroke={1.8} />
                        </span>
                        <span className="profile-copy">
                          <span className="profile-name">{profile.name}</span>
                          <span className={`profile-state profile-state-${statusTone(profile.status)}`}>
                            <IconCircleFilled size={8} fill="currentColor" stroke={0} />
                            {profileSummary(profile)}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="empty-note">Empty</div>
                )}
              </div>
            </section>
          ))}
        </div>

        <nav className="secondary-nav" aria-label="Main navigation">
          {dashboard.navigation.map((item) => {
            const NavIcon = navIcons[item.id] ?? IconSettings;
            const active = item.id === activeView;
            return (
              <button
                key={item.id}
                type="button"
                className={`secondary-nav-item${active ? " secondary-nav-item-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveView(item.id)}
              >
                <NavIcon size={18} stroke={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="version-lockup">{dashboard.serviceVersion}</div>
      </aside>

      <div className="workspace">
        <header className="top-bar">
          <h1>{viewTitles[activeView]}</h1>
          <div className="top-bar-right">
            <span>{dashboard.generatedAt}</span>
            <button className="icon-button subtle" type="button" aria-label="Refresh" onClick={refreshDashboard}>
              <IconRefresh size={17} />
            </button>
            <div className="profile-chip" aria-label="Current operator">
              {dashboard.operator}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className={`workspace-grid${activeView === "dashboard" ? " workspace-grid-wide" : ""}`}>
          <section className="canvas-card">
            {renderMainView()}
          </section>

          {activeView !== "dashboard" && <aside className="detail-panel">
            {renderDetailPanel()}
          </aside>}
        </main>
        <div className="app-status" role="status">
          <span className={`status-pill status-pill-${mode}`}>{mode === "connecting" ? "CONNECTING" : feedStale ? "OFFLINE / DELAYED" : "LIVE SERVER"}</span>
          <span>{statusMessage}</span>
        </div>
      </div>

      {modalMode ? (
        <div className="modal-scrim" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{modalMode === "create" ? "Create client profile" : "Import OpenVPN profile"}</h3>
              <button className="icon-button subtle" type="button" onClick={closeModal} aria-label="Close profile modal">
                <IconX size={16} />
              </button>
            </div>

            <div className="modal-tabs">
              <button type="button" className={modalMode === "create" ? "modal-tab-active" : ""} onClick={() => setModalMode("create")}>Create client</button>
              <button type="button" className={modalMode === "import" ? "modal-tab-active" : ""} onClick={() => setModalMode("import")}>Import config</button>
            </div>

            {modalMode === "create" ? (
              <form className="modal-form" onSubmit={handleCreateSubmit}>
                <label>
                  <span>Profile name</span>
                  <input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} required />
                </label>
                <label>
                  <span>Group</span>
                  <select value={createForm.group} onChange={(event) => setCreateForm((current) => ({ ...current, group: event.target.value }))}>
                    <option value="remote-sites">Remote Sites</option>
                    <option value="road-warriors">Road Warriors</option>
                    <option value="hub">Hub (This Device)</option>
                  </select>
                </label>
                <div className="empty-note">
                  Generates a complete profile for {pki.publicHost || "the managed server"}:{pki.port || 1194} with embedded CA, client certificate, private key and tls-crypt key.
                </div>
                <button type="submit" className="primary-action" disabled={!pki.initialized}>
                  {pki.initialized ? "Create and download .ovpn" : "Initialize PKI first"}
                </button>
              </form>
            ) : (
              <form className="modal-form" onSubmit={handleImportSubmit}>
                <label>
                  <span>Profile name</span>
                  <input value={importForm.name} onChange={(event) => setImportForm((current) => ({ ...current, name: event.target.value }))} required />
                </label>
                <label>
                  <span>Group</span>
                  <select value={importForm.group} onChange={(event) => setImportForm((current) => ({ ...current, group: event.target.value }))}>
                    <option value="remote-sites">Remote Sites</option>
                    <option value="road-warriors">Road Warriors</option>
                    <option value="hub">Hub (This Device)</option>
                  </select>
                </label>
                <label>
                  <span>Profile file</span>
                  <input type="file" accept=".ovpn,.conf,.zip" onChange={(event) => setImportForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} required />
                </label>
                <button type="submit" className="primary-action">Import profile</button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
