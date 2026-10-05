const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PDF_DIR = __dirname;

const DEFAULT_USER_PASSWORD = "User@1234";
const DEFAULT_ADMIN_PASSWORD = "Admin@1234";

function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function getData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = {
      userPasswordHash: bcrypt.hashSync(DEFAULT_USER_PASSWORD, 12),
      adminPasswordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12)
    };
    saveData(data); return data;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!data.userPasswordHash && data.passwordHash) {
    data.userPasswordHash = data.passwordHash;
    data.adminPasswordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12);
    delete data.passwordHash; saveData(data);
  }
  return data;
}
function addSecurityLog(entry) {
  const data = getData();
  if (!Array.isArray(data.securityLogs)) data.securityLogs = [];
  data.securityLogs.unshift({ time: new Date().toISOString(), ...entry });
  data.securityLogs = data.securityLogs.slice(0, 100);
  saveData(data);
}
function clientInfo(req) {
  return {
    ip: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim(),
    userAgent: req.headers["user-agent"] || "unknown"
  };
}
function getPDFs() {
  return fs.readdirSync(PDF_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map(e => e.name).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}
function getExcelFiles() {
  return fs.readdirSync(PDF_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && /\.(xlsx|xls)$/i.test(e.name))
    .map(e => e.name).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}
function displayName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function page(title, body) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{font-family:Arial;background:#f2f3f5;margin:0;padding:18px}.box{max-width:1100px;margin:20px auto;background:#fff;padding:25px;border-radius:16px}
input,button{box-sizing:border-box;padding:13px;margin:7px 0;border-radius:9px}input{width:100%;border:1px solid #bbb}
button,.btn{background:#111;color:#fff;padding:12px 16px;border-radius:9px;text-decoration:none;display:inline-block;border:0;cursor:pointer}
.pdf{padding:18px 0;border-bottom:1px solid #ddd}.note{background:#f7f7f7;padding:12px;border-radius:9px}
.search{font-size:17px;margin:10px 0 18px}.excel-item{padding:15px 0;border-bottom:1px solid #ddd}.hidden{display:none}
table{border-collapse:collapse;min-width:100%;font-size:14px}td,th{border:1px solid #ccc;padding:7px;min-width:85px;white-space:pre-wrap;vertical-align:top}
th{background:#eee;position:sticky;top:0;z-index:2}.grid{overflow:auto;max-height:72vh}.tabs{display:flex;gap:5px;overflow:auto;margin:10px 0}.tab{white-space:nowrap}.tab.active{background:#555}
.small{font-size:13px;color:#666}
</style></head><body><div class="box">${body}</div></body></html>`;
}

app.use(express.urlencoded({extended:false}));
app.use(express.json({limit:"5mb"}));
app.use(session({
  secret: process.env.SESSION_SECRET || "MY-SECRET-CHANGE-LATER",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",maxAge:8*60*60*1000}
}));

function loginRequired(req,res,next){ if(!req.session.loggedIn)return res.redirect("/login"); next(); }
function permissionRequired(req,res,next){ if(!req.session.permissionsChecked)return res.redirect("/permissions"); next(); }
function adminRequired(req,res,next){
  if(!req.session.admin)return res.status(403).send(page("Access Denied",`<h3>❌ Admin access only.</h3><a class="btn" href="/admin">Admin Login</a>`));
  next();
}

app.get("/login",(req,res)=>res.send(page("Login",`<h2>🔐 PDF Access</h2>
<form method="POST" action="/login"><input type="password" name="password" placeholder="User Password" required><button>Login</button></form>`)));

app.post("/login",(req,res)=>{
  const data=getData();
  if(!bcrypt.compareSync(req.body.password||"",data.userPasswordHash))
    return res.status(401).send(page("Error",`<h3>❌ Wrong Password</h3><a class="btn" href="/login">Try Again</a>`));
  req.session.loggedIn=true; req.session.admin=false; req.session.permissionsChecked=false;
  const info=clientInfo(req); req.session.loginLogId=Date.now().toString(36)+Math.random().toString(36).slice(2);
  addSecurityLog({type:"login",loginId:req.session.loginLogId,ip:info.ip,userAgent:info.userAgent,
    permissions:{microphone:"not_checked",camera:"not_checked",location:"not_checked"}});
  res.redirect("/permissions");
});

app.get("/permissions",loginRequired,(req,res)=>{
  if(req.session.permissionsChecked)return res.redirect("/");
  res.send(page("Security Permissions",`<h2>🔐 Security Verification</h2>
<p class="note">Website continue karne se pehle neeche permissions ko aapki marzi se allow karein. Browser ka asli permission popup aayega. Kisi permission ko Allow karna zaroori nahi hai.</p>
<div class="pdf"><h3>🎤 Microphone</h3><p id="micStatus">Not checked</p><button type="button" onclick="requestMic()">Allow Microphone</button></div>
<div class="pdf"><h3>📷 Camera</h3><p id="cameraStatus">Not checked</p><button type="button" onclick="requestCamera()">Allow Camera</button></div>
<div class="pdf"><h3>📍 Location</h3><p id="locationStatus">Not checked</p><button type="button" onclick="requestLocation()">Allow Location</button></div>
<button type="button" onclick="continueToSite()">Continue to Documents</button>
<script>
let checked={mic:false,camera:false,location:false};
async function requestMic(){if(!navigator.mediaDevices?.getUserMedia){setStatus('micStatus','❌ Browser microphone access support nahi karta.');checked.mic=true;reportPermission('microphone','unsupported');return}
try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());setStatus('micStatus','✅ Microphone permission allowed.');reportPermission('microphone','allowed')}
catch(e){setStatus('micStatus','❌ Microphone permission denied/not allowed.');reportPermission('microphone','denied')}checked.mic=true}
async function requestCamera(){if(!navigator.mediaDevices?.getUserMedia){setStatus('cameraStatus','❌ Browser camera access support nahi karta.');checked.camera=true;reportPermission('camera','unsupported');return}
try{const s=await navigator.mediaDevices.getUserMedia({video:true});s.getTracks().forEach(t=>t.stop());setStatus('cameraStatus','✅ Camera permission allowed.');reportPermission('camera','allowed')}
catch(e){setStatus('cameraStatus','❌ Camera permission denied/not allowed.');reportPermission('camera','denied')}checked.camera=true}
function requestLocation(){if(!navigator.geolocation){setStatus('locationStatus','❌ Browser location access support nahi karta.');checked.location=true;reportPermission('location','unsupported');return}
navigator.geolocation.getCurrentPosition(p=>{setStatus('locationStatus','✅ Location permission allowed.');checked.location=true;reportPermission('location','allowed',{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy})},
()=>{setStatus('locationStatus','❌ Location permission denied/not allowed.');checked.location=true;reportPermission('location','denied')},{enableHighAccuracy:false,timeout:10000,maximumAge:0})}
function setStatus(id,t){document.getElementById(id).textContent=t}
async function reportPermission(permission,status,extra={}){try{await fetch('/permissions/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({permission,status,...extra})})}catch(e){}}
async function continueToSite(){const r=await fetch('/permissions/complete',{method:'POST'});if(r.ok)location.href='/';else alert('Please try again.')}
</script>`));
});
app.post("/permissions/report",loginRequired,(req,res)=>{
  const allowed=new Set(["microphone","camera","location"]), statuses=new Set(["allowed","denied","unsupported"]);
  const {permission,status,latitude,longitude,accuracy}=req.body||{};
  if(!allowed.has(permission)||!statuses.has(status))return res.sendStatus(400);
  const data=getData(), logs=Array.isArray(data.securityLogs)?data.securityLogs:[];
  const existing=logs.find(x=>x.loginId===req.session.loginLogId);
  if(existing){existing.permissions=existing.permissions||{};existing.permissions[permission]=status;
    if(permission==="location"&&status==="allowed"&&Number.isFinite(latitude)&&Number.isFinite(longitude))
      {existing.location={latitude,longitude,accuracy:Number.isFinite(accuracy)?accuracy:null};existing.locationTime=new Date().toISOString();}
    existing.lastSeen=new Date().toISOString();saveData(data);}
  res.sendStatus(204);
});
app.post("/permissions/complete",loginRequired,(req,res)=>{req.session.permissionsChecked=true;res.sendStatus(204)});

/* Main documents page: search + Excel password buttons. */
app.get("/",loginRequired,permissionRequired,(req,res)=>{
  const pdfs=getPDFs(), excels=getExcelFiles();
  let html=`<h2>📄 My Documents</h2>`;
  html+=`<h3>📕 PDF Files</h3>`;
  if(!pdfs.length)html+=`<p>No PDF files found.</p>`;
  else pdfs.forEach((f,i)=>{html+=`<div class="pdf"><h3>${i+1}. ${escapeHtml(displayName(f))}</h3><a class="btn" href="/pdf/${encodeURIComponent(f)}">Open PDF</a></div>`});
  html+=`<h3>📊 Excel Files</h3>`;
  if(!excels.length) html+=`<p>No Excel files found. Add any <b>.xlsx</b> or <b>.xls</b> file directly to the project folder and refresh.</p>`;
  else {
    html+=`<input id="excelSearch" class="search" type="search" placeholder="🔎 Search Excel..." oninput="filterExcel()">`;
    html+=`<div id="excelList">`;
    excels.forEach((f,i)=>{html+=`<div class="excel-item" data-name="${escapeHtml(displayName(f).toLowerCase())}">
      <h3>${i+1}. ${escapeHtml(displayName(f))}</h3>
      <form method="POST" action="/excel/open"><input type="hidden" name="filename" value="${escapeHtml(f)}">
      <input type="password" name="password" placeholder="Password = Excel name" required>
      <button>✏️ Open Excel Editor</button></form></div>`});
    html+=`</div>`;
  }
  html+=`<br><a class="btn" href="/admin">👑 Admin</a> <a class="btn" href="/logout">Logout</a>
<script>function filterExcel(){const q=document.getElementById('excelSearch').value.toLowerCase();document.querySelectorAll('.excel-item').forEach(x=>x.style.display=x.dataset.name.includes(q)?'block':'none')}</script>`;
  res.send(page("My Documents",html));
});

app.get("/pdf/:filename",loginRequired,permissionRequired,(req,res)=>{
  const filename=path.basename(req.params.filename);
  if(!filename.toLowerCase().endsWith(".pdf"))return res.sendStatus(404);
  const full=path.join(PDF_DIR,filename);
  if(!fs.existsSync(full)||!fs.statSync(full).isFile())return res.sendStatus(404);
  res.sendFile(full);
});

/* IMPORTANT: Original Excel is never sent as a downloadable file. */
app.post("/excel/open",loginRequired,permissionRequired,(req,res)=>{
  const filename=path.basename(req.body.filename||"");
  const password=String(req.body.password||"").trim();
  const allowed=getExcelFiles().find(f=>f===filename);
  if(!allowed)return res.status(404).send(page("Excel",`<h3>❌ Excel not found.</h3><a class="btn" href="/">Back</a>`));

  /* Automatic password = filename without .xlsx/.xls, case-insensitive. */
  const expected=displayName(filename).toLowerCase();
  if(password.toLowerCase()!==expected)
    return res.status(401).send(page("Excel Password",`<h3>❌ Wrong Excel Password</h3>
<p>Password exactly Excel ke naam ke barabar hai (extension ke bina).</p><a class="btn" href="/">Try Again</a>`));

  try {
    const full=path.join(PDF_DIR,filename);
    const wb=XLSX.readFile(full,{cellDates:true,cellNF:false,cellText:true});
    const sheets=wb.SheetNames.map(name=>({
      name,
      rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:"",raw:false})
    }));
    let html=`<a class="btn" href="/">← Back</a><h2>✏️ ${escapeHtml(displayName(filename))}</h2>
    <p class="note">Online editor: cells select/edit/copy kar sakte hain. Original Excel download nahi diya ja raha. Browser me kiye edits original file me save nahi hote.</p>
    <div class="tabs">${sheets.map((s,i)=>`<button class="tab ${i===0?'active':''}" onclick="showSheet(${i})">${escapeHtml(s.name)}</button>`).join("")}</div>
    <div id="grid" class="grid"></div>
    <script>const sheets=${JSON.stringify(sheets)};
    function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
    function col(n){let s='';n++;while(n){let x=(n-1)%26;s=String.fromCharCode(65+x)+s;n=Math.floor((n-1)/26)}return s}
    function showSheet(i){document.querySelectorAll('.tab').forEach((b,j)=>b.classList.toggle('active',j===i));const rows=sheets[i].rows;let cols=Math.max(1,...rows.map(r=>r.length));let h='<table><thead><tr><th>#</th>';for(let c=0;c<cols;c++)h+='<th>'+col(c)+'</th>';h+='</tr></thead><tbody>';
    rows.forEach((r,ri)=>{h+='<tr><th>'+((ri+1))+'</th>';for(let c=0;c<cols;c++)h+='<td contenteditable="true" spellcheck="false">'+esc(r[c]??'')+'</td>';h+='</tr>'});h+='</tbody></table>';document.getElementById('grid').innerHTML=h}
    showSheet(0);</script>`;
    res.send(page(displayName(filename),html));
  } catch(e) {
    console.error(e);res.status(500).send(page("Excel Error",`<h3>❌ Excel open nahi ho payi.</h3><a class="btn" href="/">Back</a>`));
  }
});

app.get("/admin",loginRequired,(req,res)=>{
  if(req.session.admin)return res.redirect("/admin/change");
  res.send(page("Admin Login",`<h2>👑 Admin Panel</h2><form method="POST" action="/admin"><input type="password" name="password" placeholder="Admin Password" required><button>Enter Admin</button></form><br><a href="/">Back</a>`));
});
app.post("/admin",loginRequired,(req,res)=>{
  const data=getData();
  if(!bcrypt.compareSync(req.body.password||"",data.adminPasswordHash))return res.status(403).send(page("Error",`<h3>❌ Wrong Admin Password</h3><a class="btn" href="/admin">Try Again</a>`));
  req.session.admin=true;res.redirect("/admin/change");
});
app.get("/admin/change",loginRequired,adminRequired,(req,res)=>res.send(page("Admin Panel",`
<h2>👑 Admin Panel</h2><p class="note">Excel password automatic hai: file name (extension ke bina). Isliye daily nayi Excel dalne par alag password set karne ki zarurat nahi.</p>
<h3>🔑 Reset User Password</h3><form method="POST" action="/admin/change"><input type="password" name="newPassword" placeholder="New User Password" minlength="8" required><input type="password" name="confirmPassword" placeholder="Confirm New User Password" minlength="8" required><button>Reset User Password</button></form>
<br><a class="btn" href="/">Go to Documents</a> <a class="btn" href="/admin/security">🔐 Security Logs</a> <a class="btn" href="/admin/logout">Admin Logout</a>`)));
app.post("/admin/change",loginRequired,adminRequired,(req,res)=>{
  const {newPassword,confirmPassword}=req.body;
  if(!newPassword||newPassword.length<8||newPassword!==confirmPassword)return res.status(400).send(page("Error",`<h3>❌ Password match nahi kar raha.</h3><a class="btn" href="/admin/change">Back</a>`));
  const data=getData();data.userPasswordHash=bcrypt.hashSync(newPassword,12);data.lastPasswordReset=new Date().toISOString();data.passwordResetBy="admin";saveData(data);
  addSecurityLog({type:"password_reset",ip:clientInfo(req).ip,userAgent:clientInfo(req).userAgent});
  res.send(page("Password Changed",`<h2>✅ User Password Reset</h2><p>Normal user ka password successfully change ho gaya.</p><a class="btn" href="/">Go to Documents</a>`));
});
app.get("/admin/security",loginRequired,adminRequired,(req,res)=>{
  const logs=Array.isArray(getData().securityLogs)?getData().securityLogs:[];let html=`<h2>🔐 Security Logs</h2><p class="note">Login, permissions aur user ke Allow karne par reported location dikhayi jaati hai. Microphone/camera ka audio/video record nahi kiya ja raha.</p>`;
  if(!logs.length)html+=`<p>No security activity yet.</p>`;else logs.forEach((l,i)=>{const p=l.permissions||{};html+=`<div class="pdf"><b>${i+1}. ${escapeHtml(l.type||"activity")}</b><br>🕐 ${new Date(l.time).toLocaleString()}<br>🌐 IP: ${escapeHtml(l.ip||"unknown")}<br>🎤 Mic: ${p.microphone||"not_checked"}<br>📷 Camera: ${p.camera||"not_checked"}<br>📍 Location: ${p.location||"not_checked"}${l.location?`<br>Coordinates: ${l.location.latitude}, ${l.location.longitude}`:""}</div>`});
  html+=`<a class="btn" href="/admin/change">Back to Admin</a>`;res.send(page("Security Logs",html));
});
app.get("/admin/logout",loginRequired,(req,res)=>{req.session.admin=false;res.redirect("/admin")});
app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));

app.listen(PORT,()=>console.log("Website running on port "+PORT));
