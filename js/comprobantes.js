/* ============================================================
   COMPROBANTES — examinador de todo lo emitido.
   Pestañas por tipo: Órdenes de taller, Recibos, Ventas.
   Búsqueda por número o cliente + rango de fechas.
   Cada comprobante abre su documento (ficha, recibo, ticket).
   ============================================================ */
(function () {
  const { db, ui, router } = window.PADDOCK;
  const { el, toast } = ui;

  let tab = 'ordenes';      // 'ordenes' | 'recibos' | 'ventas'
  let texto = '';
  let desde = '';
  let hasta = '';
  let contActual = null;

  function fmtMoneda(n) { return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 }); }
  function fmtFecha(iso) { return iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }

  function rangoISO() {
    let ini = null, fin = null;
    if (desde) { const [a, m, d] = desde.split('-').map(Number); ini = new Date(a, m - 1, d, 0, 0, 0).toISOString(); }
    if (hasta) { const [a, m, d] = hasta.split('-').map(Number); fin = new Date(a, m - 1, d + 1, 0, 0, 0).toISOString(); }
    return { ini, fin };
  }

  async function cargar() {
    const { ini, fin } = rangoISO();
    let q;
    if (tab === 'ordenes') {
      q = db.from('operaciones').select('id, numero_orden, total, creado_en, estado, clientes(nombre), vehiculos(patente)').eq('tipo', 'taller');
    } else if (tab === 'ventas') {
      q = db.from('operaciones').select('id, numero_venta, total, creado_en, estado, clientes(nombre)').eq('tipo', 'venta');
    } else {
      q = db.from('cobros').select('id, numero, monto, creado_en, anulado, clientes(nombre), operaciones(numero_orden)');
    }
    if (ini) q = q.gte('creado_en', ini);
    if (fin) q = q.lt('creado_en', fin);
    q = q.order('creado_en', { ascending: false });
    const { data, error } = await q;
    if (error) { toast('No se pudieron cargar los comprobantes.', 'error'); return []; }
    return data || [];
  }

  function coincide(row) {
    if (!texto) return true;
    const t = texto.toLowerCase();
    const num = String(tab === 'ordenes' ? row.numero_orden : (tab === 'ventas' ? row.numero_venta : row.numero) || '');
    const cli = row.clientes ? (row.clientes.nombre || '') : '';
    return num.includes(t) || cli.toLowerCase().includes(t);
  }

  function pintar(cont, lista) {
    const wrap = cont.querySelector('#lista-comp');
    wrap.innerHTML = '';
    const filtrada = lista.filter(coincide);
    if (!filtrada.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Sin comprobantes'),
        el('div', {}, 'Probá con otra búsqueda o rango de fechas.')
      ]));
      return;
    }
    const card = el('div', { class: 'card' });
    filtrada.forEach(row => {
      let numero, titulo, sub, destino, monto;
      const cli = row.clientes ? row.clientes.nombre : 'Sin cliente';
      if (tab === 'ordenes') {
        numero = 'Orden N° ' + (row.numero_orden || '—');
        titulo = numero;
        sub = (row.vehiculos ? row.vehiculos.patente + '  ·  ' : '') + cli + '  ·  ' + fmtFecha(row.creado_en);
        monto = row.total; destino = '#/ficha-orden?id=' + row.id;
      } else if (tab === 'ventas') {
        numero = 'Venta N° ' + (row.numero_venta || '—');
        titulo = numero;
        sub = cli + '  ·  ' + fmtFecha(row.creado_en);
        monto = row.total; destino = '#/ticket?id=' + row.id;
      } else {
        numero = 'Recibo N° ' + (row.numero || '—');
        titulo = numero;
        const ordRef = row.operaciones && row.operaciones.numero_orden ? '  ·  Orden N° ' + row.operaciones.numero_orden : '';
        sub = cli + ordRef + '  ·  ' + fmtFecha(row.creado_en);
        monto = row.monto; destino = '#/recibo?id=' + row.id;
      }
      const anulado = (tab === 'recibos') ? row.anulado : (row.estado === 'anulada');
      card.appendChild(el('div', { class: 'list-row clickable', onclick: () => { location.hash = destino; } }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, [ titulo, anulado ? el('span', { class: 'chip-anulado' }, 'ANULADO') : null ]),
          el('div', { class: 'list-row-sub' }, sub)
        ]),
        el('div', { class: 'compra-total', style: anulado ? 'text-decoration:line-through;opacity:.5' : '' }, fmtMoneda(monto))
      ]));
    });
    wrap.appendChild(card);
  }

  async function recargar() {
    if (!contActual) return;
    const wrap = contActual.querySelector('#lista-comp');
    wrap.innerHTML = '<div class="loading">Cargando…</div>';
    const lista = await cargar();
    pintar(contActual, lista);
  }

  function barra(cont) {
    const mkTab = (id, txt) => el('button', { class: 'btn btn-sm ' + (tab === id ? 'btn-primary' : 'btn-ghost'), onclick: () => { tab = id; render(cont); } }, txt);
    return el('div', { class: 'comp-tabs' }, [ mkTab('ordenes', 'Órdenes'), mkTab('recibos', 'Recibos'), mkTab('ventas', 'Ventas') ]);
  }

  async function render(cont) {
    contActual = cont;
    cont.innerHTML = '';
    cont.appendChild(el('div', { class: 'view-head' }, [ el('h1', {}, 'Comprobantes') ]));
    cont.appendChild(barra(cont));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { class: 'search', type: 'text', placeholder: 'Buscar por número o cliente…', value: texto, oninput: (e) => { texto = e.target.value; recargar(); } })
    ]));
    cont.appendChild(el('div', { class: 'filtro-fecha', style: 'margin-bottom:16px' }, [
      el('span', { class: 'ff-lbl' }, 'Fecha:'),
      el('input', { type: 'date', value: desde, onchange: (e) => { desde = e.target.value; recargar(); } }),
      el('span', { class: 'rango-sep' }, 'a'),
      el('input', { type: 'date', value: hasta, onchange: (e) => { hasta = e.target.value; recargar(); } })
    ]));
    cont.appendChild(el('div', { id: 'lista-comp' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));

    const lista = await cargar();
    pintar(cont, lista);
  }

  router.registrar('comprobantes', render);
})();
