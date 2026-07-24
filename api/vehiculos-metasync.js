// api/vehiculos-metasync.js
// Proyecto: reddesguace-api-test (Vercel)
// Recibe: GET ?codigos=00492C,04091,06002
// Devuelve: array JSON con los vehículos encontrados en Metasync
// Sin CORS issues porque corre en servidor.

const MS_API_BASE  = 'https://apis.metasync.com';
const MS_APIKEY    = process.env.METASYNC_APIKEY_REDIA;
const MS_IDEMPRESA = process.env.METASYNC_IDEMPRESA_REDIA;
const FECHA_INICIO = '01/01/2015 00:00:00';
const PAGE_SIZE    = 1000;
const PAUSA_MS     = 200;

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
  if (!res.ok) throw new Error(`API Metasync ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String(req.query.codigos || '').trim();
  if (!raw) return res.status(400).json({ error: 'Parámetro codigos requerido' });

  const buscados = new Set(raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean));
  if (buscados.size === 0) return res.status(400).json({ error: 'Sin códigos válidos' });
  if (buscados.size > 200) return res.status(400).json({ error: 'Máximo 200 códigos por llamada' });

  const encontrados = new Map();
  let lastId = 0;
  let paginas = 0;
  const MAX_PAGINAS = 200; // techo de seguridad (~200k piezas)

  try {
    while (encontrados.size < buscados.size && paginas < MAX_PAGINAS) {
      paginas++;
      const data = await llamarAPI(lastId);
      const { piezas = [], vehiculos = [] } = data;

      for (const v of vehiculos) {
        const cod = String(v.codigo || '').trim().toUpperCase();
        if (buscados.has(cod) && !encontrados.has(cod)) {
          encontrados.set(cod, v);
        }
      }

      if (!piezas.length && !vehiculos.length) break;

      // lastId = mayor idLocal de las piezas de esta página
      const ids = piezas.map(p => p.idLocal || 0).filter(Boolean);
      if (!ids.length) break;
      const nuevoLastId = Math.max(...ids);
      if (nuevoLastId <= lastId) break;
      lastId = nuevoLastId;

      if (encontrados.size < buscados.size && paginas < MAX_PAGINAS) {
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
  });
}
