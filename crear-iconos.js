const fs = require("fs");
const zlib = require("zlib");

function png(n) {
  const fila = 1 + n * 3;
  const raw = Buffer.alloc(fila * n);
  for (let y = 0; y < n; y++) {
    raw[y * fila] = 0;
    for (let x = 0; x < n; x++) {
      // Fondo pergamino + esfera iridiscente (gradiente a 255°, amarillo → rosa → azul → blanco)
      const px = x + 0.5 - n / 2, py = y + 0.5 - n / 2, rad = n * 0.26;
      const cob = Math.max(0, Math.min(1, rad - Math.hypot(px, py) + 0.5));
      const ang = (255 * Math.PI) / 180, dx = Math.sin(ang), dy = -Math.cos(ang);
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (2 * rad * (Math.abs(dx) + Math.abs(dy))) + 0.5));
      const paradas = [[0, [250, 203, 14]], [0.3, [240, 107, 168]], [0.65, [120, 186, 230]], [1, [255, 255, 255]]];
      let i0 = 0; while (i0 < 2 && t > paradas[i0 + 1][0]) i0++;
      const [t0, c0] = paradas[i0], [t1, c1] = paradas[i0 + 1], u = (t - t0) / (t1 - t0);
      const orbe = c0.map((v, k) => v + (c1[k] - v) * u);
      const fondo = [229, 228, 224];
      const color = fondo.map((f, k) => Math.round(f + (orbe[k] - f) * cob));
      raw.set(color, y * fila + 1 + x * 3);
    }
  }
  const trozo = (tipo, datos) => {
    const b = Buffer.alloc(12 + datos.length);
    b.writeUInt32BE(datos.length, 0);
    b.write(tipo, 4, "ascii");
    datos.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + datos.length)), 8 + datos.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(raw)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync("public/icons", { recursive: true });
for (const n of [192, 512]) fs.writeFileSync(`public/icons/icon-${n}.png`, png(n));
console.log("Iconos creados en public/icons");
