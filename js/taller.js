/* ============================================================
   Vista TALLER — órdenes de trabajo con ficha de control.
   Dos tipos de ficha: 'convencional' y 'full'.
   Cada ítem se completa según su tipo:
     · 'texto' → línea para escribir un valor
     · 'sino'  → Sí / No
   La orden queda 'a cobrar' (no toca la caja). Descuenta stock
   y se engancha con la ficha del vehículo.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, confirmar } = ui;

  // ---- Secciones reutilizables ----
  const SEC_SERVICE = { seccion: 'Service', items: [
    { n: 'Aceite', t: 'texto' },
    { n: 'Filtro de aire', t: 'sino' },
    { n: 'Filtro de aceite', t: 'sino' },
    { n: 'Filtro de combustible', t: 'sino' },
    { n: 'Filtro de habitáculo', t: 'sino' },
    { n: 'Aceite de caja', t: 'sino' },
    { n: 'Filtro de caja', t: 'sino' }
  ] };
  const SEC_FLUIDOS = { seccion: 'Fluidos', items: [
    { n: 'Líquido de frenos', t: 'texto' },
    { n: 'Líquido hidráulico', t: 'texto' },
    { n: 'Líquido refrigerante', t: 'texto' },
    { n: 'Líquido lavaparabrisas', t: 'texto' },
    { n: 'Aceite de caja', t: 'texto' },
    { n: 'Aceite de motor', t: 'texto' }
  ] };
  const SEC_LUCES = { seccion: 'Luces', items: [
    { n: 'Luces', t: 'texto' },
    { n: 'Avisos en tablero', t: 'sino' }
  ] };
  const SEC_NEUMATICOS = { seccion: 'Neumáticos', items: [
    { n: 'Balanceado', t: 'texto' },
    { n: 'Presión', t: 'texto' }
  ] };
  const SEC_FRENOS = { seccion: 'Frenos', items: [
    { n: 'Delanteros', t: 'texto' },
    { n: 'Discos delanteros', t: 'texto' },
    { n: 'Pastillas delanteras', t: 'texto' },
    { n: 'Traseros', t: 'texto' },
    { n: 'Campanas y cintas', t: 'texto' },
    { n: 'Discos traseros', t: 'texto' },
    { n: 'Pastillas traseras', t: 'texto' },
    { n: 'Freno de mano', t: 'texto' }
  ] };
  const SEC_TREN_DEL = { seccion: 'Tren delantero', items: [
    { n: 'Amortiguadores delanteros', t: 'texto' },
    { n: 'Parrillas de suspensión', t: 'texto' },
    { n: 'Extremos de dirección', t: 'texto' },
    { n: 'Axiales', t: 'texto' },
    { n: 'Barra estabilizadora', t: 'texto' },
    { n: 'Bieletas', t: 'texto' },
    { n: 'Rótulas', t: 'texto' },
    { n: 'Caja de dirección', t: 'texto' },
    { n: 'Rulemanes', t: 'texto' },
    { n: 'Alineado', t: 'texto' },
    { n: 'Combas', t: 'texto' }
  ] };
  const SEC_TREN_TRAS = { seccion: 'Tren trasero', items: [
    { n: 'Puente', t: 'texto' },
    { n: 'Amortiguadores traseros', t: 'texto' },
    { n: 'Barra estabilizadora', t: 'texto' },
    { n: 'Bieletas', t: 'texto' },
    { n: 'Bujes', t: 'texto' },
    { n: 'Parrillas de suspensión', t: 'texto' },
    { n: 'Rulemanes', t: 'texto' }
  ] };
  const SEC_DISTRIB = { seccion: 'Distribución', items: [
    { n: 'Correa de distribución', t: 'sino' },
    { n: 'Tensores', t: 'sino' },
    { n: 'Bomba de agua', t: 'sino' },
    { n: 'Correa de accesorios', t: 'sino' },
    { n: 'Tensores C/A', t: 'sino' }
  ] };
  const SEC_ENCENDIDO = { seccion: 'Encendido', items: [
    { n: 'Bujías', t: 'texto' },
    { n: 'Cables', t: 'texto' },
    { n: 'Bobinas', t: 'texto' }
  ] };
  const SEC_ESCOBILLAS = { seccion: 'Escobillas', items: [
    { n: 'Delanteras', t: 'texto' },
    { n: 'Traseras', t: 'texto' }
  ] };

  const FICHAS = {
    convencional: { nombre: 'Service convencional', secciones: [SEC_SERVICE, SEC_FLUIDOS, SEC_NEUMATICOS, SEC_LUCES, SEC_FRENOS] },
    full: { nombre: 'Service full', secciones: [SEC_SERVICE, SEC_FLUIDOS, SEC_LUCES, SEC_TREN_DEL, SEC_TREN_TRAS, SEC_FRENOS, SEC_DISTRIB, SEC_NEUMATICOS, SEC_ENCENDIDO, SEC_ESCOBILLAS] }
  };

  let cache = [];
  let vehiculos = [];
  let productos = [];
  let filtro = '';
  let contActual = null;

  function fmtMoneda(n) { return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 }); }
  function fmtFecha(iso) { return iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }
  function idHash() { const m = location.hash.match(/[?&]id=([^&]+)/); return m ? decodeURIComponent(m[1]) : null; }
  function urlPublica(id) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'ficha.html?orden=' + id; }

  /* ---------- Datos ---------- */
  async function traer() {
    const { data, error } = await db.from('operaciones')
      .select('*, vehiculos(patente), clientes(nombre)')
      .eq('tipo', 'taller').order('creado_en', { ascending: false });
    if (error) { toast('No se pudieron cargar las órdenes.', 'error'); return []; }
    return data || [];
  }
  async function traerVehiculos() {
    const { data } = await db.from('vehiculos').select('id, patente, marca, modelo, cliente_id, clientes(nombre, telefono)').order('patente');
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
    if (!vehiculos.length || !productos.length) { [vehiculos, productos] = await Promise.all([traerVehiculos(), traerProductos()]); }
    cont.innerHTML = '';

    let vehiculoSel = null;
    let tipoFicha = 'convencional';
    const valores = {};          // "Sección::Ítem" -> texto | 'si' | 'no'
    let repuestos = [];

    cont.appendChild(el('div', { class: 'detail-head' }, [ el('button', { class: 'back-link', onclick: () => { location.hash = '#/taller'; } }, '← Taller') ]));
    cont.appendChild(el('div', { class: 'view-head' }, [ el('h1', {}, 'Nueva orden de trabajo') ]));

    /* --- Vehículo --- */
    const vehInfo = el('div', { class: 'orden-veh-sel', hidden: true });
    const vehBusq = el('input', { type: 'text', class: 'search', placeholder: 'Buscar vehículo por patente…' });
    const vehResultados = el('div', { class: 'venta-resultados' });
    const vehBusqWrap = el('div', {}, [vehBusq, vehResultados]);
    const inpTel = el('input', { id: 'o-tel', type: 'tel' });

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
      vehBusqWrap.hidden = true; vehInfo.hidden = false; vehInfo.innerHTML = '';
      if (v.clientes && v.clientes.telefono) inpTel.value = v.clientes.telefono;
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

    /* --- Datos + tipo de ficha --- */
    cont.appendChild(el('div', { class: 'field-row', style: 'margin-top:16px' }, [
      el('div', { class: 'field' }, [ el('label', { for: 'o-dni' }, 'DNI'), el('input', { id: 'o-dni', type: 'text' }) ]),
      el('div', { class: 'field' }, [ el('label', { for: 'o-tel' }, 'Teléfono'), inpTel ])
    ]));
    cont.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [ el('label', { for: 'o-motor' }, 'Motor'), el('input', { id: 'o-motor', type: 'text' }) ]),
      el('div', { class: 'field' }, [ el('label', { for: 'o-km' }, 'Kilometraje'), el('input', { id: 'o-km', type: 'number', min: '0' }) ])
    ]));
    cont.appendChild(el('div', { class: 'field' }, [ el('label', { for: 'o-motivo' }, 'Motivo de ingreso'), el('input', { id: 'o-motivo', type: 'text', placeholder: 'ej. service, ruido…' }) ]));

    const selTipo = el('select', { id: 'o-tipo' }, [
      el('option', { value: 'convencional' }, 'Service convencional'),
      el('option', { value: 'full' }, 'Service full')
    ]);
    cont.appendChild(el('div', { class: 'field' }, [ el('label', { for: 'o-tipo' }, 'Tipo de ficha' ), selTipo ]));

    /* --- Checklist (se arma según el tipo) --- */
    cont.appendChild(el('h2', { class: 'section-title' }, 'Control del vehículo'));
    const chkWrap = el('div', { class: 'card', style: 'padding:4px 0' });
    cont.appendChild(chkWrap);

    function botonesSiNo(key) {
      const wrap = el('div', { class: 'chk-btns' });
      [['si', 'Sí'], ['no', 'No']].forEach(([val, txt]) => {
        const b = el('button', { class: 'chk-btn chk-' + (val === 'si' ? 'bien' : 'mal'), type: 'button', style: 'width:auto;padding:0 14px' + (valores[key] === val ? '' : '') }, txt);
        if (valores[key] === val) b.classList.add('activo');
        b.addEventListener('click', () => {
          const ya = valores[key] === val;
          wrap.querySelectorAll('.chk-btn').forEach(x => x.classList.remove('activo'));
          if (ya) { delete valores[key]; } else { valores[key] = val; b.classList.add('activo'); }
        });
        wrap.appendChild(b);
      });
      return wrap;
    }

    function construirChecklist() {
      chkWrap.innerHTML = '';
      FICHAS[tipoFicha].secciones.forEach(sec => {
        chkWrap.appendChild(el('div', { class: 'chk-seccion' }, sec.seccion));
        sec.items.forEach(item => {
          const key = sec.seccion + '::' + item.n;
          if (item.t === 'sino') {
            chkWrap.appendChild(el('div', { class: 'chk-fila' }, [ el('div', { class: 'chk-item' }, item.n), botonesSiNo(key) ]));
          } else {
            const inp = el('input', { type: 'text', class: 'chk-texto-input', value: valores[key] || '' });
            inp.addEventListener('input', () => { valores[key] = inp.value.trim() || undefined; });
            chkWrap.appendChild(el('div', { class: 'chk-fila' }, [ el('div', { class: 'chk-item' }, item.n), inp ]));
          }
        });
      });
    }
    selTipo.addEventListener('change', () => { tipoFicha = selTipo.value; construirChecklist(); });
    construirChecklist();

    cont.appendChild(el('div', { class: 'field', style: 'margin-top:12px' }, [ el('label', { for: 'o-obs' }, 'Observaciones' ), el('textarea', { id: 'o-obs', placeholder: 'Notas, recomendaciones…' }, '') ]));

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
        tipo: tipoFicha,
        header: {
          dni: document.getElementById('o-dni').value.trim() || null,
          motor: document.getElementById('o-motor').value.trim() || null,
          tel: inpTel.value.trim() || null
        },
        motivo,
        observaciones: document.getElementById('o-obs').value.trim() || null,
        valores
      };

      try {
        const { data: orden, error: e1 } = await db.from('operaciones').insert({
          tipo: 'taller', estado: 'pendiente',
          vehiculo_id: vehiculoSel.id, cliente_id: vehiculoSel.cliente_id || null, usuario_id,
          descripcion: motivo || 'Orden de trabajo', km_ingreso: km ? parseInt(km, 10) : null,
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
     LISTA
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

  async function recargar() { cache = await traer(); if (contActual) pintarLista(contActual); }

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
     FICHA DE SERVICE
     ============================================================ */
  function valorTxt(t, v) { return t === 'sino' ? (v === 'si' ? 'Sí' : 'No') : v; }

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
    const header = chk.header || {};
    const valores = chk.valores || {};
    const tipoFicha = chk.tipo && FICHAS[chk.tipo] ? chk.tipo : 'convencional';
    const repuestos = (items || []).filter(i => i.tipo_item === 'producto');
    const mano = (items || []).filter(i => i.tipo_item === 'mano_obra');
    const url = urlPublica(o.id);

    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/taller'; } }, '← Taller'),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => ui.descargarPDF(document.getElementById('ficha-doc'), 'ficha-' + (o.numero_orden || '') + '.pdf') }, 'Descargar PDF'),
        c.telefono ? el('a', { class: 'btn btn-accent btn-sm', target: '_blank', rel: 'noopener',
          href: 'https://wa.me/' + (c.telefono || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent('Ficha de service de tu vehículo ' + (v.patente || '') + ' — Paddock Car Center. Vela online: ' + url) }, 'WhatsApp') : null
      ])
    ]));

    const doc = el('div', { class: 'reporte-doc', id: 'ficha-doc' });
    doc.appendChild(el('div', { class: 'rep-head' }, [
      el('div', { class: 'od-brand' }, [ el('div', { class: 'od-brand-name' }, 'PADDOCK'), el('div', { class: 'od-brand-sub' }, 'Car Center') ]),
      el('div', { class: 'rep-title' }, [ el('div', { class: 'od-title-txt' }, 'Ficha de Service'), el('div', { class: 'rep-fecha' }, FICHAS[tipoFicha].nombre), o.numero_orden ? el('div', { class: 'od-numero' }, 'Orden N° ' + o.numero_orden) : null, el('div', { class: 'rep-fecha' }, fmtFecha(o.creado_en)) ])
    ]));

    doc.appendChild(el('div', { class: 'od-datos' }, [
      el('div', {}, [ el('span', { class: 'od-lbl' }, 'Vehículo: '), el('strong', {}, v.patente || '—'), el('span', {}, ' ' + [v.marca, v.modelo, v.anio].filter(Boolean).join(' ')) ]),
      c.nombre ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Cliente: '), c.nombre ]) : null,
      header.dni ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'DNI: '), header.dni ]) : null,
      header.tel ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Tel: '), header.tel ]) : null,
      header.motor ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Motor: '), header.motor ]) : null,
      o.km_ingreso ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Kilometraje: '), Number(o.km_ingreso).toLocaleString('es-AR') + ' km' ]) : null,
      chk.motivo ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Motivo: '), chk.motivo ]) : null,
      (auth.esAdmin() && o.usuarios_app) ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Cargó: '), o.usuarios_app.nombre ]) : null
    ]));

    // Control del vehículo según el tipo de ficha
    const bloques = [];
    FICHAS[tipoFicha].secciones.forEach(sec => {
      const filas = [];
      sec.items.forEach(item => {
        const val = valores[sec.seccion + '::' + item.n];
        if (val) {
          const esSino = item.t === 'sino';
          filas.push(el('div', { class: 'fs-item' }, [
            el('span', {}, item.n),
            esSino ? el('span', { class: 'fs-estado ' + (val === 'si' ? 'bien' : 'mal') }, valorTxt('sino', val)) : el('span', { class: 'fs-val' }, val)
          ]));
        }
      });
      if (filas.length) bloques.push(el('div', {}, [ el('div', { class: 'fs-sec' }, sec.seccion), ...filas ]));
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

    const qrBox = el('div', { class: 'fs-qr' });
    try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); qrBox.innerHTML = qr.createImgTag(4, 8); } catch (e) {}
    qrBox.appendChild(el('div', { class: 'fs-qr-txt' }, 'Escaneá para ver esta ficha online'));
    doc.appendChild(qrBox);

    cont.appendChild(doc);
  }

  router.registrar('taller', render);
  router.registrar('taller-nueva', renderNueva);
  router.registrar('ficha-orden', renderFicha);
})();
