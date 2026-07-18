// api/inventario.js
// ============================================================
// RED DESGUACE · TESTER — Proxy de SOLO LECTURA hacia Metasync
// ------------------------------------------------------------
// Vive en el repo reddesguace-api-test, desplegado como proyecto
// PROPIO en Vercel (separado por completo de red-desguace-web).
// GitHub Pages sigue sirviendo el index.html como siempre; este
// proxy solo existe para saltarse el CORS del navegador.
//
// Llamada idéntica a la de sync-metasync.mjs:
//   GET https://apis.metasync.com/Almacen/RecuperarCambiosCanalEmpresa
//   headers: apikey, fecha (dd/mm/yyyy HH:MM:SS), lastid, offset, idempresa
//
// Uso: /api/inventario?lastid=0&offset=1000&fecha=01%2F01%2F2015%2000%3A00%3A00
//
// Variables de entorno del proyecto Vercel del tester:
//   METASYNC_APIKEY_REDIA
//   METASYNC_IDEMPRESA_REDIA
// ============================================================

const MS_API_BASE = 'https://apis.metasync.com';

const ORIGENES_PERMITIDOS = [
  'https://gmolinazafra.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const permitido = ORIGENES_PERMITIDOS.includes(origin)
    ? origin
    : ORIGENES_PERMITIDOS[0];

  res.setHeader('Access-Control-Allow-Origin', permitido);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).json({ error: 'Solo GET' }); return; }

  const apikey    = process.env.METASYNC_APIKEY_REDIA;
  const idempresa = process.env.METASYNC_IDEMPRESA_REDIA;

  if (!apikey || !idempresa) {
    res.status(500).json({ error: 'Faltan METASYNC_APIKEY_REDIA / METASYNC_IDEMPRESA_REDIA en las variables del proyecto Vercel del tester' });
    return;
  }

  // lastid: entero >= 0
  const lastid = String(Math.max(0, parseInt(req.query.lastid || '0', 10) || 0));

  // offset: 1..1000 (tope de la API, mismo valor que usa el sync)
  let offset = parseInt(req.query.offset || '1000', 10);
  if (!Number.isFinite(offset) || offset < 1) offset = 1000;
  if (offset > 1000) offset = 1000;

  // fecha: dd/mm/yyyy [HH:MM:SS] — mismo formato que sync-metasync.mjs
  const fecha = String(req.query.fecha || '01/01/2015 00:00:00').trim();
  if (!/^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}:\d{2})?$/.test(fecha)) {
    res.status(400).json({ error: 'Parámetro fecha inválido. Formato: dd/mm/yyyy HH:MM:SS' });
    return;
  }

  try {
    const r = await fetch(`${MS_API_BASE}/Almacen/RecuperarCambiosCanalEmpresa`, {
      method: 'GET',
      headers: {
        apikey,
        fecha,
        lastid,
        offset: String(offset),
        idempresa,
      },
    });

    const texto = await r.text();

    if (!r.ok) {
      console.warn('[tester-proxy] Metasync', r.status, texto.slice(0, 300));
      res.status(502).json({ error: `Metasync respondió ${r.status}`, detalle: texto.slice(0, 500) });
      return;
    }

    // Respuesta tal cual: { piezas, vehiculos, result_set: { total, count, lastId } }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(texto);

  } catch (err) {
    console.warn('[tester-proxy] Error de conexión:', err.message);
    res.status(502).json({ error: 'No se pudo conectar con la API de Metasync', detalle: err.message });
  }
};
