/* ============================================================
   Vista CAJA — movimientos de plata.
   - Automáticos: ingresos por ventas, egresos por pagos.
   - Manuales: gastos, retiros, ingresos varios (se cargan acá).
   - Vista por día (con fecha) o por rango (desde/hasta).
   - Totales del período + desglose por medio de pago.
   Solo los movimientos manuales se pueden borrar.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let modo = 'dia';           // 'dia' | 'rango'
  let fechaDia = hoyISO();
  let desde = hoyISO();
  let hasta = hoyISO();
  let cache = [];
  let contActual = null;

  function hoyISO() { return new Date().toISOString().slice(0, 10); }
  function fmtMoneda(n) {
    return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
  function fmtHora(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  // Límites del período en ISO (usando medianoche local).
  function limites() {
    let ini, fin;
    if (modo === 'dia') {
      const [a, m, d] = fechaDia.split('-').map(Number);
      ini = new Date(a, m - 1, d, 0, 0, 0);
      fin = new Date(a, m - 1, d + 1, 0, 0, 0);
    } else {
      const [a1, m1, d1] = desde.split('-').map(Number);
      const [a2, m2, d2] = hasta.split('-').map(Number);
      ini = new Date(a1, m1 - 1, d1, 0, 0, 0);
      fin = new Date(a2, m2 - 1, d2 + 1, 0, 0, 0);
    }
    return { ini: ini.toISOString(), fin: fin.toISOString() };
  }

  async function traer() {
    const { ini, fin } = limites();
    const { data, error } = await db.from('movimientos_caja')
      .select('*, usuarios_app(nombre)')
      .gte('creado_en', ini).lt('creado_en', fin)
      .order('creado_en', { ascending: false });
    if (error) { toast('No se pudieron cargar los movimientos.', 'error'); return []; }
    return data || [];
  }

  function totales() {
    let ing = 0, egr = 0;
    const porMedio = {};
    cache.forEach(m => {
      const monto = Number(m.monto) || 0;
      const medio = m.medio_pago || 'otro';
      if (!porMedio[medio]) porMedio[medio] = 0;
      if (m.tipo === 'ingreso') { ing += monto; porMedio[medio] += monto; }
      else { egr += monto; porMedio[medio] -= monto; }
    });
    return { ing, egr, saldo: ing - egr, porMedio };
  }

  /* ---------- Movimiento manual ---------- */
  function abrirForm() {
    const cuerpo = el('div', {}, [
      el('div', { class: 'field' }, [
        el('label', { for: 'm-tipo' }, 'Tipo'),
        el('select', { id: 'm-tipo' }, [
          el('option', { value: 'egreso' }, 'Egreso (gasto / retiro)'),
          el('option', { value: 'ingreso' }, 'Ingreso (entrada de plata)')
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'm-concepto' }, 'Concepto'),
        el('input', { id: 'm-concepto', type: 'text', placeholder: 'ej. pago de luz, retiro, etc.' })
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'm-monto' }, 'Monto'),
          el('input', { id: 'm-monto', type: 'number', min: '0', step: '1' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'm-medio' }, 'Medio'),
          el('select', { id: 'm-medio' }, [
            el('option', { value: 'efectivo' }, 'Efectivo'),
            el('option', { value: 'transferencia' }, 'Transferencia'),
            el('option', { value: 'tarjeta' }, 'Tarjeta'),
            el('option', { value: 'otro' }, 'Otro')
          ])
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'm-fecha' }, 'Fecha'),
        el('input', { id: 'm-fecha', type: 'date', value: hoyISO() })
      ])
    ]);

    modal({
      titulo: 'Nuevo movimiento',
      cuerpo,
      textoGuardar: 'Guardar',
      onGuardar: async () => {
        const monto = Number(document.getElementById('m-monto').value || 0);
        const concepto = document.getElementById('m-concepto').value.trim();
        if (monto <= 0) { toast('Poné un monto válido.', 'error'); return false; }
        if (!concepto) { toast('Escribí un concepto.', 'error'); return false; }

        const fecha = document.getElementById('m-fecha').value || hoyISO();
        // Si es hoy, usamos la hora actual; si no, mediodía de ese día.
        const creado_en = (fecha === hoyISO())
          ? new Date().toISOString()
          : new Date(fecha + 'T12:00:00').toISOString();

        const { error } = await db.from('movimientos_caja').insert({
          tipo: document.getElementById('m-tipo').value,
          monto,
          medio_pago: document.getElementById('m-medio').value,
          concepto,
          manual: true,
          usuario_id: (auth.sesion() || {}).id || null,
          creado_en
        });
        if (error) { toast('No se pudo guardar.', 'error'); return false; }
        toast('Movimiento cargado.', 'ok');
        recargar();
      }
    });
  }

  async function eliminar(m) {
    if (!m.manual) { toast('Los movimientos automáticos no se borran desde la caja.', 'error'); return; }
    const ok = await confirmar('¿Eliminar este movimiento manual?');
    if (!ok) return;
    const { error } = await db.from('movimientos_caja').delete().eq('id', m.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Movimiento eliminado.', 'ok');
    recargar();
  }

  /* ---------- Pintar ---------- */
  function pintar(cont) {
    const t = totales();

    // Resumen
    const resumen = cont.querySelector('#caja-resumen');
    resumen.innerHTML = '';
    resumen.appendChild(el('div', { class: 'caja-cards' }, [
      el('div', { class: 'caja-card ingreso' }, [ el('span', { class: 'cc-lbl' }, 'Ingresos'), el('span', { class: 'cc-val' }, fmtMoneda(t.ing)) ]),
      el('div', { class: 'caja-card egreso' }, [ el('span', { class: 'cc-lbl' }, 'Egresos'), el('span', { class: 'cc-val' }, fmtMoneda(t.egr)) ]),
      el('div', { class: 'caja-card saldo' }, [ el('span', { class: 'cc-lbl' }, 'Saldo'), el('span', { class: 'cc-val' }, fmtMoneda(t.saldo)) ])
    ]));
    // Desglose por medio (neto), en tarjetas claras
    const fijos = ['efectivo', 'transferencia', 'tarjeta'];
    const extras = Object.keys(t.porMedio).filter(m => !fijos.includes(m) && Math.abs(t.porMedio[m]) > 0.01);
    const listaMedios = fijos.concat(extras);
    resumen.appendChild(el('div', { class: 'medios-grid' },
      listaMedios.map(medio => el('div', { class: 'medio-card' }, [
        el('span', { class: 'medio-nombre' }, medio),
        el('span', { class: 'medio-val' }, fmtMoneda(t.porMedio[medio] || 0))
      ]))
    ));

    // Lista
    const wrap = cont.querySelector('#caja-lista');
    wrap.innerHTML = '';
    if (!cache.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Sin movimientos'),
        el('div', {}, 'No hubo movimientos en este período.')
      ]));
      return;
    }

    const card = el('div', { class: 'card' });
    cache.forEach(m => {
      const esIng = m.tipo === 'ingreso';
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, m.concepto || (esIng ? 'Ingreso' : 'Egreso')),
          el('div', { class: 'list-row-sub' }, fmtHora(m.creado_en) + '  ·  ' + (m.medio_pago || 'otro') + (m.manual ? '  ·  manual' : '') + (auth.esAdmin() && m.usuarios_app ? '  ·  ' + m.usuarios_app.nombre : ''))
        ]),
        el('div', { class: 'caja-monto ' + (esIng ? 'ing' : 'egr') }, (esIng ? '+ ' : '− ') + fmtMoneda(m.monto)),
        el('div', { class: 'list-row-actions' }, [
          m.manual ? el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(m) }, 'Borrar') : null
        ])
      ]));
    });
    wrap.appendChild(card);
  }

  async function recargar() {
    cache = await traer();
    if (contActual) pintar(contActual);
  }

  /* ---------- Selector de período ---------- */
  function barraPeriodo(cont) {
    const barra = el('div', { class: 'caja-periodo' });

    const btnDia = el('button', { class: 'btn btn-sm ' + (modo === 'dia' ? 'btn-primary' : 'btn-ghost'), onclick: () => { modo = 'dia'; render(cont); } }, 'Por día');
    const btnRango = el('button', { class: 'btn btn-sm ' + (modo === 'rango' ? 'btn-primary' : 'btn-ghost'), onclick: () => { modo = 'rango'; render(cont); } }, 'Por rango');
    barra.appendChild(el('div', { class: 'caja-modos' }, [btnDia, btnRango]));

    if (modo === 'dia') {
      barra.appendChild(el('input', { type: 'date', value: fechaDia, onchange: (e) => { fechaDia = e.target.value; recargar(); } }));
    } else {
      barra.appendChild(el('div', { class: 'caja-rango' }, [
        el('input', { type: 'date', value: desde, onchange: (e) => { desde = e.target.value; recargar(); } }),
        el('span', { class: 'rango-sep' }, 'a'),
        el('input', { type: 'date', value: hasta, onchange: (e) => { hasta = e.target.value; recargar(); } })
      ]));
    }
    return barra;
  }

  async function render(cont) {
    contActual = cont;
    cont.innerHTML = '';
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Caja'),
      el('div', { class: 'head-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => {
          const label = (modo === 'dia')
            ? fechaDia.split('-').reverse().join('/')
            : (desde.split('-').reverse().join('/') + ' a ' + hasta.split('-').reverse().join('/'));
          window.PADDOCK.reportes.abrirCaja(cache, label, totales());
        } }, 'Reporte'),
        el('button', { class: 'btn btn-primary', onclick: abrirForm }, '+ Movimiento')
      ])
    ]));
    cont.appendChild(barraPeriodo(cont));
    cont.appendChild(el('div', { id: 'caja-resumen' }));
    cont.appendChild(el('div', { id: 'caja-lista' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));

    cache = await traer();
    pintar(cont);
  }

  router.registrar('caja', render);
})();
