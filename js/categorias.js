/* ============================================================
   Categorías de gastos del sistema.
   Para cambiarlas, editá SOLO esta lista (agregá, sacá o renombrá).
   Se usan en Compras, en los egresos de Caja y en la vista Gastos.
   ============================================================ */
window.PADDOCK = window.PADDOCK || {};
window.PADDOCK.CATEGORIAS_GASTO = [
  'Compra de productos',
  'Alquiler',
  'Servicios',
  'Sueldos',
  'Impuestos y tasas',
  'Mantenimiento',
  'Insumos',
  'Otros'
];

// Crea las <option> para un <select> de categorías.
window.PADDOCK.opcionesCategorias = function (seleccionada, incluirVacia) {
  const opts = [];
  if (incluirVacia) {
    const v = document.createElement('option');
    v.value = ''; v.textContent = '— Sin categoría —';
    opts.push(v);
  }
  window.PADDOCK.CATEGORIAS_GASTO.forEach(function (c) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (seleccionada && seleccionada === c) o.selected = true;
    opts.push(o);
  });
  return opts;
};
