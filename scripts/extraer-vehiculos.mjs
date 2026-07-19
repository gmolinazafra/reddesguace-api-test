// scripts/extraer-vehiculos.mjs
// ============================================================
// RED DESGUACE · TESTER — Extracción completa de vehículos
// ------------------------------------------------------------
// Barre TODA la API de Metasync (RecuperarCambiosCanalEmpresa,
// misma llamada que sync-metasync.mjs) y genera:
//   - vehiculos_matricula_ktype.csv  (todos los vehículos únicos)
//   - vehiculos_resumen.json         (totales y cobertura)
// Pensado para ejecutarse en GitHub Actions (egress libre).
// Credenciales: la key de SOLO LECTURA ya pública en este repo.
// ============================================================

const MS_API_BASE = 'https://apis.metasync.com';
const APIKEY      = process.env.METASYNC_APIKEY_REDIA    || 'MS-Q17aFd9zFsNW7pDB1XKYjB6YNZmclhXS7';
const IDEMPRESA   = process.env.METASYNC_IDEMPRESA_REDIA || '1225';
const FECHA       = '01/01/2015 00:00:00';
const OFFSET      = 1000;
const PAUSA_MS    = 300;

import { writeFileSync } from 'node:fs';

async function llamarAPI(lastId) {
  const res = await fetch(`${MS_API_BASE}/Almacen/RecuperarCambiosCanalEmpresa`, {
    method: 'GET',
    headers: {
      apikey:    APIKEY,
      fecha:     FECHA,
      lastid:    String(lastId),
      offset:    String(OFFSET),
      idempresa: IDEMPRESA,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function esc(x) {
  const s = (x === null || x === undefined) ? '' : String(x);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const vehiculos = new Map(); // idLocal → objeto
const piezaVeh  = [];        // pares refLocal;idVehiculo (puente pieza→vehículo)
let lastId = 0, pagina = 0, totPiezas = 0, totalAPI = null;

const t0 = Date.now();
for (;;) {
  pagina++;
  let data;
  try {
    data = await llamarAPI(lastId);
  } catch (e) {
    // un reintento por página y seguimos
    console.warn(`Página ${pagina}: ${e.message} — reintento en 3s`);
    await new Promise(r => setTimeout(r, 3000));
    data = await llamarAPI(lastId);
  }
  const { piezas = [], vehiculos: vehs = [], result_set } = data;
  if (totalAPI === null && result_set) totalAPI = result_set.total;

  for (const v of vehs) vehiculos.set(String(v.idLocal), v);
  for (const p of piezas) piezaVeh.push(`${p.refLocal};${p.idVehiculo}`);
  totPiezas += piezas.length;

  if (pagina % 10 === 0) {
    console.log(`Página ${pagina} · piezas ${totPiezas}${totalAPI ? '/' + totalAPI : ''} · vehículos únicos ${vehiculos.size} · ${Math.round((Date.now()-t0)/1000)}s`);
  }

  lastId = result_set ? result_set.lastId : 0;
  if (!result_set || result_set.count === 0 || result_set.count < OFFSET) break;
  await new Promise(r => setTimeout(r, PAUSA_MS));
}

// ── CSV ──
const cab = ['id_local','matricula','bastidor','ktype','codVersion','rvCode','marca','modelo','version','anyo','combustible','estado','fotos'];
const filas = [...vehiculos.values()].map(v => [
  v.idLocal,
  v.matricula,
  v.bastidor,
  v.ktype,
  v.codVersion,
  v.rvCode,
  v.nombreMarca,
  v.nombreModelo,
  v.nombreVersion,
  v.anyoVehiculo,
  v.combustible,
  v.estado,
  (v.urlsImgs || []).length,
].map(esc).join(';'));
writeFileSync('vehiculos_matricula_ktype.csv', '﻿' + cab.join(';') + '\n' + filas.join('\n'));

// ── Puente pieza→vehículo ──
writeFileSync('piezas_vehiculo.csv', 'refLocal;idVehiculo\n' + piezaVeh.join('\n'));

// ── Resumen ──
const lista = [...vehiculos.values()];
const conMatricula = lista.filter(v => v.matricula && String(v.matricula).trim()).length;
const conKtype     = lista.filter(v => v.ktype).length;
const resumen = {
  generado: new Date().toISOString(),
  duracion_s: Math.round((Date.now() - t0) / 1000),
  paginas: pagina,
  piezas_recorridas: totPiezas,
  total_api: totalAPI,
  vehiculos_unicos: lista.length,
  con_matricula: conMatricula,
  con_bastidor: lista.filter(v => v.bastidor && String(v.bastidor).trim()).length,
  con_ktype: conKtype,
  con_matricula_y_ktype: lista.filter(v => v.matricula && String(v.matricula).trim() && v.ktype).length,
  con_codVersion: lista.filter(v => v.codVersion).length,
  con_fotos: lista.filter(v => (v.urlsImgs || []).length > 0).length,
  estados: lista.reduce((a, v) => { const k = String(v.estado); a[k] = (a[k] || 0) + 1; return a; }, {}),
};
writeFileSync('vehiculos_resumen.json', JSON.stringify(resumen, null, 2));

console.log('============================================');
console.log(`Vehículos únicos: ${lista.length} (matrícula ${conMatricula}, ktype ${conKtype})`);
console.log(`Páginas: ${pagina} · Piezas recorridas: ${totPiezas} · ${Math.round((Date.now()-t0)/1000)}s`);
console.log('============================================');
