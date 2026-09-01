/* ============================================================
   Vista PROVEEDORES — ABM contra la tabla `proveedores`.
   Los repuestos se asocian a un proveedor para saber a quién
   comprarles cuando baja el stock.
   ============================================================ */
(function () {
  const { db, ui, router } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let cache = [];
  let filtro = '';
  let contActual = null;

  async function traer() {
    const { data, error } = await db
      .from('proveedores')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) { toast('No se pudieron cargar los proveedores.', 'error'); return []; }
    return data || [];
  }

  function coincide(p) {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return (p.nombre || '').toLowerCase().includes(q) ||
           (p.telefono || '').toLowerCase().includes(q);
  }

  function formulario(prov) {
    const p = prov || {};
    return el('div', {}, [
      el('div', { class: 'field' }, [
        el('label', { for: 'f-nombre' }, 'Nombre'),
        el('input', { id: 'f-nombre', type: 'text', value: p.nombre || '', required: true })
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-tel' }, 'Teléfono'),
        el('input', { id: 'f-tel', type: 'tel', value: p.telefono || '' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-cuit' }, 'CUIT (opcional)'),
        el('input', { id: 'f-cuit', type: 'text', value: p.cuit || '', placeholder: '20-12345678-9' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-notas' }, 'Notas'),
        el('textarea', { id: 'f-notas' }, p.notas || '')
      ])
    ]);
  }

  function abrirForm(prov) {
    const esNuevo = !prov;
    modal({
      titulo: esNuevo ? 'Nuevo proveedor' : 'Editar proveedor',
      cuerpo: formulario(prov),
      textoGuardar: esNuevo ? 'Crear' : 'Guardar',
      onGuardar: async () => {
        const nombre = document.getElementById('f-nombre').value.trim();
        if (!nombre) { toast('El nombre es obligatorio.', 'error'); return false; }
        const payload = {
          nombre,
          telefono: document.getElementById('f-tel').value.trim() || null,
          cuit: document.getElementById('f-cuit').value.trim() || null,
          notas: document.getElementById('f-notas').value.trim() || null
        };
        const q = esNuevo
          ? db.from('proveedores').insert(payload)
          : db.from('proveedores').update(payload).eq('id', prov.id);
        const { error } = await q;
        if (error) { toast('No se pudo guardar.', 'error'); return false; }
        toast(esNuevo ? 'Proveedor creado.' : 'Cambios guardados.', 'ok');
        recargar();
      }
    });
  }

  async function eliminar(p) {
    const ok = await confirmar('¿Eliminar a "' + p.nombre + '"? Los repuestos que lo tengan asignado quedan sin proveedor.');
    if (!ok) return;
    const { error } = await db.from('proveedores').delete().eq('id', p.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Proveedor eliminado.', 'ok');
    recargar();
  }

  function pintarLista(cont) {
    const lista = cache.filter(coincide);
    const wrap = cont.querySelector('#lista-proveedores');
    wrap.innerHTML = '';

    if (!lista.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, cache.length ? 'Sin resultados' : 'Todavía no hay proveedores'),
        el('div', {}, cache.length ? 'Probá con otra búsqueda.' : 'Cargá el primero con el botón de arriba.')
      ]));
      return;
    }

    const card = el('div', { class: 'card' });
    lista.forEach(p => {
      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, p.nombre),
          p.telefono || p.cuit ? el('div', { class: 'list-row-sub' }, [p.telefono, p.cuit ? 'CUIT ' + p.cuit : null].filter(Boolean).join('  ·  ')) : null
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => abrirForm(p) }, 'Editar'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(p) }, 'Borrar')
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
      el('h1', {}, 'Proveedores'),
      el('div', { class: 'head-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => window.PADDOCK.reportes.abrirProveedores() }, 'Reporte'),
        el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '+ Nuevo')
      ])
    ]));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', {
        class: 'search', type: 'text', placeholder: 'Buscar por nombre o teléfono…',
        oninput: (e) => { filtro = e.target.value; pintarLista(cont); }
      })
    ]));
    cont.appendChild(el('div', { id: 'lista-proveedores' }, [
      el('div', { class: 'loading' }, 'Cargando…')
    ]));

    cache = await traer();
    pintarLista(cont);
  }

  router.registrar('proveedores', render);
})();
