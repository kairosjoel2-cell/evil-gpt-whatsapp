const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const axios = require("axios");
const QRCode = require("qrcode");
const http = require("http");

const API_URL = process.env.API_URL ||
  "https://evil-engine-ui.vercel.app/api/generate";

let sock;
let connected = false;
let requesting = false;
let isRegistered = false;
let socketStartedAt = 0;
let latestQR = null;

const page = () => `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evil GPT WhatsApp</title>
<style>
body{background:#080d18;color:white;font-family:Arial;text-align:center;padding:45px 15px}
.card{background:#111b2d;padding:25px;border-radius:16px;max-width:360px;margin:auto}
input,button{width:100%;box-sizing:border-box;padding:15px;margin-top:14px;border-radius:9px;border:0;font-size:16px}
input{background:#202d42;color:white}
button{background:#3478f6;color:white;font-weight:bold;cursor:pointer}
button.secondary{background:#26364f}
#code{font-size:30px;letter-spacing:7px;margin:25px 0;color:#70a7ff}
#qrImage{display:none;width:240px;max-width:100%;margin:20px auto;background:white;padding:10px;border-radius:10px}
p{color:#b8c5d8;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<h2>EVIL GPT</h2>
<p>Connect your WhatsApp number</p>
${connected ? "<h3>WhatsApp Connected!</h3>" : `
<input id="phone" placeholder="2348012345678" type="tel">
<button onclick="getCode()">Get Pairing Code</button>
<div id="code"></div>
<p>Or connect by scanning a QR code</p>
<button class="secondary" onclick="showQR()">Get QR Code</button>
<img id="qrImage" alt="WhatsApp connection QR code">
<p id="status">Choose a connection method above.</p>
`}
</div>
<script>
async function getCode(){
 const phone=document.getElementById("phone").value.replace(/\\D/g,"");
 const status=document.getElementById("status");
 const code=document.getElementById("code");
 if(!phone){status.innerText="Enter your WhatsApp number.";return;}
 status.innerText="Generating pairing code...";
 code.innerText="";
 try{
  const r=await fetch("/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone})});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error || "Could not generate code");
  code.innerText=data.code;
  status.innerText="Enter this code immediately in WhatsApp → Linked Devices → Link with phone number.";
 }catch(e){status.innerText=e.message;}
}
let qrTimer;
async function loadQR(){
 const status=document.getElementById("status");
 const qrImage=document.getElementById("qrImage");
 try{
  const r=await fetch("/qr",{cache:"no-store"});
  const data=await r.json();
  if(data.qr){
   qrImage.src=data.qr;
   qrImage.style.display="block";
   status.innerText="Open WhatsApp → Linked Devices → Link a device, then scan this QR code.";
  }else{
   status.innerText=data.status || "Waiting for WhatsApp QR code...";
  }
 }catch(e){status.innerText="Could not load QR code. Please try again.";}
}
function showQR(){
 if(qrTimer) clearInterval(qrTimer);
 document.getElementById("code").innerText="";
 document.getElementById("status").innerText="Requesting QR code...";
 loadQR();
 qrTimer=setInterval(loadQR,2000);
}
</script>
</body>
</html>
`;

http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/qr") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    if (!latestQR) {
      res.end(JSON.stringify({ qr: null, status: connected ? "WhatsApp is already connected." : "Waiting for WhatsApp QR code. Give it a few seconds and try again." }));
      return;
    }
    QRCode.toDataURL(latestQR, { margin: 2, width: 280 })
      .then(qr => res.end(JSON.stringify({ qr })))
      .catch(error => {
        console.error("QR rendering failed:", error.message);
        res.end(JSON.stringify({ qr: null, status: "Could not create QR image. Try again." }));
      });
    return;
  }

  if (req.method === "POST" && req.url === "/pair") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { phone } = JSON.parse(body);
        if (typeof phone !== "string" || !/^\\d{10,15}$/.test(phone)) {
          throw new Error("Use country code, without + or a leading 0.");
        }
        if (!sock) throw new Error("WhatsApp is still starting. Wait 10 seconds and refresh.");
        if (isRegistered || connected) throw new Error("This WhatsApp number is already linked to the bot.");
        if (requesting) throw new Error("A code request is already running. Wait a moment.");
        if (Date.now() - socketStartedAt < 5000) {
          throw new Error("WhatsApp is still initializing. Wait 5 seconds and try again.");
        }

        requesting = true;
        const code = await sock.requestPairingCode(phone);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ code }));
      } catch (e) {
        console.error("Pairing request failed:", e?.message || "Unknown error", "status:", e?.output?.statusCode || "n/a");
        res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        requesting = false;
      }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  res.end(page());
}).listen(process.env.PORT || 3000);

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  isRegistered = Boolean(state.creds.registered);

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "info" }),
    browser: ["Evil GPT", "Chrome", "1.0.0"],
    printQRInTerminal: false
  });
  socketStartedAt = Date.now();

  sock.ev.on("creds.update", async (update) => {
    if (update.registered) isRegistered = true;
    await saveCreds();
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (connection) console.log("WhatsApp connection state:", connection);
    if (qr) {
      latestQR = qr;
      console.log("WhatsApp QR code is ready to scan.");
    }
    if (lastDisconnect?.error) {
      console.error("WhatsApp connection error:", lastDisconnect.error?.message || "Unknown connection error", "status:", lastDisconnect.error?.output?.statusCode || "n/a");
    }
    if (connection === "open") {
      connected = true;
      isRegistered = true;
      latestQR = null;
      console.log("WhatsApp connected!");
    }

    if (connection === "close") {
      connected = false;
      latestQR = null;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        startBot();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;

      const messageText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text;

      if (!messageText) continue;

      try {
        const response = await axios.post(API_URL, { prompt: messageText });
        await sock.sendMessage(msg.key.remoteJid, {
          text: response.data.response || "I couldn't generate a response."
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
