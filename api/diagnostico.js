// api/diagnostico.js
// ============================================================
// RED DESGUACE · TESTER — Diagnóstico de la API de Metasync
// ------------------------------------------------------------
// Llama a RecuperarCambiosCanalEmpresa en el servidor y devuelve
// un RESUMEN compacto (pocas KB) para aprender de la API sin
// descargar el JSON gigante: claves reales, escalas de peso y
// precio, fotos de vehículos, distribución de reserva, etc.
//
// Uso: /api/diagnostico?fecha=17%2F07%2F2026%2000%3A00%3A00&lastid=0&offset=1000
// ============================================================

const MS_API_BASE = 'https://apis.metasync.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const apikey    = process.env.METASYNC_APIKEY_REDIA    || 'MS-Q17aFd9zFsNW7pDB1XKYjB6YNZmclhXS7';
  const idempresa = process.env.METASYNC_IDEMPRESA_REDIA || '1225';

  const fecha  = String(req.query.fecha || '17/07/2026 00:00:00').trim();
  const lastid = String(Math.max(0, parseInt(req.query.lastid || '0', 10) || 0));
  let offset = parseInt(req.query.offset || '1000', 10);
  if (!Number.isFinite(offset) || offset < 1) offset = 1000;
  if (offset > 1000) offset = 1000;

  const t0 = Date.now();
  try {
    const r = await fetch(`${MS_API_BASE}/Almacen/RecuperarCambiosCanalEmpresa`, {
      method: 'GET',
      headers: { apikey, fecha, lastid, offset: String(offset), idempresa },
    });
    const ms = Date.now() - t0;
    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ error: `Metasync ${r.status}`, detalle: t.slice(0, 300), ms });
      return;
    }
    const data = await r.json();
    const piezas    = data.piezas    || [];
    const vehiculos = data.vehiculos || [];

    const keysOf = (arr) => {
      const s = new Set();
      for (const o of arr.slice(0, 300)) Object.keys(o || {}).forEach(k => s.add(k));
      return [...s];
    };

    // ── Pesos ──
    const pesos  = piezas.map(p => p.peso).filter(n => typeof n === 'number');
    const sorted = [...pesos].sort((a, b) => a - b);
    const freq   = {};
    for (const n of pesos) freq[n] = (freq[n] || 0) + 1;
    const masFrecuentes = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12);

    // ── Muestras por palabra clave (para calibrar la escala) ──
    const muestras = {};
    for (const kw of ['PUERTA', 'MOTOR COMPLETO', 'COMPRESOR', 'FARO', 'RETROVISOR', 'ALETA', 'ELECTROVENTILADOR', 'CULATA', 'CAJA CAMBIOS', 'PARAGOLPES']) {
      muestras[kw] = piezas
        .filter(p => (p.descripcionArticulo || '').includes(kw))
        .slice(0, 3)
        .map(p => ({ d: p.descripcionArticulo, peso: p.peso, precio: p.precio, reserva: p.reserva }));
    }

    // ── Vehículos ──
    const vehConFotos = vehiculos.filter(v => Array.isArray(v.urlsImgs) && v.urlsImgs.length > 0);
    const ejemploVeh  = vehiculos[0]
      ? { ...vehiculos[0], urlsImgs: (vehiculos[0].urlsImgs || []).slice(0, 2) }
      : null;
    const ejemploVehConFoto = vehConFotos[0]
      ? { idLocal: vehConFotos[0].idLocal, nombreMarca: vehConFotos[0].nombreMarca, nombreModelo: vehConFotos[0].nombreModelo, urlsImgs: (vehConFotos[0].urlsImgs || []).slice(0, 3) }
      : null;

    res.status(200).json({
      llamada: { fecha, lastid, offset, ms },
      raiz_keys: Object.keys(data),
      result_set: data.result_set ?? null,
      nPiezas: piezas.length,
      nVehiculos: vehiculos.length,
      pieza_keys: keysOf(piezas),
      vehiculo_keys: keysOf(vehiculos),
      vehiculos_con_fotos: vehConFotos.length,
      ejemplo_vehiculo: ejemploVeh,
      ejemplo_vehiculo_con_foto: ejemploVehConFoto,
      pesos: {
        n: pesos.length,
        cero: pesos.filter(n => !n).length,
        min: sorted[0] ?? null,
        max: sorted[sorted.length - 1] ?? null,
        mediana: sorted[Math.floor(sorted.length / 2)] ?? null,
        mas_frecuentes: masFrecuentes,
      },
      precios: {
        negativos: piezas.filter(p => p.precio < 0).length,
        cero: piezas.filter(p => p.precio === 0).length,
        positivos: piezas.filter(p => p.precio > 0).length,
        max: piezas.reduce((m, p) => Math.max(m, p.precio || 0), 0),
      },
      reserva: piezas.reduce((a, p) => { const k = String(p.reserva); a[k] = (a[k] || 0) + 1; return a; }, {}),
      muestras_peso: muestras,
    });
  } catch (err) {
    res.status(502).json({ error: err.message, ms: Date.now() - t0 });
  }
};
