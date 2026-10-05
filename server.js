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

function getPDFs() {
  return fs.readdirSync(PDF_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
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
  res.redirect("/");
});

app.get("/", loginRequired, (req, res) => {
  const pdfs = getPDFs();
  let html = `<h2>📄 My PDF Documents</h2>`;

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

  html += `<br>
    <a class="btn" href="/admin">👑 Admin</a>
    <a class="btn" href="/logout">Logout</a>`;
  res.send(page("My PDFs", html));
});

app.get("/pdf/:filename", loginRequired, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.toLowerCase().endsWith(".pdf")) return res.sendStatus(404);

  const fullPath = path.join(PDF_DIR, filename);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return res.sendStatus(404);

  res.sendFile(fullPath);
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
    <form method="POST" action="/admin/change">
      <input type="password" name="newPassword" placeholder="New User Password" minlength="8" required>
      <input type="password" name="confirmPassword" placeholder="Confirm New User Password" minlength="8" required>
      <button>Reset User Password</button>
    </form>
    <br><a class="btn" href="/">Go to PDFs</a>
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
  saveData(data);

  res.send(page("Password Changed", `
    <h2>✅ User Password Reset</h2>
    <p>Normal user ka password successfully change ho gaya.</p>
    <p>Admin password alag hai aur safe rahega.</p>
    <a class="btn" href="/">Go to PDFs</a>
  `));
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
