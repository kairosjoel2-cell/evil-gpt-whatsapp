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

let sock;
let connected = false;
let requesting = false;
let isRegistered = false;
let socketStartedAt = 0;

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
#code{font-size:30px;letter-spacing:7px;margin:25px 0;color:#70a7ff}
p{color:#b8c5d8}
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
<p id="status">Enter your number with country code, without +.</p>
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
</script>
</body>
</html>
`;

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/pair") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { phone } = JSON.parse(body);
        if (typeof phone !== "string" || !/^\d{10,15}$/.test(phone)) {
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
    logger: P({ level: "silent" }),
    browser: ["Evil GPT", "Chrome", "1.0.0"],
    printQRInTerminal: false
  });
  socketStartedAt = Date.now();

  sock.ev.on("creds.update", async (update) => {
    if (update.registered) isRegistered = true;
    await saveCreds();
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      connected = true;
      isRegistered = true;
      console.log("WhatsApp connected!");
    }

    if (connection === "close") {
      connected = false;
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
