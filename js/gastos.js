/* ============================================================
   Vista GASTOS — en qué se va la plata, por categoría.
   Suma, por mes:
     · Facturas de compra (compras), con su categoría.
     · Egresos MANUALES de caja (gastos cargados a mano).
   No cuenta los egresos automáticos de caja (pagos a proveedor
   y compras al contado), porque esos ya están en las compras:
   así no se duplica.
   NOTA: ayuda de control. La contabilidad la valida el contador.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast } = ui;

  let mes = mesActual();
  let items = [];     // [{categoria, etiqueta, sub, monto}]
  let contActual = null;

  function mesActual() { return new Date().toISOString().slice(0, 7); }
  function fmt(n) { return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 }); }
  function fmtFecha(f) { if (!f) return ''; const [a, m, d] = String(f).slice(0, 10).split('-'); return d + '/' + m + '/' + a; }

  function rango() {
    const [a, m] = mes.split('-').map(Number);
    const ini = new Date(a, m - 1, 1), fin = new Date(a, m, 1);
    const d = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    return { dIni: d(ini), dFin: d(fin), isoIni: ini.toISOString(), isoFin: fin.toISOString() };
  }

  async function cargar() {
    const r = rango();
    const [compras, caja] = await Promise.all([
      db.from('compras').select('total, categoria, fecha, numero, tipo_comprobante, proveedores(nombre)')
        .gte('fecha', r.dIni).lt('fecha', r.dFin),
      db.from('movimientos_caja').select('monto, categoria, concepto, creado_en')
        .eq('manual', true).eq('tipo', 'egreso').gte('creado_en', r.isoIni).lt('creado_en', r.isoFin)
    ]);
    if (compras.error || caja.error) toast('No se pudieron cargar los gastos.', 'error');

    items = [];
    (compras.data || []).forEach(c => items.push({
      categoria: c.categoria || 'Sin categoría',
      etiqueta: (c.tipo_comprobante || 'Compra') + (c.numero ? ' N° ' + c.numero : ''),
      sub: (c.proveedores ? c.proveedores.nombre + '  ·  ' : '') + 'Compra  ·  ' + fmtFecha(c.fecha),
      monto: Number(c.total) || 0
    }));
    (caja.data || []).forEach(m => items.push({
      categoria: m.categoria || 'Sin categoría',
      etiqueta: m.concepto || 'Gasto',
      sub: 'Caja  ·  ' + fmtFecha(m.creado_en),
      monto: Number(m.monto) || 0
    }));
  }

  function porCategoria() {
    const map = {};
    items.forEach(it => { map[it.categoria] = (map[it.categoria] || 0) + it.monto; });
    return Object.entries(map).map(([cat, monto]) => ({ cat, monto })).sort((a, b) => b.monto - a.monto);
  }

  function pintar(cont) {
    const totalWrap = cont.querySelector('#gastos-total');
    const catWrap = cont.querySelector('#gastos-cats');
    const detWrap = cont.querySelector('#gastos-detalle');
    totalWrap.innerHTML = ''; catWrap.innerHTML = ''; detWrap.innerHTML = '';

    const total = items.reduce((a, it) => a + it.monto, 0);
    totalWrap.appendChild(el('div', { class: 'deuda-box' }, [
      el('span', { class: 'deuda-label' }, 'Total de gastos del mes'),
      el('span', { class: 'deuda-monto' }, fmt(total))
    ]));

    if (!items.length) {
      catWrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Sin gastos este mes'),
        el('div', {}, 'Cargá compras o gastos en la caja para verlos acá.')
      ]));
      return;
    }

    // Barras por categoría
    const cats = porCategoria();
    const max = cats[0] ? cats[0].monto : 1;
    const card = el('div', { class: 'card', style: 'padding:16px' });
    cats.forEach(c => {
      const pct = total ? Math.round(c.monto / total * 100) : 0;
      card.appendChild(el('div', { class: 'gasto-cat' }, [
        el('div', { class: 'gasto-cat-top' }, [
          el('span', { class: 'gasto-cat-nom' }, c.cat),
          el('span', { class: 'gasto-cat-monto' }, fmt(c.monto) + '  ·  ' + pct + '%')
        ]),
        el('div', { class: 'gasto-bar' }, [ el('div', { class: 'gasto-bar-in', style: 'width:' + Math.max(3, Math.round(c.monto / max * 100)) + '%' }) ])
      ]));
    });
    catWrap.appendChild(card);

    // Detalle
    detWrap.appendChild(el('h2', { class: 'section-title' }, 'Detalle'));
    const dcard = el('div', { class: 'card' });
    items.slice().sort((a, b) => b.monto - a.monto).forEach(it => {
      dcard.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, it.etiqueta),
          el('div', { class: 'list-row-sub' }, it.categoria + '  ·  ' + it.sub)
        ]),
        el('div', { class: 'compra-total' }, fmt(it.monto))
      ]));
    });
    detWrap.appendChild(dcard);
  }

  async function recargar(cont) {
    cont.querySelector('#gastos-cats').innerHTML = '<div class="loading">Cargando…</div>';
    cont.querySelector('#gastos-detalle').innerHTML = '';
    await cargar();
    pintar(cont);
  }

  async function render(cont) {
    contActual = cont;
    if (!auth.esAdmin()) {
      cont.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Acceso restringido'),
        el('div', {}, 'Solo el administrador puede ver los gastos.')
      ]));
      return;
    }
    cont.appendChild(el('div', { class: 'view-head' }, [ el('h1', {}, 'Gastos del mes') ]));
    cont.appendChild(el('div', { class: 'iva-barra' }, [
      el('span', { class: 'ff-lbl' }, 'Mes:'),
      el('input', { type: 'month', value: mes, onchange: (e) => { mes = e.target.value || mesActual(); recargar(cont); } })
    ]));
    cont.appendChild(el('p', { class: 'iva-nota' }, 'Suma las facturas de compra y los gastos manuales de la caja, clasificados por categoría. Los pagos automáticos de caja no se cuentan dos veces.'));
    cont.appendChild(el('div', { id: 'gastos-total' }));
    cont.appendChild(el('div', { id: 'gastos-cats' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));
    cont.appendChild(el('div', { id: 'gastos-detalle' }));

    await cargar();
    pintar(cont);
  }

  router.registrar('gastos', render);
})();
