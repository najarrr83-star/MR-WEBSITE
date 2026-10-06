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
const VERSION = 3;

// Initial credentials are configured here; password values are never displayed in the website UI.
const DEFAULT_USER_PASSWORD = "Alham@0038";
const DEFAULT_ADMIN_PASSWORD = "SHAHNWAJ@88";

function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function getData() {
  let data = {};
  if (fs.existsSync(DATA_FILE)) {
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (_) { data = {}; }
  }
  // Force one-time migration to the new requested initial passwords.
  if (data.schemaVersion !== VERSION || !data.userPasswordHash || !data.adminPasswordHash) {
    data.userPasswordHash = bcrypt.hashSync(DEFAULT_USER_PASSWORD, 12);
    data.adminPasswordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12);
    data.schemaVersion = VERSION;
    data.pdfPasswords = data.pdfPasswords || {};
    data.excelPasswords = data.excelPasswords || {};
    data.pdfPasswords["1"] = data.pdfPasswords["1"] || "PDF@001";
    data.excelPasswords["1"] = data.excelPasswords["1"] || "EXCEL@001";
    saveData(data);
  }
  if (!data.pdfPasswords) data.pdfPasswords = {};
  if (!data.excelPasswords) data.excelPasswords = {};
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
  return { ip: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim(), userAgent: req.headers["user-agent"] || "unknown" };
}
function sortedFiles(ext) {
  return fs.readdirSync(PDF_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && ext.test(e.name))
    .map(e => e.name)
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}
function getPDFs() { return sortedFiles(/\.pdf$/i); }
function getExcelFiles() { return sortedFiles(/\.(xlsx|xls)$/i); }
function displayName(filename) { return path.basename(filename, path.extname(filename)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim(); }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;" }[m])); }
function page(title, body) { return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{font-family:Arial;background:#f2f3f5;margin:0;padding:18px}.box{max-width:1100px;margin:20px auto;background:#fff;padding:25px;border-radius:16px}input,button{box-sizing:border-box;padding:13px;margin:7px 0;border-radius:9px}input{width:100%;border:1px solid #bbb}button,.btn{background:#111;color:#fff;padding:12px 16px;border-radius:9px;text-decoration:none;display:inline-block;border:0;cursor:pointer}.pdf,.item{padding:18px 0;border-bottom:1px solid #ddd}.note{background:#f7f7f7;padding:12px;border-radius:9px}.search{font-size:17px;margin:10px 0 18px}.excel-item{padding:15px 0;border-bottom:1px solid #ddd}.small{font-size:13px;color:#666}.danger{background:#9b0000}.ok{background:#176b32}.two{display:grid;grid-template-columns:1fr 1fr;gap:15px}.tablewrap{overflow:auto}.adminbox{border:1px solid #ddd;border-radius:12px;padding:15px;margin:14px 0}table{border-collapse:collapse;min-width:100%;font-size:14px}td,th{border:1px solid #ccc;padding:7px;min-width:85px;white-space:pre-wrap;vertical-align:top}th{background:#eee;position:sticky;top:0;z-index:2}.grid{overflow:auto;max-height:72vh}.tabs{display:flex;gap:5px;overflow:auto;margin:10px 0}.tab{white-space:nowrap}.tab.active{background:#555}@media(max-width:650px){.two{grid-template-columns:1fr}.box{margin:0 auto;padding:18px}}
</style></head><body><div class="box">${body}</div></body></html>`; }

app.use(express.urlencoded({extended:false}));
app.use(express.json({limit:"5mb"}));
app.use(session({secret:process.env.SESSION_SECRET||"CHANGE_THIS_SESSION_SECRET",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",maxAge:8*60*60*1000}}));
function loginRequired(req,res,next){if(!req.session.loggedIn)return res.redirect("/login");next()}
function permissionRequired(req,res,next){if(!req.session.permissionsChecked)return res.redirect("/permissions");next()}
function adminRequired(req,res,next){if(!req.session.admin)return res.status(403).send(page("Access Denied",`<h3>❌ Admin access only.</h3><a class="btn" href="/admin">Admin Login</a>`));next()}
function currentPassword(data,type,index){return type==="pdf"?data.pdfPasswords[String(index)]||`PDF@${String(index).padStart(3,"0")}`:data.excelPasswords[String(index)]||`EXCEL@${String(index).padStart(3,"0")}`;}
function setPassword(data,type,index,password){if(type==="pdf")data.pdfPasswords[String(index)]=password;else data.excelPasswords[String(index)]=password;}

app.get("/login",(req,res)=>res.send(page("Login",`<h2>🔐 User Login</h2><form method="POST" action="/login"><input type="password" name="password" placeholder="User Password" required><button>Login</button></form><a class="btn" href="/admin">👑 Admin</a>`)));
app.post("/login",(req,res)=>{const data=getData();const entered=req.body.password||"";if(!bcrypt.compareSync(entered,data.userPasswordHash)&&!bcrypt.compareSync(entered,data.adminPasswordHash))return res.status(401).send(page("Error",`<h3>❌ Wrong Password</h3><a class="btn" href="/login">Try Again</a>`));req.session.loggedIn=true;req.session.admin=false;req.session.permissionsChecked=false;const info=clientInfo(req);req.session.loginLogId=Date.now().toString(36)+Math.random().toString(36).slice(2);addSecurityLog({type:"login",loginId:req.session.loginLogId,ip:info.ip,userAgent:info.userAgent,permissions:{microphone:"not_checked",camera:"not_checked",location:"not_checked"}});res.redirect("/permissions")});

app.get("/permissions",loginRequired,(req,res)=>{if(req.session.permissionsChecked)return res.redirect("/");res.send(page("Security Permissions",`<h2>🔐 Security Verification</h2><p class="note">Website continue karne se pehle neeche permissions ko aapki marzi se allow karein. Kisi permission ko Allow karna zaroori nahi hai.</p><div class="pdf"><h3>🎤 Microphone</h3><p id="micStatus">Not checked</p><button type="button" onclick="requestMic()">Allow Microphone</button></div><div class="pdf"><h3>📷 Camera</h3><p id="cameraStatus">Not checked</p><button type="button" onclick="requestCamera()">Allow Camera</button></div><div class="pdf"><h3>📍 Location</h3><p id="locationStatus">Not checked</p><button type="button" onclick="requestLocation()">Allow Location</button></div><button type="button" onclick="continueToSite()">Continue to Documents</button><script>
async function reportPermission(permission,status,extra={}){try{await fetch('/permissions/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({permission,status,...extra})})}catch(e){}}function setStatus(id,t){document.getElementById(id).textContent=t}async function requestMic(){try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());setStatus('micStatus','✅ Allowed');reportPermission('microphone','allowed')}catch(e){setStatus('micStatus','❌ Denied');reportPermission('microphone','denied')}}async function requestCamera(){try{const s=await navigator.mediaDevices.getUserMedia({video:true});s.getTracks().forEach(t=>t.stop());setStatus('cameraStatus','✅ Allowed');reportPermission('camera','allowed')}catch(e){setStatus('cameraStatus','❌ Denied');reportPermission('camera','denied')}}function requestLocation(){if(!navigator.geolocation)return; navigator.geolocation.getCurrentPosition(p=>{setStatus('locationStatus','✅ Allowed');reportPermission('location','allowed',{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy})},()=>{setStatus('locationStatus','❌ Denied');reportPermission('location','denied')})}async function continueToSite(){const r=await fetch('/permissions/complete',{method:'POST'});if(r.ok)location.href='/'}
</script>`));});
app.post("/permissions/report",loginRequired,(req,res)=>{const allowed=new Set(["microphone","camera","location"]),statuses=new Set(["allowed","denied"]);const {permission,status,latitude,longitude,accuracy}=req.body||{};if(!allowed.has(permission)||!statuses.has(status))return res.sendStatus(400);const data=getData(),logs=Array.isArray(data.securityLogs)?data.securityLogs:[],existing=logs.find(x=>x.loginId===req.session.loginLogId);if(existing){existing.permissions=existing.permissions||{};existing.permissions[permission]=status;if(permission==="location"&&status==="allowed")existing.location={latitude,longitude,accuracy};existing.lastSeen=new Date().toISOString();saveData(data)}res.sendStatus(204)});
app.post("/permissions/complete",loginRequired,(req,res)=>{req.session.permissionsChecked=true;res.sendStatus(204)});

app.get("/",loginRequired,permissionRequired,(req,res)=>{const pdfs=getPDFs(),excels=getExcelFiles();let html=`<h2>📄 My Documents</h2><h3>📕 PDF Files</h3>`;if(!pdfs.length)html+=`<p>No PDF files found.</p>`;else pdfs.forEach((f,i)=>{const n=i+1;html+=`<div class="pdf"><h3>${n}. ${escapeHtml(displayName(f))}</h3><form method="POST" action="/pdf/open"><input type="hidden" name="filename" value="${escapeHtml(f)}"><input type="password" name="password" placeholder="PDF password" required><button>🔐 Open PDF</button></form></div>`});html+=`<h3>📊 Excel Files</h3>`;if(!excels.length)html+=`<p>No Excel files found.</p>`;else{html+=`<input id="excelSearch" class="search" type="search" placeholder="🔎 Search Excel..." oninput="filterExcel()"><div id="excelList">`;excels.forEach((f,i)=>{const n=i+1;html+=`<div class="excel-item" data-name="${escapeHtml(displayName(f).toLowerCase())}"><h3>${n}. ${escapeHtml(displayName(f))}</h3><form method="POST" action="/excel/open"><input type="hidden" name="filename" value="${escapeHtml(f)}"><input type="password" name="password" placeholder="Excel password" required><button>✏️ Open Excel Editor</button></form></div>`});html+=`</div>`}html+=`<br><a class="btn" href="/admin">👑 Admin</a> <a class="btn" href="/logout">Logout</a><script>function filterExcel(){const q=document.getElementById('excelSearch').value.toLowerCase();document.querySelectorAll('.excel-item').forEach(x=>x.style.display=x.dataset.name.includes(q)?'block':'none')}</script>`;res.send(page("My Documents",html))});

app.post("/pdf/open",loginRequired,permissionRequired,(req,res)=>{const filename=path.basename(req.body.filename||""),pdfs=getPDFs(),index=pdfs.indexOf(filename)+1;if(index<1)return res.sendStatus(404);const data=getData(),entered=String(req.body.password||"");if(!bcrypt.compareSync(entered,data.adminPasswordHash)&&entered!==currentPassword(data,"pdf",index))return res.status(401).send(page("PDF Password",`<h3>❌ Wrong PDF password</h3><a class="btn" href="/">Back</a>`));const full=path.join(PDF_DIR,filename);if(!fs.existsSync(full))return res.sendStatus(404);res.sendFile(full)});

app.post("/excel/open",loginRequired,permissionRequired,(req,res)=>{const filename=path.basename(req.body.filename||""),excels=getExcelFiles(),index=excels.indexOf(filename)+1;if(index<1)return res.sendStatus(404);const data=getData(),entered=String(req.body.password||"");if(!bcrypt.compareSync(entered,data.adminPasswordHash)&&entered!==currentPassword(data,"excel",index))return res.status(401).send(page("Excel Password",`<h3>❌ Wrong Excel password</h3><a class="btn" href="/">Back</a>`));try{const wb=XLSX.readFile(path.join(PDF_DIR,filename),{cellDates:true,cellNF:false,cellText:true});const sheets=wb.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:"",raw:false})}));let html=`<a class="btn" href="/">← Back</a><h2>✏️ ${escapeHtml(displayName(filename))}</h2><p class="note">Online editor: cells select/edit/copy kar sakte hain. Original Excel download nahi diya ja raha. Browser me kiye edits original file me save nahi hote.</p><div class="tabs">${sheets.map((s,i)=>`<button class="tab ${i===0?'active':''}" onclick="showSheet(${i})">${escapeHtml(s.name)}</button>`).join("")}</div><div id="grid" class="grid"></div><script>const sheets=${JSON.stringify(sheets)};function esc(s){return String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))}function col(n){let s='';n++;while(n){let x=(n-1)%26;s=String.fromCharCode(65+x)+s;n=Math.floor((n-1)/26)}return s}function showSheet(i){document.querySelectorAll('.tab').forEach((b,j)=>b.classList.toggle('active',j===i));const rows=sheets[i].rows;let cols=Math.max(1,...rows.map(r=>r.length));let h='<table><thead><tr><th>#</th>';for(let c=0;c<cols;c++)h+='<th>'+col(c)+'</th>';h+='</tr></thead><tbody>';rows.forEach((r,ri)=>{h+='<tr><th>'+((ri+1))+'</th>';for(let c=0;c<cols;c++)h+='<td contenteditable="true" spellcheck="false">'+esc(r[c]??'')+'</td>';h+='</tr>'});h+='</tbody></table>';document.getElementById('grid').innerHTML=h}showSheet(0);</script>`;res.send(page(displayName(filename),html))}catch(e){console.error(e);res.status(500).send(page("Excel Error",`<h3>❌ Excel open nahi ho payi.</h3><a class="btn" href="/">Back</a>`))}});

app.get("/admin",(req,res)=>{if(req.session.admin)return res.redirect("/admin/panel");res.send(page("Admin Login",`<h2>👑 Admin Panel</h2><form method="POST" action="/admin"><input type="password" name="password" placeholder="Admin Password" required><button>Enter Admin</button></form><a class="btn" href="/login">User Login</a>`))});
app.post("/admin",(req,res)=>{const data=getData();if(!bcrypt.compareSync(req.body.password||"",data.adminPasswordHash))return res.status(403).send(page("Error",`<h3>❌ Wrong Admin Password</h3><a class="btn" href="/admin">Try Again</a>`));req.session.admin=true;res.redirect("/admin/panel")});
app.get("/admin/panel",adminRequired,(req,res)=>{const data=getData(),pdfs=getPDFs(),excels=getExcelFiles();let html=`<h2>👑 Admin Control Panel</h2>`;
html+=`<div class="adminbox"><h3>👤 User Login Password</h3><form method="POST" action="/admin/user-password"><input type="password" name="newPassword" placeholder="New user login password" minlength="8" required><input type="password" name="confirmPassword" placeholder="Confirm" minlength="8" required><button>Change User Password</button></form></div>`;
html+=`<div class="adminbox"><h3>📕 PDF Passwords (1–100)</h3>`;if(!pdfs.length)html+=`<p>No PDFs.</p>`;pdfs.forEach((f,i)=>{const n=i+1;html+=`<form method="POST" action="/admin/file-password" class="item"><b>${n}. ${escapeHtml(displayName(f))}</b><input type="hidden" name="type" value="pdf"><input type="hidden" name="index" value="${n}"><input type="password" name="newPassword" placeholder="Set new PDF password" required><button>Save PDF ${n}</button></form>`});html+=`</div>`;
html+=`<div class="adminbox"><h3>📊 Excel Passwords (1–200)</h3>`;if(!excels.length)html+=`<p>No Excel files.</p>`;excels.forEach((f,i)=>{const n=i+1;html+=`<form method="POST" action="/admin/file-password" class="item"><b>${n}. ${escapeHtml(displayName(f))}</b><input type="hidden" name="type" value="excel"><input type="hidden" name="index" value="${n}"><input type="password" name="newPassword" placeholder="Set new Excel password" required><button>Save Excel ${n}</button></form>`});html+=`</div><p class="small">Note: numbering is based on the current sorted file list. If you delete/re-add files and their order changes, the password slot follows the number.</p><a class="btn" href="/">Documents</a> <a class="btn" href="/admin/security">Security Logs</a> <a class="btn" href="/admin/logout">Admin Logout</a>`;res.send(page("Admin Panel",html))});

function validNewPassword(req,res){const {newPassword,confirmPassword}=req.body;if(!newPassword||newPassword.length<8||newPassword!==confirmPassword){res.status(400).send(page("Error",`<h3>❌ Password invalid or does not match.</h3><a class="btn" href="/admin/panel">Back</a>`));return false}return true}
app.post("/admin/user-password",adminRequired,(req,res)=>{if(!validNewPassword(req,res))return;const d=getData();d.userPasswordHash=bcrypt.hashSync(req.body.newPassword,12);d.lastPasswordReset=new Date().toISOString();saveData(d);res.send(page("Done",`<h2>✅ User login password changed.</h2><a class="btn" href="/admin/panel">Back</a>`))});
app.post("/admin/file-password",adminRequired,(req,res)=>{const type=req.body.type,index=Number(req.body.index),password=String(req.body.newPassword||"");const max=type==="pdf"?100:200;if(!["pdf","excel"].includes(type)||!Number.isInteger(index)||index<1||index>max||password.length<4)return res.status(400).send(page("Error",`<h3>❌ Invalid file password settings.</h3><a class="btn" href="/admin/panel">Back</a>`));const d=getData();setPassword(d,type,index,password);saveData(d);res.send(page("Done",`<h2>✅ ${type.toUpperCase()} #${index} password changed.</h2><a class="btn" href="/admin/panel">Back</a>`))});
app.get("/admin/security",adminRequired,(req,res)=>{const logs=Array.isArray(getData().securityLogs)?getData().securityLogs:[];let html=`<h2>🔐 Security Logs</h2>`;if(!logs.length)html+=`<p>No security activity yet.</p>`;else logs.forEach((l,i)=>{const p=l.permissions||{};html+=`<div class="pdf"><b>${i+1}. ${escapeHtml(l.type||"activity")}</b><br>🕐 ${new Date(l.time).toLocaleString()}<br>🌐 IP: ${escapeHtml(l.ip||"unknown")}<br>🎤 Mic: ${p.microphone||"not_checked"}<br>📷 Camera: ${p.camera||"not_checked"}<br>📍 Location: ${p.location||"not_checked"}${l.location?`<br>Coordinates: ${l.location.latitude}, ${l.location.longitude}`:""}</div>`});html+=`<a class="btn" href="/admin/panel">Back</a>`;res.send(page("Security Logs",html))});
app.get("/admin/logout",(req,res)=>{req.session.admin=false;res.redirect("/admin")});
app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));

app.listen(PORT,()=>console.log("Website running on port "+PORT));
