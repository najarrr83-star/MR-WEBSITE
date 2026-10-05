const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PDF_DIR = __dirname;

// First-run defaults. Change the user password from the Admin panel.
const DEFAULT_USER_PASSWORD = "User@1234";
const DEFAULT_ADMIN_PASSWORD = "Admin@1234";

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = {
      userPasswordHash: bcrypt.hashSync(DEFAULT_USER_PASSWORD, 12),
      adminPasswordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12)
    };
    saveData(data);
    return data;
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  // Upgrade the old one-password data.json automatically.
  if (!data.userPasswordHash && data.passwordHash) {
    data.userPasswordHash = data.passwordHash;
    data.adminPasswordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12);
    delete data.passwordHash;
    saveData(data);
  }

  return data;
}

function addSecurityLog(entry) {
  const data = getData();
  if (!Array.isArray(data.securityLogs)) data.securityLogs = [];
  data.securityLogs.unshift({
    time: new Date().toISOString(),
    ...entry
  });
  // Keep the most recent 100 entries.
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
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function getExcelFiles() {
  return fs.readdirSync(PDF_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && /\.(xlsx|xls)$/i.test(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function displayName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(session({
  secret: "MY-SECRET-CHANGE-LATER",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));

function loginRequired(req, res, next) {
  if (!req.session.loggedIn) return res.redirect("/login");
  next();
}

function permissionRequired(req, res, next) {
  if (!req.session.permissionsChecked) return res.redirect("/permissions");
  next();
}

function adminRequired(req, res, next) {
  if (!req.session.admin) {
    return res.status(403).send(page("Access Denied", `
      <h3>❌ Admin access only.</h3>
      <a class="btn" href="/admin">Admin Login</a>
    `));
  }
  next();
}

function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:Arial;background:#f2f3f5;margin:0;padding:25px}
.box{max-width:650px;margin:30px auto;background:white;padding:25px;border-radius:16px}
input,button{width:100%;box-sizing:border-box;padding:13px;margin:7px 0;border-radius:9px}
button,.btn{background:#111;color:white;padding:12px 16px;border-radius:9px;text-decoration:none;display:inline-block;border:0;cursor:pointer}
.pdf{padding:18px 0;border-bottom:1px solid #ddd}
.note{background:#f7f7f7;padding:12px;border-radius:9px}
</style>
</head>
<body><div class="box">${body}</div></body>
</html>`;
}

app.get("/login", (req, res) => {
  res.send(page("Login", `
    <h2>🔐 PDF Access</h2>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="User Password" required>
      <button>Login</button>
    </form>
  `));
});

app.post("/login", (req, res) => {
  const data = getData();
  if (!bcrypt.compareSync(req.body.password || "", data.userPasswordHash)) {
    return res.status(401).send(page("Error", `
      <h3>❌ Wrong Password</h3>
      <a class="btn" href="/login">Try Again</a>
    `));
  }
  req.session.loggedIn = true;
  req.session.admin = false;
  req.session.permissionsChecked = false;
  const info = clientInfo(req);
  req.session.loginLogId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  addSecurityLog({
    type: "login",
    loginId: req.session.loginLogId,
    ip: info.ip,
    userAgent: info.userAgent,
    permissions: { microphone: "not_checked", camera: "not_checked", location: "not_checked" }
  });
  res.redirect("/permissions");
});

app.get("/permissions", loginRequired, (req, res) => {
  if (req.session.permissionsChecked) return res.redirect("/");

  res.send(page("Security Permissions", `
    <h2>🔐 Security Verification</h2>
    <p class="note">Website continue karne se pehle neeche permissions ko aapki marzi se allow karein. Browser ka asli permission popup aayega. Kisi permission ko Allow karna zaroori nahi hai.</p>

    <div class="pdf">
      <h3>🎤 Microphone</h3>
      <p id="micStatus">Not checked</p>
      <button type="button" onclick="requestMic()">Allow Microphone</button>
    </div>

    <div class="pdf">
      <h3>📷 Camera</h3>
      <p id="cameraStatus">Not checked</p>
      <button type="button" onclick="requestCamera()">Allow Camera</button>
    </div>

    <div class="pdf">
      <h3>📍 Location</h3>
      <p id="locationStatus">Not checked</p>
      <button type="button" onclick="requestLocation()">Allow Location</button>
    </div>

    <button type="button" onclick="continueToSite()">Continue to Documents</button>
    <p id="continueNote" class="note" style="display:none">Aapne permissions ko choose kar liya hai. Continue par click karke documents khol sakte hain.</p>

    <script>
      let checked = { mic: false, camera: false, location: false };

      async function requestMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus('micStatus', '❌ Browser microphone access support nahi karta.');
          checked.mic = true;
          reportPermission('microphone', 'unsupported');
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          setStatus('micStatus', '✅ Microphone permission allowed.');
          reportPermission('microphone', 'allowed');
        } catch (err) {
          setStatus('micStatus', '❌ Microphone permission denied/not allowed.');
          reportPermission('microphone', 'denied');
        }
        checked.mic = true;
      }

      async function requestCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus('cameraStatus', '❌ Browser camera access support nahi karta.');
          checked.camera = true;
          reportPermission('camera', 'unsupported');
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach(track => track.stop());
          setStatus('cameraStatus', '✅ Camera permission allowed.');
          reportPermission('camera', 'allowed');
        } catch (err) {
          setStatus('cameraStatus', '❌ Camera permission denied/not allowed.');
          reportPermission('camera', 'denied');
        }
        checked.camera = true;
      }

      function requestLocation() {
        if (!navigator.geolocation) {
          setStatus('locationStatus', '❌ Browser location access support nahi karta.');
          checked.location = true;
          reportPermission('location', 'unsupported');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setStatusAndCheckLocation('✅ Location permission allowed.');
            reportPermission('location', 'allowed', {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            });
          },
          () => {
            setStatusAndCheckLocation('❌ Location permission denied/not allowed.');
            reportPermission('location', 'denied');
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
        );
      }

      function setStatusAndCheckLocation(text) {
        setStatus('locationStatus', text);
        checked.location = true;
      }

      async function reportPermission(permission, status, extra = {}) {
        try {
          await fetch('/permissions/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permission, status, ...extra })
          });
        } catch (e) {
          // Permission UI should still work if reporting fails.
        }
      }

      function setStatus(id, text) {
        document.getElementById(id).textContent = text;
      }

      async function continueToSite() {
        try {
          const response = await fetch('/permissions/complete', { method: 'POST' });
          if (response.ok) {
            window.location.href = '/';
          } else {
            alert('Please try again.');
          }
        } catch (e) {
          alert('Connection error. Please try again.');
        }
      }
    </script>
  `));
});

app.post("/permissions/report", loginRequired, (req, res) => {
  const allowed = new Set(["microphone", "camera", "location"]);
  const statuses = new Set(["allowed", "denied", "unsupported"]);
  const { permission, status, latitude, longitude, accuracy } = req.body || {};
  if (!allowed.has(permission) || !statuses.has(status)) return res.sendStatus(400);

  const data = getData();
  if (!Array.isArray(data.securityLogs)) data.securityLogs = [];
  const existing = data.securityLogs.find(x => x.loginId === req.session.loginLogId);
  if (existing) {
    if (!existing.permissions) existing.permissions = {};
    existing.permissions[permission] = status;
    if (permission === "location" && status === "allowed" && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      existing.location = { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null };
      existing.locationTime = new Date().toISOString();
    }
    existing.lastSeen = new Date().toISOString();
    saveData(data);
  }
  res.sendStatus(204);
});

app.post("/permissions/complete", loginRequired, (req, res) => {
  req.session.permissionsChecked = true;
  res.sendStatus(204);
});

app.get("/", loginRequired, permissionRequired, (req, res) => {
  const pdfs = getPDFs();
  const excels = getExcelFiles();
  let html = `<h2>📄 My Documents</h2>`;

  html += `<h3>📕 PDF Files</h3>`;
  if (!pdfs.length) {
    html += `<p>No PDF files found. Add any <b>.pdf</b> file directly to the project folder and refresh.</p>`;
  } else {
    pdfs.forEach((filename, index) => {
      html += `
        <div class="pdf">
          <h3>${index + 1}. ${displayName(filename)}</h3>
          <a class="btn" href="/pdf/${encodeURIComponent(filename)}">Open PDF</a>
        </div>`;
    });
  }

  html += `<h3>📊 Excel Files</h3>`;
  if (!excels.length) {
    html += `<p>No Excel files found. Add any <b>.xlsx</b> or <b>.xls</b> file directly to the project folder and refresh.</p>`;
  } else {
    excels.forEach((filename, index) => {
      html += `
        <div class="pdf">
          <h3>${index + 1}. ${displayName(filename)}</h3>
          <a class="btn" href="/excel/${encodeURIComponent(filename)}">Download Excel</a>
        </div>`;
    });
  }

  html += `<br>
    <a class="btn" href="/admin">👑 Admin</a>
    <a class="btn" href="/logout">Logout</a>`;
  res.send(page("My Documents", html));
});

app.get("/pdf/:filename", loginRequired, permissionRequired, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.toLowerCase().endsWith(".pdf")) return res.sendStatus(404);

  const fullPath = path.join(PDF_DIR, filename);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return res.sendStatus(404);

  res.sendFile(fullPath);
});

app.get("/excel/:filename", loginRequired, permissionRequired, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/\.(xlsx|xls)$/i.test(filename)) return res.sendStatus(404);

  const fullPath = path.join(PDF_DIR, filename);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return res.sendStatus(404);

  res.download(fullPath, filename);
});

app.get("/admin", loginRequired, (req, res) => {
  if (req.session.admin) return res.redirect("/admin/change");
  res.send(page("Admin Login", `
    <h2>👑 Admin Panel</h2>
    <form method="POST" action="/admin">
      <input type="password" name="password" placeholder="Admin Password" required>
      <button>Enter Admin</button>
    </form>
    <br><a href="/">Back to PDFs</a>
  `));
});

app.post("/admin", loginRequired, (req, res) => {
  const data = getData();
  if (!bcrypt.compareSync(req.body.password || "", data.adminPasswordHash)) {
    return res.status(403).send(page("Error", `
      <h3>❌ Wrong Admin Password</h3>
      <a class="btn" href="/admin">Try Again</a>
    `));
  }
  req.session.admin = true;
  res.redirect("/admin/change");
});

app.get("/admin/change", loginRequired, adminRequired, (req, res) => {
  res.send(page("Admin Panel", `
    <h2>👑 Admin Panel</h2>
    <p class="note">Sirf Admin password se normal user's password reset/change kiya ja sakta hai.</p>
    <h3>🔑 Reset User Password</h3>
    <p class="note">Security ke liye passwords plain text me save nahi hote. Admin reset kare to naya password sirf usi waqt admin ko pata hota hai; baad me database me hash hi rehta hai.</p>
    <form method="POST" action="/admin/change">
      <input type="password" name="newPassword" placeholder="New User Password" minlength="8" required>
      <input type="password" name="confirmPassword" placeholder="Confirm New User Password" minlength="8" required>
      <button>Reset User Password</button>
    </form>
    <br><a class="btn" href="/">Go to PDFs</a>
    <a class="btn" href="/admin/security">🔐 Security Logs</a>
    <a class="btn" href="/admin/logout">Admin Logout</a>
  `));
});

app.post("/admin/change", loginRequired, adminRequired, (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  if (!newPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
    return res.status(400).send(page("Error", `
      <h3>❌ Password match nahi kar raha.</h3>
      <a class="btn" href="/admin/change">Back</a>
    `));
  }

  const data = getData();
  data.userPasswordHash = bcrypt.hashSync(newPassword, 12);
  data.lastPasswordReset = new Date().toISOString();
  data.passwordResetBy = "admin";
  saveData(data);
  addSecurityLog({ type: "password_reset", ip: clientInfo(req).ip, userAgent: clientInfo(req).userAgent });

  res.send(page("Password Changed", `
    <h2>✅ User Password Reset</h2>
    <p>Normal user ka password successfully change ho gaya.</p>
    <p>Admin password alag hai aur safe rahega.</p>
    <a class="btn" href="/">Go to PDFs</a>
  `));
});

app.get("/admin/security", loginRequired, adminRequired, (req, res) => {
  const data = getData();
  const logs = Array.isArray(data.securityLogs) ? data.securityLogs : [];
  let html = `<h2>🔐 Security Logs</h2>
    <p class="note">Yahan login, permission status aur user ke Allow karne par reported location dikhayi jaati hai. Microphone/camera ka audio/video record nahi kiya ja raha.</p>`;

  if (!logs.length) {
    html += `<p>No security activity yet.</p>`;
  } else {
    logs.forEach((log, i) => {
      const p = log.permissions || {};
      const loc = log.location ? `<br>📍 Location: ${log.location.latitude}, ${log.location.longitude} (accuracy ~${Math.round(log.location.accuracy || 0)}m)` : `<br>📍 Location: not reported`;
      html += `<div class="pdf">
        <b>${i + 1}. ${log.type || 'activity'}</b><br>
        🕐 ${new Date(log.time).toLocaleString()}<br>
        🌐 IP: ${log.ip || 'unknown'}<br>
        🎤 Mic: ${p.microphone || 'not_checked'}<br>
        📷 Camera: ${p.camera || 'not_checked'}<br>
        📍 Location permission: ${p.location || 'not_checked'}${loc}
        <br><small>${String(log.userAgent || '').replace(/</g, '&lt;')}</small>
      </div>`;
    });
  }
  html += `<br><a class="btn" href="/admin/change">Back to Admin</a>`;
  res.send(page("Security Logs", html));
});

app.get("/admin/logout", loginRequired, (req, res) => {
  req.session.admin = false;
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.listen(PORT, () => {
  console.log("Website running at http://localhost:" + PORT);
});
