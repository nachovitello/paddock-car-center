/* ============================================================
   IMPORTAR REPUESTOS desde Excel (.xlsx) o CSV.
   - Descarga de plantilla con las columnas correctas.
   - Vista previa antes de importar (nuevos / existentes / errores).
   - Match por código: si ya existe, el usuario decide
     actualizar u omitir.
   - Al actualizar NO se pisa el stock (se maneja por
     entradas/ajustes). Los nuevos con stock dejan su
     movimiento de carga inicial.
   ============================================================ */
(function () {
  const { db, ui, auth } = window.PADDOCK;
  const { el, toast } = ui;

  // Columnas esperadas en el archivo (en este orden en la plantilla).
  const COLUMNAS = ['nombre', 'codigo', 'categoria', 'precio_compra', 'precio_venta', 'stock', 'stock_minimo', 'proveedor'];

  function normalizarClave(k) {
    return String(k || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // saca acentos
      .replace(/\s+/g, '_');
  }
  function num(v) {
    if (v === '' || v == null) return 0;
    const n = Number(String(v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  /* ---------- Plantilla ---------- */
  function descargarPlantilla() {
    const headers = COLUMNAS;
    const ejemplo = ['Filtro de aceite', 'FIL-001', 'filtro', '3000', '5500', '10', '3', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ejemplo]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Repuestos');
    XLSX.writeFile(wb, 'plantilla_repuestos.xlsx');
  }

  /* ---------- Lectura del archivo ---------- */
  async function leerArchivo(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });
    // Normalizamos las claves de cada fila.
    return filas.map(f => {
      const o = {};
      for (const [k, v] of Object.entries(f)) o[normalizarClave(k)] = v;
      return o;
    });
  }

  /* ---------- Análisis ---------- */
  async function analizar(filas) {
    // Traemos lo existente para comparar.
    const [{ data: prods }, { data: provs }] = await Promise.all([
      db.from('productos').select('id, codigo'),
      db.from('proveedores').select('id, nombre')
    ]);
    const porCodigo = {};
    (prods || []).forEach(p => { if (p.codigo) porCodigo[String(p.codigo).toLowerCase()] = p.id; });
    const provPorNombre = {};
    (provs || []).forEach(p => { provPorNombre[String(p.nombre).toLowerCase()] = p.id; });

    const nuevos = [], existentes = [], errores = [];

    filas.forEach((f, i) => {
      const nombre = String(f.nombre || '').trim();
      if (!nombre) { errores.push({ fila: i + 2, motivo: 'Sin nombre' }); return; }

      const codigo = String(f.codigo || '').trim() || null;
      const provNombre = String(f.proveedor || '').trim().toLowerCase();
      const proveedor_id = provNombre ? (provPorNombre[provNombre] || null) : null;

      const prod = {
        nombre,
        codigo,
        categoria: String(f.categoria || '').trim() || null,
        precio_compra: num(f.precio_compra),
        precio_venta: num(f.precio_venta),
        stock: num(f.stock),
        stock_minimo: num(f.stock_minimo),
        proveedor_id
      };

      const idExistente = codigo ? porCodigo[codigo.toLowerCase()] : null;
      if (idExistente) existentes.push({ prod, id: idExistente });
      else nuevos.push({ prod });
    });

    return { nuevos, existentes, errores };
  }

  /* ---------- Importación ---------- */
  async function ejecutar(analisis, accionExistentes) {
    const usuario_id = (auth.sesion() || {}).id || null;
    let creados = 0, actualizados = 0;

    // Nuevos: insert en lote.
    if (analisis.nuevos.length) {
      const payload = analisis.nuevos.map(n => n.prod);
      const { data, error } = await db.from('productos').insert(payload).select('id, stock');
      if (error) throw error;
      creados = data.length;
      // Movimiento de carga inicial para los que entraron con stock.
      const movs = [];
      data.forEach(p => {
        if (Number(p.stock) > 0) {
          movs.push({ producto_id: p.id, tipo: 'entrada', cantidad: Number(p.stock), motivo: 'Carga inicial (importación)', usuario_id });
        }
      });
      if (movs.length) await db.from('movimientos_stock').insert(movs);
    }

    // Existentes: según lo que eligió el usuario.
    if (accionExistentes === 'actualizar' && analisis.existentes.length) {
      for (const e of analisis.existentes) {
        // No pisamos el stock: solo datos del catálogo.
        const { stock, ...datos } = e.prod;
        await db.from('productos').update(datos).eq('id', e.id);
        actualizados++;
      }
    }

    return { creados, actualizados };
  }

  /* ---------- UI ---------- */
  function abrir(onDone) {
    const root = document.getElementById('modal-root');
    let analisis = null;

    const cerrar = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };

    const body = el('div', { class: 'modal-body' });
    const footer = el('div', { class: 'modal-foot' });

    // --- Paso 1: elegir archivo ---
    function pasoInicial() {
      body.innerHTML = '';
      footer.innerHTML = '';

      body.appendChild(el('p', { class: 'imp-texto' },
        'Subí un archivo Excel o CSV con tus repuestos. Cada fila es un repuesto. Si no tenés el formato, descargá la plantilla.'));

      body.appendChild(el('button', { class: 'btn btn-ghost btn-block imp-plantilla', onclick: descargarPlantilla },
        '↓ Descargar plantilla (.xlsx)'));

      body.appendChild(el('div', { class: 'imp-file' }, [
        el('label', { for: 'imp-input', class: 'imp-drop' }, [
          el('strong', {}, 'Elegí tu archivo'),
          el('span', {}, ' (.xlsx o .csv)')
        ]),
        el('input', {
          id: 'imp-input', type: 'file', accept: '.xlsx,.xls,.csv',
          onchange: async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            body.innerHTML = '<div class="loading">Leyendo archivo…</div>';
            try {
              const filas = await leerArchivo(file);
              if (!filas.length) { toast('El archivo está vacío.', 'error'); pasoInicial(); return; }
              analisis = await analizar(filas);
              pasoPreview();
            } catch (err) {
              toast('No se pudo leer el archivo. Revisá el formato.', 'error');
              pasoInicial();
            }
          }
        })
      ]));

      footer.appendChild(el('button', { class: 'btn btn-ghost', onclick: cerrar }, 'Cancelar'));
    }

    // --- Paso 2: vista previa ---
    function pasoPreview() {
      body.innerHTML = '';
      footer.innerHTML = '';

      const { nuevos, existentes, errores } = analisis;

      body.appendChild(el('div', { class: 'imp-resumen' }, [
        el('div', { class: 'imp-chip nuevo' }, nuevos.length + ' nuevos'),
        existentes.length ? el('div', { class: 'imp-chip existe' }, existentes.length + ' ya existen') : null,
        errores.length ? el('div', { class: 'imp-chip error' }, errores.length + ' con error') : null
      ]));

      // Qué hacer con los que ya existen.
      let selAccion = null;
      if (existentes.length) {
        selAccion = el('select', { id: 'imp-accion' }, [
          el('option', { value: 'omitir' }, 'Omitir (no tocar los que ya existen)'),
          el('option', { value: 'actualizar' }, 'Actualizar datos (sin cambiar el stock)')
        ]);
        body.appendChild(el('div', { class: 'field' }, [
          el('label', { for: 'imp-accion' }, 'Con los repuestos que ya existen:'),
          selAccion
        ]));
      }

      if (errores.length) {
        body.appendChild(el('div', { class: 'imp-errores' }, [
          el('strong', {}, 'Filas omitidas por error:'),
          el('div', {}, errores.slice(0, 6).map(e => 'Fila ' + e.fila + ': ' + e.motivo).join('  ·  '))
        ]));
      }

      // Muestra de los primeros nuevos.
      if (nuevos.length) {
        const tabla = el('div', { class: 'imp-tabla' });
        nuevos.slice(0, 8).forEach(n => {
          tabla.appendChild(el('div', { class: 'imp-tr' }, [
            el('div', { class: 'imp-td-nombre' }, n.prod.nombre),
            el('div', {}, n.prod.codigo || '—'),
            el('div', {}, '$' + n.prod.precio_venta),
            el('div', {}, 'Stock: ' + n.prod.stock)
          ]));
        });
        if (nuevos.length > 8) tabla.appendChild(el('div', { class: 'imp-mas' }, '…y ' + (nuevos.length - 8) + ' más'));
        body.appendChild(tabla);
      }

      footer.appendChild(el('button', { class: 'btn btn-ghost', onclick: pasoInicial }, 'Atrás'));

      const totalAImportar = nuevos.length; // + existentes si actualiza (se calcula al confirmar)
      const btnImportar = el('button', { class: 'btn btn-primary' },
        'Importar');
      btnImportar.addEventListener('click', async () => {
        const accion = selAccion ? selAccion.value : 'omitir';
        if (!nuevos.length && accion === 'omitir') {
          toast('No hay nada para importar.', 'error'); return;
        }
        btnImportar.disabled = true;
        btnImportar.textContent = 'Importando…';
        try {
          const r = await ejecutar(analisis, accion);
          let msg = r.creados + ' creados';
          if (r.actualizados) msg += ', ' + r.actualizados + ' actualizados';
          toast(msg + '.', 'ok');
          cerrar();
          if (onDone) onDone();
        } catch (err) {
          toast('Hubo un problema al importar. Revisá e intentá de nuevo.', 'error');
          btnImportar.disabled = false;
          btnImportar.textContent = 'Importar';
        }
      });
      footer.appendChild(btnImportar);
    }

    const overlay = el('div', { class: 'modal-overlay' }, [
      el('div', { class: 'modal' }, [
        el('div', { class: 'modal-head' }, [
          el('h2', {}, 'Importar repuestos'),
          el('button', { class: 'modal-close', 'aria-label': 'Cerrar', onclick: cerrar }, '\u00d7')
        ]),
        body,
        footer
      ])
    ]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);

    pasoInicial();
  }

  window.PADDOCK.importar = { abrir };
})();
