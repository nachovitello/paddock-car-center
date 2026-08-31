/* ============================================================
   Vista VENTAS — venta de mostrador.
   Al cerrar una venta, en cadena:
     1. crea la operación (tipo 'venta', cerrada)
     2. guarda cada ítem (operacion_items)
     3. descuenta stock + deja movimiento_stock 'salida'
     4. registra el ingreso en movimientos_caja
   Stock permisivo: si no alcanza, avisa pero deja vender.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, confirmar } = ui;

  let productos = [];   // catálogo
  let clientes = [];
  let venta = [];       // carrito: { producto_id, nombre, precio_unit, cantidad, stock }
  let contActual = null;
  let filtroBusq = '';

  function fmtMoneda(n) {
    if (n == null) return '$0';
    return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }

  async function traerProductos() {
    const { data } = await db.from('productos')
      .select('id, nombre, codigo, precio_venta, stock')
      .eq('activo', true)
      .order('nombre');
    return data || [];
  }
  async function traerClientes() {
    const { data } = await db.from('clientes').select('id, nombre').order('nombre');
    return data || [];
  }

  /* ---------- Carrito ---------- */
  function agregar(prod) {
    const existente = venta.find(l => l.producto_id === prod.id);
    if (existente) {
      existente.cantidad += 1;
    } else {
      venta.push({
        producto_id: prod.id,
        nombre: prod.nombre,
        precio_unit: Number(prod.precio_venta) || 0,
        cantidad: 1,
        stock: Number(prod.stock) || 0
      });
    }
    filtroBusq = '';
    const busq = document.getElementById('venta-busqueda');
    if (busq) busq.value = '';
    repintar();
  }

  function quitar(idx) { venta.splice(idx, 1); repintar(); }

  function total() {
    return venta.reduce((acc, l) => acc + (l.precio_unit * l.cantidad), 0);
  }

  function pintarResultados() {
    const cont = document.getElementById('venta-resultados');
    if (!cont) return;
    cont.innerHTML = '';
    const q = filtroBusq.trim().toLowerCase();
    if (!q) return;

    const matches = productos.filter(p =>
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.codigo || '').toLowerCase().includes(q)
    ).slice(0, 8);

    if (!matches.length) {
      cont.appendChild(el('div', { class: 'busq-vacio' }, 'Sin resultados.'));
      return;
    }
    matches.forEach(p => {
      cont.appendChild(el('div', { class: 'busq-item', onclick: () => agregar(p) }, [
        el('div', {}, [
          el('div', { class: 'busq-nombre' }, p.nombre),
          el('div', { class: 'busq-sub' }, (p.codigo ? 'Cód. ' + p.codigo + '  ·  ' : '') + 'Stock: ' + p.stock)
        ]),
        el('div', { class: 'busq-precio' }, fmtMoneda(p.precio_venta))
      ]));
    });
  }

  function pintarCarrito() {
    const cont = document.getElementById('venta-carrito');
    if (!cont) return;
    cont.innerHTML = '';

    if (!venta.length) {
      cont.appendChild(el('div', { class: 'carrito-vacio' }, 'Todavía no agregaste nada. Buscá un repuesto arriba.'));
      return;
    }

    venta.forEach((l, idx) => {
      const subtotal = l.precio_unit * l.cantidad;
      const sinStock = l.cantidad > l.stock;
      cont.appendChild(el('div', { class: 'carrito-linea' }, [
        el('div', { class: 'cl-nombre' }, [
          l.nombre,
          sinStock ? el('span', { class: 'cl-aviso' }, ' ⚠ supera stock (' + l.stock + ')') : null
        ]),
        el('div', { class: 'cl-cant' }, [
          el('input', {
            type: 'number', min: '1', step: '1', value: String(l.cantidad),
            class: 'input-cant',
            oninput: (e) => {
              l.cantidad = Math.max(1, parseInt(e.target.value || '1', 10));
              // Actualizamos solo totales y avisos sin re-pintar todo el input.
              document.getElementById('venta-total').textContent = fmtMoneda(total());
            },
            onblur: () => repintar()
          })
        ]),
        el('div', { class: 'cl-precio' }, [
          el('span', { class: 'cl-x' }, '×'),
          el('input', {
            type: 'number', min: '0', step: '1', value: String(l.precio_unit),
            class: 'input-precio',
            oninput: (e) => {
              l.precio_unit = Math.max(0, Number(e.target.value || 0));
              document.getElementById('venta-total').textContent = fmtMoneda(total());
            },
            onblur: () => repintar()
          })
        ]),
        el('div', { class: 'cl-subtotal' }, fmtMoneda(subtotal)),
        el('button', { class: 'cl-quitar', 'aria-label': 'Quitar', onclick: () => quitar(idx) }, '×')
      ]));
    });
  }

  function repintar() {
    pintarResultados();
    pintarCarrito();
    const t = document.getElementById('venta-total');
    if (t) t.textContent = fmtMoneda(total());
    const btn = document.getElementById('venta-cerrar');
    if (btn) btn.disabled = venta.length === 0;
  }

  /* ---------- Cerrar venta ---------- */
  async function cerrarVenta() {
    if (!venta.length) return;

    const btn = document.getElementById('venta-cerrar');
    const clienteId = document.getElementById('venta-cliente').value || null;
    const medio = document.getElementById('venta-medio').value;
    const montoTotal = total();

    const ok = await confirmar('Cerrar venta por ' + fmtMoneda(montoTotal) + '?', 'Cerrar venta');
    if (!ok) return;

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const usuario_id = (auth.sesion() || {}).id || null;

    try {
      // 1. La operación
      const { data: op, error: e1 } = await db.from('operaciones').insert({
        tipo: 'venta', estado: 'cerrada', cliente_id: clienteId, usuario_id,
        descripcion: 'Venta de mostrador', total: montoTotal, cerrado_en: new Date().toISOString()
      }).select('id').single();
      if (e1 || !op) throw e1 || new Error('op');

      // 2. Los ítems
      const items = venta.map(l => ({
        operacion_id: op.id, tipo_item: 'producto', producto_id: l.producto_id,
        descripcion: l.nombre, cantidad: l.cantidad, precio_unit: l.precio_unit,
        subtotal: l.precio_unit * l.cantidad
      }));
      const { error: e2 } = await db.from('operacion_items').insert(items);
      if (e2) throw e2;

      // 3. Descontar stock (sobre el valor real actual) + movimientos
      const ids = venta.map(l => l.producto_id);
      const { data: actuales } = await db.from('productos').select('id, stock').in('id', ids);
      const mapa = {};
      (actuales || []).forEach(p => { mapa[p.id] = Number(p.stock) || 0; });

      for (const l of venta) {
        const nuevo = (mapa[l.producto_id] ?? 0) - l.cantidad;
        await db.from('productos').update({ stock: nuevo }).eq('id', l.producto_id);
      }
      const movs = venta.map(l => ({
        producto_id: l.producto_id, tipo: 'salida', cantidad: l.cantidad,
        operacion_id: op.id, motivo: 'Venta mostrador', usuario_id
      }));
      await db.from('movimientos_stock').insert(movs);

      // 4. Caja
      const { error: e4 } = await db.from('movimientos_caja').insert({
        tipo: 'ingreso', monto: montoTotal, medio_pago: medio,
        concepto: 'Venta de mostrador', operacion_id: op.id, usuario_id
      });
      if (e4) throw e4;

      toast('Venta cerrada por ' + fmtMoneda(montoTotal) + '.', 'ok');
      venta = [];
      productos = await traerProductos();  // stock actualizado
      render(contActual);
    } catch (err) {
      toast('Hubo un problema al guardar la venta. Revisá e intentá de nuevo.', 'error');
      btn.disabled = false;
      btn.textContent = 'Cerrar venta';
    }
  }

  /* ---------- Render ---------- */
  async function render(cont) {
    contActual = cont;
    cont.innerHTML = '';
    cont.appendChild(el('div', { class: 'view-head' }, [ el('h1', {}, 'Nueva venta') ]));

    if (!productos.length) cont.appendChild(el('div', { class: 'loading' }, 'Cargando catálogo…'));
    [productos, clientes] = await Promise.all([traerProductos(), traerClientes()]);
    cont.innerHTML = '';
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Nueva venta'),
      el('button', { class: 'btn btn-ghost', onclick: () => window.PADDOCK.reportes.abrirVentas() }, 'Reporte')
    ]));

    // Buscador
    cont.appendChild(el('div', { class: 'venta-buscador' }, [
      el('input', {
        id: 'venta-busqueda', class: 'search', type: 'text',
        placeholder: 'Buscar repuesto por nombre o código…',
        oninput: (e) => { filtroBusq = e.target.value; pintarResultados(); }
      }),
      el('div', { id: 'venta-resultados', class: 'venta-resultados' })
    ]));

    // Carrito
    cont.appendChild(el('div', { id: 'venta-carrito', class: 'card venta-carrito' }));

    // Opciones de cliente
    const opcCliente = [el('option', { value: '' }, '— Sin cliente —')];
    clientes.forEach(c => opcCliente.push(el('option', { value: c.id }, c.nombre)));

    // Pie de venta
    cont.appendChild(el('div', { class: 'venta-pie card' }, [
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'venta-cliente' }, 'Cliente (opcional)'),
          el('select', { id: 'venta-cliente' }, opcCliente)
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'venta-medio' }, 'Medio de pago'),
          el('select', { id: 'venta-medio' }, [
            el('option', { value: 'efectivo' }, 'Efectivo'),
            el('option', { value: 'transferencia' }, 'Transferencia'),
            el('option', { value: 'tarjeta' }, 'Tarjeta')
          ])
        ])
      ]),
      el('div', { class: 'venta-total-fila' }, [
        el('span', { class: 'vt-label' }, 'Total'),
        el('span', { id: 'venta-total', class: 'vt-monto' }, '$0')
      ]),
      el('button', {
        id: 'venta-cerrar', class: 'btn btn-primary btn-block', disabled: true,
        onclick: cerrarVenta
      }, 'Cerrar venta')
    ]));

    repintar();
  }

  router.registrar('ventas', render);
})();
