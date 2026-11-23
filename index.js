const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const axios = require("axios");
const http = require("http");

const API_URL = process.env.API_URL ||
  "https://evil-engine-ui.vercel.app/api/generate";

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Evil GPT WhatsApp Bot is running");
}).listen(process.env.PORT || 3000);

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    browser: ["Evil GPT", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Scan this QR code using WhatsApp:");
      require("qrcode-terminal").generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Evil GPT WhatsApp connected!");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text;

      if (!text) continue;

      try {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "⏳ Evil GPT is thinking..."
        });

        const response = await axios.post(API_URL, {
          prompt: text
        });

        const answer =
          response.data.response || "I couldn't generate a response.";

        await sock.sendMessage(msg.key.remoteJid, {
          text: answer
        });

      } catch (error) {
        console.error(error.message);

        await sock.sendMessage(msg.key.remoteJid, {
          text: "Sorry, something went wrong. Please try again."
        });
      }
    }
  });
}

startBot();
