/* ============================================================
   Vista CLIENTES — ABM completo contra la tabla `clientes`.
   ============================================================ */
(function () {
  const { db, ui, router } = window.PADDOCK;
  const { el, esc, toast, modal, confirmar } = ui;

  let cache = [];   // último listado traído
  let filtro = '';

  async function traer() {
    const { data, error } = await db
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) { toast('No se pudieron cargar los clientes.', 'error'); return []; }
    return data || [];
  }

  function coincide(c) {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return (c.nombre || '').toLowerCase().includes(q) ||
           (c.telefono || '').toLowerCase().includes(q) ||
           (c.email || '').toLowerCase().includes(q);
  }

  function formulario(cliente) {
    const c = cliente || {};
    return el('div', {}, [
      el('div', { class: 'field' }, [
        el('label', { for: 'f-nombre' }, 'Nombre'),
        el('input', { id: 'f-nombre', type: 'text', value: c.nombre || '', required: true })
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'f-tel' }, 'Teléfono'),
          el('input', { id: 'f-tel', type: 'tel', value: c.telefono || '' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'f-email' }, 'Email'),
          el('input', { id: 'f-email', type: 'email', value: c.email || '' })
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-notas' }, 'Notas'),
        el('textarea', { id: 'f-notas' }, c.notas || '')
      ])
    ]);
  }

  function abrirForm(cliente) {
    const esNuevo = !cliente;
    modal({
      titulo: esNuevo ? 'Nuevo cliente' : 'Editar cliente',
      cuerpo: formulario(cliente),
      textoGuardar: esNuevo ? 'Crear' : 'Guardar',
      onGuardar: async () => {
        const nombre = document.getElementById('f-nombre').value.trim();
        if (!nombre) { toast('El nombre es obligatorio.', 'error'); return false; }
        const payload = {
          nombre,
          telefono: document.getElementById('f-tel').value.trim() || null,
          email: document.getElementById('f-email').value.trim() || null,
          notas: document.getElementById('f-notas').value.trim() || null
        };
        const q = esNuevo
          ? db.from('clientes').insert(payload)
          : db.from('clientes').update(payload).eq('id', cliente.id);
        const { error } = await q;
        if (error) { toast('No se pudo guardar.', 'error'); return false; }
        toast(esNuevo ? 'Cliente creado.' : 'Cambios guardados.', 'ok');
        recargar();
      }
    });
  }

  async function eliminar(cliente) {
    const ok = await confirmar('¿Eliminar a "' + cliente.nombre + '"? Sus vehículos quedan sin cliente asignado.');
    if (!ok) return;
    const { error } = await db.from('clientes').delete().eq('id', cliente.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Cliente eliminado.', 'ok');
    recargar();
  }

  function pintarLista(cont) {
    const lista = cache.filter(coincide);
    const wrap = cont.querySelector('#lista-clientes');
    wrap.innerHTML = '';

    if (!lista.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, cache.length ? 'Sin resultados' : 'Todavía no hay clientes'),
        el('div', {}, cache.length ? 'Probá con otra búsqueda.' : 'Creá el primero con el botón de arriba.')
      ]));
      return;
    }

    const card = el('div', { class: 'card' });
    lista.forEach(c => {
      const sub = [c.telefono, c.email].filter(Boolean).join('  ·  ');
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, c.nombre),
          sub ? el('div', { class: 'list-row-sub' }, sub) : null
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => abrirForm(c) }, 'Editar'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(c) }, 'Borrar')
        ])
      ]));
    });
    wrap.appendChild(card);
  }

  let contActual = null;
  async function recargar() {
    cache = await traer();
    if (contActual) pintarLista(contActual);
  }

  async function render(cont) {
    contActual = cont;
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Clientes'),
      el('div', { class: 'head-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => window.PADDOCK.reportes.abrirClientes() }, 'Reporte'),
        el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '+ Nuevo')
      ])
    ]));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', {
        class: 'search', type: 'text', placeholder: 'Buscar por nombre, teléfono o email…',
        oninput: (e) => { filtro = e.target.value; pintarLista(cont); }
      })
    ]));
    cont.appendChild(el('div', { id: 'lista-clientes' }, [
      el('div', { class: 'loading' }, 'Cargando…')
    ]));

    cache = await traer();
    pintarLista(cont);
  }

  router.registrar('clientes', render);
})();
