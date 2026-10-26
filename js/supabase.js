/* ============================================================
   Cliente de Supabase + namespace global de la app.
   TODO: reemplazá estos dos valores por los de tu proyecto
   (Supabase → Project Settings → API).
   ============================================================ */

const SUPABASE_URL = 'https://myrmxcknwevoviuobmnu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yVAPEuojURZEUN9VAk6BUA_0dbGgaIG' ;

// El CDN de supabase-js expone el global `supabase`. Creamos el cliente
// una sola vez y lo compartimos por toda la app en PADDOCK.db
window.PADDOCK = window.PADDOCK || {};
window.PADDOCK.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Medios de pago del sistema (se usan en ventas, cobros, pagos y caja).
// Para cambiarlos, editá SOLO esta lista: { valor, texto }.
window.PADDOCK.MEDIOS_PAGO = [
  { valor: 'efectivo',           texto: 'Efectivo' },
  { valor: 'tarjeta_credito',    texto: 'Tarjeta crédito' },
  { valor: 'tarjeta_debito',     texto: 'Tarjeta débito' },
  { valor: 'qr',                 texto: 'QR' },
  { valor: 'transf_paddock',     texto: 'Transferencia cta Paddock' },
  { valor: 'transf_luciano',     texto: 'Transferencia cta Luciano' },
  { valor: 'transf_nacho',       texto: 'Transferencia cta Nacho' },
  { valor: 'transf_facu',        texto: 'Transferencia cta Facu' }
];
// Helper: crea las <option> de un <select> de medios de pago.
window.PADDOCK.opcionesMedios = function (seleccionado) {
  return window.PADDOCK.MEDIOS_PAGO.map(function (m) {
    var o = document.createElement('option');
    o.value = m.valor; o.textContent = m.texto;
    if (seleccionado && seleccionado === m.valor) o.selected = true;
    return o;
  });
};
// Helper: devuelve el texto lindo de un valor de medio.
window.PADDOCK.textoMedio = function (valor) {
  var m = window.PADDOCK.MEDIOS_PAGO.find(function (x) { return x.valor === valor; });
  return m ? m.texto : (valor || '—');
};
