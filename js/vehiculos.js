/* ============================================================
   Vista VEHÍCULOS — lista + ABM + FICHA con historial.
   El vehículo es el eje del sistema: la patente manda.
   La ficha muestra datos, dueño e historial de trabajos
   (el historial se llena solo cuando existan operaciones).
   ============================================================ */
(function () {
  const { db, ui, router } = window.PADDOCK;
  const { el, esc, toast, modal, confirmar } = ui;

  let cache = [];
  let clientes = [];   // para el select
  let filtro = '';
  let fDueno = 'todos';   // 'todos' | 'con' | 'sin'
  let fDesde = '';
  let fHasta = '';
  let contActual = null;

  // Devuelve los vehículos que pasan todos los filtros activos.
  function listaFiltrada() { return cache.filter(coincide); }

  /* ---------- Helpers ---------- */
  function fmtMoneda(n) {
    if (n == null) return '$0';
    return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
  function fmtFecha(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function idDeHash() {
    const m = location.hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function soloDigitos(tel) { return (tel || '').replace(/[^0-9]/g, ''); }

  /* ---------- Datos ---------- */
  async function traer() {
    const { data, error } = await db
      .from('vehiculos')
      .select('*, clientes(nombre)')
      .order('creado_en', { ascending: false });
    if (error) { toast('No se pudieron cargar los vehículos.', 'error'); return []; }
    return data || [];
  }

  async function traerUno(id) {
    const { data, error } = await db
      .from('vehiculos')
      .select('*, clientes(id, nombre, telefono, email)')
      .eq('id', id)
      .maybeSingle();
    if (error) { toast('No se pudo cargar el vehículo.', 'error'); return null; }
    return data;
  }

  async function traerOperaciones(vehiculoId) {
    // El historial: todas las operaciones de este vehículo.
    // Hoy puede venir vacío; se llena cuando arranquen taller/lubricentro/ventas.
    const { data, error } = await db
      .from('operaciones')
      .select('id, tipo, estado, descripcion, total, creado_en')
      .eq('vehiculo_id', vehiculoId)
      .order('creado_en', { ascending: false });
    if (error) return [];
    return data || [];
  }

  async function traerClientes() {
    const { data } = await db.from('clientes').select('id, nombre').order('nombre');
    return data || [];
  }

  function coincide(v) {
    // Texto libre (patente, marca, modelo, cliente)
    if (filtro) {
      const q = filtro.toLowerCase();
      const okTexto = (v.patente || '').toLowerCase().includes(q) ||
             (v.marca || '').toLowerCase().includes(q) ||
             (v.modelo || '').toLowerCase().includes(q) ||
             (v.clientes && (v.clientes.nombre || '').toLowerCase().includes(q));
      if (!okTexto) return false;
    }
    // Con / sin dueño
    if (fDueno === 'con' && !v.cliente_id) return false;
    if (fDueno === 'sin' && v.cliente_id) return false;
    // Rango de fecha de alta (creado_en)
    if (v.creado_en) {
      const fecha = v.creado_en.slice(0, 10);
      if (fDesde && fecha < fDesde) return false;
      if (fHasta && fecha > fHasta) return false;
    }
    return true;
  }

  /* ---------- Formulario (alta/edición) ---------- */
  function formulario(vehiculo) {
    const v = vehiculo || {};
    const opciones = [el('option', { value: '' }, '— Sin cliente —')];
    clientes.forEach(c => {
      opciones.push(el('option', { value: c.id, selected: v.cliente_id === c.id }, c.nombre));
    });

    return el('div', {}, [
      el('div', { class: 'field' }, [
        el('label', { for: 'f-patente' }, 'Patente'),
        el('input', {
          id: 'f-patente', type: 'text', value: v.patente || '',
          required: true, autocapitalize: 'characters', spellcheck: 'false',
          style: 'text-transform:uppercase'
        })
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'f-marca' }, 'Marca'),
          el('input', { id: 'f-marca', type: 'text', value: v.marca || '' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'f-modelo' }, 'Modelo'),
          el('input', { id: 'f-modelo', type: 'text', value: v.modelo || '' })
        ])
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'f-anio' }, 'Año'),
          el('input', { id: 'f-anio', type: 'number', value: v.anio || '', min: '1950', max: '2100' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'f-km' }, 'Km'),
          el('input', { id: 'f-km', type: 'number', value: v.km || '', min: '0' })
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-cliente' }, 'Cliente'),
        el('select', { id: 'f-cliente' }, opciones)
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-notas' }, 'Notas'),
        el('textarea', { id: 'f-notas' }, v.notas || '')
      ])
    ]);
  }

  // onSaved: qué hacer después de guardar (refrescar lista o ficha).
  function abrirForm(vehiculo, onSaved) {
    const esNuevo = !vehiculo;
    modal({
      titulo: esNuevo ? 'Nuevo vehículo' : 'Editar vehículo',
      cuerpo: formulario(vehiculo),
      textoGuardar: esNuevo ? 'Crear' : 'Guardar',
      onGuardar: async () => {
        const patente = document.getElementById('f-patente').value.trim().toUpperCase();
        if (!patente) { toast('La patente es obligatoria.', 'error'); return false; }
        const anio = document.getElementById('f-anio').value;
        const km = document.getElementById('f-km').value;
        const payload = {
          patente,
          marca: document.getElementById('f-marca').value.trim() || null,
          modelo: document.getElementById('f-modelo').value.trim() || null,
          anio: anio ? parseInt(anio, 10) : null,
          km: km ? parseInt(km, 10) : null,
          cliente_id: document.getElementById('f-cliente').value || null,
          notas: document.getElementById('f-notas').value.trim() || null
        };
        const q = esNuevo
          ? db.from('vehiculos').insert(payload)
          : db.from('vehiculos').update(payload).eq('id', vehiculo.id);
        const { error } = await q;
        if (error) {
          const msg = error.code === '23505'
            ? 'Ya existe un vehículo con esa patente.'
            : 'No se pudo guardar.';
          toast(msg, 'error');
          return false;
        }
        toast(esNuevo ? 'Vehículo creado.' : 'Cambios guardados.', 'ok');
        (onSaved || recargar)();
      }
    });
  }

  async function eliminar(v, onDone) {
    const ok = await confirmar('¿Eliminar el vehículo ' + v.patente + '?');
    if (!ok) return;
    const { error } = await db.from('vehiculos').delete().eq('id', v.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Vehículo eliminado.', 'ok');
    (onDone || recargar)();
  }

  /* ---------- Lista ---------- */
  function abrirFicha(v) { location.hash = '#/vehiculo?id=' + v.id; }

  function pintarLista(cont) {
    const lista = cache.filter(coincide);
    const wrap = cont.querySelector('#lista-vehiculos');
    wrap.innerHTML = '';

    if (!lista.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, cache.length ? 'Sin resultados' : 'Todavía no hay vehículos'),
        el('div', {}, cache.length ? 'Probá con otra búsqueda.' : 'Cargá el primero con el botón de arriba.')
      ]));
      return;
    }

    const card = el('div', { class: 'card' });
    lista.forEach(v => {
      const desc = [v.marca, v.modelo, v.anio].filter(Boolean).join(' ');
      const dueno = v.clientes ? v.clientes.nombre : 'Sin cliente';
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main clickable', onclick: () => abrirFicha(v) }, [
          el('div', { class: 'list-row-title' }, [
            el('span', { class: 'patente-tag' }, v.patente),
            desc ? el('span', { style: 'margin-left:10px;font-weight:500' }, desc) : null
          ]),
          el('div', { class: 'list-row-sub' }, dueno + (v.km ? '  ·  ' + v.km.toLocaleString('es-AR') + ' km' : ''))
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => abrirForm(v) }, 'Editar'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(v) }, 'Borrar')
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
      el('h1', {}, 'Vehículos'),
      el('div', { class: 'head-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => window.PADDOCK.reportes.abrirVehiculos(listaFiltrada()) }, 'Reporte'),
        el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '+ Nuevo')
      ])
    ]));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', {
        class: 'search', type: 'text', placeholder: 'Buscar por patente, marca, modelo o cliente…',
        oninput: (e) => { filtro = e.target.value; pintarLista(cont); }
      })
    ]));
    cont.appendChild(el('div', { class: 'filtros-veh' }, [
      el('select', {
        onchange: (e) => { fDueno = e.target.value; pintarLista(cont); }
      }, [
        el('option', { value: 'todos' }, 'Todos'),
        el('option', { value: 'con' }, 'Con dueño'),
        el('option', { value: 'sin' }, 'Sin dueño')
      ]),
      el('div', { class: 'filtro-fecha' }, [
        el('span', { class: 'ff-lbl' }, 'Alta:'),
        el('input', { type: 'date', title: 'Desde', onchange: (e) => { fDesde = e.target.value; pintarLista(cont); } }),
        el('span', { class: 'rango-sep' }, 'a'),
        el('input', { type: 'date', title: 'Hasta', onchange: (e) => { fHasta = e.target.value; pintarLista(cont); } })
      ])
    ]));
    cont.appendChild(el('div', { id: 'lista-vehiculos' }, [
      el('div', { class: 'loading' }, 'Cargando…')
    ]));

    [cache, clientes] = await Promise.all([traer(), traerClientes()]);
    pintarLista(cont);
  }

  /* ---------- Ficha del vehículo ---------- */
  function filaDato(label, valor) {
    return el('div', { class: 'kv-row' }, [
      el('div', { class: 'kv-label' }, label),
      el('div', { class: 'kv-val' }, valor || '—')
    ]);
  }

  async function renderFicha(cont) {
    // Mantenemos "Vehículos" marcado como activo en la nav.
    document.querySelectorAll('.mainnav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === 'vehiculos');
    });

    const id = idDeHash();
    cont.appendChild(el('div', { class: 'loading' }, 'Cargando ficha…'));

    const v = await traerUno(id);
    cont.innerHTML = '';
    if (!v) {
      cont.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Vehículo no encontrado'),
        el('button', { class: 'btn btn-ghost', onclick: () => { location.hash = '#/vehiculos'; } }, '← Volver')
      ]));
      return;
    }

    // Necesitamos que las ediciones tengan la lista de clientes cargada.
    if (!clientes.length) clientes = await traerClientes();

    const desc = [v.marca, v.modelo, v.anio].filter(Boolean).join(' ');
    const refrescar = () => renderFicha(cont);

    // --- Encabezado ---
    cont.appendChild(el('div', { class: 'detail-head' }, [
      el('button', { class: 'back-link', onclick: () => { location.hash = '#/vehiculos'; } }, '← Vehículos'),
      el('div', { class: 'detail-actions' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => abrirForm(v, refrescar) }, 'Editar'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(v, () => { location.hash = '#/vehiculos'; }) }, 'Borrar')
      ])
    ]));

    cont.appendChild(el('div', { class: 'detail-title' }, [
      el('span', { class: 'patente-tag lg' }, v.patente),
      desc ? el('span', { class: 'detail-desc' }, desc) : null
    ]));

    // --- Datos del vehículo ---
    cont.appendChild(el('h2', { class: 'section-title' }, 'Datos del vehículo'));
    cont.appendChild(el('div', { class: 'card detail-card' }, [
      filaDato('Marca', v.marca),
      filaDato('Modelo', v.modelo),
      filaDato('Año', v.anio ? String(v.anio) : null),
      filaDato('Kilometraje', v.km ? v.km.toLocaleString('es-AR') + ' km' : null),
      filaDato('Notas', v.notas)
    ]));

    // --- Cliente / dueño ---
    cont.appendChild(el('h2', { class: 'section-title' }, 'Dueño'));
    if (v.clientes) {
      const c = v.clientes;
      const acciones = [];
      if (c.telefono) {
        const wpp = soloDigitos(c.telefono);
        acciones.push(el('a', {
          class: 'btn btn-accent btn-sm', href: 'https://wa.me/' + wpp, target: '_blank', rel: 'noopener'
        }, 'WhatsApp'));
        acciones.push(el('a', { class: 'btn btn-ghost btn-sm', href: 'tel:' + c.telefono }, 'Llamar'));
      }
      cont.appendChild(el('div', { class: 'card detail-card' }, [
        filaDato('Nombre', c.nombre),
        filaDato('Teléfono', c.telefono),
        filaDato('Email', c.email),
        acciones.length ? el('div', { class: 'kv-actions' }, acciones) : null
      ]));
    } else {
      cont.appendChild(el('div', { class: 'card detail-card' }, [
        el('div', { class: 'muted' }, 'Sin cliente asignado. Editá el vehículo para asociarle uno.')
      ]));
    }

    // --- Historial ---
    cont.appendChild(el('h2', { class: 'section-title' }, 'Historial'));
    const histWrap = el('div', { class: 'card detail-card' }, [el('div', { class: 'loading' }, 'Cargando…')]);
    cont.appendChild(histWrap);

    const ops = await traerOperaciones(v.id);
    histWrap.innerHTML = '';
    if (!ops.length) {
      histWrap.appendChild(el('div', { class: 'muted' },
        'Todavía no hay trabajos registrados. Cuando arranquen las órdenes de taller y las ventas, van a aparecer acá.'));
    } else {
      ops.forEach(op => {
        histWrap.appendChild(el('div', { class: 'hist-row' }, [
          el('div', {}, [
            el('div', { class: 'hist-tipo' }, (op.tipo || '').toUpperCase()),
            el('div', { class: 'hist-desc' }, op.descripcion || '')
          ]),
          el('div', { class: 'hist-right' }, [
            el('div', { class: 'hist-total' }, fmtMoneda(op.total)),
            el('div', { class: 'hist-fecha' }, fmtFecha(op.creado_en))
          ])
        ]));
      });
    }
  }

  router.registrar('vehiculos', render);
  router.registrar('vehiculo', renderFicha);
})();
