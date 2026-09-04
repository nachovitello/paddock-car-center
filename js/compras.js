/* ============================================================
   Vista COMPRAS — cuentas por pagar, agrupadas por proveedor.
   - Pantalla principal: una tarjeta por proveedor con su saldo.
   - Tocás una tarjeta → cuenta corriente del proveedor (sus
     facturas, pagadas y pendientes).
   - Al cargar una factura elegís condición:
       · cuenta corriente → queda como deuda
       · abonada en el momento → se paga sola (genera el pago,
         va a la caja como egreso y queda 'pagada')
   - Si la factura afecta stock, los repuestos entran al inventario.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let cache = [];
  let proveedores = [];
  let productos = [];
  let pagosPorCompra = {};
  let contActual = null;
  let filtro = '';

  function fmtMoneda(n) {
    if (n == null) return '$0';
    return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
  function fmtFecha(f) {
    if (!f) return '';
    const [a, m, d] = String(f).split('-');
    return d + '/' + m + '/' + a;
  }

  /* ---------- Datos ---------- */
  async function traer() {
    const { data, error } = await db
      .from('compras')
      .select('*, proveedores(nombre)')
      .order('fecha', { ascending: false });
    if (error) { toast('No se pudieron cargar las compras.', 'error'); return []; }
    return data || [];
  }
  async function traerPagos() {
    const { data } = await db.from('pago_aplicaciones').select('compra_id, monto');
    const mapa = {};
    (data || []).forEach(p => { if (p.compra_id) mapa[p.compra_id] = (mapa[p.compra_id] || 0) + Number(p.monto); });
    return mapa;
  }
  async function traerProveedores() {
    const { data } = await db.from('proveedores').select('id, nombre').order('nombre');
    return data || [];
  }
  async function traerProductos() {
    const { data } = await db.from('productos').select('id, nombre, precio_compra, stock').eq('activo', true).order('nombre');
    return data || [];
  }

  function saldoDe(c) { return Number(c.total) - (pagosPorCompra[c.id] || 0); }
  function estadoDe(c) {
    const pagado = pagosPorCompra[c.id] || 0;
    if (pagado <= 0) return 'pendiente';
    if (pagado < Number(c.total)) return 'parcial';
    return 'pagada';
  }
  function idHash() {
    const m = location.hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ---------- Subida de archivo ---------- */
  async function subirArchivo(file, carpeta) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'dat').toLowerCase();
    const path = carpeta + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await db.storage.from('comprobantes').upload(path, file);
    if (error) { toast('No se pudo subir el archivo.', 'error'); return null; }
    const { data } = db.storage.from('comprobantes').getPublicUrl(path);
    return data.publicUrl;
  }

  /* ---------- Nueva factura ---------- */
  function abrirForm() {
    let items = [];

    const opcProv = [el('option', { value: '' }, '— Elegí proveedor —')];
    proveedores.forEach(p => opcProv.push(el('option', { value: p.id }, p.nombre)));

    const itemsCont = el('div', { class: 'compra-items' });
    const totalCalc = el('div', { class: 'compra-total-calc' }, 'Total: $0');
    const inpTotalManual = el('input', { id: 'c-total', type: 'number', min: '0', step: '1', value: '' });

    function repintarItems() {
      itemsCont.innerHTML = '';
      items.forEach((it, idx) => {
        const opc = [el('option', { value: '' }, '— Repuesto —')];
        productos.forEach(p => opc.push(el('option', { value: p.id, selected: it.producto_id === p.id }, p.nombre)));
        const sel = el('select', { class: 'ci-prod' }, opc);
        const inpPrecio = el('input', { class: 'ci-precio', type: 'number', min: '0', step: '1', value: String(it.precio_unit) });
        sel.addEventListener('change', (e) => {
          it.producto_id = e.target.value || null;
          const p = productos.find(x => x.id === it.producto_id);
          if (p && !it.precio_unit) { it.precio_unit = Number(p.precio_compra) || 0; inpPrecio.value = it.precio_unit; }
          it.descripcion = p ? p.nombre : '';
          recalcular();
        });
        const inpCant = el('input', { class: 'ci-cant', type: 'number', min: '1', step: '1', value: String(it.cantidad) });
        inpCant.addEventListener('input', (e) => { it.cantidad = Math.max(1, parseInt(e.target.value || '1', 10)); recalcular(); });
        inpPrecio.addEventListener('input', (e) => { it.precio_unit = Math.max(0, Number(e.target.value || 0)); recalcular(); });
        itemsCont.appendChild(el('div', { class: 'compra-item-row' }, [
          sel, inpCant, inpPrecio,
          el('button', { class: 'cl-quitar', onclick: () => { items.splice(idx, 1); repintarItems(); recalcular(); } }, '\u00d7')
        ]));
      });
      itemsCont.appendChild(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { items.push({ producto_id: null, descripcion: '', cantidad: 1, precio_unit: 0 }); repintarItems(); } }, '+ Agregar repuesto'));
    }
    function totalItems() { return items.reduce((a, it) => a + (it.cantidad * it.precio_unit), 0); }
    function recalcular() { totalCalc.textContent = 'Total: ' + fmtMoneda(totalItems()); }

    const bloqueStock = el('div', { class: 'bloque-stock', hidden: true }, [
      el('label', { class: 'sublabel' }, 'Repuestos que entran'), itemsCont, totalCalc
    ]);
    const bloqueManual = el('div', { class: 'bloque-manual' }, [
      el('div', { class: 'field' }, [ el('label', { for: 'c-total' }, 'Total de la factura'), inpTotalManual ])
    ]);

    const selAfecta = el('select', { id: 'c-afecta' }, [
      el('option', { value: 'no' }, 'No — solo registro la deuda'),
      el('option', { value: 'si' }, 'Sí — los repuestos entran al stock')
    ]);
    selAfecta.addEventListener('change', () => {
      const si = selAfecta.value === 'si';
      bloqueStock.hidden = !si; bloqueManual.hidden = si;
      if (si && !items.length) { items.push({ producto_id: null, descripcion: '', cantidad: 1, precio_unit: 0 }); repintarItems(); recalcular(); }
    });

    // Condición de pago
    const selMedio = el('select', { id: 'c-medio' }, [
      el('option', { value: 'efectivo' }, 'Efectivo'),
      el('option', { value: 'transferencia' }, 'Transferencia'),
      el('option', { value: 'tarjeta' }, 'Tarjeta')
    ]);
    const bloqueMedio = el('div', { class: 'field', hidden: true }, [
      el('label', { for: 'c-medio' }, 'Medio de pago'), selMedio
    ]);
    const selCondicion = el('select', { id: 'c-condicion' }, [
      el('option', { value: 'cuenta_corriente' }, 'Cuenta corriente (queda como deuda)'),
      el('option', { value: 'contado' }, 'Abonada en el momento')
    ]);
    selCondicion.addEventListener('change', () => {
      bloqueMedio.hidden = selCondicion.value !== 'contado';
    });

    const hoy = new Date().toISOString().slice(0, 10);

    const cuerpo = el('div', {}, [
      el('div', { class: 'field' }, [ el('label', { for: 'c-prov' }, 'Proveedor'), el('select', { id: 'c-prov' }, opcProv) ]),
      el('div', { class: 'field' }, [ el('label', { for: 'c-tipo' }, 'Tipo de comprobante'), el('select', { id: 'c-tipo' }, [
        el('option', { value: 'Factura A' }, 'Factura A'),
        el('option', { value: 'Factura B' }, 'Factura B'),
        el('option', { value: 'Factura C' }, 'Factura C'),
        el('option', { value: 'Factura M' }, 'Factura M'),
        el('option', { value: 'Nota de crédito' }, 'Nota de crédito'),
        el('option', { value: 'Nota de débito' }, 'Nota de débito')
      ]) ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [ el('label', { for: 'c-numero' }, 'N° de comprobante'), el('input', { id: 'c-numero', type: 'text' }) ]),
        el('div', { class: 'field' }, [ el('label', { for: 'c-fecha' }, 'Fecha'), el('input', { id: 'c-fecha', type: 'date', value: hoy }) ])
      ]),
      el('div', { class: 'field' }, [ el('label', { for: 'c-condicion' }, 'Condición'), selCondicion ]),
      bloqueMedio,
      el('div', { class: 'field' }, [ el('label', { for: 'c-afecta' }, '¿Afecta el stock?'), selAfecta ]),
      bloqueManual,
      bloqueStock,
      el('div', { class: 'field' }, [ el('label', { for: 'c-archivo' }, 'Adjuntar factura (foto o PDF)'), el('input', { id: 'c-archivo', type: 'file', accept: 'image/*,.pdf' }) ]),
      el('div', { class: 'field' }, [ el('label', { for: 'c-notas' }, 'Notas'), el('textarea', { id: 'c-notas' }, '') ])
    ]);

    modal({
      titulo: 'Nueva factura de compra',
      cuerpo,
      textoGuardar: 'Guardar',
      onGuardar: async () => {
        const proveedor_id = document.getElementById('c-prov').value || null;
        if (!proveedor_id) { toast('Elegí un proveedor.', 'error'); return false; }

        const afecta = selAfecta.value === 'si';
        let total;
        if (afecta) {
          const validos = items.filter(it => it.producto_id);
          if (!validos.length) { toast('Agregá al menos un repuesto.', 'error'); return false; }
          total = totalItems();
        } else {
          total = Number(inpTotalManual.value || 0);
          if (total <= 0) { toast('Poné el total de la factura.', 'error'); return false; }
        }

        const contado = selCondicion.value === 'contado';
        const usuario_id = (auth.sesion() || {}).id || null;
        const archivo = document.getElementById('c-archivo').files[0];

        let archivo_url = null;
        if (archivo) {
          archivo_url = await subirArchivo(archivo, 'compras');
          if (!archivo_url) return false;
        }

        // 1. La compra
        const { data: compra, error: e1 } = await db.from('compras').insert({
          proveedor_id,
          numero: document.getElementById('c-numero').value.trim() || null,
          tipo_comprobante: document.getElementById('c-tipo').value,
          fecha: document.getElementById('c-fecha').value || hoy,
          total,
          afecta_stock: afecta,
          archivo_url,
          estado: contado ? 'pagada' : 'pendiente',
          notas: document.getElementById('c-notas').value.trim() || null,
          usuario_id
        }).select('id, numero').single();
        if (e1 || !compra) { toast('No se pudo guardar la factura.', 'error'); return false; }

        // 2. Ítems + stock
        if (afecta) {
          const validos = items.filter(it => it.producto_id);
          await db.from('compra_items').insert(validos.map(it => ({
            compra_id: compra.id, producto_id: it.producto_id, descripcion: it.descripcion,
            cantidad: it.cantidad, precio_unit: it.precio_unit, subtotal: it.cantidad * it.precio_unit
          })));
          const ids = validos.map(it => it.producto_id);
          const { data: actuales } = await db.from('productos').select('id, stock').in('id', ids);
          const mapa = {}; (actuales || []).forEach(p => { mapa[p.id] = Number(p.stock) || 0; });
          for (const it of validos) {
            await db.from('productos').update({ stock: (mapa[it.producto_id] || 0) + it.cantidad }).eq('id', it.producto_id);
          }
          await db.from('movimientos_stock').insert(validos.map(it => ({
            producto_id: it.producto_id, tipo: 'entrada', cantidad: it.cantidad,
            motivo: 'Compra' + (compra.numero ? ' #' + compra.numero : ''), usuario_id
          })));
        }

        // 3. Si es al contado: pago automático + egreso en caja
        if (contado) {
          const medio = selMedio.value;
          const { data: pago } = await db.from('pagos').insert({
            proveedor_id, monto: total, medio_pago: medio,
            fecha: document.getElementById('c-fecha').value || hoy,
            notas: 'Pago al contado', usuario_id
          }).select('id, numero').single();
          if (pago) {
            await db.from('pago_aplicaciones').insert({ pago_id: pago.id, compra_id: compra.id, monto: total });
          }
          await db.from('movimientos_caja').insert({
            tipo: 'egreso', monto: total, medio_pago: medio,
            concepto: 'Pago compra' + (compra.numero ? ' #' + compra.numero : '') + (pago ? ' (OP ' + pago.numero + ')' : ''),
            usuario_id
          });
        }

        toast(contado ? 'Factura cargada y pagada.' : 'Factura cargada.', 'ok');
        recargar();
      }
    });

    repintarItems();
  }

  async function eliminar(c, onDone) {
    const ok = await confirmar('¿Eliminar esta factura? Se borran también sus ítems y pagos asociados. (El stock que ya entró no se revierte.)');
    if (!ok) return;
    const { error } = await db.from('compras').delete().eq('id', c.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Factura eliminada.', 'ok');
    (onDone || recargar)();
  }

  /* ---------- Agrupar por proveedor ---------- */
  function agrupar() {
    const grupos = {};
    cache.forEach(c => {
      const pid = c.proveedor_id || 'sin';
      const nombre = c.proveedores ? c.proveedores.nombre : 'Sin proveedor';
      if (!grupos[pid]) grupos[pid] = { id: pid, nombre, saldo: 0, pendientes: 0, facturas: 0 };
      grupos[pid].facturas++;
      const s = saldoDe(c);
      if (s > 0.01) { grupos[pid].saldo += s; grupos[pid].pendientes++; }
    });
    return Object.values(grupos).sort((a, b) => b.saldo - a.saldo);
  }

  /* ---------- Pantalla principal: tarjetas por proveedor ---------- */
  function pintarGrid(cont) {
    const wrap = cont.querySelector('#grid-proveedores');
    wrap.innerHTML = '';

    const deuda = cache.reduce((a, c) => a + Math.max(0, saldoDe(c)), 0);
    const resumen = cont.querySelector('#resumen-compras');
    resumen.innerHTML = '';
    resumen.appendChild(el('div', { class: 'deuda-box' }, [
      el('span', { class: 'deuda-label' }, 'Deuda total con proveedores'),
      el('span', { class: 'deuda-monto' }, fmtMoneda(deuda))
    ]));

    let grupos = agrupar();
    if (filtro) {
      const q = filtro.toLowerCase();
      grupos = grupos.filter(g => g.nombre.toLowerCase().includes(q));
    }

    if (!grupos.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, cache.length ? 'Sin resultados' : 'Todavía no hay facturas'),
        el('div', {}, cache.length ? 'Probá con otra búsqueda.' : 'Cargá la primera con el botón de arriba.')
      ]));
      return;
    }

    const grid = el('div', { class: 'prov-grid' });
    grupos.forEach(g => {
      const alDia = g.saldo <= 0.01;
      grid.appendChild(el('div', { class: 'prov-card' + (alDia ? ' al-dia' : ''), onclick: () => { location.hash = '#/cuenta?id=' + g.id; } }, [
        el('div', { class: 'prov-card-nombre' }, g.nombre),
        el('div', { class: 'prov-card-saldo' }, alDia ? 'Al día' : fmtMoneda(g.saldo)),
        el('div', { class: 'prov-card-sub' }, alDia
          ? g.facturas + (g.facturas === 1 ? ' factura' : ' facturas')
          : g.pendientes + (g.pendientes === 1 ? ' factura pendiente' : ' facturas pendientes'))
      ]));
    });
    wrap.appendChild(grid);
  }

  async function recargar() {
    [cache, pagosPorCompra] = await Promise.all([traer(), traerPagos()]);
    if (contActual) pintarGrid(contActual);
  }

  async function render(cont) {
    contActual = cont;
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Compras'),
      el('button', { class: 'btn btn-primary', onclick: abrirForm }, '+ Nueva factura')
    ]));
    cont.appendChild(el('div', { id: 'resumen-compras' }));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { class: 'search', type: 'text', placeholder: 'Buscar proveedor…',
        oninput: (e) => { filtro = e.target.value; pintarGrid(cont); } })
    ]));
    cont.appendChild(el('div', { id: 'grid-proveedores' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));

    [cache, pagosPorCompra, proveedores, productos] = await Promise.all([
      traer(), traerPagos(), traerProveedores(), traerProductos()
    ]);
    pintarGrid(cont);
  }

  /* ---------- Cuenta corriente de un proveedor ---------- */
  async function renderCuenta(cont) {
    document.querySelectorAll('.mainnav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === 'compras');
    });

    const pid = idHash();
    cont.appendChild(el('div', { class: 'loading' }, 'Cargando cuenta…'));

    // Traemos las facturas del proveedor + pagos frescos.
    let query = db.from('compras').select('*, proveedores(nombre), usuarios_app(nombre)').order('fecha', { ascending: false });
    query = (pid === 'sin') ? query.is('proveedor_id', null) : query.eq('proveedor_id', pid);
    const [{ data: compras }, pagosMapa] = await Promise.all([query, traerPagos()]);
    pagosPorCompra = pagosMapa;
    cont.innerHTML = '';

    const nombre = (compras && compras[0] && compras[0].proveedores) ? compras[0].proveedores.nombre
      : (pid === 'sin' ? 'Sin proveedor' : 'Proveedor');
    const saldo = (compras || []).reduce((a, c) => a + Math.max(0, saldoDe(c)), 0);

    cont.appendChild(el('div', { class: 'detail-head' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/compras'; } }, '← Compras'),
    ]));
    cont.appendChild(el('div', { class: 'cuenta-header' }, [
      el('div', { class: 'cuenta-nombre' }, nombre),
      el('div', { class: 'cuenta-saldo' }, [
        el('span', { class: 'cs-label' }, 'Saldo'),
        el('span', { class: 'cs-monto' }, fmtMoneda(saldo))
      ])
    ]));

    if (saldo > 0.01 && pid !== 'sin') {
      cont.appendChild(el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-bottom:16px',
        onclick: () => window.PADDOCK.pagos.abrir(pid, nombre, () => renderCuenta(cont))
      }, 'Registrar pago'));
    }

    if (!compras || !compras.length) {
      cont.appendChild(el('div', { class: 'empty' }, [ el('div', { class: 'empty-title' }, 'Sin facturas') ]));
      return;
    }

    const card = el('div', { class: 'card' });
    compras.forEach(c => {
      const est = estadoDe(c);
      const s = saldoDe(c);
      const sub = [c.tipo_comprobante, c.numero ? 'N° ' + c.numero : null, fmtFecha(c.fecha), (auth.esAdmin() && c.usuarios_app ? 'cargó ' + c.usuarios_app.nombre : null)].filter(Boolean).join('  ·  ');
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, fmtMoneda(c.total)),
          el('div', { class: 'list-row-sub' }, sub)
        ]),
        el('div', { class: 'compra-meta' }, [
          est !== 'pagada' ? el('div', { class: 'compra-saldo' }, 'Saldo ' + fmtMoneda(s)) : null,
          el('div', { class: 'estado-chip ' + est }, est)
        ]),
        el('div', { class: 'list-row-actions' }, [
          c.archivo_url ? el('a', { class: 'btn btn-ghost btn-sm', href: c.archivo_url, target: '_blank', rel: 'noopener' }, 'Factura') : null,
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(c, () => renderCuenta(cont)) }, 'Borrar')
        ])
      ]));
    });
    cont.appendChild(card);
  }

  router.registrar('compras', render);
  router.registrar('cuenta', renderCuenta);
})();
