const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "data.json");
const PDF_DIR = path.join(__dirname, "pdfs");

const PDFs = [
  ["CAPITAL KWH MD", "capital.pdf"]
];

function getData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({
        passwordHash: bcrypt.hashSync("ChangeMe123!", 12)
      })
    );
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: "MY-SECRET-CHANGE-LATER",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

function loginRequired(req, res, next) {
  if (!req.session.loggedIn) return res.redirect("/login");
  next();
}

function adminRequired(req, res, next) {
  if (!req.session.admin) return res.status(403).send("Admin access only.");
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
button,.btn{background:#111;color:white;padding:12px 16px;border-radius:9px;text-decoration:none;display:inline-block}
.pdf{padding:18px 0;border-bottom:1px solid #ddd}
</style>
</head>
<body><div class="box">${body}</div></body>
</html>`;
}

app.get("/login", (req, res) => {
  res.send(page("Login", `
    <h2>🔐 PDF Access</h2>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Password" required>
      <button>Login</button>
    </form>
  `));
});

app.post("/login", (req, res) => {
  const data = getData();

  if (!bcrypt.compareSync(req.body.password || "", data.passwordHash)) {
    return res.status(401).send(page("Error", `
      <h3>❌ Wrong Password</h3>
      <a class="btn" href="/login">Try Again</a>
    `));
  }

  req.session.loggedIn = true;
  res.redirect("/");
});

app.get("/", loginRequired, (req, res) => {
  let html = `<h2>📄 My PDF Documents</h2>`;

  PDFs.forEach((pdf, index) => {
    html += `
      <div class="pdf">
        <h3>${pdf[0]}</h3>
        <a class="btn" href="/pdf/${index}">Open PDF</a>
      </div>
    `;
  });

  html += `
    <br>
    <a class="btn" href="/admin">👑 Admin</a>
    <a class="btn" href="/logout">Logout</a>
  `;

  res.send(page("My PDFs", html));
});

app.get("/pdf/:id", loginRequired, (req, res) => {
  const pdf = PDFs[Number(req.params.id)];

  if (!pdf) return res.sendStatus(404);

  res.sendFile(path.join(PDF_DIR, pdf[1]));
});

app.get("/admin", loginRequired, (req, res) => {
  res.send(page("Admin", `
    <h2>👑 Admin Panel</h2>
    <form method="POST" action="/admin">
      <input type="password" name="password" placeholder="Admin Password" required>
      <button>Enter Admin</button>
    </form>
  `));
});

app.post("/admin", loginRequired, (req, res) => {
  const data = getData();

  if (!bcrypt.compareSync(req.body.password || "", data.passwordHash)) {
    return res.status(403).send("Wrong admin password.");
  }

  req.session.admin = true;
  res.redirect("/admin/change");
});

app.get("/admin/change", loginRequired, adminRequired, (req, res) => {
  res.send(page("Change Password", `
    <h2>🔑 Change Password</h2>

    <form method="POST" action="/admin/change">
      <input type="password" name="newPassword" placeholder="New Password" minlength="8" required>
      <input type="password" name="confirmPassword" placeholder="Confirm Password" minlength="8" required>
      <button>Change Password</button>
    </form>
  `));
});

app.post("/admin/change", loginRequired, adminRequired, (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
    return res.status(400).send("Password match nahi kar raha.");
  }

  const data = getData();
  data.passwordHash = bcrypt.hashSync(newPassword, 12);
  saveData(data);

  req.session.admin = false;

  res.send(`
    <h2>✅ Password Changed</h2>
    <p>Ab purana password kaam nahi karega.</p>
    <a href="/">Go to PDFs</a>
  `);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.listen(PORT, () => {
  console.log("Website running at http://localhost:" + PORT);
});