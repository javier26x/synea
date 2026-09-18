/**
 * Carga el catálogo de Synea Studio Spa (categorías + servicios) y la
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
 * Fuente: ficha de Synea Studio Spa en AgendaPro. Nombres, precios, duraciones
 * y descripciones son los publicados ahí. La única excepción está marcada con
 * DURACIÓN ESTIMADA más abajo.
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
const CATEGORIES = [
  { key: 'maso', name: 'MASOTERAPIA Y BIENESTAR', icon: 'fa-spa', order: 1 },
  { key: 'mani', name: 'MANICURE', icon: 'fa-hand-sparkles', order: 2 },
  { key: 'terapias', name: 'TERAPIAS COMPLEMENTARIAS Y BIENESTAR ENERGÉTICO', icon: 'fa-yin-yang', order: 3 },
  { key: 'promos', name: 'PROMOCIONES', icon: 'fa-star', order: 4, isSale: true },
];

// Los "SERVICIOS ADICIONALES MANICURE" de AgendaPro no son servicios que se
// agenden solos: son decoración que se suma a un esmaltado. Aquí cuelgan de
// cada servicio de manicure como adicionales opcionales, ordenados de lo más
// simple a lo más elaborado y con los apliques al final. Cada uno suma su
// precio Y sus minutos a la cita.
const MANI_ADDONS = [
  { name: 'Diseño simple (por uña)', duration: 5, price: 500 },
  { name: 'Diseño medio (por uña)', duration: 10, price: 1000 },
  { name: 'Diseño complejo', duration: 15, price: 1500 },
  { name: 'Ojo de gato', duration: 5, price: 1000 },
  { name: 'Degradé / francesa', duration: 15, price: 4000 },
  { name: 'Pedrería', duration: 10, price: 1500 },
  { name: 'Decoración 3D', duration: 15, price: 3000 },
];
const maniAddons = (...excluir) => MANI_ADDONS.filter((a) => !excluir.includes(a.name));

// Lo que cargaron corridas anteriores y ya no va. No se borra (puede haber
// citas que lo referencian por id): se desactiva, y así desaparece de la web.
//   - Los 7 adicionales sueltos, que ahora cuelgan de cada servicio.
//   - El primer catálogo, que estaba equivocado: se armó con datos que los
//     buscadores tenían indexados y traía peluquería y color, que Synea no hace.
const RETIRED_CATEGORIES = [
  'SERVICIOS ADICIONALES MANICURE',
  'Peluquería', 'Color', 'Uñas', 'Cejas y Pestañas', 'Masajes y Spa',
];
const RETIRED_SERVICES = [
  'PEDRERÍA', 'DISEÑO SIMPLE', 'DISEÑO MEDIO', 'DISEÑO COMPLEJO',
  'DECORACIÓN 3D', 'DISEÑO OJO DE GATO', 'DISEÑO DEGRADE/FRANCESA',
  'Corte de pelo', 'Balayage', 'Morena Iluminada con papel',
  'Cubrimiento de canas', 'Manicure', 'Esmaltado permanente',
  'Retiro de esmaltado permanente', 'Laminado de cejas',
  'Masaje con piedras calientes',
];

const SERVICES = [
  // ---- MASOTERAPIA Y BIENESTAR ----
  { cat: 'maso', name: 'HEAD SPA JAPONÉS', duration: 60, price: 34990,
    description: '✨Ritual de bienestar que combina masajes relajantes específicos en el cuero cabelludo, rostro y zona clavicular/hombros, para revitalizar el cabello, aliviar tensiones y brindar una experiencia de relajación completa.✨' },
  { cat: 'maso', name: 'PAUSA ESENCIAL', duration: 50, price: 29990,
    description: '✨Masaje de relajación enfocado en la zona posterior del cuerpo, incluyendo cráneo, espalda, cuello, hombros, brazos y piernas. Libera tensiones, disminuye el estrés y favorece una profunda sensación de bienestar y descanso.✨' },
  { cat: 'maso', name: 'ARMONÍA VITAL', duration: 50, price: 32990,
    description: '✨Combinación de técnicas de masaje relajante y descontracturante, alternando maniobras suaves con presiones más profundas para liberar tensiones musculares, reducir contracturas y proporcionar bienestar integral.✨' },
  { cat: 'maso', name: 'ALIVIO PROFUNDO', duration: 50, price: 34990,
    description: '✨Masaje de presión media a profunda, enfocado en liberar tensiones y contracturas musculares, aliviar molestias y mejorar la movilidad, incluyendo cráneo, cuello, hombros, espalda y piernas posterior.✨' },
  { cat: 'maso', name: 'ALIVIO & CALMA SYNEA', duration: 70, price: 34990,
    description: '✨Masaje suave y envolvente que recorre todo el cuerpo, ayudando a liberar tensiones, disminuir el estrés y promover una profunda sensación de relajación, descanso y bienestar.✨' },
  { cat: 'maso', name: 'EQUILIBRIO CORPORAL SYNEA', duration: 70, price: 37990,
    description: '✨Combinación de técnicas de masaje relajante y descontracturante en todo el cuerpo, alternando maniobras suaves con presiones más profundas para liberar tensiones musculares y reducir contracturas.✨' },
  { cat: 'maso', name: 'LIBERACIÓN MUSCULAR SYNEA', duration: 70, price: 39990,
    description: '✨Masaje de presión media a profunda, enfocado en liberar tensiones y contracturas musculares, aliviar molestias y mejorar la movilidad. Proporciona alivio y bienestar en cuerpo completo.✨' },
  { cat: 'maso', name: 'MASAJE CRANEAL CHAMPI', duration: 30, price: 19990,
    description: '✨Masaje inspirado en la tradición ayurvédica, enfocado en cuero cabelludo, cráneo, cuello y hombros. Ayuda a liberar tensiones, reducir el estrés y proporcionar una profunda sensación de relajación.✨' },
  { cat: 'maso', name: 'MASAJE DEPORTIVO PRE COMPETENCIA/ENTRENO', duration: 45, price: 27990,
    description: '🏃Masaje dinámico y estimulante diseñado para preparar la musculatura antes de la actividad física. Activa la circulación, aumenta la movilidad y prepara el cuerpo para el esfuerzo.🏃‍♀️' },
  { cat: 'maso', name: 'MASAJE DEPORTIVO POST COMPETENCIA/ENTRENO', duration: 60, price: 34990,
    description: '🏃‍♂️Masaje enfocado en relajar y recuperar la musculatura después de la actividad física. Disminuye la tensión muscular, favorece la circulación y acelera la recuperación.🏃‍♀️' },

  // ---- MANICURE ----
  { cat: 'mani', name: 'LIMPIEZA DE UÑAS', duration: 45, price: 13000,
    description: '✨Servicio enfocado en limpiar, dar forma y retirar cuidadosamente el exceso de cutícula, dejando las uñas prolijas, saludables y con una apariencia limpia y cuidada.✨' },
  { cat: 'mani', name: 'ESMALTADO PERMANENTE UNICOLOR', duration: 60, price: 14990, addons: maniAddons(),
    description: '✨Aplicación de un tono de esmalte de larga duración con acabado brillante y uniforme, ideal para mantener las uñas impecables por más tiempo. Incluye base rubber, color y top coat.✨' },
  { cat: 'mani', name: 'ESMALTADO PERMANENTE FRANCESA/DEGRADE', duration: 75, price: 19990, addons: maniAddons('Degradé / francesa'),
    description: '✨Técnicas de esmaltado que aportan un acabado delicado y elegante, ya sea con la clásica punta francesa o con una transición suave de tonos en efecto degradé.✨' },
  { cat: 'mani', name: 'KAPPING DE POLYGEL/BUILDER GEL', duration: 90, price: 22000, addons: maniAddons(),
    description: '✨Técnica que refuerza la uña natural con una capa de builder gel o polygel, aportando mayor resistencia, protección y una apariencia prolija sin necesidad de alargarla.✨' },
  { cat: 'mani', name: 'EXTENSIÓN SOFT GEL', duration: 120, price: 25990, addons: maniAddons(),
    description: '✨Técnica de alargamiento de uñas mediante tips de gel flexible, logrando un acabado natural, liviano y resistente con la forma y largo deseado.✨' },
  { cat: 'mani', name: 'EXTENSIÓN DE POLYGEL', duration: 120, price: 28990, addons: maniAddons(),
    description: '✨Alargamiento de uñas que combina resistencia y flexibilidad, con una pasta que une gel y acrílico para crear la forma y largo deseado con un acabado firme, prolijo y natural.✨' },
  { cat: 'mani', name: 'RETIRO POLYGEL/BUILDER GEL', duration: 45, price: 10000,
    description: '✨Proceso cuidadoso para remover el producto de las uñas de forma segura, protegiendo la uña natural y dejándola limpia y preparada para un nuevo servicio.✨' },
  { cat: 'mani', name: 'REPARACIÓN', duration: 10, price: 3000,
    description: '✨Servicio destinado a reparar una uña quebrada, dañada o debilitada, devolviéndole su forma, resistencia y una apariencia prolija.✨' },
  { cat: 'mani', name: 'RETIRO ESMALTADO PERMANENTE', duration: 30, price: 5000,
    description: '✨Proceso cuidadoso para remover el esmalte permanente de forma segura, protegiendo la uña natural y dejándola limpia y preparada para un nuevo servicio.✨' },
  { cat: 'mani', name: 'GARANTÍA', duration: 30, price: 0,
    description: '✨Servicio destinado a corregir detalles del manicure realizado, como levantamiento o desprendimiento del producto, dentro del período de garantía establecido por el salón.✨' },

  // ---- TERAPIAS COMPLEMENTARIAS Y BIENESTAR ENERGÉTICO ----
  { cat: 'terapias', name: 'ACOMPAÑAMIENTO TERAPEUTICO', duration: 60, price: 25000,
    description: '🤍 Un espacio seguro para detenerte, escucharte y recibir apoyo. A través de una mirada integrativa y cercana, te acompañamos en tu proceso personal para fortalecer tu bienestar emocional y calidad de vida.' },
  { cat: 'terapias', name: 'FLORES DE BACH', duration: 60, price: 30000,
    description: '🌷 Acompaña tu bienestar emocional de forma natural. Esta terapia floral busca ayudarte a gestionar momentos de estrés, cambios o desafíos emocionales, promoviendo equilibrio, calma y bienestar interior.' },
  { cat: 'terapias', name: 'GEMOTERAPIA', duration: 60, price: 29990,
    description: '✨ Conecta con la energía de los cristales a través de una experiencia diseñada para favorecer la armonía y el bienestar integral. Un momento de relajación y conexión personal que invita al equilibrio.' },
  { cat: 'terapias', name: 'REIKI', duration: 60, price: 29990,
    description: '✨ Un espacio para reconectar contigo y encontrar equilibrio interior. Reiki es una terapia energética suave que promueve la relajación profunda, armonizando cuerpo, mente y emociones.' },

  // ---- PROMOCIONES ----
  // DURACIÓN ESTIMADA: AgendaPro publica este paquete sin duración. Los 75 min
  // salen del esmaltado unicolor (60) más el perfilado. Ajústala en el panel.
  { cat: 'promos', name: 'ESMALTADO + PERFILADO', duration: 75, price: 21990, addons: maniAddons(),
    description: 'Paquete de servicios: esmaltado permanente unicolor más perfilado de uñas.' },
];

// ------------------------------------------------------------ configuración --
// Solo se escriben las claves que aún no existan: nunca pisa lo que ya ajustaste
// desde el panel.
const CONFIG = {
  businessName: 'Synea Studio Spa',
  address: 'Bosque de Luz 1581, Puerto Montt, Llanquihue',
  phone: '+56 9 6163 5077',
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
    const prev = findBy(existingCats, c.name);
    const id = prev || db.ref('categories').push().key;
    catIds[c.key] = id;
    updates[`categories/${id}`] = {
      ...(prev ? existingCats[prev] : {}),
      name: c.name, icon: c.icon, order: c.order, active: true, isSale: !!c.isSale,
    };
    plan.push(`${prev ? 'actualiza' : 'crea     '} categoría  ${c.name}`);
  }

  // --- servicios ---
  for (const s of SERVICES) {
    const prev = findBy(existingSvcs, s.name);
    const id = prev || db.ref('services').push().key;
    updates[`services/${id}`] = {
      // Se parte del registro que ya está: si no, una segunda corrida borraría
      // la foto de portada y la miniatura que se subieron desde el panel.
      ...(prev ? existingSvcs[prev] : {}),
      name: s.name,
      duration: s.duration,
      price: s.price,
      description: s.description,
      active: true,
      categoryId: catIds[s.cat],
      addons: s.addons && s.addons.length ? s.addons : null,
    };
    const nAdd = s.addons ? s.addons.length : 0;
    plan.push(`${prev ? 'actualiza' : 'crea     '} servicio   ${s.name}${nAdd ? `  (+${nAdd} adicionales)` : ''}`);
  }

  // Un nombre retirado que siga en el catálogo apagaría un servicio vigente.
  const activos = new Set(SERVICES.map((s) => norm(s.name)));
  const choque = RETIRED_SERVICES.filter((n) => activos.has(norm(n)));
  if (choque.length) {
    console.error('RETIRED_SERVICES choca con el catálogo vigente:', choque.join(', '));
    process.exit(1);
  }

  // --- lo que dejó de ofrecerse: se desactiva, no se borra ---
  for (const name of RETIRED_CATEGORIES) {
    const id = findBy(existingCats, name);
    if (id && existingCats[id].active !== false) {
      updates[`categories/${id}/active`] = false;
      plan.push(`desactiva categoría  ${name}`);
    }
  }
  for (const name of RETIRED_SERVICES) {
    const id = findBy(existingSvcs, name);
    if (id && existingSvcs[id].active !== false) {
      updates[`services/${id}/active`] = false;
      plan.push(`desactiva servicio   ${name}`);
    }
  }

  // --- configuración (solo lo que falte) ---
  for (const [k, v] of Object.entries(CONFIG)) {
    if (existingCfg[k] === undefined) {
      updates[`config/${k}`] = v;
      plan.push(`crea      config     ${k}`);
    }
  }

  console.log(plan.join('\n'));
  console.log(`\n${CATEGORIES.length} categorías · ${SERVICES.length} servicios · ${Object.keys(updates).length} nodos a escribir.`);

  if (!doWrite) {
    console.log('\nSimulación. Para escribir de verdad: node seed-catalog.mjs --write');
    process.exit(0);
  }

  await db.ref().update(updates);
  console.log('\nListo. Revisa el panel > Servicios.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
