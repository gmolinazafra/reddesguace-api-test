// api/vehiculos-metasync.js
// Proyecto: reddesguace-api-test (Vercel)
// Recibe: GET ?codigos=00492C,04091&desde=2026-07-01
//     o bien ?codigos=...&dias=30   (dias=0 → todo el histórico)
// Devuelve: array JSON con los vehículos encontrados en Metasync
//
// ============================================================
// 2026-07-25 · Tres correcciones que explican el "Failed to fetch"
// y el consumo desbocado de Vercel:
//
// 1) COMPARACIÓN DE CÓDIGOS. Se comparaban tal cual, pero Metasync
//    devuelve "6757" donde el desguace tiene "06757". Al no coincidir
//    nunca, el proxy recorría las 171 páginas del inventario completo,
//    agotaba los 60s y moría. Cada búsqueda fallida costaba una
//    invocación de un minuto. Ahora se comparan sin ceros a la
//    izquierda.
//
// 2) FILTRO POR FECHA. La API no permite pedir un vehículo por código:
//    solo paginación secuencial. Pero un coche recién dado de alta
//    tiene fechaMod reciente, así que acotando la fecha se pasa de 171
//    páginas a una o dos. Por defecto 30 días, que cubre el caso real
//    ("acaba de entrar un coche"). Con dias=0 se busca en todo el
//    histórico, que es caro y solo debería usarse a sabiendas.
//
// 3) PÁGINAS ACOTADAS POR INVOCACIÓN. Antes hasta 200 páginas en una
//    sola petición, garantizando el timeout. Ahora un máximo de 25 y,
//    si no ha terminado, devuelve `siguiente_lastid` para que el
//    cliente continúe en otra llamada corta. Nunca se agota el tiempo.
// ============================================================

const MS_API_BASE  = 'https://apis.metasync.com';
const MS_APIKEY    = process.env.METASYNC_APIKEY_REDIA;
const MS_IDEMPRESA = process.env.METASYNC_IDEMPRESA_REDIA;
const PAGE_SIZE    = 1000;
const PAUSA_MS     = 250;
const MAX_PAGINAS_POR_LLAMADA = 25;

export const config = { maxDuration: 60 };

// Metasync espera dd/MM/yyyy HH:mm:ss
function fmtFecha(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// "06757" y "6757" son el mismo vehículo: se ignoran los ceros de la
// izquierda y las mayúsculas.
function normCodigo(s) {
  return String(s ?? '').trim().toUpperCase().replace(/^0+/, '');
}

async function llamarAPI(lastId, fecha) {
  const res = await fetch(`${MS_API_BASE}/Almacen/RecuperarCambiosCanalEmpresa`, {
    method: 'GET',
    headers: {
      apikey:    MS_APIKEY,
      fecha,
      lastid:    String(lastId),
      offset:    String(PAGE_SIZE),
      idempresa: MS_IDEMPRESA,
    },
  });
  if (!res.ok) throw new Error(`API Metasync ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String(req.query.codigos || '').trim();
  if (!raw) return res.status(400).json({ error: 'Parámetro codigos requerido' });

  // Mapa normalizado -> código tal cual lo escribió el usuario, para
  // poder informar de los no encontrados con su formato original.
  const buscados = new Map();
  for (const c of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    buscados.set(normCodigo(c), c);
  }
  if (buscados.size === 0) return res.status(400).json({ error: 'Sin códigos válidos' });
  if (buscados.size > 50)  return res.status(400).json({ error: 'Máximo 50 códigos por llamada' });

  // Ventana temporal. Dos formas de indicarla:
  //   desde=YYYY-MM-DD  → fecha exacta elegida por el usuario
  //   dias=N            → N días hacia atrás (0 = todo el histórico)
  // Si no llega ninguna, por defecto 30 días.
  let fecha;
  let ventana;
  const desde = String(req.query.desde || '').trim();

  if (desde) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desde);
    if (!m) return res.status(400).json({ error: 'Parámetro desde inválido (formato YYYY-MM-DD)' });
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Fecha desde inválida' });
    fecha = fmtFecha(d);
    ventana = `desde ${desde}`;
  } else {
    const diasParam = req.query.dias === undefined ? '30' : String(req.query.dias);
    const dias = Number(diasParam);
    if (Number.isNaN(dias) || dias < 0) {
      return res.status(400).json({ error: 'Parámetro dias inválido' });
    }
    if (dias === 0) {
      fecha = '01/01/2015 00:00:00';
      ventana = 'todo el histórico';
    } else {
      const d = new Date();
      d.setDate(d.getDate() - dias);
      fecha = fmtFecha(d);
      ventana = `últimos ${dias} días`;
    }
  }

  // Continuación de una búsqueda anterior
  let lastId = Number(req.query.lastid || 0);
  if (Number.isNaN(lastId) || lastId < 0) lastId = 0;

  const encontrados = new Map();
  let paginas = 0;
  let agotado = false;

  try {
    while (encontrados.size < buscados.size && paginas < MAX_PAGINAS_POR_LLAMADA) {
      paginas++;
      const data = await llamarAPI(lastId, fecha);
      const { vehiculos = [], result_set } = data;

      for (const v of vehiculos) {
        const cod = normCodigo(v.codigo);
        if (buscados.has(cod) && !encontrados.has(cod)) {
          encontrados.set(cod, v);
        }
      }

      if (!result_set || result_set.count === 0 || result_set.count < PAGE_SIZE) {
        agotado = true;
        break;
      }
      const nuevoLastId = result_set.lastId;
      if (!nuevoLastId || nuevoLastId <= lastId) {
        agotado = true;
        break;
      }
      lastId = nuevoLastId;

      if (encontrados.size < buscados.size) {
        await new Promise((r) => setTimeout(r, PAUSA_MS));
      }
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  const completo = encontrados.size === buscados.size || agotado;
  const noEncontrados = [...buscados.entries()]
    .filter(([norm]) => !encontrados.has(norm))
    .map(([, original]) => original);

  return res.status(200).json({
    encontrados: [...encontrados.values()],
    no_encontrados: completo ? noEncontrados : [],
    paginas_consultadas: paginas,
    desde_fecha: fecha,
    ventana,
    completo,
    // Si completo=false, volver a llamar con este lastid para continuar.
    siguiente_lastid: completo ? null : lastId,
  });
}
