import "dotenv/config";
import express from "express";
import fs from "node:fs";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import whatsappPkg from "whatsapp-web.js";
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

const { Client, LocalAuth } = whatsappPkg as typeof whatsappPkg;

const candidateExecutablePaths = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/lib/chromium/chromium",
  "/usr/bin/google-chrome-stable",
].filter(Boolean) as string[];

const executablePath = candidateExecutablePaths.find((path) => fs.existsSync(path));
if (executablePath) {
  console.log(`Using Chromium executable at ${executablePath}`);
} else {
  console.warn(
    `Chromium executable not found. Checked: ${candidateExecutablePaths.join(", ")}`
  );
}

const whatsappClient = new Client({
  authStrategy: new LocalAuth({ clientId: "rentalflow" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath,
  },
});

whatsappClient.on("qr", async (qr) => {
  qrcodeTerminal.generate(qr, { small: true });
  const qrCode = await QRCode.toDataURL(qr);
  await updateStatus({ status: "connecting", qr_code: qrCode, last_error: null });
});

whatsappClient.on("ready", async () => {
  const info = whatsappClient.info;
  await updateStatus({
    status: "connected",
    connected_number: info?.wid?.user ?? null,
    last_connected_at: new Date().toISOString(),
    qr_code: null,
    last_error: null,
  });
});

whatsappClient.on("disconnected", async (reason) => {
  await updateStatus({ status: "disconnected", last_error: String(reason) });
});

whatsappClient.on("auth_failure", async (message) => {
  await updateStatus({ status: "disconnected", last_error: String(message) });
});

setInterval(() => {
  updateStatus({ heartbeat_at: new Date().toISOString() }).catch(() => undefined);
}, 30_000);

app.get("/api/health", requireToken, async (_req, res) => {
  await updateStatus({ heartbeat_at: new Date().toISOString() });
  return res.json({ status: "ok" });
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
    const chatId = phoneNumber.includes("@c.us") ? phoneNumber : `${phoneNumber}@c.us`;
    await whatsappClient.sendMessage(chatId, message);
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
    await whatsappClient.destroy();
    await whatsappClient.initialize();
  } else if (action === "logout") {
    await whatsappClient.logout();
  } else if (action === "clear_session") {
    await whatsappClient.logout();
    await whatsappClient.destroy();
    await whatsappClient.initialize();
  } else {
    return res.status(400).json({ message: "Invalid action." });
  }

  return res.json({ success: true });
});

whatsappClient.initialize();

app.listen(Number(PORT), () => {
  console.log(`WhatsApp service running on port ${PORT}`);
});
