import "dotenv/config";
import express from "express";
import fs from "node:fs";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const {
  SUPABASE_URL = "",
  SUPABASE_SERVICE_ROLE_KEY = "",
  WHATSAPP_SERVICE_TOKEN = "",
  PORT = "5055",
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const requireToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token || token !== WHATSAPP_SERVICE_TOKEN) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

const updateStatus = async (updates: Record<string, unknown>) => {
  await supabase
    .from("whatsapp_status")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", 1);
};

const panelHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>WhatsApp Service</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: "Segoe UI", Arial, sans-serif;
        margin: 0;
        padding: 24px;
        background: #f5f7fb;
        color: #0f172a;
      }
      .container {
        max-width: 920px;
        margin: 0 auto;
        display: grid;
        gap: 20px;
      }
      .card {
        background: #ffffff;
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 20px;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: center;
        justify-content: space-between;
      }
      .status {
        padding: 6px 12px;
        border-radius: 999px;
        font-weight: 700;
        font-size: 12px;
      }
      .status.connected { background: #d1fae5; color: #065f46; }
      .status.connecting { background: #fef3c7; color: #92400e; }
      .status.disconnected { background: #fee2e2; color: #991b1b; }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 260px;
        gap: 16px;
      }
      .kv {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid #e2e8f0;
        font-size: 13px;
      }
      .kv:last-child { border-bottom: none; }
      .qr {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 240px;
        border: 1px dashed #cbd5f5;
        border-radius: 14px;
        background: #f8fafc;
      }
      .qr img {
        width: 200px;
        height: 200px;
        object-fit: contain;
        background: #fff;
        border-radius: 12px;
        padding: 6px;
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button {
        border: none;
        padding: 10px 14px;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
        background: #1d4ed8;
        color: #fff;
      }
      button.secondary { background: #0f766e; }
      button.danger { background: #dc2626; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      input {
        border: 1px solid #cbd5f5;
        border-radius: 10px;
        padding: 10px 12px;
        width: 100%;
        font-size: 13px;
      }
      .error { color: #dc2626; font-size: 13px; font-weight: 600; }
      .muted { color: #64748b; font-size: 12px; }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>WhatsApp Service Panel</h1>
        <p class="muted">Use your service token to load status and control the session.</p>
        <div class="row" style="margin-top: 12px;">
          <div style="flex: 1; min-width: 240px;">
            <input id="tokenInput" type="password" placeholder="WHATSAPP_SERVICE_TOKEN" />
          </div>
          <button id="saveToken">Save Token</button>
          <button id="refreshStatus" class="secondary">Refresh</button>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <strong>Status</strong>
          <span id="statusBadge" class="status disconnected">disconnected</span>
        </div>
        <div class="grid" style="margin-top: 16px;">
          <div>
            <div class="kv"><span class="muted">Connected Number</span><span id="connectedNumber">—</span></div>
            <div class="kv"><span class="muted">Last Connected</span><span id="lastConnectedAt">—</span></div>
            <div class="kv"><span class="muted">Heartbeat</span><span id="heartbeatAt">—</span></div>
            <div class="kv"><span class="muted">Updated At</span><span id="updatedAt">—</span></div>
            <div class="kv"><span class="muted">Last Error</span><span id="lastError">—</span></div>
          </div>
          <div class="qr" id="qrBox">
            <span class="muted">No QR code</span>
          </div>
        </div>
        <div style="margin-top: 16px;">
          <div class="controls">
            <button id="restartBtn">Restart</button>
            <button id="logoutBtn" class="danger">Logout</button>
            <button id="clearBtn" class="danger">Clear Session</button>
          </div>
        </div>
        <p id="errorText" class="error" style="margin-top: 12px;"></p>
      </div>
    </div>

    <script>
      const tokenInput = document.getElementById("tokenInput");
      const saveToken = document.getElementById("saveToken");
      const refreshStatus = document.getElementById("refreshStatus");
      const statusBadge = document.getElementById("statusBadge");
      const connectedNumber = document.getElementById("connectedNumber");
      const lastConnectedAt = document.getElementById("lastConnectedAt");
      const heartbeatAt = document.getElementById("heartbeatAt");
      const updatedAt = document.getElementById("updatedAt");
      const lastError = document.getElementById("lastError");
      const qrBox = document.getElementById("qrBox");
      const errorText = document.getElementById("errorText");
      const restartBtn = document.getElementById("restartBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      const clearBtn = document.getElementById("clearBtn");

      const loadToken = () => {
        const saved = localStorage.getItem("whatsapp_service_token") || "";
        tokenInput.value = saved;
        return saved;
      };

      const saveCurrentToken = () => {
        localStorage.setItem("whatsapp_service_token", tokenInput.value.trim());
      };

      const formatDate = (value) => {
        if (!value) return "—";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "—";
        return parsed.toLocaleString();
      };

      const setStatus = (status) => {
        const value = (status || "disconnected").toLowerCase();
        statusBadge.textContent = value;
        statusBadge.className = "status " + value;
      };

      const renderQr = (qrCode) => {
        qrBox.innerHTML = "";
        if (!qrCode) {
          const span = document.createElement("span");
          span.className = "muted";
          span.textContent = "No QR code";
          qrBox.appendChild(span);
          return;
        }
        const img = document.createElement("img");
        img.src = qrCode;
        img.alt = "WhatsApp QR";
        qrBox.appendChild(img);
      };

      const fetchStatus = async () => {
        const token = tokenInput.value.trim();
        if (!token) {
          errorText.textContent = "Token is required.";
          return;
        }
        errorText.textContent = "";
        const response = await fetch("/api/status", {
          headers: { Authorization: "Bearer " + token }
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message || "Failed to load status.");
        }
        const data = await response.json();
        setStatus(data.status);
        connectedNumber.textContent = data.connected_number || "—";
        lastConnectedAt.textContent = formatDate(data.last_connected_at);
        heartbeatAt.textContent = formatDate(data.heartbeat_at);
        updatedAt.textContent = formatDate(data.updated_at);
        lastError.textContent = data.last_error || "—";
        renderQr(data.qr_code);
      };

      const sendControl = async (action) => {
        const token = tokenInput.value.trim();
        if (!token) {
          errorText.textContent = "Token is required.";
          return;
        }
        errorText.textContent = "";
        const response = await fetch("/api/control", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token
          },
          body: JSON.stringify({ action })
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message || "Control failed.");
        }
      };

      saveToken.addEventListener("click", () => {
        saveCurrentToken();
      });

      refreshStatus.addEventListener("click", async () => {
        try {
          await fetchStatus();
        } catch (err) {
          errorText.textContent = err.message;
        }
      });

      restartBtn.addEventListener("click", async () => {
        try {
          await sendControl("restart");
          await fetchStatus();
        } catch (err) {
          errorText.textContent = err.message;
        }
      });

      logoutBtn.addEventListener("click", async () => {
        try {
          await sendControl("logout");
          await fetchStatus();
        } catch (err) {
          errorText.textContent = err.message;
        }
      });

      clearBtn.addEventListener("click", async () => {
        try {
          await sendControl("clear_session");
          await fetchStatus();
        } catch (err) {
          errorText.textContent = err.message;
        }
      });

      loadToken();
      fetchStatus().catch((err) => {
        errorText.textContent = err.message;
      });
      setInterval(() => {
        fetchStatus().catch(() => undefined);
      }, 15000);
    </script>
  </body>
</html>`;

const authFolder = process.env.BAILEYS_AUTH_FOLDER ?? "./.baileys_auth";
const storageBucket = process.env.BAILEYS_STORAGE_BUCKET ?? "whatsapp-auth";
const storagePrefix = process.env.BAILEYS_STORAGE_PREFIX ?? "baileys";
const storageClient = supabase.storage.from(storageBucket);
let waSocket: ReturnType<typeof makeWASocket> | null = null;

const safeUpdateStatus = (updates: Record<string, unknown>) =>
  updateStatus(updates).catch(() => undefined);

const parseConnectedNumber = (jid?: string | null) => {
  if (!jid) return null;
  const base = jid.split("@")[0] ?? "";
  return base.split(":")[0] ?? null;
};

const ensureAuthFolder = () => {
  fs.mkdirSync(authFolder, { recursive: true });
};

const ensureStorageBucket = async () => {
  const { error } = await supabase.storage.createBucket(storageBucket, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
  });
  if (error && !error.message?.includes("already exists")) {
    console.warn("Storage bucket create failed:", error.message);
  }
};

const loadAuthFromStorage = async () => {
  ensureAuthFolder();
  await ensureStorageBucket();
  const { data, error } = await storageClient.list(storagePrefix, { limit: 1000 });
  if (error) {
    console.warn("Failed to list auth files:", error.message);
    return;
  }
  if (!data?.length) return;
  await Promise.all(
    data
      .filter((item) => item.name && !item.name.endsWith("/"))
      .map(async (item) => {
        const filePath = `${storagePrefix}/${item.name}`;
        const download = await storageClient.download(filePath);
        if (download.error || !download.data) {
          console.warn("Failed to download auth file:", filePath);
          return;
        }
        const buffer = Buffer.from(await download.data.arrayBuffer());
        fs.writeFileSync(`${authFolder}/${item.name}`, buffer);
      })
  );
};

const syncAuthToStorage = async () => {
  ensureAuthFolder();
  const entries = fs.readdirSync(authFolder);
  await Promise.all(
    entries.map(async (name) => {
      const content = fs.readFileSync(`${authFolder}/${name}`);
      const path = `${storagePrefix}/${name}`;
      const { error } = await storageClient.upload(path, content, {
        upsert: true,
        contentType: "application/json",
      });
      if (error) {
        console.warn("Failed to upload auth file:", name, error.message);
      }
    })
  );
};

const clearAuthStorage = async () => {
  const { data, error } = await storageClient.list(storagePrefix, { limit: 1000 });
  if (error || !data?.length) return;
  await storageClient.remove(data.map((item) => `${storagePrefix}/${item.name}`));
};

const startWhatsApp = async () => {
  await loadAuthFromStorage();
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["RentalFlow", "Chrome", "1.0.0"],
  });

  socket.ev.on("creds.update", async () => {
    await saveCreds();
    await syncAuthToStorage();
  });

  socket.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      qrcodeTerminal.generate(qr, { small: true });
      const qrCode = await QRCode.toDataURL(qr);
      await safeUpdateStatus({ status: "connecting", qr_code: qrCode, last_error: null });
    }

    if (connection === "open") {
      const connectedNumber = parseConnectedNumber(socket.user?.id);
      await safeUpdateStatus({
        status: "connected",
        connected_number: connectedNumber,
        last_connected_at: new Date().toISOString(),
        qr_code: null,
        last_error: null,
      });
    }

    if (connection === "close") {
      const reasonCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;
      const reasonText =
        reasonCode === DisconnectReason.loggedOut
          ? "Logged out"
          : `Connection closed (${reasonCode ?? "unknown"})`;
      await safeUpdateStatus({ status: "disconnected", last_error: reasonText });
    }
  });

  waSocket = socket;
};

setInterval(() => {
  updateStatus({ heartbeat_at: new Date().toISOString() }).catch(() => undefined);
}, 30_000);

app.get("/api/health", requireToken, async (_req, res) => {
  await updateStatus({ heartbeat_at: new Date().toISOString() });
  return res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(panelHtml);
});

app.get("/api/status", requireToken, async (_req, res) => {
  const { data } = await supabase.from("whatsapp_status").select("*").eq("id", 1).maybeSingle();
  return res.json(data ?? {});
});

app.post("/api/send-otp", requireToken, async (req, res) => {
  const { phoneNumber, message } = req.body ?? {};
  if (!phoneNumber || !message) {
    return res.status(400).json({ message: "phoneNumber and message required." });
  }

  try {
    if (!waSocket || !waSocket.user) {
      return res.status(503).json({ message: "WhatsApp service is not connected." });
    }
    const normalized = String(phoneNumber).replace(/[^\d]/g, "");
    const chatId = `${normalized}@s.whatsapp.net`;
    await waSocket.sendMessage(chatId, { text: message });
    return res.json({ success: true });
  } catch (error) {
    await updateStatus({ last_error: (error as Error).message });
    return res.status(500).json({ message: "Failed to send WhatsApp message." });
  }
});

app.post("/api/control", requireToken, async (req, res) => {
  const { action } = req.body ?? {};
  if (!action) {
    return res.status(400).json({ message: "Action required." });
  }

  if (action === "restart") {
    if (waSocket?.end) waSocket.end();
    await startWhatsApp();
  } else if (action === "logout") {
    if (waSocket?.logout) await waSocket.logout();
    await clearAuthStorage();
  } else if (action === "clear_session") {
    if (waSocket?.logout) await waSocket.logout();
    fs.rmSync(authFolder, { recursive: true, force: true });
    await clearAuthStorage();
    await startWhatsApp();
  } else {
    return res.status(400).json({ message: "Invalid action." });
  }

  return res.json({ success: true });
});

startWhatsApp().catch((error) => {
  console.error("Failed to start WhatsApp", error);
  safeUpdateStatus({ status: "disconnected", last_error: "Failed to start WhatsApp" });
});

app.listen(Number(PORT), () => {
  console.log(`WhatsApp service running on port ${PORT}`);
});
