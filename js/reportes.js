/* ============================================================
   REPORTES — informes exportables e imprimibles.
   Por ahora: Clientes (con sus vehículos), en Excel y PDF.
   Se irá sumando el resto de las secciones.
   ============================================================ */
(function () {
  const { db, ui, router } = window.PADDOCK;
  const { el, toast, modal } = ui;

  function fechaHoy() {
    return new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtMoneda(n) {
    return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
  function fmtFecha(f) {
    if (!f) return '';
    const [a, m, d] = String(f).split('-');
    return d + '/' + m + '/' + a;
  }
  function fmtFechaHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
           d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  async function traerClientes() {
    const { data, error } = await db
      .from('clientes')
      .select('nombre, telefono, email, notas, vehiculos(patente, marca, modelo, anio)')
      .order('nombre');
    if (error) { toast('No se pudieron cargar los datos.', 'error'); return null; }
    return data || [];
  }

  /* ---------- Excel ---------- */
  async function exportarExcel() {
    const clientes = await traerClientes();
    if (!clientes) return;

    // Hoja 1: Clientes
    const filasCli = [['Nombre', 'Teléfono', 'Email', 'Vehículos', 'Notas']];
    clientes.forEach(c => {
      const pats = (c.vehiculos || []).map(v => v.patente).join(', ');
      filasCli.push([c.nombre || '', c.telefono || '', c.email || '', pats, c.notas || '']);
    });

    // Hoja 2: Vehículos (uno por fila, con su dueño)
    const filasVeh = [['Patente', 'Marca', 'Modelo', 'Año', 'Cliente']];
    clientes.forEach(c => {
      (c.vehiculos || []).forEach(v => {
        filasVeh.push([v.patente || '', v.marca || '', v.modelo || '', v.anio || '', c.nombre || '']);
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasCli), 'Clientes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasVeh), 'Vehículos');
    XLSX.writeFile(wb, 'reporte_clientes.xlsx');
    toast('Excel generado.', 'ok');
  }

  /* ---------- Documento imprimible ---------- */
  async function renderReporteClientes(cont) {
    cont.appendChild(el('div', { class: 'loading' }, 'Armando el reporte…'));
    const clientes = await traerClientes();
    cont.innerHTML = '';
    if (!clientes) return;

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/clientes'; } }, '← Clientes'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF')
    ]));

    const doc = el('div', { class: 'reporte-doc', id: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [
        el('div', { class: 'od-brand-name' }, 'PADDOCK'),
        el('div', { class: 'od-brand-sub' }, 'Car Center')
      ]),
      el('div', { class: 'rep-title' }, [
        el('div', { class: 'od-title-txt' }, 'Listado de clientes'),
        el('div', { class: 'rep-fecha' }, fechaHoy()),
        el('div', { class: 'rep-total' }, clientes.length + (clientes.length === 1 ? ' cliente' : ' clientes'))
      ])
    ]));

    if (!clientes.length) {
      doc.appendChild(el('div', { class: 'muted' }, 'No hay clientes cargados.'));
    } else {
      clientes.forEach(c => {
        const contacto = [c.telefono, c.email].filter(Boolean).join('  ·  ');
        const veh = (c.vehiculos || []).map(v => {
          const d = [v.marca, v.modelo, v.anio].filter(Boolean).join(' ');
          return v.patente + (d ? ' — ' + d : '');
        });
        doc.appendChild(el('div', { class: 'rep-cliente' }, [
          el('div', { class: 'rep-cli-nombre' }, c.nombre),
          contacto ? el('div', { class: 'rep-cli-contacto' }, contacto) : null,
          veh.length
            ? el('div', { class: 'rep-cli-veh' }, veh.map(t => el('div', { class: 'rep-veh-item' }, '• ' + t)))
            : el('div', { class: 'rep-cli-veh muted' }, 'Sin vehículos cargados')
        ]));
      });
    }
    cont.appendChild(doc);
  }

  /* ---------- Elegir formato ---------- */
  function abrirClientes() {
    modal({
      titulo: 'Reporte de clientes',
      cuerpo: el('div', {}, [
        el('p', { class: 'imp-texto' }, 'Elegí el formato del reporte de clientes con sus vehículos.'),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: async () => { document.querySelector('.modal-overlay').remove(); await exportarExcel(); } }, '↓ Descargar Excel'),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => { document.querySelector('.modal-overlay').remove(); location.hash = '#/reporte-clientes'; } }, 'Ver / imprimir PDF')
      ]),
      textoGuardar: null
    });
    // Ocultamos el botón "Guardar" del modal (no aplica acá).
    const foot = document.querySelector('.modal-foot');
    if (foot && foot.lastChild) foot.lastChild.style.display = 'none';
  }

  /* ============================================================
     PROVEEDORES — cuentas por pagar
     ============================================================ */
  async function traerProveedoresCuentas() {
    const [{ data: proveedores }, { data: compras }, { data: aplic }] = await Promise.all([
      db.from('proveedores').select('id, nombre, telefono').order('nombre'),
      db.from('compras').select('id, numero, fecha, total, proveedor_id'),
      db.from('pago_aplicaciones').select('compra_id, monto')
    ]);
    if (!proveedores) { toast('No se pudieron cargar los datos.', 'error'); return null; }

    const pagado = {};
    (aplic || []).forEach(a => { pagado[a.compra_id] = (pagado[a.compra_id] || 0) + Number(a.monto); });

    // Agrupamos facturas por proveedor con su saldo.
    const porProv = {};
    (compras || []).forEach(c => {
      const saldo = Number(c.total) - (pagado[c.id] || 0);
      const pid = c.proveedor_id || 'sin';
      if (!porProv[pid]) porProv[pid] = [];
      porProv[pid].push({ ...c, saldo });
    });

    const lista = proveedores.map(p => {
      const facturas = porProv[p.id] || [];
      const saldo = facturas.reduce((a, f) => a + Math.max(0, f.saldo), 0);
      const pendientes = facturas.filter(f => f.saldo > 0.01);
      return { ...p, facturas, saldo, pendientes };
    });
    // Ordenamos por deuda (mayor primero)
    lista.sort((a, b) => b.saldo - a.saldo);
    return lista;
  }

  async function exportarProveedoresExcel() {
    const provs = await traerProveedoresCuentas();
    if (!provs) return;

    const filasProv = [['Proveedor', 'Teléfono', 'Deuda', 'Facturas pendientes']];
    provs.forEach(p => filasProv.push([p.nombre || '', p.telefono || '', p.saldo, p.pendientes.length]));

    const filasFac = [['Proveedor', 'N° Factura', 'Fecha', 'Total', 'Pagado', 'Saldo']];
    provs.forEach(p => {
      p.facturas.forEach(f => {
        filasFac.push([p.nombre || '', f.numero || '', fmtFecha(f.fecha), Number(f.total), Number(f.total) - f.saldo, f.saldo]);
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasProv), 'Proveedores');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasFac), 'Facturas');
    XLSX.writeFile(wb, 'reporte_proveedores.xlsx');
    toast('Excel generado.', 'ok');
  }

  async function renderReporteProveedores(cont) {
    cont.appendChild(el('div', { class: 'loading' }, 'Armando el reporte…'));
    const provs = await traerProveedoresCuentas();
    cont.innerHTML = '';
    if (!provs) return;

    const deudaTotal = provs.reduce((a, p) => a + p.saldo, 0);

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/proveedores'; } }, '← Proveedores'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF')
    ]));

    const doc = el('div', { class: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [
        el('div', { class: 'od-brand-name' }, 'PADDOCK'),
        el('div', { class: 'od-brand-sub' }, 'Car Center')
      ]),
      el('div', { class: 'rep-title' }, [
        el('div', { class: 'od-title-txt' }, 'Cuentas por pagar'),
        el('div', { class: 'rep-fecha' }, fechaHoy()),
        el('div', { class: 'rep-total' }, 'Deuda total: ' + fmtMoneda(deudaTotal))
      ])
    ]));

    const conDeuda = provs.filter(p => p.saldo > 0.01);
    if (!conDeuda.length) {
      doc.appendChild(el('div', { class: 'muted' }, 'No hay deudas pendientes. ¡Todo al día!'));
    } else {
      conDeuda.forEach(p => {
        const facs = p.pendientes.map(f =>
          el('div', { class: 'rep-fac-item' }, [
            el('span', {}, (f.numero ? 'Factura N° ' + f.numero : 'Factura') + '  ·  ' + fmtFecha(f.fecha)),
            el('span', { class: 'rep-fac-saldo' }, fmtMoneda(f.saldo))
          ])
        );
        doc.appendChild(el('div', { class: 'rep-cliente' }, [
          el('div', { class: 'rep-prov-head' }, [
            el('div', { class: 'rep-cli-nombre' }, p.nombre),
            el('div', { class: 'rep-prov-saldo' }, fmtMoneda(p.saldo))
          ]),
          p.telefono ? el('div', { class: 'rep-cli-contacto' }, p.telefono) : null,
          el('div', { class: 'rep-cli-veh' }, facs)
        ]));
      });
    }
    cont.appendChild(doc);
  }

  function abrirProveedores() {
    modal({
      titulo: 'Reporte de proveedores',
      cuerpo: el('div', {}, [
        el('p', { class: 'imp-texto' }, 'Cuentas por pagar: cuánto le debés a cada proveedor y el detalle de facturas.'),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: async () => { document.querySelector('.modal-overlay').remove(); await exportarProveedoresExcel(); } }, '↓ Descargar Excel'),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => { document.querySelector('.modal-overlay').remove(); location.hash = '#/reporte-proveedores'; } }, 'Ver / imprimir PDF')
      ]),
      textoGuardar: null
    });
    const foot = document.querySelector('.modal-foot');
    if (foot && foot.lastChild) foot.lastChild.style.display = 'none';
  }

  /* ============================================================
     VEHÍCULOS — con filtros (recibe la lista ya filtrada)
     ============================================================ */
  let vehiculosReporte = null;

  function datosVeh(v) {
    const desc = [v.marca, v.modelo, v.anio].filter(Boolean).join(' ');
    const dueno = v.clientes ? v.clientes.nombre : 'Sin dueño';
    return { desc, dueno };
  }

  function exportarVehiculosExcel(lista) {
    const filas = [['Patente', 'Marca', 'Modelo', 'Año', 'Km', 'Dueño', 'Alta']];
    (lista || []).forEach(v => {
      const alta = v.creado_en ? v.creado_en.slice(0, 10).split('-').reverse().join('/') : '';
      filas.push([v.patente || '', v.marca || '', v.modelo || '', v.anio || '', v.km || '', v.clientes ? v.clientes.nombre : '', alta]);
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Vehículos');
    XLSX.writeFile(wb, 'reporte_vehiculos.xlsx');
    toast('Excel generado.', 'ok');
  }

  function renderReporteVehiculos(cont) {
    const lista = vehiculosReporte || [];

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/vehiculos'; } }, '← Vehículos'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF')
    ]));

    const doc = el('div', { class: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [
        el('div', { class: 'od-brand-name' }, 'PADDOCK'),
        el('div', { class: 'od-brand-sub' }, 'Car Center')
      ]),
      el('div', { class: 'rep-title' }, [
        el('div', { class: 'od-title-txt' }, 'Listado de vehículos'),
        el('div', { class: 'rep-fecha' }, fechaHoy()),
        el('div', { class: 'rep-total' }, lista.length + (lista.length === 1 ? ' vehículo' : ' vehículos'))
      ])
    ]));

    if (!lista.length) {
      doc.appendChild(el('div', { class: 'muted' }, 'No hay vehículos para mostrar con esos filtros.'));
    } else {
      const tabla = el('div', { class: 'rep-tabla' });
      tabla.appendChild(el('div', { class: 'rep-tr rep-th' }, [
        el('div', {}, 'Patente'), el('div', {}, 'Vehículo'), el('div', {}, 'Dueño')
      ]));
      lista.forEach(v => {
        const { desc, dueno } = datosVeh(v);
        tabla.appendChild(el('div', { class: 'rep-tr' }, [
          el('div', { class: 'rep-pat' }, v.patente),
          el('div', {}, desc || '—'),
          el('div', {}, dueno)
        ]));
      });
      doc.appendChild(tabla);
    }
    cont.appendChild(doc);
  }

  function abrirVehiculos(lista) {
    vehiculosReporte = lista || [];
    modal({
      titulo: 'Reporte de vehículos',
      cuerpo: el('div', {}, [
        el('p', { class: 'imp-texto' }, (vehiculosReporte.length) + ' vehículo(s) con los filtros actuales. Elegí el formato.'),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: () => { document.querySelector('.modal-overlay').remove(); exportarVehiculosExcel(vehiculosReporte); } }, '↓ Descargar Excel'),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => { document.querySelector('.modal-overlay').remove(); location.hash = '#/reporte-vehiculos'; } }, 'Ver / imprimir PDF')
      ]),
      textoGuardar: null
    });
    const foot = document.querySelector('.modal-foot');
    if (foot && foot.lastChild) foot.lastChild.style.display = 'none';
  }

  /* ============================================================
     REPUESTOS — inventario
     ============================================================ */
  let repuestosReporte = null;
  function estadoStock(p) {
    const min = Number(p.stock_minimo) || 0;
    if (Number(p.stock) <= 0) return 'Sin stock';
    if (min > 0 && Number(p.stock) <= min) return 'Bajo';
    return 'OK';
  }
  async function traerRepuestos() {
    const { data, error } = await db.from('productos').select('*, proveedores(nombre)').order('nombre');
    if (error) { toast('No se pudieron cargar los datos.', 'error'); return null; }
    return data || [];
  }
  function exportarRepuestosExcel(lista) {
    const filas = [['Código', 'Nombre', 'Categoría', 'P. Compra', 'P. Venta', 'Stock', 'Mínimo', 'Estado', 'Proveedor']];
    (lista || []).forEach(p => filas.push([
      p.codigo || '', p.nombre || '', p.categoria || '', Number(p.precio_compra) || 0, Number(p.precio_venta) || 0,
      Number(p.stock) || 0, Number(p.stock_minimo) || 0, estadoStock(p), p.proveedores ? p.proveedores.nombre : ''
    ]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Inventario');
    XLSX.writeFile(wb, 'reporte_inventario.xlsx');
    toast('Excel generado.', 'ok');
  }
  async function renderReporteRepuestos(cont) {
    cont.appendChild(el('div', { class: 'loading' }, 'Armando el reporte…'));
    const lista = repuestosReporte || await traerRepuestos();
    cont.innerHTML = '';
    if (!lista) return;

    const valorVenta = lista.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.precio_venta) || 0), 0);
    const valorCompra = lista.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.precio_compra) || 0), 0);
    const bajos = lista.filter(p => estadoStock(p) !== 'OK');

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/repuestos'; } }, '← Repuestos'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF')
    ]));

    const doc = el('div', { class: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [ el('div', { class: 'od-brand-name' }, 'PADDOCK'), el('div', { class: 'od-brand-sub' }, 'Car Center') ]),
      el('div', { class: 'rep-title' }, [
        el('div', { class: 'od-title-txt' }, 'Inventario de repuestos'),
        el('div', { class: 'rep-fecha' }, fechaHoy()),
        el('div', { class: 'rep-total' }, lista.length + ' ítems')
      ])
    ]));
    doc.appendChild(el('div', { class: 'rep-resumen' }, [
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Valor a precio de venta: '), el('strong', {}, fmtMoneda(valorVenta)) ]),
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Valor a precio de costo: '), el('strong', {}, fmtMoneda(valorCompra)) ]),
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Con stock bajo o agotado: '), el('strong', {}, String(bajos.length)) ])
    ]));

    const tabla = el('div', { class: 'rep-tabla' });
    tabla.appendChild(el('div', { class: 'rep-tr rep-th rep-tr4' }, [ el('div', {}, 'Repuesto'), el('div', {}, 'Precio'), el('div', {}, 'Stock'), el('div', {}, 'Estado') ]));
    lista.forEach(p => {
      const est = estadoStock(p);
      tabla.appendChild(el('div', { class: 'rep-tr rep-tr4' }, [
        el('div', {}, p.nombre + (p.codigo ? ' (' + p.codigo + ')' : '')),
        el('div', {}, fmtMoneda(p.precio_venta)),
        el('div', {}, String(p.stock)),
        el('div', { class: est === 'OK' ? '' : 'rep-alerta' }, est)
      ]));
    });
    doc.appendChild(tabla);
    cont.appendChild(doc);
  }
  async function abrirRepuestos() {
    repuestosReporte = await traerRepuestos();
    if (!repuestosReporte) return;
    modal({
      titulo: 'Reporte de inventario',
      cuerpo: el('div', {}, [
        el('p', { class: 'imp-texto' }, 'Inventario completo con stock, precios y valorización.'),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: () => { document.querySelector('.modal-overlay').remove(); exportarRepuestosExcel(repuestosReporte); } }, '↓ Descargar Excel'),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => { document.querySelector('.modal-overlay').remove(); location.hash = '#/reporte-repuestos'; } }, 'Ver / imprimir PDF')
      ]),
      textoGuardar: null
    });
    const foot = document.querySelector('.modal-foot');
    if (foot && foot.lastChild) foot.lastChild.style.display = 'none';
  }

  /* ============================================================
     VENTAS — por período
     ============================================================ */
  let ventasReporte = null, ventasLabel = '';
  function limitesISO(desde, hasta) {
    const [a1, m1, d1] = desde.split('-').map(Number);
    const [a2, m2, d2] = hasta.split('-').map(Number);
    return {
      ini: new Date(a1, m1 - 1, d1, 0, 0, 0).toISOString(),
      fin: new Date(a2, m2 - 1, d2 + 1, 0, 0, 0).toISOString()
    };
  }
  async function traerVentas(desde, hasta) {
    const { ini, fin } = limitesISO(desde, hasta);
    const { data } = await db.from('operaciones')
      .select('id, creado_en, total, clientes(nombre)')
      .eq('tipo', 'venta').gte('creado_en', ini).lt('creado_en', fin)
      .order('creado_en', { ascending: false });
    return data || [];
  }
  function exportarVentasExcel(lista) {
    const filas = [['Fecha', 'Cliente', 'Total']];
    (lista || []).forEach(v => filas.push([fmtFechaHora(v.creado_en), v.clientes ? v.clientes.nombre : 'Mostrador', Number(v.total) || 0]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Ventas');
    XLSX.writeFile(wb, 'reporte_ventas.xlsx');
    toast('Excel generado.', 'ok');
  }
  function renderReporteVentas(cont) {
    const lista = ventasReporte || [];
    const total = lista.reduce((a, v) => a + (Number(v.total) || 0), 0);

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/ventas'; } }, '← Ventas'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF')
    ]));
    const doc = el('div', { class: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [ el('div', { class: 'od-brand-name' }, 'PADDOCK'), el('div', { class: 'od-brand-sub' }, 'Car Center') ]),
      el('div', { class: 'rep-title' }, [
        el('div', { class: 'od-title-txt' }, 'Ventas'),
        el('div', { class: 'rep-fecha' }, ventasLabel),
        el('div', { class: 'rep-total' }, 'Total: ' + fmtMoneda(total))
      ])
    ]));
    if (!lista.length) {
      doc.appendChild(el('div', { class: 'muted' }, 'No hubo ventas en este período.'));
    } else {
      const tabla = el('div', { class: 'rep-tabla' });
      tabla.appendChild(el('div', { class: 'rep-tr rep-th' }, [ el('div', {}, 'Fecha'), el('div', {}, 'Cliente'), el('div', {}, 'Total') ]));
      lista.forEach(v => tabla.appendChild(el('div', { class: 'rep-tr' }, [
        el('div', {}, fmtFechaHora(v.creado_en)),
        el('div', {}, v.clientes ? v.clientes.nombre : 'Mostrador'),
        el('div', {}, fmtMoneda(v.total))
      ])));
      doc.appendChild(tabla);
    }
    cont.appendChild(doc);
  }
  function abrirVentas() {
    const hoy = new Date().toISOString().slice(0, 10);
    const primero = hoy.slice(0, 8) + '01';
    const inpD = el('input', { type: 'date', value: primero });
    const inpH = el('input', { type: 'date', value: hoy });

    async function preparar(navegar) {
      const desde = inpD.value || primero, hasta = inpH.value || hoy;
      ventasReporte = await traerVentas(desde, hasta);
      ventasLabel = fmtFecha(desde) + ' a ' + fmtFecha(hasta);
      document.querySelector('.modal-overlay').remove();
      if (navegar) location.hash = '#/reporte-ventas';
      else exportarVentasExcel(ventasReporte);
    }

    modal({
      titulo: 'Reporte de ventas',
      cuerpo: el('div', {}, [
        el('p', { class: 'imp-texto' }, 'Elegí el período.'),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [ el('label', {}, 'Desde'), inpD ]),
          el('div', { class: 'field' }, [ el('label', {}, 'Hasta'), inpH ])
        ]),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: () => preparar(false) }, '↓ Descargar Excel'),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => preparar(true) }, 'Ver / imprimir PDF')
      ]),
      textoGuardar: null
    });
    const foot = document.querySelector('.modal-foot');
    if (foot && foot.lastChild) foot.lastChild.style.display = 'none';
  }

  /* ============================================================
     CAJA — recibe los movimientos del período mostrado
     ============================================================ */
  let cajaReporte = null, cajaLabel = '', cajaTot = null;
  function exportarCajaExcel(lista) {
    const filas = [['Fecha', 'Tipo', 'Concepto', 'Medio', 'Monto']];
    (lista || []).forEach(m => filas.push([
      fmtFechaHora(m.creado_en), m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
      m.concepto || '', m.medio_pago || '', (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0)
    ]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Caja');
    XLSX.writeFile(wb, 'reporte_caja.xlsx');
    toast('Excel generado.', 'ok');
  }
  function renderReporteCaja(cont) {
    const lista = cajaReporte || [];
    const t = cajaTot || { ing: 0, egr: 0, saldo: 0 };

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/caja'; } }, '← Caja'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF')
    ]));
    const doc = el('div', { class: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [ el('div', { class: 'od-brand-name' }, 'PADDOCK'), el('div', { class: 'od-brand-sub' }, 'Car Center') ]),
      el('div', { class: 'rep-title' }, [
        el('div', { class: 'od-title-txt' }, 'Movimientos de caja'),
        el('div', { class: 'rep-fecha' }, cajaLabel)
      ])
    ]));
    doc.appendChild(el('div', { class: 'rep-resumen' }, [
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Ingresos: '), el('strong', {}, fmtMoneda(t.ing)) ]),
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Egresos: '), el('strong', {}, fmtMoneda(t.egr)) ]),
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Saldo: '), el('strong', {}, fmtMoneda(t.saldo)) ])
    ]));
    if (!lista.length) {
      doc.appendChild(el('div', { class: 'muted' }, 'Sin movimientos en este período.'));
    } else {
      const tabla = el('div', { class: 'rep-tabla' });
      tabla.appendChild(el('div', { class: 'rep-tr rep-th rep-tr4' }, [ el('div', {}, 'Fecha'), el('div', {}, 'Concepto'), el('div', {}, 'Medio'), el('div', {}, 'Monto') ]));
      lista.forEach(m => {
        const esIng = m.tipo === 'ingreso';
        tabla.appendChild(el('div', { class: 'rep-tr rep-tr4' }, [
          el('div', {}, fmtFechaHora(m.creado_en)),
          el('div', {}, m.concepto || ''),
          el('div', {}, m.medio_pago || ''),
          el('div', { class: esIng ? 'rep-ing' : 'rep-egr' }, (esIng ? '+ ' : '− ') + fmtMoneda(m.monto))
        ]));
      });
      doc.appendChild(tabla);
    }
    cont.appendChild(doc);
  }
  function abrirCaja(lista, label, totales) {
    cajaReporte = lista || []; cajaLabel = label || ''; cajaTot = totales || null;
    modal({
      titulo: 'Reporte de caja',
      cuerpo: el('div', {}, [
        el('p', { class: 'imp-texto' }, 'Movimientos del período que estás viendo (' + (label || '') + ').'),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: () => { document.querySelector('.modal-overlay').remove(); exportarCajaExcel(cajaReporte); } }, '↓ Descargar Excel'),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => { document.querySelector('.modal-overlay').remove(); location.hash = '#/reporte-caja'; } }, 'Ver / imprimir PDF')
      ]),
      textoGuardar: null
    });
    const foot = document.querySelector('.modal-foot');
    if (foot && foot.lastChild) foot.lastChild.style.display = 'none';
  }

  router.registrar('reporte-clientes', renderReporteClientes);
  router.registrar('reporte-proveedores', renderReporteProveedores);
  router.registrar('reporte-vehiculos', renderReporteVehiculos);
  router.registrar('reporte-repuestos', renderReporteRepuestos);
  router.registrar('reporte-ventas', renderReporteVentas);
  router.registrar('reporte-caja', renderReporteCaja);
  window.PADDOCK.reportes = { abrirClientes, abrirProveedores, abrirVehiculos, abrirRepuestos, abrirVentas, abrirCaja };
})();
