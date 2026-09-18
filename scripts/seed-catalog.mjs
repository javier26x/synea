/**
 * Carga el catálogo inicial de Synea Studio Spa (categorías + servicios) y la
 * configuración base del negocio en la base de datos.
 *
 * USO (en Cloud Shell):
 *   cd ~/synea/scripts && npm install    # si no lo has hecho
 *
 *   # 1) Ver qué se va a crear (NO escribe nada):
 *   node seed-catalog.mjs
 *
 *   # 2) Si está correcto, escribir de verdad:
 *   node seed-catalog.mjs --write
 *
 * Es idempotente: si una categoría o servicio ya existe con el mismo nombre, lo
 * actualiza en vez de duplicarlo. Nunca toca reservas ni disponibilidad.
 *
 * Los servicios marcados `active: false` son los que salieron publicados en
 * AgendaPro sin precio ni duración visibles: quedan cargados pero ocultos en la
 * web hasta que les pongas el valor real desde el panel (Servicios > Editar).
 */

import { readFileSync, existsSync } from 'node:fs';
import admin from 'firebase-admin';

const DATABASE_URL = 'https://synea-app.firebaseio.com';

const doWrite = process.argv.slice(2).includes('--write');

const keyUrl = new URL('./serviceAccountKey.json', import.meta.url);
const initOpts = { databaseURL: DATABASE_URL };
if (existsSync(keyUrl)) initOpts.credential = admin.credential.cert(JSON.parse(readFileSync(keyUrl)));
else initOpts.credential = admin.credential.applicationDefault();
admin.initializeApp(initOpts);
const db = admin.database();

// ---------------------------------------------------------------- catálogo --
// Fuente: ficha pública de Synea Studio Spa en AgendaPro.
// `active: false` = falta confirmar precio/duración reales.
const CATEGORIES = [
  { key: 'peluqueria', name: 'Peluquería', icon: 'fa-cut', order: 1 },
  { key: 'color', name: 'Color', icon: 'fa-paint-brush', order: 2 },
  { key: 'unas', name: 'Uñas', icon: 'fa-hand-sparkles', order: 3 },
  { key: 'cejas', name: 'Cejas y Pestañas', icon: 'fa-eye', order: 4 },
  { key: 'spa', name: 'Masajes y Spa', icon: 'fa-spa', order: 5 },
];

const SERVICES = [
  {
    cat: 'peluqueria', name: 'Corte de pelo', duration: 45, price: 11990, active: true,
    description: 'Corte personalizado según tu tipo de cabello y el estilo que buscas, con lavado y terminación.',
  },
  {
    cat: 'color', name: 'Balayage', duration: 180, price: 70000, active: true,
    description: 'Técnica de coloración que aclara el cabello de forma gradual y personalizada, con un degradado natural.',
  },
  {
    cat: 'color', name: 'Morena Iluminada con papel', duration: 240, price: 50000, active: true,
    description: 'Reflejos trabajados con papel que aportan luz, dimensión y movimiento al cabello moreno. Resultado natural y de bajo mantenimiento.',
  },
  {
    cat: 'color', name: 'Cubrimiento de canas', duration: 120, price: 35000, active: true,
    description: 'Coloración que cubre las canas de forma pareja, respetando tu tono base.',
  },
  {
    cat: 'unas', name: 'Manicure', duration: 30, price: 5000, active: true,
    description: 'Limado, retiro de cutícula e hidratación para dejar tus manos prolijas.',
  },
  {
    cat: 'unas', name: 'Esmaltado permanente', duration: 60, price: 0, active: false,
    description: 'Esmaltado en gel que mantiene el brillo entre 2 y 3 semanas. Incluye preparación de la uña, limado, limpieza de cutícula, aplicación del gel y sellado en lámpara LED/UV.',
  },
  {
    cat: 'unas', name: 'Diseño medio', duration: 45, price: 0, active: false,
    description: 'Diseños con mayor nivel de detalle: combinaciones de colores, degradados o efectos decorativos.',
  },
  {
    cat: 'unas', name: 'Retiro de esmaltado permanente', duration: 30, price: 0, active: false,
    description: 'Retiro cuidadoso del esmaltado permanente, con acondicionamiento de la superficie de la uña e hidratación de cutículas.',
  },
  {
    cat: 'cejas', name: 'Laminado de cejas', duration: 60, price: 0, active: false,
    description: 'Alisa y fija el vello de la ceja hacia arriba para lograr un efecto más poblado y definido.',
  },
  {
    cat: 'spa', name: 'Masaje con piedras calientes', duration: 60, price: 0, active: false,
    description: 'Masaje con piedras calientes para liberar tensión muscular y reducir el estrés.',
  },
];

// ------------------------------------------------------------ configuración --
// Solo se escriben las claves que aún no existan: nunca pisa lo que ya ajustaste
// desde el panel.
const CONFIG = {
  businessName: 'Synea Studio Spa',
  address: 'Bosque de Luz 1581, Puerto Montt, Los Lagos',
  // Lunes a sábado, 10:00 a 20:00 (última hora de inicio 19:00). Domingo cerrado.
  schedule: {
    0: [],
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [
      d, ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
    ])),
  },
};

// ------------------------------------------------------------------ helpers --
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function main() {
  const [catsSnap, svcsSnap, cfgSnap] = await Promise.all([
    db.ref('categories').get(),
    db.ref('services').get(),
    db.ref('config').get(),
  ]);
  const existingCats = catsSnap.val() || {};
  const existingSvcs = svcsSnap.val() || {};
  const existingCfg = cfgSnap.val() || {};

  const findBy = (obj, name) =>
    Object.entries(obj).find(([, v]) => norm(v && v.name) === norm(name))?.[0] || null;

  const updates = {};
  const plan = [];

  // --- categorías ---
  const catIds = {};
  for (const c of CATEGORIES) {
    const id = findBy(existingCats, c.name) || db.ref('categories').push().key;
    catIds[c.key] = id;
    updates[`categories/${id}`] = { name: c.name, icon: c.icon, order: c.order, active: true, isSale: false };
    plan.push(`${findBy(existingCats, c.name) ? 'actualiza' : 'crea    '} categoría  ${c.name}`);
  }

  // --- servicios ---
  for (const s of SERVICES) {
    const id = findBy(existingSvcs, s.name) || db.ref('services').push().key;
    updates[`services/${id}`] = {
      name: s.name,
      duration: s.duration,
      price: s.price,
      description: s.description,
      active: s.active,
      categoryId: catIds[s.cat],
      addons: null,
    };
    const flag = s.active ? '' : '  (oculto: falta precio)';
    plan.push(`${findBy(existingSvcs, s.name) ? 'actualiza' : 'crea    '} servicio   ${s.name}${flag}`);
  }

  // --- configuración (solo lo que falte) ---
  for (const [k, v] of Object.entries(CONFIG)) {
    if (existingCfg[k] === undefined) {
      updates[`config/${k}`] = v;
      plan.push(`crea     config     ${k}`);
    }
  }

  console.log(plan.join('\n'));
  console.log(`\n${Object.keys(updates).length} nodos a escribir.`);

  if (!doWrite) {
    console.log('\nSimulación. Para escribir de verdad: node seed-catalog.mjs --write');
    process.exit(0);
  }

  await db.ref().update(updates);
  console.log('\nListo. Revisa el panel > Servicios y ponle precio a los que quedaron ocultos.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
