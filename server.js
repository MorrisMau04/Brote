try { process.loadEnvFile(); } catch {} // lee el archivo .env si existe
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY || ADMIN_KEY.length < 8 || ADMIN_KEY === "brote1234") {
  console.error("\n[Brote] Falta ADMIN_KEY (mínimo 8 caracteres, distinta de la de ejemplo).\n" +
    "Crea un archivo .env con: ADMIN_KEY=tu-clave-larga  (mira .env.example)\n");
  process.exit(1);
}
const { SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;
const PRECIO = 349;
const ESTADOS = ["Recibido", "Preparando", "Enviado", "Entregado", "Cancelado"];
const PAGOS = ["Transferencia", "Contra entrega"];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "brote.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS Pedidos(
    IdPedido INTEGER PRIMARY KEY AUTOINCREMENT,
    Folio TEXT UNIQUE NOT NULL,
    Nombre TEXT NOT NULL,
    Correo TEXT NOT NULL,
    Telefono TEXT,
    Direccion TEXT NOT NULL,
    Cantidad INTEGER NOT NULL,
    Total REAL NOT NULL,
    Pago TEXT NOT NULL,
    Estado TEXT NOT NULL DEFAULT 'Recibido',
    Fecha TEXT NOT NULL
  )
`);

/* ---------- Correo (Gmail con contraseña de aplicación) ---------- */
const mailer = SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS.replace(/\s/g, "") } })
  : null;
if (!mailer) console.warn("[Brote] Correo desactivado: define SMTP_USER y SMTP_PASS en .env");

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mxn = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 });

async function enviar(to, subject, html) {
  if (!mailer || !to) return;
  try {
    await mailer.sendMail({ from: `"Brote" <${SMTP_USER}>`, to, subject, html });
  } catch (e) {
    console.error("[Brote] No se pudo enviar el correo:", e.message); // un fallo de correo nunca cancela el pedido
  }
}

function avisarPedido(p) {
  const fila = (k, v) => `<tr><td style="padding:4px 14px 4px 0;color:#666">${k}</td><td>${v}</td></tr>`;
  enviar(p.correo, `Tu pedido ${p.folio} en Brote`, `
    <div style="font-family:Arial,sans-serif;max-width:520px;color:#111">
      <h2>¡Gracias por tu pedido, ${esc(p.nombre.split(" ")[0])}! 🌱</h2>
      <p>Recibimos tu pedido. Guarda tu folio para consultar el estado en el sitio:</p>
      <p style="font-size:26px;font-weight:bold;letter-spacing:2px">${p.folio}</p>
      <table>${fila("Kits", p.cantidad)}${fila("Total", mxn(p.total))}${fila("Pago", esc(p.pago))}${fila("Envío a", esc(p.direccion))}</table>
      <p>${p.pago === "Transferencia"
        ? "Te escribiremos pronto con los datos para realizar tu transferencia."
        : "Pagarás en efectivo al recibir tu kit."}</p>
      <p style="color:#666">Equipo Brote</p>
    </div>`);
  enviar(ADMIN_EMAIL || SMTP_USER, `Nuevo pedido ${p.folio} (${p.cantidad} kit${p.cantidad > 1 ? "s" : ""})`, `
    <div style="font-family:Arial,sans-serif;max-width:520px;color:#111">
      <h2>Nuevo pedido ${p.folio}</h2>
      <table>${fila("Nombre", esc(p.nombre))}${fila("Correo", esc(p.correo))}${fila("Teléfono", esc(p.telefono || "—"))}
      ${fila("Dirección", esc(p.direccion))}${fila("Kits", p.cantidad)}${fila("Total", mxn(p.total))}${fila("Pago", esc(p.pago))}</table>
    </div>`);
}

/* ---------- Límites de intentos ---------- */
const limite = (max, mensaje, extra = {}) => rateLimit({
  windowMs: 15 * 60 * 1000, max, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: mensaje }), ...extra,
});
const limPedidos = limite(8, "Demasiados pedidos desde tu conexión. Intenta de nuevo en unos minutos.");
const limConsulta = limite(30, "Demasiadas consultas. Intenta de nuevo en unos minutos.");
const limAdmin = limite(10, "Demasiados intentos fallidos. Espera 15 minutos.", { skipSuccessfulRequests: true });

const app = express();
app.set("trust proxy", 1); // detrás de Render/Railway la IP real viene en el encabezado del proxy
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => res.json({ precio: PRECIO }));

app.post("/api/pedidos", limPedidos, (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  const correo = String(b.correo || "").trim().toLowerCase();
  const telefono = String(b.telefono || "").trim().slice(0, 20);
  const direccion = String(b.direccion || "").trim();
  const cantidad = Number(b.cantidad);
  const pago = String(b.pago || "");

  if (nombre.length < 3 || nombre.length > 100)
    return res.status(400).json({ error: "Escribe tu nombre completo." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))
    return res.status(400).json({ error: "Escribe un correo válido." });
  if (direccion.length < 10 || direccion.length > 300)
    return res.status(400).json({ error: "Escribe una dirección de envío completa." });
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10)
    return res.status(400).json({ error: "La cantidad debe ser de 1 a 10 kits." });
  if (!PAGOS.includes(pago))
    return res.status(400).json({ error: "Elige una forma de pago." });

  const folio = "BR-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const total = cantidad * PRECIO; // el total lo calcula el servidor

  db.prepare(
    `INSERT INTO Pedidos (Folio,Nombre,Correo,Telefono,Direccion,Cantidad,Total,Pago,Fecha)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(folio, nombre, correo, telefono, direccion, cantidad, total, pago, new Date().toISOString());

  res.status(201).json({ folio, total });
  avisarPedido({ folio, nombre, correo, telefono, direccion, cantidad, total, pago }); // sin esperar: no retrasa la respuesta
});

app.get("/api/pedidos/:folio", limConsulta, (req, res) => {
  const p = db
    .prepare("SELECT Folio,Cantidad,Total,Estado FROM Pedidos WHERE Folio=? AND Correo=?")
    .get(req.params.folio.toUpperCase(), String(req.query.correo || "").trim().toLowerCase());
  if (!p) return res.status(404).json({ error: "No encontramos ese pedido. Revisa el folio y el correo." });
  res.json({ folio: p.Folio, cantidad: p.Cantidad, total: p.Total, estado: p.Estado });
});

/* ---------- Administrador ---------- */
function admin(req, res, next) {
  const a = Buffer.from(String(req.get("x-admin-key") || ""));
  const b = Buffer.from(ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: "Clave incorrecta" });
  next();
}

app.use("/api/admin", limAdmin);

app.get("/api/admin/pedidos", admin, (_req, res) => {
  res.json(db.prepare("SELECT * FROM Pedidos ORDER BY IdPedido DESC").all());
});

app.put("/api/admin/pedidos/:id", admin, (req, res) => {
  const estado = req.body && req.body.estado;
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: "Estado inválido" });
  db.prepare("UPDATE Pedidos SET Estado=? WHERE IdPedido=?").run(estado, req.params.id);
  res.json({ ok: true });
});

app.use((_err, _req, res, _next) => res.status(400).json({ error: "Solicitud inválida" }));

app.listen(PORT, () => console.log("Brote corriendo en puerto " + PORT));
