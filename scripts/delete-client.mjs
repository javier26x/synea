/**
 * Elimina reservas de un cliente de la base (por coincidencia de nombre).
 * Pensado para limpiar reservas de prueba.
 *
 * USO (en Cloud Shell):
 *   cd ~/synea/scripts && npm install    # si no lo has hecho
 *
 *   # 1) Ver qué coincide (NO borra nada):
 *   node delete-client.mjs "javier cacha"
 *
 *   # 2) Si lo que sale es correcto, borrar de verdad:
 *   node delete-client.mjs "javier cacha" --delete
 *
 * El término puede ser una o varias palabras: el nombre de la reserva debe
 * contener TODAS (sin distinguir acentos/mayúsculas). Al borrar, también libera
 * el horario en /availability.
 */

import { readFileSync, existsSync } from 'node:fs';
import admin from 'firebase-admin';

const DATABASE_URL = 'https://synea-app-default-rtdb.firebaseio.com';

const args = process.argv.slice(2);
const doDelete = args.includes('--delete');
const query = args.filter(a => a !== '--delete').join(' ').trim();
if (!query) { console.error('Falta el término. Ej: node delete-client.mjs "javier cacha"'); process.exit(1); }

const keyUrl = new URL('./serviceAccountKey.json', import.meta.url);
const initOpts = { databaseURL: DATABASE_URL };
if (existsSync(keyUrl)) initOpts.credential = admin.credential.cert(JSON.parse(readFileSync(keyUrl)));
else initOpts.credential = admin.credential.applicationDefault();
admin.initializeApp(initOpts);
const db = admin.database();

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const digits = query.replace(/\D/g, '');
const isPhone = digits.length >= 8;            // si el t\u00e9rmino es un n\u00famero, busca por tel\u00e9fono
const phoneKey = digits.slice(-9);             // \u00faltimos 9 d\u00edgitos (m\u00f3vil chileno)
const terms = norm(query).split(/\s+/).filter(Boolean);
const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-9);
const matchFn = (a) => isPhone
  ? normPhone(a.clientPhone) === phoneKey
  : terms.every(t => norm(a.clientName).includes(t));

async function main() {
  console.log(isPhone ? `Buscando por tel\u00e9fono (\u2026${phoneKey})` : `Buscando por nombre ("${query}")`);
  const appts = (await db.ref('appointments').get()).val() || {};
  const availability = (await db.ref('availability').get()).val() || {};

  const matches = Object.entries(appts)
    .filter(([, a]) => a && matchFn(a))
    .map(([id, a]) => ({ id, ...a }));

  if (!matches.length) {
    console.log(`Sin coincidencias para "${query}".`);
    process.exit(0);
  }

  console.log(`\nCoincidencias para "${query}" (${matches.length}):\n`);
  for (const m of matches) {
    console.log(`  • ${m.clientName || '(sin nombre)'} | ${m.clientPhone || ''} | ${m.date || '?'} ${m.time || ''} | estado: ${m.status || '?'} | id: ${m.id}`);
  }

  if (!doDelete) {
    console.log(`\n(Modo vista) No se borró nada. Si esto es correcto, repite con --delete:`);
    console.log(`  node delete-client.mjs "${query}" --delete\n`);
    process.exit(0);
  }

  const updates = {};
  for (const m of matches) {
    updates['appointments/' + m.id] = null;
    if (m.date && m.time && availability?.[m.date]?.[m.time] === m.id) {
      updates['availability/' + m.date + '/' + m.time] = null;
    }
  }
  await db.ref().update(updates);
  console.log(`\n✓ Eliminadas ${matches.length} reservas y liberados sus horarios.\n`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
