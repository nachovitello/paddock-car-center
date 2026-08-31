/* ============================================================
   Vista REPUESTOS — catálogo de productos + control de stock.
   - ABM de productos (código, precios, proveedor, stock mínimo).
   - Movimientos de stock: entradas (compras) y ajustes (conteo).
   - Alerta de stock bajo.
   El stock se guarda en productos.stock y cada cambio deja
   registro en movimientos_stock (trazabilidad).
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let cache = [];
  let proveedores = [];
  let filtro = '';
  let contActual = null;

  /* ---------- Helpers ---------- */
  function fmtMoneda(n) {
    if (n == null) return '$0';
    return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
  function estadoStock(p) {
    const min = Number(p.stock_minimo) || 0;
    if (Number(p.stock) <= 0) return 'sin';
    if (min > 0 && Number(p.stock) <= min) return 'bajo';
    return 'ok';
  }

  /* ---------- Datos ---------- */
  async function traer() {
    const { data, error } = await db
      .from('productos')
      .select('*, proveedores(nombre)')
      .order('nombre', { ascending: true });
    if (error) { toast('No se pudieron cargar los repuestos.', 'error'); return []; }
    return data || [];
  }
  async function traerProveedores() {
    const { data } = await db.from('proveedores').select('id, nombre').order('nombre');
    return data || [];
  }

  function coincide(p) {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return (p.nombre || '').toLowerCase().includes(q) ||
           (p.codigo || '').toLowerCase().includes(q) ||
           (p.categoria || '').toLowerCase().includes(q);
  }

  /* ---------- Formulario alta/edición ---------- */
  function formulario(prod) {
    const p = prod || {};
    const esNuevo = !prod;
    const opciones = [el('option', { value: '' }, '— Sin proveedor —')];
    proveedores.forEach(pr => {
      opciones.push(el('option', { value: pr.id, selected: p.proveedor_id === pr.id }, pr.nombre));
    });

    return el('div', {}, [
      el('div', { class: 'field' }, [
        el('label', { for: 'f-nombre' }, 'Nombre del repuesto'),
        el('input', { id: 'f-nombre', type: 'text', value: p.nombre || '', required: true })
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'f-codigo' }, 'Código'),
          el('input', { id: 'f-codigo', type: 'text', value: p.codigo || '', autocapitalize: 'characters', spellcheck: 'false' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'f-categoria' }, 'Categoría'),
          el('input', { id: 'f-categoria', type: 'text', value: p.categoria || '', placeholder: 'ej. filtro, aceite…' })
        ])
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'f-compra' }, 'Precio de compra'),
          el('input', { id: 'f-compra', type: 'number', value: p.precio_compra || '', min: '0', step: '0.01' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'f-venta' }, 'Precio de venta'),
          el('input', { id: 'f-venta', type: 'number', value: p.precio_venta || '', min: '0', step: '0.01' })
        ])
      ]),
      el('div', { class: 'field-row' }, [
        // El stock inicial solo se pide al crear. Después se maneja
        // con entradas y ajustes para no romper la trazabilidad.
        esNuevo ? el('div', { class: 'field' }, [
          el('label', { for: 'f-stock' }, 'Stock inicial'),
          el('input', { id: 'f-stock', type: 'number', value: '0', min: '0', step: '1' })
        ]) : null,
        el('div', { class: 'field' }, [
          el('label', { for: 'f-minimo' }, 'Stock mínimo (alerta)'),
          el('input', { id: 'f-minimo', type: 'number', value: p.stock_minimo || '0', min: '0', step: '1' })
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-proveedor' }, 'Proveedor'),
        el('select', { id: 'f-proveedor' }, opciones)
      ])
    ]);
  }

  function abrirForm(prod) {
    const esNuevo = !prod;
    modal({
      titulo: esNuevo ? 'Nuevo repuesto' : 'Editar repuesto',
      cuerpo: formulario(prod),
      textoGuardar: esNuevo ? 'Crear' : 'Guardar',
      onGuardar: async () => {
        const nombre = document.getElementById('f-nombre').value.trim();
        if (!nombre) { toast('El nombre es obligatorio.', 'error'); return false; }

        const val = (id) => {
          const v = document.getElementById(id).value;
          return v === '' ? null : Number(v);
        };
        const payload = {
          nombre,
          codigo: document.getElementById('f-codigo').value.trim() || null,
          categoria: document.getElementById('f-categoria').value.trim() || null,
          precio_compra: val('f-compra') || 0,
          precio_venta: val('f-venta') || 0,
          stock_minimo: val('f-minimo') || 0,
          proveedor_id: document.getElementById('f-proveedor').value || null
        };
        if (esNuevo) payload.stock = val('f-stock') || 0;

        if (esNuevo) {
          const { data, error } = await db.from('productos').insert(payload).select('id, stock').single();
          if (error) {
            const msg = error.code === '23505' ? 'Ya existe un repuesto con ese código.' : 'No se pudo guardar.';
            toast(msg, 'error'); return false;
          }
          // Si arrancó con stock, dejamos el movimiento de carga inicial.
          if (data && Number(data.stock) > 0) {
            await db.from('movimientos_stock').insert({
              producto_id: data.id, tipo: 'entrada', cantidad: Number(data.stock),
              motivo: 'Carga inicial', usuario_id: (auth.sesion() || {}).id || null
            });
          }
          toast('Repuesto creado.', 'ok');
        } else {
          const { error } = await db.from('productos').update(payload).eq('id', prod.id);
          if (error) {
            const msg = error.code === '23505' ? 'Ya existe un repuesto con ese código.' : 'No se pudo guardar.';
            toast(msg, 'error'); return false;
          }
          toast('Cambios guardados.', 'ok');
        }
        recargar();
      }
    });
  }

  /* ---------- Movimientos de stock ---------- */
  function abrirStock(prod) {
    const cuerpo = el('div', {}, [
      el('div', { class: 'stock-actual' }, [
        el('span', {}, 'Stock actual: '),
        el('strong', {}, String(prod.stock))
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 's-modo' }, '¿Qué querés hacer?'),
        el('select', { id: 's-modo' }, [
          el('option', { value: 'entrada' }, 'Sumar entrada (compra / reposición)'),
          el('option', { value: 'ajuste' }, 'Corregir stock (conteo real)')
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 's-cant', id: 's-cant-label' }, 'Cantidad que entró'),
        el('input', { id: 's-cant', type: 'number', min: '0', step: '1', value: '' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 's-motivo' }, 'Motivo (opcional)'),
        el('input', { id: 's-motivo', type: 'text', placeholder: 'ej. compra a proveedor' })
      ])
    ]);

    // Cambiar el label según el modo elegido.
    setTimeout(() => {
      const modo = document.getElementById('s-modo');
      const label = document.getElementById('s-cant-label');
      modo.addEventListener('change', () => {
        label.textContent = modo.value === 'ajuste' ? 'Stock real contado' : 'Cantidad que entró';
      });
    }, 0);

    modal({
      titulo: 'Stock — ' + prod.nombre,
      cuerpo,
      textoGuardar: 'Aplicar',
      onGuardar: async () => {
        const modo = document.getElementById('s-modo').value;
        const cant = Number(document.getElementById('s-cant').value);
        const motivo = document.getElementById('s-motivo').value.trim() || null;
        if (isNaN(cant) || cant < 0) { toast('Poné una cantidad válida.', 'error'); return false; }

        const usuario_id = (auth.sesion() || {}).id || null;
        let nuevoStock, movimiento;

        if (modo === 'entrada') {
          nuevoStock = Number(prod.stock) + cant;
          movimiento = { producto_id: prod.id, tipo: 'entrada', cantidad: cant, motivo: motivo || 'Entrada', usuario_id };
        } else {
          // Ajuste: el stock pasa a ser el valor contado.
          const dif = cant - Number(prod.stock);
          nuevoStock = cant;
          movimiento = { producto_id: prod.id, tipo: 'ajuste', cantidad: Math.abs(dif), motivo: motivo || 'Ajuste por conteo', usuario_id };
        }

        const { error: e1 } = await db.from('productos').update({ stock: nuevoStock }).eq('id', prod.id);
        if (e1) { toast('No se pudo actualizar el stock.', 'error'); return false; }
        await db.from('movimientos_stock').insert(movimiento);
        toast('Stock actualizado.', 'ok');
        recargar();
      }
    });
  }

  async function eliminar(p) {
    const ok = await confirmar('¿Eliminar el repuesto "' + p.nombre + '"?');
    if (!ok) return;
    const { error } = await db.from('productos').delete().eq('id', p.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Repuesto eliminado.', 'ok');
    recargar();
  }

  /* ---------- Lista ---------- */
  function pintarLista(cont) {
    const lista = cache.filter(coincide);
    const wrap = cont.querySelector('#lista-repuestos');
    wrap.innerHTML = '';

    // Aviso de stock bajo (sobre el total, no sobre el filtro).
    const bajos = cache.filter(p => estadoStock(p) !== 'ok').length;
    const aviso = cont.querySelector('#aviso-stock');
    aviso.innerHTML = '';
    if (bajos > 0) {
      aviso.appendChild(el('div', { class: 'alerta-stock' },
        '⚠ ' + bajos + (bajos === 1 ? ' repuesto' : ' repuestos') + ' con stock bajo o agotado.'));
    }

    if (!lista.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, cache.length ? 'Sin resultados' : 'Todavía no hay repuestos'),
        el('div', {}, cache.length ? 'Probá con otra búsqueda.' : 'Cargá el primero con el botón de arriba.')
      ]));
      return;
    }

    const card = el('div', { class: 'card' });
    lista.forEach(p => {
      const est = estadoStock(p);
      const textoEst = est === 'sin' ? 'Sin stock' : (est === 'bajo' ? 'Stock bajo' : 'En stock');
      const sub = [
        p.codigo ? 'Cód. ' + p.codigo : null,
        p.categoria,
        p.proveedores ? p.proveedores.nombre : null
      ].filter(Boolean).join('  ·  ');

      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, p.nombre),
          sub ? el('div', { class: 'list-row-sub' }, sub) : null
        ]),
        el('div', { class: 'repuesto-meta' }, [
          el('div', { class: 'precio' }, fmtMoneda(p.precio_venta)),
          el('div', { class: 'stock-badge ' + est }, [
            el('span', { class: 'stock-num' }, String(p.stock)),
            el('span', { class: 'stock-txt' }, textoEst)
          ])
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('button', { class: 'btn btn-accent btn-sm', onclick: () => abrirStock(p) }, 'Stock'),
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
      el('h1', {}, 'Repuestos'),
      el('div', { class: 'head-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => window.PADDOCK.reportes.abrirRepuestos() }, 'Reporte'),
        el('button', { class: 'btn btn-ghost', onclick: () => window.PADDOCK.importar.abrir(recargar) }, 'Importar'),
        el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '+ Nuevo')
      ])
    ]));
    cont.appendChild(el('div', { id: 'aviso-stock' }));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', {
        class: 'search', type: 'text', placeholder: 'Buscar por nombre, código o categoría…',
        oninput: (e) => { filtro = e.target.value; pintarLista(cont); }
      })
    ]));
    cont.appendChild(el('div', { id: 'lista-repuestos' }, [
      el('div', { class: 'loading' }, 'Cargando…')
    ]));

    [cache, proveedores] = await Promise.all([traer(), traerProveedores()]);
    pintarLista(cont);
  }

  router.registrar('repuestos', render);
})();
