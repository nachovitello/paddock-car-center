/* ============================================================
   COBROS — cuentas por cobrar del taller.
   - Pantalla principal: tarjeta por cliente con lo que te debe.
   - Tocás un cliente → su cuenta corriente (órdenes con saldo).
   - Cobrás una orden (total o parcial): baja el saldo, entra a
     la caja como ingreso y genera el recibo numerado.
   - El recibo se imprime / PDF y se comparte por WhatsApp.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let ordenes = [];
  let cobradoPorOrden = {};
  let contActual = null;
  let filtro = '';

  function fmtMoneda(n) { return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 }); }
  function fmtFecha(iso) { return iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }
  function fmtFechaD(f) { if (!f) return ''; const [a, m, d] = String(f).split('-'); return d + '/' + m + '/' + a; }
  function idHash() { const m = location.hash.match(/[?&]id=([^&]+)/); return m ? decodeURIComponent(m[1]) : null; }

  /* ---------- Datos ---------- */
  async function traerOrdenes() {
    const { data } = await db.from('operaciones')
      .select('id, total, descripcion, creado_en, cliente_id, clientes(nombre), vehiculos(patente)')
      .eq('tipo', 'taller')
      .order('creado_en', { ascending: false });
    return data || [];
  }
  async function traerCobros() {
    const { data } = await db.from('cobros').select('operacion_id, monto, anulado');
    const mapa = {};
    (data || []).forEach(c => { if (c.operacion_id && !c.anulado) mapa[c.operacion_id] = (mapa[c.operacion_id] || 0) + Number(c.monto); });
    return mapa;
  }
  function saldoDe(o) { return Number(o.total) - (cobradoPorOrden[o.id] || 0); }
  function estadoDe(o) {
    const p = cobradoPorOrden[o.id] || 0;
    if (p <= 0) return 'pendiente';
    if (p < Number(o.total)) return 'parcial';
    return 'cobrada';
  }

  /* ---------- Cobrar una orden ---------- */
  function abrirCobro(orden, onDone) {
    const saldo = saldoDe(orden);
    const inpMonto = el('input', { type: 'number', min: '0', step: '1', value: String(saldo), class: '' });
    const selMedio = el('select', {}, [
      el('option', { value: 'efectivo' }, 'Efectivo'),
      el('option', { value: 'transferencia' }, 'Transferencia'),
      el('option', { value: 'tarjeta' }, 'Tarjeta')
    ]);
    const hoy = new Date().toISOString().slice(0, 10);

    modal({
      titulo: 'Cobrar orden',
      cuerpo: el('div', {}, [
        el('div', { class: 'stock-actual' }, [ el('span', {}, 'Saldo de la orden: '), el('strong', {}, fmtMoneda(saldo)) ]),
        el('div', { class: 'field' }, [ el('label', {}, 'Monto a cobrar'), inpMonto ]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [ el('label', {}, 'Medio'), selMedio ]),
          el('div', { class: 'field' }, [ el('label', {}, 'Fecha'), el('input', { id: 'cob-fecha', type: 'date', value: hoy }) ])
        ])
      ]),
      textoGuardar: 'Cobrar y generar recibo',
      onGuardar: async () => {
        let monto = Number(inpMonto.value || 0);
        if (monto <= 0) { toast('Poné un monto válido.', 'error'); return false; }
        if (monto > saldo) monto = saldo;

        const usuario_id = (auth.sesion() || {}).id || null;
        const medio = selMedio.value;
        const fecha = document.getElementById('cob-fecha').value || hoy;

        // 1. El cobro (recibo)
        const { data: cobro, error: e1 } = await db.from('cobros').insert({
          operacion_id: orden.id, cliente_id: orden.cliente_id || null, monto, medio_pago: medio, fecha, usuario_id
        }).select('id, numero').single();
        if (e1 || !cobro) { toast('No se pudo registrar el cobro.', 'error'); return false; }

        // 2. Ingreso en caja
        await db.from('movimientos_caja').insert({
          tipo: 'ingreso', monto, medio_pago: medio,
          concepto: 'Cobro orden' + (orden.vehiculos ? ' ' + orden.vehiculos.patente : '') + ' (Recibo ' + cobro.numero + ')',
          operacion_id: orden.id, usuario_id
        });

        // 3. Actualizar estado de la orden
        const { data: sumData } = await db.from('cobros').select('monto').eq('operacion_id', orden.id);
        const pagado = (sumData || []).reduce((a, x) => a + Number(x.monto), 0);
        const nuevoEstado = pagado >= Number(orden.total) ? 'cobrada' : (pagado > 0 ? 'parcial' : 'pendiente');
        await db.from('operaciones').update({ estado: nuevoEstado }).eq('id', orden.id);

        toast('Cobro registrado. Recibo ' + cobro.numero + '.', 'ok');
        if (onDone) onDone();
        location.hash = '#/recibo?id=' + cobro.id;
      }
    });
  }

  /* ---------- Agrupar por cliente ---------- */
  function agrupar() {
    const grupos = {};
    ordenes.forEach(o => {
      const cid = o.cliente_id || 'sin';
      const nombre = o.clientes ? o.clientes.nombre : 'Sin cliente';
      if (!grupos[cid]) grupos[cid] = { id: cid, nombre, saldo: 0, pendientes: 0, ordenes: 0 };
      grupos[cid].ordenes++;
      const s = saldoDe(o);
      if (s > 0.01) { grupos[cid].saldo += s; grupos[cid].pendientes++; }
    });
    return Object.values(grupos).sort((a, b) => b.saldo - a.saldo);
  }

  function pintarGrid(cont) {
    const wrap = cont.querySelector('#grid-cobros');
    wrap.innerHTML = '';

    const total = ordenes.reduce((a, o) => a + Math.max(0, saldoDe(o)), 0);
    const resumen = cont.querySelector('#resumen-cobros');
    resumen.innerHTML = '';
    resumen.appendChild(el('div', { class: 'deuda-box cobrar' }, [
      el('span', { class: 'deuda-label' }, 'Total por cobrar'),
      el('span', { class: 'deuda-monto' }, fmtMoneda(total))
    ]));

    let grupos = agrupar().filter(g => g.saldo > 0.01);  // solo los que deben
    if (filtro) { const q = filtro.toLowerCase(); grupos = grupos.filter(g => g.nombre.toLowerCase().includes(q)); }

    if (!grupos.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Nadie te debe'),
        el('div', {}, 'No hay órdenes pendientes de cobro. ¡Todo cobrado!')
      ]));
      return;
    }

    const grid = el('div', { class: 'prov-grid' });
    grupos.forEach(g => {
      grid.appendChild(el('div', { class: 'prov-card', onclick: () => { location.hash = '#/cuenta-cliente?id=' + g.id; } }, [
        el('div', { class: 'prov-card-nombre' }, g.nombre),
        el('div', { class: 'prov-card-saldo' }, fmtMoneda(g.saldo)),
        el('div', { class: 'prov-card-sub' }, g.pendientes + (g.pendientes === 1 ? ' orden pendiente' : ' órdenes pendientes'))
      ]));
    });
    wrap.appendChild(grid);
  }

  async function recargar() {
    [ordenes, cobradoPorOrden] = await Promise.all([traerOrdenes(), traerCobros()]);
    if (contActual) pintarGrid(contActual);
  }

  async function render(cont) {
    contActual = cont;
    cont.appendChild(el('div', { class: 'view-head' }, [ el('h1', {}, 'Cobros') ]));
    cont.appendChild(el('div', { id: 'resumen-cobros' }));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { class: 'search', type: 'text', placeholder: 'Buscar cliente…', oninput: (e) => { filtro = e.target.value; pintarGrid(cont); } })
    ]));
    cont.appendChild(el('div', { id: 'grid-cobros' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));

    [ordenes, cobradoPorOrden] = await Promise.all([traerOrdenes(), traerCobros()]);
    pintarGrid(cont);
  }

  /* ---------- Cuenta corriente del cliente ---------- */
  async function renderCuenta(cont) {
    document.querySelectorAll('.mainnav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-route') === 'cobros'));
    const cid = idHash();
    cont.appendChild(el('div', { class: 'loading' }, 'Cargando cuenta…'));

    let q = db.from('operaciones').select('id, total, descripcion, creado_en, cliente_id, clientes(nombre), vehiculos(patente)').eq('tipo', 'taller').order('creado_en', { ascending: false });
    q = (cid === 'sin') ? q.is('cliente_id', null) : q.eq('cliente_id', cid);
    const [{ data: ords }, cobMapa] = await Promise.all([q, traerCobros()]);
    cobradoPorOrden = cobMapa;
    cont.innerHTML = '';

    const nombre = (ords && ords[0] && ords[0].clientes) ? ords[0].clientes.nombre : (cid === 'sin' ? 'Sin cliente' : 'Cliente');
    const saldo = (ords || []).reduce((a, o) => a + Math.max(0, saldoDe(o)), 0);

    cont.appendChild(el('div', { class: 'detail-head' }, [ el('button', { class: 'back-link', onclick: () => { location.hash = '#/cobros'; } }, '← Cobros') ]));
    cont.appendChild(el('div', { class: 'cuenta-header' }, [
      el('div', { class: 'cuenta-nombre' }, nombre),
      el('div', { class: 'cuenta-saldo' }, [ el('span', { class: 'cs-label' }, 'Te debe'), el('span', { class: 'cs-monto' }, fmtMoneda(saldo)) ])
    ]));

    if (!ords || !ords.length) { cont.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty-title' }, 'Sin órdenes')])); return; }

    const card = el('div', { class: 'card' });
    ords.forEach(o => {
      const est = estadoDe(o);
      const s = saldoDe(o);
      const estClass = est === 'cobrada' ? 'pagada' : (est === 'parcial' ? 'parcial' : 'pendiente');
      const estTxt = est === 'cobrada' ? 'cobrada' : (est === 'parcial' ? 'parcial' : 'a cobrar');
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, [
            o.vehiculos ? el('span', { class: 'patente-tag' }, o.vehiculos.patente) : null,
            el('span', { style: 'margin-left:8px' }, fmtMoneda(o.total))
          ]),
          el('div', { class: 'list-row-sub' }, fmtFecha(o.creado_en) + '  ·  ' + (o.descripcion || ''))
        ]),
        el('div', { class: 'compra-meta' }, [
          est !== 'cobrada' ? el('div', { class: 'compra-saldo' }, 'Saldo ' + fmtMoneda(s)) : null,
          el('div', { class: 'estado-chip ' + estClass }, estTxt)
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('a', { class: 'btn btn-ghost btn-sm', href: '#/ficha-orden?id=' + o.id }, 'Ficha'),
          s > 0.01 ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => abrirCobro(o, () => renderCuenta(cont)) }, 'Cobrar') : null
        ])
      ]));
    });
    cont.appendChild(card);
  }

  /* ---------- Recibo ---------- */
  let contRecibo = null;

  async function anularRecibo(cobro) {
    if (!auth.esAdmin()) { toast('Solo el admin puede anular.', 'error'); return; }
    const ok = await confirmar('¿Anular el recibo N° ' + cobro.numero + '? Se revierte la caja y la orden vuelve a tener saldo.', 'Anular');
    if (!ok) return;
    const usuario_id = (auth.sesion() || {}).id || null;

    await db.from('cobros').update({ anulado: true }).eq('id', cobro.id);
    await db.from('movimientos_caja').insert({ tipo: 'egreso', monto: cobro.monto, medio_pago: cobro.medio_pago, concepto: 'Anulación recibo N° ' + cobro.numero, operacion_id: cobro.operacion_id, usuario_id });

    // Recalcular estado de la orden (sin los anulados)
    if (cobro.operacion_id) {
      const { data: sum } = await db.from('cobros').select('monto, anulado').eq('operacion_id', cobro.operacion_id);
      const pagado = (sum || []).filter(c => !c.anulado).reduce((a, x) => a + Number(x.monto), 0);
      const { data: ord } = await db.from('operaciones').select('total').eq('id', cobro.operacion_id).maybeSingle();
      const total = ord ? Number(ord.total) : 0;
      const est = (pagado >= total && total > 0) ? 'cobrada' : (pagado > 0 ? 'parcial' : 'pendiente');
      await db.from('operaciones').update({ estado: est }).eq('id', cobro.operacion_id);
    }
    toast('Recibo anulado.', 'ok');
    renderRecibo(contRecibo);
  }

  async function renderRecibo(cont) {
    contRecibo = cont;
    cont.innerHTML = '';
    document.querySelectorAll('.mainnav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-route') === 'cobros'));
    const id = idHash();
    cont.appendChild(el('div', { class: 'loading' }, 'Cargando recibo…'));

    const { data: cobro } = await db.from('cobros')
      .select('*, clientes(nombre, telefono), operaciones(numero_orden, descripcion, total, vehiculos(patente))')
      .eq('id', id).maybeSingle();
    if (!cobro) { cont.innerHTML = ''; cont.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty-title' }, 'Recibo no encontrado')])); return; }
    cont.innerHTML = '';

    const cli = cobro.clientes || {};
    const op = cobro.operaciones || {};
    const veh = op.vehiculos || {};

    const textoWpp = 'Recibo N° ' + cobro.numero + ' — Paddock Car Center\n' +
      'Cliente: ' + (cli.nombre || '') + '\n' +
      (veh.patente ? 'Vehículo: ' + veh.patente + '\n' : '') +
      'Monto: ' + fmtMoneda(cobro.monto) + '\n' +
      'Medio: ' + (cobro.medio_pago || '') + '\n' +
      'Fecha: ' + fmtFechaD(cobro.fecha) + '\n¡Gracias!';

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => history.back() }, '← Volver'),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF'),
        cli.telefono ? el('a', { class: 'btn btn-accent btn-sm', target: '_blank', rel: 'noopener',
          href: 'https://wa.me/' + (cli.telefono || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(textoWpp) }, 'WhatsApp') : null,
        (!cobro.anulado && auth.esAdmin()) ? el('button', { class: 'btn btn-danger btn-sm', onclick: () => anularRecibo(cobro) }, 'Anular') : null
      ])
    ]));

    const saldoRest = Number(op.total || 0) - (cobradoPorOrden[cobro.operacion_id] || cobro.monto);

    const doc = el('div', { class: 'orden-doc' });
    if (cobro.anulado) doc.appendChild(el('div', { class: 'sello-anulado' }, 'ANULADO'));
    doc.appendChild(el('div', { class: 'od-head' }, [
      el('div', { class: 'od-brand' }, [ el('div', { class: 'od-brand-name' }, 'PADDOCK'), el('div', { class: 'od-brand-sub' }, 'Car Center') ]),
      el('div', { class: 'od-title' }, [ el('div', { class: 'od-title-txt' }, 'Recibo'), el('div', { class: 'od-numero' }, 'N° ' + cobro.numero) ])
    ]));
    doc.appendChild(el('div', { class: 'od-datos' }, [
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Cliente: '), el('strong', {}, cli.nombre || '—') ]),
      veh.patente ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Vehículo: '), veh.patente ]) : null,
      op.numero_orden ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Orden: '), 'N° ' + op.numero_orden ]) : null,
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Fecha: '), fmtFechaD(cobro.fecha) ]),
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Medio de pago: '), (cobro.medio_pago || '—') ]),
      op.descripcion ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Trabajo: '), op.descripcion ]) : null
    ]));
    doc.appendChild(el('div', { class: 'od-total' }, [ el('span', {}, 'RECIBIMOS' ), el('span', { class: 'od-total-monto' }, fmtMoneda(cobro.monto)) ]));
    doc.appendChild(el('div', { class: 'od-firma' }, [ el('div', { class: 'od-firma-linea' }), el('div', { class: 'od-firma-txt' }, 'Paddock Car Center') ]));
    cont.appendChild(doc);
  }

  router.registrar('cobros', render);
  router.registrar('cuenta-cliente', renderCuenta);
  router.registrar('recibo', renderRecibo);
})();
