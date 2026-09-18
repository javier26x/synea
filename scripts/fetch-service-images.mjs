/**
 * Busca una foto referencial para cada servicio, la sube a Firebase Storage y
 * guarda su URL en el catálogo. Las fotos salen de Pexels, cuya licencia
 * permite uso comercial sin atribución.
 *
 * Hay que correrlo desde un lugar con internet abierto (Cloud Shell sirve).
 *
 * UNA VEZ: consigue una API key gratis en https://www.pexels.com/api/
 *
 *   cd ~/synea/scripts && npm install
 *   export PEXELS_API_KEY="tu_key"
 *
 *   # 1) Ver qué foto elegiría para cada servicio (NO descarga ni escribe):
 *   node fetch-service-images.mjs
 *
 *   # 2) Si convence, descargar, subir y guardar:
 *   node fetch-service-images.mjs --write
 *
 * OPCIONES
 *   --force            Reemplaza también los servicios que ya tienen foto.
 *                      Sin esto se respetan las que subiste desde el panel.
 *   --only "<texto>"   Solo los servicios cuyo nombre contenga ese texto.
 *   --pick <n>         Toma el resultado n de la búsqueda (1 = el primero).
 *                      Útil para reintentar uno suelto que quedó feo.
 *
 * Para cambiar una sola foto suele ser más rápido el panel
 * (Servicios > Editar > Imagen). Este script es para poblar todo de una vez.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import admin from 'firebase-admin';

const DATABASE_URL = 'https://synea-app.firebaseio.com';
const STORAGE_BUCKET = 'synea-app.firebasestorage.app';

// ------------------------------------------------------------------ opciones --
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const doWrite = has('--write');
const force = has('--force');
const only = (val('--only') || '').trim();
const pick = Math.max(1, parseInt(val('--pick')) || 1);

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
if (!PEXELS_API_KEY) {
  console.error('Falta PEXELS_API_KEY. Consigue una gratis en https://www.pexels.com/api/ y luego:');
  console.error('  export PEXELS_API_KEY="tu_key"');
  process.exit(1);
}

// ------------------------------------------------------------------ búsquedas --
// El nombre comercial no sirve para buscar en un banco de fotos: "ALIVIO &
// CALMA SYNEA" no significa nada fuera de Synea. Cada servicio lleva su propio
// término, en inglés porque es donde Pexels tiene más y mejor material.
const QUERIES = {
  // Masoterapia y bienestar
  'HEAD SPA JAPONÉS': 'head spa scalp treatment',
  'PAUSA ESENCIAL': 'back massage spa relaxation',
  'ARMONÍA VITAL': 'shoulder massage therapy',
  'ALIVIO PROFUNDO': 'deep tissue back massage',
  'ALIVIO & CALMA SYNEA': 'full body massage spa table',
  'EQUILIBRIO CORPORAL SYNEA': 'massage therapist hands back',
  'LIBERACIÓN MUSCULAR SYNEA': 'muscle massage therapy clinic',
  'MASAJE CRANEAL CHAMPI': 'head massage relaxation woman',
  'MASAJE DEPORTIVO PRE COMPETENCIA/ENTRENO': 'sports massage athlete leg',
  'MASAJE DEPORTIVO POST COMPETENCIA/ENTRENO': 'athlete recovery massage legs',

  // Manicure
  'LIMPIEZA DE UÑAS': 'manicure nail care hands',
  'ESMALTADO PERMANENTE UNICOLOR': 'gel nail polish manicure',
  'ESMALTADO PERMANENTE FRANCESA/DEGRADE': 'french manicure nails',
  'KAPPING DE POLYGEL/BUILDER GEL': 'nail technician gel nails',
  'EXTENSIÓN SOFT GEL': 'nail extensions salon',
  'EXTENSIÓN DE POLYGEL': 'acrylic nail extensions',
  'RETIRO POLYGEL/BUILDER GEL': 'nail salon manicure tools',
  'REPARACIÓN': 'nail filing manicure closeup',
  'RETIRO ESMALTADO PERMANENTE': 'nail polish remover manicure',
  'GARANTÍA': 'manicured hands nails closeup',

  // Terapias complementarias
  'ACOMPAÑAMIENTO TERAPEUTICO': 'therapy session conversation calm',
  'FLORES DE BACH': 'flower essence dropper bottles',
  'GEMOTERAPIA': 'healing crystals stones',
  'REIKI': 'reiki energy healing hands',

  // Promociones
  'ESMALTADO + PERFILADO': 'manicure gel polish hands salon',
};

// ------------------------------------------------------------------- firebase --
const keyUrl = new URL('./serviceAccountKey.json', import.meta.url);
const initOpts = { databaseURL: DATABASE_URL, storageBucket: STORAGE_BUCKET };
if (existsSync(keyUrl)) initOpts.credential = admin.credential.cert(JSON.parse(readFileSync(keyUrl)));
else initOpts.credential = admin.credential.applicationDefault();
admin.initializeApp(initOpts);
const db = admin.database();
const bucket = admin.storage().bucket();

// -------------------------------------------------------------------- helpers --
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function searchPexels(query, n) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}`
    + `&per_page=${Math.max(n, 5)}&orientation=landscape&size=medium`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
  if (res.status === 429) throw new Error('Pexels devolvió 429: pasaste el límite por hora, espera un rato');
  if (!res.ok) throw new Error(`Pexels devolvió ${res.status} para "${query}"`);
  const data = await res.json();
  return data.photos || [];
}

async function subir(srcUrl, path) {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`No se pudo bajar la imagen (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const token = randomUUID();
  await bucket.file(path).save(buf, {
    contentType: 'image/jpeg',
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      // Es el mismo token que genera getDownloadURL() en el navegador: deja el
      // archivo accesible por URL sin abrir el bucket entero.
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

// ----------------------------------------------------------------------- main --
async function main() {
  const snap = await db.ref('services').get();
  const servicios = Object.entries(snap.val() || {})
    .map(([id, s]) => ({ id, ...s }))
    .filter((s) => s.active !== false)
    .filter((s) => !only || norm(s.name).includes(norm(only)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!servicios.length) {
    console.error(only ? `Ningún servicio activo contiene "${only}".` : 'No hay servicios activos. ¿Corriste seed-catalog.mjs?');
    process.exit(1);
  }

  const updates = {};
  const usadas = new Set();   // una misma foto en dos tarjetas se nota
  let saltados = 0, fallidos = 0;

  for (const s of servicios) {
    if (s.imageUrl && !force) {
      console.log(`  ya tiene foto   ${s.name}`);
      saltados++;
      continue;
    }
    const query = QUERIES[s.name] || s.name;
    try {
      const fotos = await searchPexels(query, pick + 4);
      const foto = fotos.slice(pick - 1).find((f) => !usadas.has(f.id)) || fotos[pick - 1] || fotos[0];
      if (!foto) { console.log(`  SIN RESULTADOS  ${s.name}  («${query}»)`); fallidos++; continue; }
      usadas.add(foto.id);

      console.log(`  ${doWrite ? 'sube        ' : 'elegiría    '}${s.name}`);
      console.log(`      «${query}» · ${foto.photographer} · ${foto.url}`);

      if (doWrite) {
        const id = `srv_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
        const [imageUrl, thumbUrl] = [
          await subir(foto.src.large, `uploads/services/${id}.jpg`),
          await subir(foto.src.medium, `uploads/services/${id}_thumb.jpg`),
        ];
        updates[`services/${s.id}/imageUrl`] = imageUrl;
        updates[`services/${s.id}/thumbUrl`] = thumbUrl;
      }
    } catch (e) {
      console.log(`  ERROR           ${s.name}: ${e.message}`);
      fallidos++;
    }
  }

  const tocados = Object.keys(updates).length / 2;
  console.log(`\n${servicios.length} servicios · ${saltados} ya tenían foto · ${fallidos} fallaron`);

  if (!doWrite) {
    console.log('\nSimulación: no se descargó ni se guardó nada.');
    console.log('Para aplicarlo:  node fetch-service-images.mjs --write');
    process.exit(fallidos ? 1 : 0);
  }

  if (tocados) {
    await db.ref().update(updates);
    console.log(`Guardadas ${tocados} fotos. Revisa la web y cambia desde el panel la que no te guste.`);
  } else {
    console.log('No había nada que guardar.');
  }
  process.exit(fallidos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
