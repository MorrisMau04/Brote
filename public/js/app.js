const $ = (s) => document.querySelector(s);
const money = (n) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/* PWA: service worker + botón de instalar */
if ("serviceWorker" in navigator)
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
let instalador;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  instalador = e;
  $("#instalar").hidden = false;
});
$("#instalar").onclick = async () => {
  instalador.prompt();
  await instalador.userChoice;
  $("#instalar").hidden = true;
};

/* Menú móvil */
$("#menu").onclick = () => $("#nav").classList.toggle("abierto");
$("#nav").onclick = (e) => { if (e.target.tagName === "A") $("#nav").classList.remove("abierto"); };

/* Galería: usa public/img/galeria-1.jpg ... galeria-6.jpg (si falta alguna, muestra un emoji) */
const emojis = ["🌿","🌱","🍃","🌶️","🌼","🪴"];
$("#fotos").innerHTML = emojis
  .map((e, i) => `<div data-e="${e}"><img src="img/galeria-${i + 1}.jpg" alt="Foto ${i + 1} de Brote" loading="lazy"></div>`)
  .join("");
$("#fotos").querySelectorAll("img").forEach((img) => {
  img.onerror = () => { img.parentElement.textContent = img.parentElement.dataset.e; };
});

/* Precio y total */
let precio = 349;
const total = () => { $("#total").textContent = money(precio * (Number($("#cantidad").value) || 0)); };
fetch("/api/config").then((r) => r.json()).then((c) => {
  precio = c.precio;
  $("#precio").textContent = money(precio);
  total();
}).catch(() => {});
$("#cantidad").oninput = total;

const mensaje = (el, ok, texto) => { el.className = ok ? "ok" : "error"; el.textContent = texto; };

/* Pedido */
$("#form-pedido").onsubmit = async (e) => {
  e.preventDefault();
  const salida = $("#resultado");
  try {
    const r = await fetch("/api/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
    });
    const d = await r.json();
    if (r.ok) {
      mensaje(salida, true, `¡Pedido recibido! Tu folio es ${d.folio}. Total: ${money(d.total)}. Guárdalo para consultar tu envío.`);
      e.target.reset();
      total();
    } else {
      mensaje(salida, false, d.error);
    }
  } catch {
    mensaje(salida, false, "Sin conexión. Intenta de nuevo cuando estés en línea.");
  }
};

/* Seguimiento */
$("#form-seg").onsubmit = async (e) => {
  e.preventDefault();
  const salida = $("#estado");
  const { folio, correo } = Object.fromEntries(new FormData(e.target));
  try {
    const r = await fetch(`/api/pedidos/${encodeURIComponent(folio.trim())}?correo=${encodeURIComponent(correo.trim())}`);
    const d = await r.json();
    if (r.ok) mensaje(salida, true, `Pedido ${d.folio}: ${d.estado} (${d.cantidad} kit(s), ${money(d.total)})`);
    else mensaje(salida, false, d.error);
  } catch {
    mensaje(salida, false, "Sin conexión. Intenta de nuevo cuando estés en línea.");
  }
};
