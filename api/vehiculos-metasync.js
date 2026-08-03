// api/vehiculos-metasync.js
// Proyecto: reddesguace-api-test (Vercel)
// Recibe:
//   GET ?codigos=00492C,04091,06002         → busca por código CRVNet (v.codigo)
//   GET ?idlocales=57517,57524              → busca por idLocal Metasync (v.idLocal)
// Ambos parámetros son mutuamente excluyentes; idlocales tiene prioridad si van los dos.
// Devuelve: { encontrados, no_encontrados, paginas_consultadas }

const MS_API_BASE  = 'https://apis.metasync.com';
const MS_APIKEY    = process.env.METASYNC_APIKEY_REDIA;
const MS_IDEMPRESA = process.env.METASYNC_IDEMPRESA_REDIA;
const FECHA_INICIO = '01/01/2015 00:00:00';
const PAGE_SIZE    = 1000;
const PAUSA_MS     = 250;

export const config = { maxDuration: 60 };

async function llamarAPI(lastId) {
  const res = await fetch(`${MS_API_BASE}/Almacen/RecuperarCambiosCanalEmpresa`, {
    method: 'GET',
    headers: {
      apikey:    MS_APIKEY,
      fecha:     FECHA_INICIO,
      lastid:    String(lastId),
      offset:    String(PAGE_SIZE),
      idempresa: MS_IDEMPRESA,
    },
  });
  if (!res.ok) throw new Error(`API Metasync ${res.status}: ${(await res.text()).slice(0,200)}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Detectar modo: idlocales (Metasync) o codigos (CRVNet)
  const rawIdlocales = String(req.query.idlocales || '').trim();
  const rawCodigos   = String(req.query.codigos   || '').trim();

  const modoIdlocal = rawIdlocales.length > 0;
  const raw = modoIdlocal ? rawIdlocales : rawCodigos;

  if (!raw) return res.status(400).json({ error: 'Parámetro codigos o idlocales requerido' });

  // Parsear según modo
  const buscados = new Set(
    raw.split(',')
      .map(c => modoIdlocal ? String(parseInt(c.trim(), 10)) : c.trim().toUpperCase())
      .filter(Boolean)
  );
  if (buscados.size === 0) return res.status(400).json({ error: 'Sin valores válidos' });
  if (buscados.size > 200) return res.status(400).json({ error: 'Máximo 200 valores por llamada' });

  const encontrados = new Map();
  let lastId = 0;
  let paginas = 0;
  const MAX_PAGINAS = 200;

  try {
    while (encontrados.size < buscados.size && paginas < MAX_PAGINAS) {
      paginas++;
      const data = await llamarAPI(lastId);
      const { vehiculos = [], result_set } = data;

      for (const v of vehiculos) {
        // La clave de búsqueda cambia según el modo
        const clave = modoIdlocal
          ? String(v.idLocal ?? '')
          : String(v.codigo || '').trim().toUpperCase();

        if (clave && buscados.has(clave) && !encontrados.has(clave)) {
          encontrados.set(clave, v);
        }
      }

      if (!result_set || result_set.count === 0 || result_set.count < PAGE_SIZE) break;
      const nuevoLastId = result_set.lastId;
      if (!nuevoLastId || nuevoLastId <= lastId) break;
      lastId = nuevoLastId;

      if (encontrados.size < buscados.size) {
        await new Promise(r => setTimeout(r, PAUSA_MS));
      }
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  const noEncontrados = [...buscados].filter(c => !encontrados.has(c));

  return res.status(200).json({
    encontrados: [...encontrados.values()],
    no_encontrados: noEncontrados,
    paginas_consultadas: paginas,
    modo: modoIdlocal ? 'idlocal' : 'codigo',
  });
}
