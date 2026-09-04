/* ============================================================
   Vista TALLER — órdenes de trabajo con checklist de control.
   La orden combina:
     · checklist de control del vehículo (Bien/Regular/Mal)
     · motivo de ingreso + observaciones
     · repuestos del stock (descuentan inventario)
     · mano de obra + total
   Queda 'a cobrar' (no toca la caja). Se engancha con la
   ficha del vehículo. La carga es una pantalla propia.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, confirmar } = ui;

  // Checklist fijo (base de la planilla de Paddock). Configurable a futuro.
  const CHECKLIST = [
    { seccion: 'Fluidos', items: [
      { nombre: 'Aceite motor', tipo: 'aceite' },
      { nombre: 'Filtro de aceite', tipo: 'brm' },
      { nombre: 'Filtro de aire', tipo: 'brm' },
      { nombre: 'Líquido de frenos', tipo: 'brm' },
      { nombre: 'Líquido lavaparabrisas', tipo: 'brm' }
    ] },
    { seccion: 'Tren delantero', items: [ { nombre: 'Estado general', tipo: 'brm' } ] },
    { seccion: 'Tren trasero', items: [ { nombre: 'Suspensión', tipo: 'brm' } ] },
    { seccion: 'Frenos', items: [ { nombre: 'Pastillas', tipo: 'brm' }, { nombre: 'Discos', tipo: 'brm' }, { nombre: 'Cintas / campanas', tipo: 'brm' } ] },
    { seccion: 'Neumáticos', items: [ { nombre: 'Alineado', tipo: 'brm' }, { nombre: 'Balanceado', tipo: 'brm' }, { nombre: 'Presión', tipo: 'brm' } ] }
  ];

  let cache = [];
  let vehiculos = [];
  let productos = [];
  let filtro = '';
  let contActual = null;

  function fmtMoneda(n) { return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 }); }
  function fmtFecha(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /* ---------- Datos ---------- */
  async function traer() {
    const { data, error } = await db.from('operaciones')
      .select('*, vehiculos(patente), clientes(nombre)')
      .eq('tipo', 'taller')
      .order('creado_en', { ascending: false });
    if (error) { toast('No se pudieron cargar las órdenes.', 'error'); return []; }
    return data || [];
  }
  async function traerVehiculos() {
    const { data } = await db.from('vehiculos').select('id, patente, marca, modelo, cliente_id, clientes(nombre)').order('patente');
    return data || [];
  }
  async function traerProductos() {
    const { data } = await db.from('productos').select('id, nombre, precio_venta, stock').eq('activo', true).order('nombre');
    return data || [];
  }

  /* ============================================================
     PANTALLA: NUEVA ORDEN
     ============================================================ */
  async function renderNueva(cont) {
    document.querySelectorAll('.mainnav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-route') === 'taller'));

    cont.appendChild(el('div', { class: 'loading' }, 'Cargando…'));
    if (!vehiculos.length || !productos.length) {
      [vehiculos, productos] = await Promise.all([traerVehiculos(), traerProductos()]);
    }
    cont.innerHTML = '';

    // Estado del formulario
    let vehiculoSel = null;
    const estados = {};          // "Sección::Ítem" -> 'bien'|'regular'|'mal'
    const obsSeccion = {};       // "Sección" -> texto observación
    const aceite = { cambiado: null, tipo: '' };   // aceite motor
    let repuestos = [];

    cont.appendChild(el('div', { class: 'detail-head' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/taller'; } }, '← Taller'),
    ]));
    cont.appendChild(el('div', { class: 'view-head' }, [ el('h1', {}, 'Nueva orden de trabajo') ]));

    /* --- Vehículo --- */
    const vehInfo = el('div', { class: 'orden-veh-sel', hidden: true });
    const vehBusq = el('input', { type: 'text', class: 'search', placeholder: 'Buscar vehículo por patente…' });
    const vehResultados = el('div', { class: 'venta-resultados' });
    const vehBusqWrap = el('div', {}, [vehBusq, vehResultados]);

    function pintarVeh() {
      vehResultados.innerHTML = '';
      const q = vehBusq.value.trim().toLowerCase();
      if (!q) return;
      vehiculos.filter(v => (v.patente || '').toLowerCase().includes(q) || (v.marca || '').toLowerCase().includes(q) || (v.modelo || '').toLowerCase().includes(q))
        .slice(0, 8).forEach(v => {
          vehResultados.appendChild(el('div', { class: 'busq-item', onclick: () => elegirVeh(v) }, [
            el('div', {}, [ el('div', { class: 'busq-nombre' }, v.patente), el('div', { class: 'busq-sub' }, [v.marca, v.modelo].filter(Boolean).join(' ') + (v.clientes ? '  ·  ' + v.clientes.nombre : '')) ])
          ]));
        });
    }
    function elegirVeh(v) {
      vehiculoSel = v;
      vehBusqWrap.hidden = true;
      vehInfo.hidden = false;
      vehInfo.innerHTML = '';
      vehInfo.appendChild(el('div', {}, [
        el('span', { class: 'patente-tag' }, v.patente),
        el('span', { style: 'margin-left:10px' }, [v.marca, v.modelo].filter(Boolean).join(' ')),
        el('div', { class: 'list-row-sub' }, v.clientes ? 'Cliente: ' + v.clientes.nombre : 'Sin cliente asignado')
      ]));
      vehInfo.appendChild(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:8px', onclick: () => { vehiculoSel = null; vehInfo.hidden = true; vehBusqWrap.hidden = false; vehBusq.focus(); } }, 'Cambiar'));
    }
    vehBusq.addEventListener('input', pintarVeh);

    cont.appendChild(el('label', { class: 'sublabel' }, 'Vehículo'));
    cont.appendChild(vehBusqWrap);
    cont.appendChild(vehInfo);

    /* --- Motivo + km --- */
    cont.appendChild(el('div', { class: 'field-row', style: 'margin-top:16px' }, [
      el('div', { class: 'field' }, [ el('label', { for: 'o-motivo' }, 'Motivo de ingreso'), el('input', { id: 'o-motivo', type: 'text', placeholder: 'ej. service, ruido en tren delantero…' }) ]),
      el('div', { class: 'field' }, [ el('label', { for: 'o-km' }, 'Kilometraje'), el('input', { id: 'o-km', type: 'number', min: '0' }) ])
    ]));

    /* --- Checklist --- */
    cont.appendChild(el('h2', { class: 'section-title' }, 'Control del vehículo'));
    const chkWrap = el('div', { class: 'card', style: 'padding:4px 0' });

    function botonesBRM(key) {
      const btnsWrap = el('div', { class: 'chk-btns' });
      ['bien', 'regular', 'mal'].forEach(estado => {
        const b = el('button', { class: 'chk-btn chk-' + estado, type: 'button' }, estado === 'bien' ? 'B' : (estado === 'regular' ? 'R' : 'M'));
        b.addEventListener('click', () => {
          const yaEstaba = estados[key] === estado;
          btnsWrap.querySelectorAll('.chk-btn').forEach(x => x.classList.remove('activo'));
          if (yaEstaba) { delete estados[key]; } else { estados[key] = estado; b.classList.add('activo'); }
        });
        btnsWrap.appendChild(b);
      });
      return btnsWrap;
    }

    CHECKLIST.forEach(sec => {
      chkWrap.appendChild(el('div', { class: 'chk-seccion' }, sec.seccion));
      sec.items.forEach(item => {
        if (item.tipo === 'aceite') {
          // Aceite motor: Cambiado / No cambiado + qué aceite
          const wrap = el('div', { class: 'chk-btns' });
          const inpTipo = el('input', { type: 'text', class: 'chk-aceite-input', placeholder: '¿Qué aceite?', value: aceite.tipo });
          inpTipo.addEventListener('input', () => { aceite.tipo = inpTipo.value; });
          [['si', 'Cambiado'], ['no', 'No']].forEach(([val, txt]) => {
            const b = el('button', { class: 'chk-btn chk-aceite chk-' + (val === 'si' ? 'bien' : 'mal'), type: 'button', style: 'width:auto;padding:0 12px' }, txt);
            b.addEventListener('click', () => {
              const ya = aceite.cambiado === val;
              wrap.querySelectorAll('.chk-btn').forEach(x => x.classList.remove('activo'));
              if (ya) { aceite.cambiado = null; } else { aceite.cambiado = val; b.classList.add('activo'); }
            });
            wrap.appendChild(b);
          });
          chkWrap.appendChild(el('div', { class: 'chk-fila' }, [ el('div', { class: 'chk-item' }, item.nombre), wrap ]));
          chkWrap.appendChild(el('div', { class: 'chk-aceite-row' }, [inpTipo]));
        } else {
          const key = sec.seccion + '::' + item.nombre;
          chkWrap.appendChild(el('div', { class: 'chk-fila' }, [ el('div', { class: 'chk-item' }, item.nombre), botonesBRM(key) ]));
        }
      });
      // Observación de la sección
      const obs = el('input', { type: 'text', class: 'chk-obs-input', placeholder: 'Observaciones de ' + sec.seccion.toLowerCase() + '…' });
      obs.addEventListener('input', () => { obsSeccion[sec.seccion] = obs.value.trim() || undefined; });
      chkWrap.appendChild(el('div', { class: 'chk-obs-row' }, [obs]));
    });
    cont.appendChild(chkWrap);

    cont.appendChild(el('div', { class: 'field', style: 'margin-top:12px' }, [
      el('label', { for: 'o-obs' }, 'Observaciones generales'),
      el('textarea', { id: 'o-obs', placeholder: 'Notas del control, recomendaciones…' }, '')
    ]));

    /* --- Repuestos + mano de obra --- */
    cont.appendChild(el('h2', { class: 'section-title' }, 'Repuestos y mano de obra'));
    const repBusq = el('input', { type: 'text', class: 'search', placeholder: 'Agregar repuesto del stock…' });
    const repResultados = el('div', { class: 'venta-resultados' });
    const repCarrito = el('div', { class: 'orden-repuestos' });
    const manoObra = el('input', { id: 'o-mano', type: 'number', min: '0', step: '1', value: '', placeholder: '0', class: 'input-mano' });
    const totalDiv = el('div', { class: 'orden-total' }, 'Total: $0');

    function totalRepuestos() { return repuestos.reduce((a, r) => a + r.precio_unit * r.cantidad, 0); }
    function recalc() { totalDiv.textContent = 'Total: ' + fmtMoneda(totalRepuestos() + Number(manoObra.value || 0)); }
    manoObra.addEventListener('input', recalc);

    function pintarRepBusq() {
      repResultados.innerHTML = '';
      const q = repBusq.value.trim().toLowerCase();
      if (!q) return;
      productos.filter(p => (p.nombre || '').toLowerCase().includes(q)).slice(0, 8).forEach(p => {
        repResultados.appendChild(el('div', { class: 'busq-item', onclick: () => agregarRep(p) }, [
          el('div', {}, [ el('div', { class: 'busq-nombre' }, p.nombre), el('div', { class: 'busq-sub' }, 'Stock: ' + p.stock) ]),
          el('div', { class: 'busq-precio' }, fmtMoneda(p.precio_venta))
        ]));
      });
    }
    function agregarRep(p) {
      const ex = repuestos.find(r => r.producto_id === p.id);
      if (ex) ex.cantidad += 1;
      else repuestos.push({ producto_id: p.id, nombre: p.nombre, precio_unit: Number(p.precio_venta) || 0, cantidad: 1, stock: Number(p.stock) || 0 });
      repBusq.value = ''; repResultados.innerHTML = '';
      pintarCarrito(); recalc();
    }
    function pintarCarrito() {
      repCarrito.innerHTML = '';
      repuestos.forEach((r, idx) => {
        const sinStock = r.cantidad > r.stock;
        repCarrito.appendChild(el('div', { class: 'carrito-linea' }, [
          el('div', { class: 'cl-nombre' }, [ r.nombre, sinStock ? el('span', { class: 'cl-aviso' }, ' ⚠ supera stock (' + r.stock + ')') : null ]),
          el('input', { class: 'input-cant', type: 'number', min: '1', value: String(r.cantidad), oninput: (e) => { r.cantidad = Math.max(1, parseInt(e.target.value || '1', 10)); recalc(); }, onblur: pintarCarrito }),
          el('div', { class: 'cl-subtotal' }, fmtMoneda(r.precio_unit * r.cantidad)),
          el('button', { class: 'cl-quitar', onclick: () => { repuestos.splice(idx, 1); pintarCarrito(); recalc(); } }, '\u00d7')
        ]));
      });
    }
    repBusq.addEventListener('input', pintarRepBusq);

    cont.appendChild(el('div', {}, [repBusq, repResultados]));
    cont.appendChild(repCarrito);
    cont.appendChild(el('div', { class: 'field', style: 'margin-top:12px' }, [ el('label', { for: 'o-mano' }, 'Mano de obra ($)'), manoObra ]));
    cont.appendChild(totalDiv);

    /* --- Guardar --- */
    const btnGuardar = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:16px' }, 'Guardar orden');
    btnGuardar.addEventListener('click', async () => {
      if (!vehiculoSel) { toast('Elegí un vehículo.', 'error'); return; }
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';

      const mano = Number(manoObra.value || 0);
      const total = totalRepuestos() + mano;
      const usuario_id = (auth.sesion() || {}).id || null;
      const km = document.getElementById('o-km').value;
      const motivo = document.getElementById('o-motivo').value.trim();
      const checklist = {
        motivo,
        observaciones: document.getElementById('o-obs').value.trim() || null,
        estados,
        obsSeccion,
        aceite
      };

      try {
        const { data: orden, error: e1 } = await db.from('operaciones').insert({
          tipo: 'taller', estado: 'pendiente',
          vehiculo_id: vehiculoSel.id, cliente_id: vehiculoSel.cliente_id || null, usuario_id,
          descripcion: motivo || 'Orden de trabajo',
          km_ingreso: km ? parseInt(km, 10) : null,
          total, checklist, cerrado_en: new Date().toISOString()
        }).select('id').single();
        if (e1 || !orden) throw e1 || new Error('orden');

        const items = repuestos.map(r => ({ operacion_id: orden.id, tipo_item: 'producto', producto_id: r.producto_id, descripcion: r.nombre, cantidad: r.cantidad, precio_unit: r.precio_unit, subtotal: r.precio_unit * r.cantidad }));
        if (mano > 0) items.push({ operacion_id: orden.id, tipo_item: 'mano_obra', descripcion: 'Mano de obra', cantidad: 1, precio_unit: mano, subtotal: mano });
        if (items.length) await db.from('operacion_items').insert(items);

        if (repuestos.length) {
          const ids = repuestos.map(r => r.producto_id);
          const { data: act } = await db.from('productos').select('id, stock').in('id', ids);
          const mapa = {}; (act || []).forEach(p => { mapa[p.id] = Number(p.stock) || 0; });
          for (const r of repuestos) await db.from('productos').update({ stock: (mapa[r.producto_id] || 0) - r.cantidad }).eq('id', r.producto_id);
          await db.from('movimientos_stock').insert(repuestos.map(r => ({ producto_id: r.producto_id, tipo: 'salida', cantidad: r.cantidad, operacion_id: orden.id, motivo: 'Orden de trabajo', usuario_id })));
        }

        toast('Orden creada.', 'ok');
        productos = await traerProductos();
        location.hash = '#/taller';
      } catch (err) {
        toast('No se pudo guardar la orden.', 'error');
        btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar orden';
      }
    });
    cont.appendChild(btnGuardar);

    setTimeout(() => vehBusq.focus(), 50);
  }

  /* ============================================================
     LISTA DE ÓRDENES
     ============================================================ */
  async function eliminar(o) {
    const ok = await confirmar('¿Eliminar esta orden de trabajo? (El stock descontado no se repone.)');
    if (!ok) return;
    const { error } = await db.from('operaciones').delete().eq('id', o.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Orden eliminada.', 'ok');
    recargar();
  }

  function coincide(o) {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return (o.vehiculos && (o.vehiculos.patente || '').toLowerCase().includes(q)) ||
           (o.clientes && (o.clientes.nombre || '').toLowerCase().includes(q)) ||
           (o.descripcion || '').toLowerCase().includes(q);
  }

  function pintarLista(cont) {
    const lista = cache.filter(coincide);
    const wrap = cont.querySelector('#lista-ordenes');
    wrap.innerHTML = '';
    if (!lista.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, cache.length ? 'Sin resultados' : 'Todavía no hay órdenes'),
        el('div', {}, cache.length ? 'Probá con otra búsqueda.' : 'Cargá la primera con el botón de arriba.')
      ]));
      return;
    }
    const card = el('div', { class: 'card' });
    lista.forEach(o => {
      const est = o.estado === 'cobrada' ? 'pagada' : (o.estado === 'parcial' ? 'parcial' : 'pendiente');
      const estTxt = o.estado === 'cobrada' ? 'cobrada' : (o.estado === 'parcial' ? 'parcial' : 'a cobrar');
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, [
            o.vehiculos ? el('span', { class: 'patente-tag' }, o.vehiculos.patente) : el('span', {}, 'Sin patente'),
            el('span', { style: 'margin-left:10px;font-weight:500' }, o.clientes ? o.clientes.nombre : 'Sin cliente')
          ]),
          el('div', { class: 'list-row-sub' }, (o.numero_orden ? 'Orden N° ' + o.numero_orden + '  ·  ' : '') + fmtFecha(o.creado_en) + '  ·  ' + (o.descripcion || ''))
        ]),
        el('div', { class: 'compra-meta' }, [
          el('div', { class: 'compra-total' }, fmtMoneda(o.total)),
          el('div', { class: 'estado-chip ' + est }, estTxt)
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { location.hash = '#/ficha-orden?id=' + o.id; } }, 'Ficha'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(o) }, 'Borrar')
        ])
      ]));
    });
    wrap.appendChild(card);
  }

  async function recargar() {
    cache = await traer();
    if (contActual) pintarLista(contActual);
  }

  async function render(cont) {
    contActual = cont;
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Taller'),
      el('button', { class: 'btn btn-primary', onclick: () => { location.hash = '#/taller-nueva'; } }, '+ Nueva orden')
    ]));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { class: 'search', type: 'text', placeholder: 'Buscar por patente, cliente o trabajo…', oninput: (e) => { filtro = e.target.value; pintarLista(cont); } })
    ]));
    cont.appendChild(el('div', { id: 'lista-ordenes' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));

    [cache, vehiculos, productos] = await Promise.all([traer(), traerVehiculos(), traerProductos()]);
    pintarLista(cont);
  }

  /* ============================================================
     FICHA DE SERVICE (interna, con QR / imprimir / WhatsApp)
     ============================================================ */
  function idHash() {
    const m = location.hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function urlPublica(id) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return base + 'ficha.html?orden=' + id;
  }
  function estadoTxt(e) { return e === 'bien' ? 'Bien' : (e === 'regular' ? 'Regular' : 'Mal'); }
  function agruparEstados(estados) {
    const g = {};
    Object.entries(estados || {}).forEach(([k, v]) => {
      const [sec, item] = k.split('::');
      if (!g[sec]) g[sec] = [];
      g[sec].push({ item, estado: v });
    });
    return g;
  }

  async function renderFicha(cont) {
    document.querySelectorAll('.mainnav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-route') === 'taller'));
    const id = idHash();
    cont.appendChild(el('div', { class: 'loading' }, 'Cargando ficha…'));

    const { data: o } = await db.from('operaciones')
      .select('*, vehiculos(patente, marca, modelo, anio), clientes(nombre, telefono), usuarios_app(nombre)')
      .eq('id', id).maybeSingle();
    if (!o) { cont.innerHTML = ''; cont.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty-title' }, 'Ficha no encontrada')])); return; }
    const { data: items } = await db.from('operacion_items').select('*').eq('operacion_id', id);
    cont.innerHTML = '';

    const v = o.vehiculos || {}, c = o.clientes || {}, chk = o.checklist || {};
    const g = agruparEstados(chk.estados);
    const repuestos = (items || []).filter(i => i.tipo_item === 'producto');
    const mano = (items || []).filter(i => i.tipo_item === 'mano_obra');
    const url = urlPublica(o.id);

    // Acciones (no se imprimen)
    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/taller'; } }, '← Taller'),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir / PDF'),
        c.telefono ? el('a', { class: 'btn btn-accent btn-sm', target: '_blank', rel: 'noopener',
          href: 'https://wa.me/' + (c.telefono || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent('Ficha de service de tu vehículo ' + (v.patente || '') + ' — Paddock Car Center. Vela online: ' + url) }, 'WhatsApp') : null
      ])
    ]));

    // Documento
    const doc = el('div', { class: 'reporte-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [ el('div', { class: 'od-brand-name' }, 'PADDOCK'), el('div', { class: 'od-brand-sub' }, 'Car Center') ]),
      el('div', { class: 'rep-title' }, [ el('div', { class: 'od-title-txt' }, 'Ficha de Service'), o.numero_orden ? el('div', { class: 'od-numero' }, 'Orden N° ' + o.numero_orden) : null, el('div', { class: 'rep-fecha' }, fmtFecha(o.creado_en)) ])
    ]));

    const datos = el('div', { class: 'od-datos' }, [
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Vehículo: '), el('strong', {}, v.patente || '—'), el('span', {}, ' ' + [v.marca, v.modelo, v.anio].filter(Boolean).join(' ')) ]),
      c.nombre ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Cliente: '), c.nombre ]) : null,
      o.km_ingreso ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Kilometraje: '), Number(o.km_ingreso).toLocaleString('es-AR') + ' km' ]) : null,
      chk.motivo ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Motivo: '), chk.motivo ]) : null,
      (auth.esAdmin() && o.usuarios_app) ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Cargó: '), o.usuarios_app.nombre ]) : null
    ]);
    doc.appendChild(datos);

    // Checklist (recorremos la definición, mostrando lo que tenga dato)
    const estados = chk.estados || {};
    const obsSec = chk.obsSeccion || {};
    const aceite = chk.aceite || {};
    const bloques = [];
    CHECKLIST.forEach(sec => {
      const filas = [];
      sec.items.forEach(item => {
        if (item.tipo === 'aceite') {
          if (aceite.cambiado || aceite.tipo) {
            const txt = (aceite.cambiado === 'si' ? 'Cambiado' : (aceite.cambiado === 'no' ? 'No cambiado' : '')) + (aceite.tipo ? ' — ' + aceite.tipo : '');
            filas.push(el('div', { class: 'fs-item' }, [
              el('span', {}, item.nombre),
              el('span', { class: 'fs-estado ' + (aceite.cambiado === 'si' ? 'bien' : 'mal') }, txt.trim())
            ]));
          }
        } else {
          const est = estados[sec.seccion + '::' + item.nombre];
          if (est) filas.push(el('div', { class: 'fs-item' }, [ el('span', {}, item.nombre), el('span', { class: 'fs-estado ' + est }, estadoTxt(est)) ]));
        }
      });
      const obs = obsSec[sec.seccion];
      if (filas.length || obs) {
        bloques.push(el('div', {}, [
          el('div', { class: 'fs-sec' }, sec.seccion),
          ...filas,
          obs ? el('div', { class: 'fs-obs' }, 'Obs: ' + obs) : null
        ]));
      }
    });
    if (bloques.length) {
      doc.appendChild(el('h2', { class: 'section-title' }, 'Control del vehículo'));
      doc.appendChild(el('div', { class: 'fs-chk' }, bloques));
    }

    if (chk.observaciones) {
      doc.appendChild(el('h2', { class: 'section-title' }, 'Observaciones'));
      doc.appendChild(el('div', { class: 'muted' }, chk.observaciones));
    }

    if (repuestos.length || mano.length) {
      doc.appendChild(el('h2', { class: 'section-title' }, 'Trabajo realizado'));
      const tabla = el('div', { class: 'od-facturas' });
      repuestos.forEach(r => tabla.appendChild(el('div', { class: 'od-fila' }, [ el('div', {}, r.descripcion + ' x' + r.cantidad), el('div', { class: 'od-monto' }, fmtMoneda(r.subtotal)) ])));
      mano.forEach(m => tabla.appendChild(el('div', { class: 'od-fila' }, [ el('div', {}, m.descripcion), el('div', { class: 'od-monto' }, fmtMoneda(m.subtotal)) ])));
      doc.appendChild(tabla);
      doc.appendChild(el('div', { class: 'od-total' }, [ el('span', {}, 'TOTAL'), el('span', { class: 'od-total-monto' }, fmtMoneda(o.total)) ]));
    }

    // QR a la ficha pública
    const qrBox = el('div', { class: 'fs-qr' });
    try {
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      qrBox.innerHTML = qr.createImgTag(4, 8);
    } catch (e) { /* si la lib no cargó, no rompemos la ficha */ }
    qrBox.appendChild(el('div', { class: 'fs-qr-txt' }, 'Escaneá para ver esta ficha online'));
    doc.appendChild(qrBox);

    cont.appendChild(doc);
  }

  router.registrar('taller', render);
  router.registrar('taller-nueva', renderNueva);
  router.registrar('ficha-orden', renderFicha);
})();
