#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

try:
    import redis
except ImportError:
    redis = None


def env_flag(name, default="false"):
    return str(os.getenv(name, default)).strip().lower() in {"1", "true", "yes", "on"}


BIND_HOST = os.getenv("KAMAILIO_LIVE_CALLS_BIND", "127.0.0.1")
PORT = int(os.getenv("KAMAILIO_LIVE_CALLS_PORT", "9081"))
REFRESH_MS = int(os.getenv("KAMAILIO_LIVE_CALLS_REFRESH_MS", "5000"))
TITLE = os.getenv("KAMAILIO_LIVE_CALLS_TITLE", "Kamailio Live Calls")
SERVER_LABEL = os.getenv("KAMAILIO_LIVE_CALLS_SERVER_LABEL", "kamailio")
KAMCMD = os.getenv("KAMAILIO_LIVE_CALLS_KAMCMD", "/usr/sbin/kamcmd")
JOURNALCTL = os.getenv("KAMAILIO_LIVE_CALLS_JOURNALCTL", "/usr/bin/journalctl")
JOURNAL_UNIT = os.getenv("KAMAILIO_LIVE_CALLS_JOURNAL_UNIT", "kamailio.service")
PROM_METRICS_URL = os.getenv("KAMAILIO_LIVE_CALLS_PROM_METRICS_URL", f"http://{BIND_HOST}:8082/metrics")
REGISTRATION_JSONRPC_URL = os.getenv("KAMAILIO_LIVE_CALLS_REGISTRATION_JSONRPC_URL", f"http://{BIND_HOST}:8081/RPC")
REGISTRATION_CACHE_TTL_SECONDS = int(os.getenv("KAMAILIO_LIVE_CALLS_REGISTRATION_CACHE_TTL_SECONDS", "30"))
REGISTRATION_DEFAULT_PAGE_SIZE = int(os.getenv("KAMAILIO_LIVE_CALLS_REGISTRATION_DEFAULT_PAGE_SIZE", "25"))
REGISTRATION_MAX_PAGE_SIZE = int(os.getenv("KAMAILIO_LIVE_CALLS_REGISTRATION_MAX_PAGE_SIZE", "100"))
REGISTRATION_REDIS_ENABLED = env_flag(
    "KAMAILIO_LIVE_CALLS_REGISTRATION_REDIS_ENABLED",
    os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_ENABLED", "false"),
)
REGISTRATION_REDIS_PREFIX = os.getenv(
    "KAMAILIO_LIVE_CALLS_REGISTRATION_REDIS_PREFIX",
    "kamailio_live_calls:registrations",
)
FAILED_REGISTRATION_COLLECTION_ENABLED = env_flag(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_COLLECTION_ENABLED",
    "true",
)
FAILED_REGISTRATION_SINCE = os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_SINCE", "today")
FAILED_REGISTRATION_JOURNAL_LINES = int(os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_JOURNAL_LINES", "2000"))
FAILED_REGISTRATION_JOURNAL_TIMEOUT = int(os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_JOURNAL_TIMEOUT", "6"))
FAILED_REGISTRATION_LOG_ERRORS = env_flag(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_LOG_ERRORS",
    "true",
)
FAILED_REGISTRATION_QUERY_WINDOW_MINUTES = int(
    os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_QUERY_WINDOW_MINUTES", "60")
)
FAILED_REGISTRATION_REDIS_ENABLED = env_flag(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_ENABLED",
    "false",
)
FAILED_REGISTRATION_REDIS_HOST = os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_HOST", "127.0.0.1")
FAILED_REGISTRATION_REDIS_PORT = int(os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_PORT", "6379"))
FAILED_REGISTRATION_REDIS_DB = int(os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_DB", "0"))
FAILED_REGISTRATION_REDIS_PASSWORD = os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_PASSWORD", "")
FAILED_REGISTRATION_REDIS_PREFIX = os.getenv(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_PREFIX",
    "kamailio_live_calls:failed_registrations",
)
FAILED_REGISTRATION_REDIS_TTL_SECONDS = int(
    os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_TTL_SECONDS", str(7 * 24 * 60 * 60))
)
FAILED_REGISTRATION_REDIS_REFRESH_INTERVAL_SECONDS = int(
    os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_REFRESH_INTERVAL_SECONDS", "900")
)
FAILED_REGISTRATION_REDIS_BOOTSTRAP_SINCE = os.getenv(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_BOOTSTRAP_SINCE",
    "today",
)
FAILED_REGISTRATION_REDIS_SOCKET_TIMEOUT = float(
    os.getenv("KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_REDIS_SOCKET_TIMEOUT", "2")
)
FAILED_REGISTRATION_STRUCTURED_GREP = os.getenv(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_STRUCTURED_GREP",
    r"\[REGFAIL\]",
)
FAILED_REGISTRATION_LEGACY_GREP = os.getenv(
    "KAMAILIO_LIVE_CALLS_FAILED_REGISTRATION_LEGACY_GREP",
    r"issued auth challenge to failed registration attempt|could not save device location|dropping unauthorized message",
)


STATE_LABELS = {
    0: "unknown",
    1: "starting",
    2: "connecting",
    3: "answering",
    4: "ongoing",
}


FAILED_REGISTRATION_REASON_LABELS = {
    "auth_failed": "Authentication failed",
    "auth_cache_miss": "Credentials cache missing",
    "save_location_failed": "Save location failed",
    "too_many_failures": "Too many failures",
    "unauthorized_source": "Unauthorized source",
}


_FAILED_REGISTRATION_REDIS_CLIENT = None
_FAILED_REGISTRATION_REDIS_CLIENT_ERROR = ""
_FAILED_REGISTRATION_CACHE_THREAD = None
_REGISTRATION_REDIS_CLIENT = None
_REGISTRATION_REDIS_CLIENT_ERROR = ""
_REGISTRATION_CACHE = {"loaded_at": 0.0, "registrations": [], "error": "", "source": "empty"}
_REGISTRATION_CACHE_LOCK = threading.Lock()


HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #121a2f;
      --panel-2: #18223d;
      --text: #e7ebf6;
      --muted: #9ca8c7;
      --accent: #55b2ff;
      --accent-2: #7dd3fc;
      --ok: #10b981;
      --warn: #f59e0b;
      --danger: #ef4444;
      --border: #263252;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      background: linear-gradient(180deg, #0b1020 0%, #11182d 100%);
      color: var(--text);
    }}
    .wrap {{
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 28px;
    }}
    .sub {{
      color: var(--muted);
      margin-bottom: 20px;
    }}
    .section-title {{
      margin: 0 0 10px;
      font-size: 20px;
    }}
    .toolbar {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 20px;
    }}
    .toolbar button {{
      background: var(--accent);
      color: #07111f;
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
    }}
    .toolbar .meta {{
      color: var(--muted);
      font-size: 14px;
    }}
    .tab-bar {{
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }}
    .tab-button {{
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
    }}
    .tab-button.active {{
      background: rgba(85, 178, 255, 0.14);
      border-color: var(--accent);
      color: var(--text);
    }}
    .tab-panel[hidden] {{
      display: none;
    }}
    .registration-controls {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin: 0 0 12px;
    }}
    .registration-controls input,
    .registration-controls select {{
      background: #0a1020;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 9px 10px;
    }}
    .registration-controls input {{
      min-width: 280px;
      flex: 1;
    }}
    .pagination {{
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0 0;
      color: var(--muted);
    }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }}
    .card .label {{
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }}
    .card .value {{
      font-size: 28px;
      font-weight: 700;
    }}
    .table-wrap {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }}
    thead {{
      background: var(--panel-2);
    }}
    th, td {{
      padding: 12px 10px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }}
    tbody tr:hover {{
      background: rgba(85, 178, 255, 0.06);
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.14);
      color: #86efac;
    }}
    .badge-danger {{
      background: rgba(239, 68, 68, 0.14);
      color: #fca5a5;
    }}
    .muted {{
      color: var(--muted);
    }}
    .warning-text {{
      color: #fbbf24;
      margin: 0 0 12px;
    }}
    .mono {{
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      word-break: break-all;
    }}
    details {{
      margin-top: 6px;
    }}
    details pre {{
      white-space: pre-wrap;
      background: #0a1020;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      overflow: auto;
    }}
    .empty {{
      padding: 28px;
      text-align: center;
      color: var(--muted);
    }}
    .contact-list {{
      display: grid;
      gap: 8px;
    }}
    .contact-item {{
      background: #0a1020;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
    }}
    a {{
      color: var(--accent-2);
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>{title}</h1>
    <div class="sub">Live per-call rows from Kamailio dialog RPC and paged/searchable registration inventory from cached JSON-RPC on <span id="serverLabel">{server_label}</span>.</div>

    <div class="toolbar">
      <button id="refreshBtn" type="button">Refresh now</button>
      <div class="meta">Auto refresh: <span id="refreshMs">{refresh_ms}</span> ms</div>
      <div class="meta">Last refresh: <span id="lastRefresh">never</span></div>
    </div>

    <div class="cards">
      <div class="card"><div class="label">Active dialogs</div><div class="value" id="activeDialogs">0</div></div>
      <div class="card"><div class="label">Registered AoRs</div><div class="value" id="registeredAors">0</div></div>
      <div class="card"><div class="label">Registered contacts</div><div class="value" id="registeredContacts">0</div></div>
      <div class="card"><div class="label">Ongoing dialogs</div><div class="value" id="ongoingDialogs">0</div></div>
      <div class="card"><div class="label">Failed registrations today</div><div class="value" id="failedRegistrationsToday">0</div></div>
    </div>

    <div class="tab-bar">
      <button class="tab-button active" id="tabButtonCalls" data-tab="calls" type="button">Active Calls</button>
      <button class="tab-button" id="tabButtonRegistrations" data-tab="registrations" type="button">Registrations</button>
      <button class="tab-button" id="tabButtonFailedRegistrations" data-tab="failed-registrations" type="button">Failed Registrations</button>
    </div>

    <section class="tab-panel" id="tabPanelCalls">
      <h2 class="section-title">Active Dialogs</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Duration</th>
              <th>From</th>
              <th>To</th>
              <th>Tenant</th>
              <th>Media Server</th>
              <th>Call-ID</th>
              <th>Contacts</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="callsBody"></tbody>
        </table>
        <div class="empty" id="callsEmpty" hidden>No active dialogs right now.</div>
      </div>
    </section>

    <section class="tab-panel" id="tabPanelRegistrations" hidden>
      <h2 class="section-title">Registrations by AoR</h2>
      <div class="registration-controls">
        <input id="registrationSearch" type="search" placeholder="Search extension, AoR, domain, contact, User-Agent" autocomplete="off" />
        <select id="registrationPageSize">
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </select>
        <button id="registrationSearchBtn" type="button">Search</button>
        <button id="registrationReloadBtn" type="button">Reload cache</button>
      </div>
      <div class="meta" id="registrationsMeta"></div>
      <div class="warning-text" id="registrationsWarning" hidden></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>AoR</th>
              <th>Contacts</th>
              <th>Registered Contacts</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="registrationsBody"></tbody>
        </table>
        <div class="empty" id="registrationsEmpty" hidden>No registered contacts match this search.</div>
      </div>
      <div class="pagination">
        <button id="registrationPrevBtn" type="button">Previous</button>
        <span id="registrationPageInfo">Page 1</span>
        <button id="registrationNextBtn" type="button">Next</button>
      </div>
    </section>

    <section class="tab-panel" id="tabPanelFailedRegistrations" hidden>
      <h2 class="section-title">Failed Registrations Today</h2>
      <div class="warning-text" id="failedRegistrationsWarning" hidden></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User / AoR</th>
              <th>Source</th>
              <th>Reason</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="failedRegistrationsBody"></tbody>
        </table>
        <div class="empty" id="failedRegistrationsEmpty" hidden>No failed registrations found today.</div>
      </div>
    </section>
  </div>

  <script>
    const refreshMs = {refresh_ms};
    const registrationState = {{
      page: 1,
      pageSize: 25,
      query: "",
      total: 0,
      loaded: false,
      activeTab: "calls",
    }};

    function escapeHtml(value) {{
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }}

    function formatDuration(value) {{
      const seconds = Number(value || 0);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
    }}

    function formatTimestamp(value) {{
      if (!value) return "-";
      const date = new Date(Number(value) * 1000);
      if (Number.isNaN(date.getTime())) return "-";
      return date.toLocaleString();
    }}

    function formatIsoTimestamp(value) {{
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return date.toLocaleString();
    }}

    function renderCalls(calls) {{
      const body = document.getElementById("callsBody");
      const empty = document.getElementById("callsEmpty");

      if (!calls.length) {{
        body.innerHTML = "";
        empty.hidden = false;
        return;
      }}

      empty.hidden = true;
      body.innerHTML = calls.map((call) => {{
        const raw = escapeHtml(JSON.stringify(call.raw, null, 2));
        return `
          <tr>
            <td><span class="badge">${{escapeHtml(call.state_label || "unknown")}}</span><div class="muted">code: ${{escapeHtml(call.state ?? "")}}</div></td>
            <td>${{escapeHtml(formatDuration(call.duration))}}<div class="muted">${{escapeHtml(formatTimestamp(call.start_ts))}}</div></td>
            <td>${{escapeHtml(call.from_user || call.from_uri || "-")}}<div class="muted mono">${{escapeHtml(call.from_uri || "")}}</div></td>
            <td>${{escapeHtml(call.to_user || call.to_uri || "-")}}<div class="muted mono">${{escapeHtml(call.to_uri || "")}}</div></td>
            <td>${{escapeHtml(call.domain || "-")}}</td>
            <td>${{escapeHtml(call.server || "-")}}</td>
            <td class="mono">${{escapeHtml(call.call_id || "-")}}</td>
            <td>
              <div><strong>Caller:</strong> <span class="mono">${{escapeHtml(call.caller?.contact || "-")}}</span></div>
              <div><strong>Callee:</strong> <span class="mono">${{escapeHtml(call.callee?.contact || "-")}}</span></div>
            </td>
            <td>
              <details>
                <summary>Show raw</summary>
                <pre>${{raw}}</pre>
              </details>
            </td>
          </tr>
        `;
      }}).join("");
    }}

    function renderRegistrationMeta(meta) {{
      const metaNode = document.getElementById("registrationsMeta");
      const pageInfo = document.getElementById("registrationPageInfo");
      const prevBtn = document.getElementById("registrationPrevBtn");
      const nextBtn = document.getElementById("registrationNextBtn");
      const total = Number(meta.total ?? 0);
      const filtered = Number(meta.filtered ?? total);
      const page = Number(meta.page ?? registrationState.page);
      const pageSize = Number(meta.page_size ?? registrationState.pageSize);
      const pages = Math.max(1, Math.ceil(filtered / Math.max(1, pageSize)));
      const source = meta.cache_source || "unknown";
      const age = meta.cache_age_seconds ?? 0;
      metaNode.textContent = `Showing ${{filtered ? ((page - 1) * pageSize) + 1 : 0}}-${{Math.min(page * pageSize, filtered)}} of ${{filtered}} matching AoRs (${{total}} total). Source: ${{source}}, cache age: ${{age}}s.`;
      pageInfo.textContent = `Page ${{page}} of ${{pages}}`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = !meta.has_next;
    }}

    function renderRegistrations(registrations, meta = {{}}) {{
      const body = document.getElementById("registrationsBody");
      const empty = document.getElementById("registrationsEmpty");

      renderRegistrationMeta(meta);

      if (!registrations.length) {{
        body.innerHTML = "";
        empty.hidden = false;
        return;
      }}

      empty.hidden = true;
      body.innerHTML = registrations.map((registration) => {{
        const raw = escapeHtml(JSON.stringify(registration.raw, null, 2));
        const contacts = (registration.contacts || []).map((contact) => `
          <div class="contact-item">
            <div class="mono">${{escapeHtml(contact.address || "-")}}</div>
            <div class="muted">Expires: ${{escapeHtml(contact.expires ?? "-")}} | Reg-ID: ${{escapeHtml(contact.reg_id ?? "-")}} | Call-ID: ${{escapeHtml(contact.call_id || "-")}}</div>
            <div class="muted">User-Agent: ${{escapeHtml(contact.user_agent || "-")}}</div>
            <div class="muted mono">RUID: ${{escapeHtml(contact.ruid || "-")}} | Socket: ${{escapeHtml(contact.socket || "-")}}</div>
          </div>
        `).join("");

        return `
          <tr>
            <td>${{escapeHtml(registration.user || registration.aor || "-")}}<div class="muted mono">${{escapeHtml(registration.aor || "-")}}</div></td>
            <td><span class="badge">${{escapeHtml(registration.contact_count ?? 0)}}</span><div class="muted">${{escapeHtml(registration.domain || "-")}}</div></td>
            <td><div class="contact-list">${{contacts || '<span class="muted">No contacts</span>'}}</div></td>
            <td>
              <details>
                <summary>Show raw</summary>
                <pre>${{raw}}</pre>
              </details>
            </td>
          </tr>
        `;
      }}).join("");
    }}

    function renderFailedRegistrations(failures) {{
      const body = document.getElementById("failedRegistrationsBody");
      const empty = document.getElementById("failedRegistrationsEmpty");

      if (!failures.length) {{
        body.innerHTML = "";
        empty.hidden = false;
        return;
      }}

      empty.hidden = true;
      body.innerHTML = failures.map((failure) => {{
        const raw = escapeHtml(JSON.stringify(failure.raw, null, 2));
        return `
          <tr>
            <td>${{escapeHtml(formatIsoTimestamp(failure.occurred_at))}}</td>
            <td>${{escapeHtml(failure.user || "-")}}<div class="muted mono">${{escapeHtml(failure.aor || "-")}}</div></td>
            <td><span class="mono">${{escapeHtml(failure.source || "-")}}</span><div class="muted mono">${{escapeHtml(failure.contact || "-")}}</div></td>
            <td><span class="badge badge-danger">${{escapeHtml(failure.reason || "-")}}</span><div class="muted mono">${{escapeHtml(failure.call_id || "-")}}</div></td>
            <td>
              <div>${{escapeHtml(failure.detail || "-")}}</div>
              <details>
                <summary>Show raw</summary>
                <pre>${{raw}}</pre>
              </details>
            </td>
          </tr>
        `;
      }}).join("");
    }}

    function renderFailedRegistrationWarning(message) {{
      const warning = document.getElementById("failedRegistrationsWarning");
      if (message) {{
        warning.textContent = `Failed registration log collection is currently unavailable: ${{message}}`;
        warning.hidden = false;
        return;
      }}
      warning.textContent = "";
      warning.hidden = true;
    }}

    function renderRegistrationWarning(message) {{
      const warning = document.getElementById("registrationsWarning");
      if (message) {{
        warning.textContent = message;
        warning.hidden = false;
        return;
      }}
      warning.textContent = "";
      warning.hidden = true;
    }}

    function setActiveTab(name) {{
      const tabs = {{
        "calls": {{
          button: document.getElementById("tabButtonCalls"),
          panel: document.getElementById("tabPanelCalls"),
        }},
        "registrations": {{
          button: document.getElementById("tabButtonRegistrations"),
          panel: document.getElementById("tabPanelRegistrations"),
        }},
        "failed-registrations": {{
          button: document.getElementById("tabButtonFailedRegistrations"),
          panel: document.getElementById("tabPanelFailedRegistrations"),
        }},
      }};

      Object.entries(tabs).forEach(([tabName, tab]) => {{
        const isActive = tabName === name;
        tab.button.classList.toggle("active", isActive);
        tab.panel.hidden = !isActive;
      }});
    }}

    function render(data) {{
      document.getElementById("serverLabel").textContent = data.server_label || "";
      document.getElementById("activeDialogs").textContent = data.summary.active_dialogs ?? 0;
      document.getElementById("registeredAors").textContent = data.summary.registered_aors ?? 0;
      document.getElementById("registeredContacts").textContent = data.summary.registered_contacts ?? 0;
      document.getElementById("ongoingDialogs").textContent = data.summary.dialogs_by_state?.ongoing ?? 0;
      document.getElementById("failedRegistrationsToday").textContent = data.summary.failed_registrations_today ?? 0;
      document.getElementById("lastRefresh").textContent = new Date().toLocaleTimeString();

      renderCalls(data.calls || []);
      renderFailedRegistrations(data.failed_registrations || []);
      renderFailedRegistrationWarning(data.summary.failed_registrations_error || "");
    }}

    async function refresh() {{
      const response = await fetch("./api/calls", {{ cache: "no-store" }});
      if (!response.ok) {{
        throw new Error(`HTTP ${{response.status}}`);
      }}
      const data = await response.json();
      render(data);
    }}

    async function refreshRegistrations(options = {{}}) {{
      if (options.resetPage) registrationState.page = 1;
      if (options.force) registrationState.loaded = false;
      const params = new URLSearchParams({{
        q: registrationState.query,
        page: String(registrationState.page),
        page_size: String(registrationState.pageSize),
      }});
      if (options.force) params.set("refresh", "1");
      const response = await fetch(`./api/registrations?${{params.toString()}}`, {{ cache: "no-store" }});
      if (!response.ok) {{
        throw new Error(`HTTP ${{response.status}}`);
      }}
      const data = await response.json();
      registrationState.loaded = true;
      registrationState.total = data.total ?? 0;
      document.getElementById("registeredAors").textContent = data.registered_aors ?? 0;
      document.getElementById("registeredContacts").textContent = data.registered_contacts ?? 0;
      renderRegistrations(data.registrations || [], data);
      renderRegistrationWarning(data.registration_error || "");
    }}

    document.getElementById("refreshBtn").addEventListener("click", () => {{
      refresh().catch((error) => console.error(error));
      if (registrationState.activeTab === "registrations") {{
        refreshRegistrations({{ force: true }}).catch((error) => console.error(error));
      }}
    }});
    document.querySelectorAll(".tab-button").forEach((button) => {{
      button.addEventListener("click", () => {{
        registrationState.activeTab = button.dataset.tab;
        setActiveTab(button.dataset.tab);
        if (button.dataset.tab === "registrations" && !registrationState.loaded) {{
          refreshRegistrations().catch((error) => console.error(error));
        }}
      }});
    }});
    document.getElementById("registrationSearchBtn").addEventListener("click", () => {{
      registrationState.query = document.getElementById("registrationSearch").value.trim();
      refreshRegistrations({{ resetPage: true }}).catch((error) => console.error(error));
    }});
    document.getElementById("registrationSearch").addEventListener("keydown", (event) => {{
      if (event.key === "Enter") {{
        registrationState.query = event.target.value.trim();
        refreshRegistrations({{ resetPage: true }}).catch((error) => console.error(error));
      }}
    }});
    document.getElementById("registrationPageSize").addEventListener("change", (event) => {{
      registrationState.pageSize = Number(event.target.value || 25);
      refreshRegistrations({{ resetPage: true }}).catch((error) => console.error(error));
    }});
    document.getElementById("registrationPrevBtn").addEventListener("click", () => {{
      registrationState.page = Math.max(1, registrationState.page - 1);
      refreshRegistrations().catch((error) => console.error(error));
    }});
    document.getElementById("registrationNextBtn").addEventListener("click", () => {{
      registrationState.page += 1;
      refreshRegistrations().catch((error) => console.error(error));
    }});
    document.getElementById("registrationReloadBtn").addEventListener("click", () => {{
      refreshRegistrations({{ force: true }}).catch((error) => console.error(error));
    }});
    document.getElementById("refreshMs").textContent = String(refreshMs);

    setActiveTab("calls");
    refresh().catch((error) => console.error(error));
    window.setInterval(() => {{
      refresh().catch((error) => console.error(error));
      if (registrationState.activeTab === "registrations") {{
        refreshRegistrations().catch((error) => console.error(error));
      }}
    }}, refreshMs);
  </script>
</body>
</html>
"""


def parse_scalar(value):
    value = value.strip()
    if value == "":
        return ""
    if re.fullmatch(r"-?\d+", value):
        try:
            return int(value)
        except ValueError:
            return value
    if re.fullmatch(r"-?\d+\.\d+", value):
        try:
            return float(value)
        except ValueError:
            return value
    return value


def finalize_container(mapping, items):
    if items and not mapping:
        return items
    if mapping and not items:
        return mapping
    if mapping and items:
        mapping["_items"] = items
        return mapping
    return {}


def add_mapping_value(mapping, key, value):
    if key not in mapping:
        mapping[key] = value
        return
    if not isinstance(mapping[key], list):
        mapping[key] = [mapping[key]]
    mapping[key].append(value)


def parse_braced(lines, index):
    mapping = {}
    items = []

    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line:
            continue
        if line == "}":
            break
        if line == "{":
            child, index = parse_braced(lines, index)
            items.append(child)
            continue
        if line.endswith("{") and ":" in line:
            key = line.split(":", 1)[0].strip()
            child, index = parse_braced(lines, index)
            add_mapping_value(mapping, key, child)
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            add_mapping_value(mapping, key.strip(), parse_scalar(value))

    return finalize_container(mapping, items), index


def parse_kamailio_reply(text):
    lines = text.splitlines()
    items = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line:
            continue
        if line == "{":
            child, index = parse_braced(lines, index)
            items.append(child)

    return items


def merge_named_items(value):
    if isinstance(value, list):
        merged = {}
        for item in value:
            if isinstance(item, dict):
                merged.update(item)
        return merged
    return value


def extract_sip_user(uri):
    if not uri:
        return ""
    match = re.search(r"sips?:([^@;>]+)", str(uri))
    return match.group(1) if match else str(uri)


def split_aor(aor):
    value = str(aor or "")
    value = re.sub(r"^sips?:", "", value)
    if "@" in value:
        user, domain = value.split("@", 1)
        return user, domain
    return value, ""


def format_epoch(value):
    if not isinstance(value, int):
        return ""
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def normalize_dialog(dialog):
    dialog = dict(dialog)
    dialog["variables"] = merge_named_items(dialog.get("variables", {}))
    dialog["profiles"] = merge_named_items(dialog.get("profiles", {}))
    raw_dialog = json.loads(json.dumps(dialog))
    dialog["state_label"] = STATE_LABELS.get(dialog.get("state"), "unknown")
    dialog["domain"] = dialog.get("variables", {}).get("domain", "")
    dialog["server"] = dialog.get("variables", {}).get("server", "")
    dialog["call_id"] = dialog.get("call-id", "")
    dialog["from_user"] = extract_sip_user(dialog.get("from_uri", ""))
    dialog["to_user"] = extract_sip_user(dialog.get("to_uri", ""))
    dialog["started_at"] = format_epoch(dialog.get("start_ts"))
    dialog["initiated_at"] = format_epoch(dialog.get("init_ts"))
    dialog["caller"] = dialog.get("caller", {}) if isinstance(dialog.get("caller"), dict) else {}
    dialog["callee"] = dialog.get("callee", {}) if isinstance(dialog.get("callee"), dict) else {}
    dialog["raw"] = raw_dialog
    return dialog


def parse_registrations(reg_data):
    groups = {}

    def ensure_group(aor):
        group = groups.get(aor)
        if group is None:
            user, domain = split_aor(aor)
            group = {
                "aor": aor,
                "user": user,
                "domain": domain,
                "contacts": [],
                "raw": [],
            }
            groups[aor] = group
        return group

    def normalize_contact(contact):
        return {
            "address": str(contact.get("Address", "")),
            "expires": contact.get("Expires", ""),
            "call_id": str(contact.get("Call-ID", "")),
            "cseq": contact.get("CSeq", ""),
            "user_agent": str(contact.get("User-Agent", "")),
            "path": str(contact.get("Path", "")),
            "socket": str(contact.get("Socket", "")),
            "methods": contact.get("Methods", ""),
            "instance": str(contact.get("Instance", "")),
            "reg_id": contact.get("Reg-Id", contact.get("Reg-ID", "")),
            "ruid": str(contact.get("RUID", contact.get("Ruid", ""))),
            "received": str(contact.get("Received", "")),
            "raw": json.loads(json.dumps(contact)),
        }

    def collect(value, current_aor=""):
        if isinstance(value, dict):
            next_aor = current_aor
            if "AoR" in value:
                next_aor = str(value.get("AoR", ""))
                ensure_group(next_aor)["raw"].append(json.loads(json.dumps(value)))
            if "Address" in value and "Expires" in value and next_aor:
                ensure_group(next_aor)["contacts"].append(normalize_contact(value))
            for child in value.values():
                collect(child, next_aor)
        elif isinstance(value, list):
            for child in value:
                collect(child, current_aor)

    collect(reg_data)

    registrations = []
    registered_contacts = 0

    for aor in sorted(groups):
        group = groups[aor]
        contacts = list(group["contacts"])

        contacts.sort(
            key=lambda item: (
                item.get("address", ""),
                str(item.get("reg_id", "")),
                item.get("instance", ""),
                item.get("call_id", ""),
                item.get("ruid", ""),
            )
        )

        registrations.append({
            "aor": group["aor"],
            "user": group["user"],
            "domain": group["domain"],
            "contact_count": len(contacts),
            "contacts": contacts,
            "raw": group["raw"],
        })
        registered_contacts += len(contacts)

    return {
        "registered_aors": len(registrations),
        "registered_contacts": registered_contacts,
        "registrations": registrations,
    }


def format_reason_label(reason_code):
    code = str(reason_code or "").strip()
    if not code:
        return "Unknown failure"
    return FAILED_REGISTRATION_REASON_LABELS.get(
        code,
        code.replace("_", " ").replace("-", " ").title(),
    )


def parse_prefixed_log(message):
    match = re.search(
        r"(?:^|<script>:\s*)\[(?P<call_id>[^\]]*)\]\[(?P<method>[^\]]*)\]:\s*(?P<body>.*)$",
        str(message or ""),
    )
    if not match:
        return {}
    return match.groupdict()


def parse_regfail_fields(message):
    text = str(message or "")
    if "[REGFAIL]" not in text:
        return {}
    fields = {match.group(1): match.group(2) for match in re.finditer(r"(\w+)=\[(.*?)\]", text)}
    if "callid" in fields and "call_id" not in fields:
        fields["call_id"] = fields["callid"]
    return fields


def journal_entry_timestamp(entry):
    try:
        return int(entry.get("__REALTIME_TIMESTAMP", "0"))
    except (TypeError, ValueError):
        return 0


def iso_from_microseconds(value):
    if not value:
        return ""
    return datetime.fromtimestamp(value / 1_000_000, tz=timezone.utc).isoformat()


def build_failed_registration_event(timestamp_us, message, reason_code, *, user="", aor="", source="", contact="", call_id="", detail="", raw=None, structured=False):
    event_aor = str(aor or "")
    event_user = str(user or "")
    if not event_user and event_aor:
        event_user, _ = split_aor(event_aor)
    return {
        "occurred_at": iso_from_microseconds(timestamp_us),
        "timestamp_us": timestamp_us,
        "user": event_user,
        "aor": event_aor,
        "source": str(source or ""),
        "contact": str(contact or ""),
        "call_id": str(call_id or ""),
        "reason_code": str(reason_code or ""),
        "reason": format_reason_label(reason_code),
        "detail": str(detail or ""),
        "message": str(message or ""),
        "structured": bool(structured),
        "raw": raw if raw is not None else {"message": str(message or "")},
    }


def parse_failed_registration_event(entry):
    message = str(entry.get("MESSAGE", ""))
    timestamp_us = journal_entry_timestamp(entry)
    raw = {
        "message": message,
        "timestamp_us": timestamp_us,
        "hostname": entry.get("_HOSTNAME", ""),
        "unit": JOURNAL_UNIT,
    }

    regfail_fields = parse_regfail_fields(message)
    if regfail_fields:
        return build_failed_registration_event(
            timestamp_us,
            message,
            regfail_fields.get("reason", ""),
            user=regfail_fields.get("user", ""),
            aor=regfail_fields.get("aor", ""),
            source=regfail_fields.get("source", ""),
            contact=regfail_fields.get("contact", ""),
            call_id=regfail_fields.get("call_id", ""),
            detail=regfail_fields.get("detail", ""),
            raw={**raw, "fields": regfail_fields},
            structured=True,
        )

    prefixed = parse_prefixed_log(message)
    if str(prefixed.get("method", "")).upper() != "REGISTER":
        return None

    body = prefixed.get("body", "")
    call_id = prefixed.get("call_id", "")

    auth_failed_match = re.search(
        r"issued auth challenge to failed registration attempt for user \[(?P<user>[^\]]*)\]",
        body,
    )
    if auth_failed_match:
        return build_failed_registration_event(
            timestamp_us,
            message,
            "auth_failed",
            user=auth_failed_match.group("user"),
            call_id=call_id,
            detail="Kamailio challenged a REGISTER after credential validation failed.",
            raw=raw,
        )

    unauthorized_match = re.search(
        r"dropping unauthorized message (?P<source>\S+) \((?P<aor>[^)]*)\)",
        body,
    )
    if unauthorized_match:
        return build_failed_registration_event(
            timestamp_us,
            message,
            "unauthorized_source",
            aor=unauthorized_match.group("aor"),
            source=unauthorized_match.group("source"),
            call_id=call_id,
            detail="Kamailio rejected the REGISTER before authentication.",
            raw=raw,
        )

    save_location_match = re.search(
        r"could not save device location \[(?P<aor>[^\]]*)\]",
        body,
    )
    if save_location_match:
        return build_failed_registration_event(
            timestamp_us,
            message,
            "save_location_failed",
            aor=save_location_match.group("aor"),
            call_id=call_id,
            detail="Kamailio could not store the registration contact in usrloc.",
            raw=raw,
        )

    return None


def dedupe_failed_registration_events(events):
    structured_call_ids = set()
    for event in events:
        if event.get("structured") and event.get("call_id"):
            structured_call_ids.add(event.get("call_id", ""))

    deduped = []
    seen = set()

    for event in sorted(events, key=lambda item: item.get("timestamp_us", 0), reverse=True):
        if not event:
            continue

        if not event.get("structured") and event.get("call_id") and event.get("call_id") in structured_call_ids:
            continue

        key = (
            event.get("timestamp_us", 0),
            event.get("call_id", ""),
            event.get("reason_code", ""),
            event.get("user", ""),
            event.get("aor", ""),
            event.get("source", ""),
            event.get("contact", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(event)

    return deduped


def log_runtime_warning(message):
    print(f"[kamailio-live-calls] {message}", file=sys.stderr, flush=True)


def utc_now():
    return datetime.now(timezone.utc)


def utc_now_microseconds():
    return int(utc_now().timestamp() * 1_000_000)


def local_today_start_microseconds():
    day_start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return int(day_start.astimezone(timezone.utc).timestamp() * 1_000_000)


def failed_registration_redis_key(suffix):
    return f"{FAILED_REGISTRATION_REDIS_PREFIX}:{suffix}"


def get_failed_registration_redis_client():
    global _FAILED_REGISTRATION_REDIS_CLIENT
    global _FAILED_REGISTRATION_REDIS_CLIENT_ERROR

    if not FAILED_REGISTRATION_REDIS_ENABLED:
        return None

    if redis is None:
        if not _FAILED_REGISTRATION_REDIS_CLIENT_ERROR:
            _FAILED_REGISTRATION_REDIS_CLIENT_ERROR = "python redis module is not installed"
        return None

    if _FAILED_REGISTRATION_REDIS_CLIENT is not None:
        return _FAILED_REGISTRATION_REDIS_CLIENT

    try:
        client = redis.Redis(
            host=FAILED_REGISTRATION_REDIS_HOST,
            port=FAILED_REGISTRATION_REDIS_PORT,
            db=FAILED_REGISTRATION_REDIS_DB,
            password=FAILED_REGISTRATION_REDIS_PASSWORD or None,
            socket_timeout=FAILED_REGISTRATION_REDIS_SOCKET_TIMEOUT,
            decode_responses=True,
        )
        client.ping()
        _FAILED_REGISTRATION_REDIS_CLIENT = client
        _FAILED_REGISTRATION_REDIS_CLIENT_ERROR = ""
        return client
    except Exception as exc:
        _FAILED_REGISTRATION_REDIS_CLIENT_ERROR = str(exc)
        log_runtime_warning(f"failed to connect to redis for failed registration cache: {exc}")
        return None


def parse_journal_json_lines(output):
    entries = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


def format_journalctl_time(value):
    return value.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def iter_failed_registration_windows():
    if FAILED_REGISTRATION_SINCE.strip().lower() != "today":
        yield FAILED_REGISTRATION_SINCE, None
        return

    window_minutes = max(1, FAILED_REGISTRATION_QUERY_WINDOW_MINUTES)
    now_local = datetime.now().astimezone()
    day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = now_local

    while window_end > day_start:
        window_start = max(day_start, window_end - timedelta(minutes=window_minutes))
        yield format_journalctl_time(window_start), format_journalctl_time(window_end)
        window_end = window_start


def run_failed_registration_journal_query(grep_pattern, since_value, until_value=None):
    command = [
        JOURNALCTL,
        "-u",
        JOURNAL_UNIT,
        "--since",
        since_value,
        "--output",
        "json",
        "--no-pager",
        "--grep",
        grep_pattern,
        "--lines",
        str(FAILED_REGISTRATION_JOURNAL_LINES),
    ]
    if until_value:
        command.extend(["--until", until_value])
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=FAILED_REGISTRATION_JOURNAL_TIMEOUT,
        check=False,
    )
    if result.returncode == 0:
        return result.stdout
    if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
        return ""
    raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")


def collect_failed_registration_events_for_pattern(query_name, grep_pattern, windows=None):
    events = []
    errors = []

    for since_value, until_value in windows or iter_failed_registration_windows():
        try:
            output = run_failed_registration_journal_query(grep_pattern, since_value, until_value)
        except Exception as exc:
            window_label = since_value if not until_value else f"{since_value}..{until_value}"
            errors.append(f"{query_name} window {window_label} failed: {exc}")
            continue

        for entry in parse_journal_json_lines(output):
            event = parse_failed_registration_event(entry)
            if event:
                events.append(event)

    return dedupe_failed_registration_events(events), errors


def trim_failed_registration_events(events):
    cutoff_us = utc_now_microseconds() - (FAILED_REGISTRATION_REDIS_TTL_SECONDS * 1_000_000)
    return [event for event in events if int(event.get("timestamp_us", 0)) >= cutoff_us]


def load_failed_registrations_from_redis():
    client = get_failed_registration_redis_client()
    if client is None:
        return None

    try:
        payload = client.get(failed_registration_redis_key("events"))
        checkpoint_raw = client.get(failed_registration_redis_key("checkpoint_us"))
        last_refresh = client.get(failed_registration_redis_key("last_refresh"))
        last_error = client.get(failed_registration_redis_key("last_error")) or ""
    except Exception as exc:
        log_runtime_warning(f"failed to read failed registration cache from redis: {exc}")
        return None

    events = []
    if payload:
        try:
            events = json.loads(payload)
        except json.JSONDecodeError:
            events = []

    checkpoint_us = 0
    if checkpoint_raw:
        try:
            checkpoint_us = int(checkpoint_raw)
        except (TypeError, ValueError):
            checkpoint_us = 0

    return {
        "events": trim_failed_registration_events(events),
        "checkpoint_us": checkpoint_us,
        "last_refresh": last_refresh or "",
        "last_error": last_error,
    }


def save_failed_registrations_to_redis(events, checkpoint_us, *, last_refresh, error_message=""):
    client = get_failed_registration_redis_client()
    if client is None:
        return False

    trimmed_events = trim_failed_registration_events(dedupe_failed_registration_events(events))

    try:
        pipe = client.pipeline()
        pipe.setex(failed_registration_redis_key("events"), FAILED_REGISTRATION_REDIS_TTL_SECONDS, json.dumps(trimmed_events))
        pipe.setex(failed_registration_redis_key("checkpoint_us"), FAILED_REGISTRATION_REDIS_TTL_SECONDS, str(int(checkpoint_us)))
        pipe.setex(failed_registration_redis_key("last_refresh"), FAILED_REGISTRATION_REDIS_TTL_SECONDS, str(last_refresh))
        if error_message:
            pipe.setex(failed_registration_redis_key("last_error"), FAILED_REGISTRATION_REDIS_TTL_SECONDS, str(error_message))
        else:
            pipe.delete(failed_registration_redis_key("last_error"))
        pipe.execute()
        return True
    except Exception as exc:
        log_runtime_warning(f"failed to persist failed registration cache to redis: {exc}")
        return False


def refresh_failed_registrations_cache():
    cached = load_failed_registrations_from_redis() or {}
    existing_events = list(cached.get("events", []))
    previous_checkpoint_us = int(cached.get("checkpoint_us", 0) or 0)
    scan_started_at = utc_now()
    scan_started_us = int(scan_started_at.timestamp() * 1_000_000)
    scan_until_value = format_journalctl_time(scan_started_at)

    if previous_checkpoint_us > 0:
        since_value = format_journalctl_time(datetime.fromtimestamp(previous_checkpoint_us / 1_000_000, tz=timezone.utc))
    else:
        since_value = FAILED_REGISTRATION_REDIS_BOOTSTRAP_SINCE

    windows = [(since_value, scan_until_value)]
    structured_events, structured_errors = collect_failed_registration_events_for_pattern(
        "structured",
        FAILED_REGISTRATION_STRUCTURED_GREP,
        windows=windows,
    )
    legacy_events, legacy_errors = collect_failed_registration_events_for_pattern(
        "legacy",
        FAILED_REGISTRATION_LEGACY_GREP,
        windows=windows,
    )

    errors = structured_errors + legacy_errors
    combined_events = dedupe_failed_registration_events(existing_events + structured_events + legacy_events)
    error_message = "; ".join(errors)
    last_refresh = utc_now().isoformat()

    if errors and not combined_events:
        log_runtime_warning(
            f"failed to refresh failed registration cache from journalctl for unit [{JOURNAL_UNIT}]: {error_message}"
        )
        save_failed_registrations_to_redis(existing_events, previous_checkpoint_us, last_refresh=last_refresh, error_message=error_message)
        return False

    if errors:
        log_runtime_warning(
            f"partial failed registration cache refresh issue for unit [{JOURNAL_UNIT}]: {error_message}"
        )

    save_failed_registrations_to_redis(combined_events, scan_started_us, last_refresh=last_refresh, error_message=error_message)
    return True


def failed_registration_cache_worker():
    while True:
        try:
            refresh_failed_registrations_cache()
        except Exception as exc:
            log_runtime_warning(f"failed registration cache worker error: {exc}")
        time.sleep(max(30, FAILED_REGISTRATION_REDIS_REFRESH_INTERVAL_SECONDS))


def start_failed_registration_cache_worker():
    global _FAILED_REGISTRATION_CACHE_THREAD

    if not FAILED_REGISTRATION_REDIS_ENABLED or _FAILED_REGISTRATION_CACHE_THREAD is not None:
        return

    _FAILED_REGISTRATION_CACHE_THREAD = threading.Thread(
        target=failed_registration_cache_worker,
        name="failed-registration-cache-worker",
        daemon=True,
    )
    _FAILED_REGISTRATION_CACHE_THREAD.start()


def collect_failed_registrations_from_redis():
    cached = load_failed_registrations_from_redis()
    if cached is None:
        error_message = _FAILED_REGISTRATION_REDIS_CLIENT_ERROR or "redis cache unavailable"
        return {
            "failed_registrations_today": 0,
            "failed_registrations": [],
            "failed_registrations_error": error_message,
        }

    events = trim_failed_registration_events(cached.get("events", []))
    today_start_us = local_today_start_microseconds()
    today_events = [event for event in events if int(event.get("timestamp_us", 0)) >= today_start_us]
    error_message = cached.get("last_error", "")

    if not cached.get("last_refresh"):
        error_message = error_message or "failed registration cache is warming up"

    return {
        "failed_registrations_today": len(today_events),
        "failed_registrations": events,
        "failed_registrations_error": error_message,
    }


def collect_failed_registrations():
    if not FAILED_REGISTRATION_COLLECTION_ENABLED:
        return {
            "failed_registrations_today": 0,
            "failed_registrations": [],
            "failed_registrations_error": "failed registration journal collection is disabled",
        }

    if FAILED_REGISTRATION_REDIS_ENABLED:
        return collect_failed_registrations_from_redis()

    deduped_events = []
    errors = []

    structured_events, structured_errors = collect_failed_registration_events_for_pattern(
        "structured",
        FAILED_REGISTRATION_STRUCTURED_GREP,
    )
    deduped_events.extend(structured_events)
    errors.extend(structured_errors)

    if not structured_events:
        legacy_events, legacy_errors = collect_failed_registration_events_for_pattern(
            "legacy",
            FAILED_REGISTRATION_LEGACY_GREP,
        )
        deduped_events.extend(legacy_events)
        errors.extend(legacy_errors)

    deduped_events = dedupe_failed_registration_events(deduped_events)
    error_message = ""

    if errors and not deduped_events:
        error_message = "; ".join(errors)
        if FAILED_REGISTRATION_LOG_ERRORS:
            log_runtime_warning(
                f"failed to collect registration failures from journalctl for unit [{JOURNAL_UNIT}]: {error_message}"
            )
    elif errors and FAILED_REGISTRATION_LOG_ERRORS:
        log_runtime_warning(
            f"partial registration failure collection issue for unit [{JOURNAL_UNIT}]: {'; '.join(errors)}"
        )

    return {
        "failed_registrations_today": len(deduped_events),
        "failed_registrations": deduped_events,
        "failed_registrations_error": error_message,
    }


def run_command(command, timeout=5):
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")
    return result.stdout


def run_kamcmd(*args):
    return run_command([KAMCMD, *args], timeout=5)


def parse_prometheus_metric_value(metrics_text, metric_name):
    pattern = re.compile(rf"^{re.escape(metric_name)}\s+([0-9]+(?:\.[0-9]+)?)\b", re.MULTILINE)
    match = pattern.search(metrics_text)
    if not match:
        raise RuntimeError(f"metric [{metric_name}] not found in prometheus payload")
    return int(float(match.group(1)))


def collect_registration_summary_from_metrics():
    try:
        with urlopen(PROM_METRICS_URL, timeout=3) as response:
            metrics_text = response.read().decode("utf-8", "replace")
    except (OSError, TimeoutError, URLError) as exc:
        raise RuntimeError(f"failed to fetch registration metrics from [{PROM_METRICS_URL}]: {exc}") from exc

    return {
        "registered_aors": parse_prometheus_metric_value(metrics_text, "kamailio_usrloc_location_users"),
        "registered_contacts": parse_prometheus_metric_value(metrics_text, "kamailio_usrloc_location_contacts"),
        "registrations": [],
        "registration_error": "",
    }


def registration_redis_key(suffix):
    return f"{REGISTRATION_REDIS_PREFIX}:{suffix}"


def get_registration_redis_client():
    global _REGISTRATION_REDIS_CLIENT, _REGISTRATION_REDIS_CLIENT_ERROR

    if not REGISTRATION_REDIS_ENABLED or redis is None:
        if REGISTRATION_REDIS_ENABLED and redis is None:
            _REGISTRATION_REDIS_CLIENT_ERROR = "python redis module is not installed"
        return None
    if _REGISTRATION_REDIS_CLIENT is not None:
        return _REGISTRATION_REDIS_CLIENT

    try:
        client = redis.Redis(
            host=FAILED_REGISTRATION_REDIS_HOST,
            port=FAILED_REGISTRATION_REDIS_PORT,
            db=FAILED_REGISTRATION_REDIS_DB,
            password=FAILED_REGISTRATION_REDIS_PASSWORD or None,
            socket_timeout=FAILED_REGISTRATION_REDIS_SOCKET_TIMEOUT,
            decode_responses=True,
        )
        client.ping()
        _REGISTRATION_REDIS_CLIENT = client
        _REGISTRATION_REDIS_CLIENT_ERROR = ""
        return client
    except Exception as exc:
        _REGISTRATION_REDIS_CLIENT_ERROR = str(exc)
        return None


def load_registration_inventory_from_redis():
    client = get_registration_redis_client()
    if client is None:
        return None

    try:
        payload = client.get(registration_redis_key("inventory"))
        loaded_at = client.get(registration_redis_key("loaded_at"))
    except Exception as exc:
        log_runtime_warning(f"failed to read registration cache from redis: {exc}")
        return None

    if not payload or not loaded_at:
        return None

    try:
        return {
            "registrations": json.loads(payload),
            "loaded_at": float(loaded_at),
            "source": "redis",
            "error": "",
        }
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def save_registration_inventory_to_redis(registrations, loaded_at):
    client = get_registration_redis_client()
    if client is None:
        return False

    try:
        pipe = client.pipeline()
        pipe.setex(registration_redis_key("inventory"), REGISTRATION_CACHE_TTL_SECONDS * 4, json.dumps(registrations))
        pipe.setex(registration_redis_key("loaded_at"), REGISTRATION_CACHE_TTL_SECONDS * 4, str(loaded_at))
        pipe.execute()
        return True
    except Exception as exc:
        log_runtime_warning(f"failed to persist registration cache to redis: {exc}")
        return False


def run_jsonrpc_method(method, params=None, timeout=20):
    payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params or [], "id": 1}).encode("utf-8")
    request = Request(REGISTRATION_JSONRPC_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
    except (OSError, TimeoutError, URLError) as exc:
        raise RuntimeError(f"jsonrpc [{method}] failed via [{REGISTRATION_JSONRPC_URL}]: {exc}") from exc

    data = json.loads(body)
    if data.get("error"):
        raise RuntimeError(f"jsonrpc [{method}] error: {data['error']}")
    return data.get("result")


def load_registration_inventory(force=False):
    now = time.time()
    with _REGISTRATION_CACHE_LOCK:
        cache_age = now - float(_REGISTRATION_CACHE.get("loaded_at") or 0)
        if not force and _REGISTRATION_CACHE.get("registrations") and cache_age <= REGISTRATION_CACHE_TTL_SECONDS:
            return dict(_REGISTRATION_CACHE)

    if not force:
        redis_cache = load_registration_inventory_from_redis()
        if redis_cache and now - float(redis_cache.get("loaded_at") or 0) <= REGISTRATION_CACHE_TTL_SECONDS:
            with _REGISTRATION_CACHE_LOCK:
                _REGISTRATION_CACHE.update(redis_cache)
            return dict(redis_cache)

    result = run_jsonrpc_method("ul.dump")
    reg_stats = parse_registrations(result or {})
    loaded_at = time.time()
    cache = {
        "registrations": reg_stats["registrations"],
        "loaded_at": loaded_at,
        "source": "jsonrpc",
        "error": "",
    }
    save_registration_inventory_to_redis(cache["registrations"], loaded_at)
    with _REGISTRATION_CACHE_LOCK:
        _REGISTRATION_CACHE.update(cache)
    return dict(cache)


def registration_matches_query(registration, query):
    if not query:
        return True

    needle = query.lower()
    values = [
        registration.get("aor", ""),
        registration.get("user", ""),
        registration.get("domain", ""),
    ]
    for contact in registration.get("contacts", []):
        values.extend([
            contact.get("address", ""),
            contact.get("call_id", ""),
            contact.get("user_agent", ""),
            contact.get("socket", ""),
            contact.get("ruid", ""),
            contact.get("received", ""),
        ])
    return any(needle in str(value).lower() for value in values)


def build_registrations_payload(query="", page=1, page_size=None, force=False):
    page = max(1, int(page or 1))
    page_size = min(REGISTRATION_MAX_PAGE_SIZE, max(1, int(page_size or REGISTRATION_DEFAULT_PAGE_SIZE)))
    metrics_error = ""

    try:
        metrics = collect_registration_summary_from_metrics()
    except Exception as exc:
        metrics = {"registered_aors": 0, "registered_contacts": 0}
        metrics_error = str(exc)

    try:
        cache = load_registration_inventory(force=force)
        registrations = cache.get("registrations", [])
        registration_error = cache.get("error", "")
    except Exception as exc:
        cache = {"loaded_at": 0, "source": "unavailable"}
        registrations = []
        registration_error = str(exc)

    filtered = [registration for registration in registrations if registration_matches_query(registration, query)]
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "registered_aors": metrics.get("registered_aors") or len(registrations),
        "registered_contacts": metrics.get("registered_contacts") or sum(int(item.get("contact_count", 0) or 0) for item in registrations),
        "total": len(registrations),
        "filtered": len(filtered),
        "page": page,
        "page_size": page_size,
        "has_next": end < len(filtered),
        "query": query,
        "cache_source": cache.get("source", "unknown"),
        "cache_age_seconds": int(max(0, time.time() - float(cache.get("loaded_at") or 0))) if cache.get("loaded_at") else 0,
        "registration_error": registration_error or metrics_error,
        "redis_enabled": REGISTRATION_REDIS_ENABLED,
        "redis_error": _REGISTRATION_REDIS_CLIENT_ERROR,
        "registrations": filtered[start:end],
    }


def collect_registrations():
    try:
        summary = collect_registration_summary_from_metrics()
        summary["registration_error"] = ""
        summary["registrations"] = []
        return summary
    except Exception as exc:
        return {
            "registered_aors": 0,
            "registered_contacts": 0,
            "registrations": [],
            "registration_error": str(exc),
        }


def build_payload():
    dialogs = [normalize_dialog(item) for item in parse_kamailio_reply(run_kamcmd("dlg.list")) if isinstance(item, dict)]
    stats_list = parse_kamailio_reply(run_kamcmd("dlg.stats_active"))
    reg_stats = collect_registrations()
    failed_registrations = collect_failed_registrations()

    stats = stats_list[0] if stats_list and isinstance(stats_list[0], dict) else {}

    dialogs.sort(key=lambda item: item.get("start_ts", 0), reverse=True)

    return {
        "title": TITLE,
        "server_label": SERVER_LABEL,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "active_dialogs": len(dialogs),
            "dialogs_by_state": stats,
            "registered_aors": reg_stats["registered_aors"],
            "registered_contacts": reg_stats["registered_contacts"],
            "registration_error": reg_stats.get("registration_error", ""),
            "failed_registrations_today": failed_registrations["failed_registrations_today"],
            "failed_registrations_error": failed_registrations.get("failed_registrations_error", ""),
        },
        "calls": dialogs,
        "registrations": reg_stats["registrations"],
        "failed_registrations": failed_registrations["failed_registrations"],
    }


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        parsed = urlparse(self.path)

        if parsed.path == "/healthz":
            self.send_simple_response(200, "application/json; charset=utf-8")
            return

        if parsed.path in ("/", "", "/api/calls", "/api/registrations"):
            content_type = "text/html; charset=utf-8" if parsed.path in ("/", "") else "application/json; charset=utf-8"
            self.send_simple_response(200, content_type)
            return

        self.send_simple_response(404, "application/json; charset=utf-8")

    def do_GET(self):
        try:
            parsed = urlparse(self.path)

            if parsed.path == "/healthz":
                self.respond_json({"ok": True})
                return

            if parsed.path in ("/", ""):
                content = HTML_PAGE.format(
                    title=TITLE,
                    server_label=SERVER_LABEL,
                    refresh_ms=REFRESH_MS,
                ).encode("utf-8")
                self.respond_content(content, "text/html; charset=utf-8")
                return

            if parsed.path == "/api/calls":
                try:
                    self.respond_json(build_payload())
                except Exception as exc:
                    log_runtime_warning(f"failed to build live-calls payload: {exc}")
                    self.respond_json({"error": str(exc)}, status=500)
                return

            if parsed.path == "/api/registrations":
                try:
                    query = parse_qs(parsed.query)
                    self.respond_json(build_registrations_payload(
                        query=(query.get("q") or [""])[0].strip(),
                        page=int((query.get("page") or ["1"])[0] or 1),
                        page_size=int((query.get("page_size") or [str(REGISTRATION_DEFAULT_PAGE_SIZE)])[0] or REGISTRATION_DEFAULT_PAGE_SIZE),
                        force=(query.get("refresh") or [""])[0] in {"1", "true", "yes"},
                    ))
                except Exception as exc:
                    log_runtime_warning(f"failed to build registrations payload: {exc}")
                    self.respond_json({"error": str(exc)}, status=500)
                return

            self.respond_json({"error": "not found"}, status=404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError) as exc:
            log_runtime_warning(f"client connection dropped while handling [{self.path}]: {exc}")

    def log_message(self, format_string, *args):
        return

    def respond_json(self, payload, status=200):
        content = json.dumps(payload, indent=2).encode("utf-8")
        self.respond_content(content, "application/json; charset=utf-8", status=status)

    def respond_content(self, content, content_type, status=200):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return True
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError) as exc:
            log_runtime_warning(f"client connection dropped while sending [{self.path}] response: {exc}")
            return False

    def send_simple_response(self, status, content_type):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError) as exc:
            log_runtime_warning(f"client connection dropped while sending headers for [{self.path}]: {exc}")


def main():
    start_failed_registration_cache_worker()
    server = ThreadingHTTPServer((BIND_HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
