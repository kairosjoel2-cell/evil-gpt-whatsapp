
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const axios = require("axios");
const http = require("http");
const QRCode = require("qrcode");

const API_URL = process.env.API_URL ||
  "https://evil-engine-ui.vercel.app/api/generate";

let qrImage = "";
let connected = false;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });

  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Evil GPT WhatsApp</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          background: #080d18;
          color: white;
          font-family: Arial;
          text-align: center;
          padding: 40px 15px;
        }
        .card {
          background: #111b2d;
          padding: 25px;
          border-radius: 16px;
          max-width: 350px;
          margin: auto;
        }
        img {
          width: 100%;
          max-width: 280px;
          background: white;
          border-radius: 10px;
        }
        p { color: #b8c5d8; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>EVIL GPT</h2>
        <p>${connected ? "WhatsApp Connected!" : "Scan with WhatsApp to connect"}</p>
        ${connected ? "" : qrImage ? `<img src="${qrImage}">` : "<p>Waiting for QR code...</p>"}
        <p>WhatsApp → Linked Devices → Link a Device</p>
      </div>
    </body>
    </html>
  `);
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

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrImage = await QRCode.toDataURL(qr);
      console.log("QR code ready on the website.");
    }

    if (connection === "open") {
      connected = true;
      qrImage = "";
      console.log("Evil GPT WhatsApp connected!");
    }

    if (connection === "close") {
      connected = false;

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
