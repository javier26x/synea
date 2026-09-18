/**
 * Pone una foto referencial en cada servicio: la baja de Pexels, la sube a
 * Firebase Storage y guarda imageUrl y thumbUrl en el catálogo.
 *
 *   cd ~/synea/scripts && npm install    # si no lo has hecho
 *
 *   # 1) Ver qué haría (NO descarga ni escribe):
 *   node fetch-service-images.mjs
 *
 *   # 2) Si convence, descargar, subir y guardar:
 *   node fetch-service-images.mjs --write
 *
 * OPCIONES
 *   --force            Reemplaza también los servicios que ya tienen foto.
 *                      Sin esto se respetan las que subiste desde el panel.
 *   --only "<texto>"   Solo los servicios cuyo nombre contenga ese texto.
 *
 * LAS FOTOS
 * Van fijadas por id, una por servicio, elegidas y revisadas a ojo. No se
 * buscan al vuelo: una búsqueda a ciegas devuelve cualquier cosa —probando
 * esto salieron pestañas postizas para una extensión de uñas y unas cabañas
 * en un bosque para un masaje—, y además fijarlas evita depender de una API
 * key y hace que dos corridas den el mismo resultado.
 *
 * Son de Pexels, cuya licencia permite uso comercial sin atribución
 * obligatoria; el autor va anotado igual, por si quieres darle crédito.
 *
 * PARA CAMBIAR UNA
 * Lo más rápido es el panel: Servicios > Editar > la foto de arriba. Lo que
 * subas desde ahí manda y este script no lo pisa (salvo --force). Si prefieres
 * otra de Pexels, busca en pexels.com, saca el número de la URL de la foto y
 * cámbialo abajo:
 *   node fetch-service-images.mjs --only "reiki" --write --force
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

// --------------------------------------------------------------------- fotos --
const PHOTOS = {
  // Masoterapia y bienestar
  'Head spa japonés': { id: 36292486, autor: 'KÁ' },
  'Pausa esencial': { id: 6628701, autor: 'KoolShooters' },
  'Armonía vital': { id: 37719545, autor: 'Nothing Ahead' },
  'Alivio profundo': { id: 9146381, autor: 'Ron Lach' },
  'Alivio & calma Synea': { id: 19641816, autor: 'Jonathan Borba' },
  'Equilibrio corporal Synea': { id: 19641818, autor: 'Jonathan Borba' },
  'Liberación muscular Synea': { id: 20860597, autor: 'Funkcinės Terapijos Centras' },
  'Masaje craneal champi': { id: 6628821, autor: 'KoolShooters' },
  'Masaje deportivo pre competencia/entreno': { id: 11349880, autor: 'Towfiqu barbhuiya' },
  'Masaje deportivo post competencia/entreno': { id: 9898722, autor: 'Ekaterina Mitkina' },

  // Manicure
  'Limpieza de uñas': { id: 22668317, autor: 'Kerim Eveyik' },
  'Esmaltado permanente unicolor': { id: 6135696, autor: 'Gabriel Puyén' },
  'Esmaltado permanente francesa/degradé': { id: 34997574, autor: 'Salim Da' },
  'Kapping de polygel/builder gel': { id: 7446915, autor: 'Gustavo Fring' },
  'Extensión soft gel': { id: 6135680, autor: 'Gabriel Puyén' },
  'Extensión de polygel': { id: 34871595, autor: 'Salim Da' },
  'Retiro polygel/builder gel': { id: 7755655, autor: 'RDNE Stock project' },
  'Reparación': { id: 16041439, autor: 'Andrea Mosti' },
  'Retiro esmaltado permanente': { id: 9253758, autor: 'Ron Lach' },
  'Garantía': { id: 18466020, autor: 'The Oluseyi' },

  // Terapias complementarias
  'Acompañamiento terapéutico': { id: 7176298, autor: 'SHVETS production' },
  'Flores de Bach': { id: 19572633, autor: 'Tuğba Öztürk' },
  'Gemoterapia': { id: 4040611, autor: 'Kaboompics' },
  'Reiki': { id: 6998232, autor: 'Arina Krasnikova' },

  // Promociones
  'Esmaltado + perfilado': { id: 3997384, autor: 'cottonbro studio' },
};

// Pexels sirve la imagen ya redimensionada según el ancho que pidas.
const pexelsUrl = (id, w) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;
const pexelsPage = (id) => `https://www.pexels.com/photo/${id}/`;

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

const buscarFoto = (nombre) => {
  const k = Object.keys(PHOTOS).find((n) => norm(n) === norm(nombre));
  return k ? PHOTOS[k] : null;
};

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
  let saltados = 0, sinFoto = 0, fallidos = 0;

  for (const s of servicios) {
    if (s.imageUrl && !force) {
      console.log(`  ya tiene foto   ${s.name}`);
      saltados++;
      continue;
    }
    const foto = buscarFoto(s.name);
    if (!foto) {
      console.log(`  SIN FOTO ASIGNADA  ${s.name}  (agrégala en PHOTOS o súbela desde el panel)`);
      sinFoto++;
      continue;
    }

    console.log(`  ${doWrite ? 'sube        ' : 'pondría     '}${s.name}`);
    console.log(`      ${foto.autor} · ${pexelsPage(foto.id)}`);

    if (!doWrite) continue;
    try {
      const nombreArchivo = `srv_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
      const [imageUrl, thumbUrl] = [
        await subir(pexelsUrl(foto.id, 1200), `uploads/services/${nombreArchivo}.jpg`),
        await subir(pexelsUrl(foto.id, 480), `uploads/services/${nombreArchivo}_thumb.jpg`),
      ];
      updates[`services/${s.id}/imageUrl`] = imageUrl;
      updates[`services/${s.id}/thumbUrl`] = thumbUrl;
    } catch (e) {
      console.log(`  ERROR           ${s.name}: ${e.message}`);
      fallidos++;
    }
  }

  const tocados = Object.keys(updates).length / 2;
  console.log(`\n${servicios.length} servicios · ${saltados} ya tenían foto · ${sinFoto} sin foto asignada · ${fallidos} fallaron`);

  if (!doWrite) {
    console.log('\nSimulación: no se descargó ni se guardó nada.');
    console.log('Para aplicarlo:  node fetch-service-images.mjs --write');
    process.exit(sinFoto || fallidos ? 1 : 0);
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
