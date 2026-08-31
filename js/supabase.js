/* ============================================================
   Cliente de Supabase + namespace global de la app.
   TODO: reemplazá estos dos valores por los de tu proyecto
   (Supabase → Project Settings → API).
   ============================================================ */

const SUPABASE_URL = 'https://myrmxcknwevoviuobmnu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yVAPEuojURZEUN9VAk6BUA_0dbGgaIG';

// El CDN de supabase-js expone el global `supabase`. Creamos el cliente
// una sola vez y lo compartimos por toda la app en PADDOCK.db
window.PADDOCK = window.PADDOCK || {};
window.PADDOCK.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
