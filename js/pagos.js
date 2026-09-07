/* ============================================================
   PAGOS — registrar pagos a proveedores y orden de pago.
   - Un pago puede cubrir VARIAS facturas (se elige cuánto a
     cada una). Genera la orden de pago numerada.
   - Registra el egreso en la caja.
   - Adjunta el comprobante de la transferencia (opcional).
   - La orden de pago se puede imprimir / guardar PDF y
     compartir por WhatsApp.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal } = ui;

  function fmtMoneda(n) {
    if (n == null) return '$0';
    return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
  function fmtFecha(f) {
    if (!f) return '';
    const [a, m, d] = String(f).split('-');
    return d + '/' + m + '/' + a;
  }
  function soloDigitos(t) { return (t || '').replace(/[^0-9]/g, ''); }

  async function subirArchivo(file, carpeta) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'dat').toLowerCase();
    const path = carpeta + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await db.storage.from('comprobantes').upload(path, file);
    if (error) { toast('No se pudo subir el comprobante.', 'error'); return null; }
    const { data } = db.storage.from('comprobantes').getPublicUrl(path);
    return data.publicUrl;
  }

  /* ---------- Registrar pago ---------- */
  async function abrir(proveedorId, proveedorNombre, onDone) {
    // Traer facturas del proveedor con su saldo.
    const [{ data: compras }, { data: aplic }] = await Promise.all([
      db.from('compras').select('id, numero, fecha, total').eq('proveedor_id', proveedorId).order('fecha'),
      db.from('pago_aplicaciones').select('compra_id, monto')
    ]);
    const pagado = {};
    (aplic || []).forEach(a => { pagado[a.compra_id] = (pagado[a.compra_id] || 0) + Number(a.monto); });

    const pendientes = (compras || [])
      .map(c => ({ ...c, saldo: Number(c.total) - (pagado[c.id] || 0) }))
      .filter(c => c.saldo > 0.01);

    if (!pendientes.length) { toast('Este proveedor no tiene facturas pendientes.', 'ok'); return; }

    // Estado de selección: { compra_id: monto a pagar } (0 = no seleccionada)
    const sel = {};
    pendientes.forEach(c => { sel[c.id] = 0; });

    const totalLabel = el('span', { id: 'pago-total' }, '$0');
    function recalc() {
      const t = Object.values(sel).reduce((a, m) => a + (Number(m) || 0), 0);
      totalLabel.textContent = fmtMoneda(t);
      return t;
    }

    const filas = pendientes.map(c => {
      const chk = el('input', { type: 'checkbox' });
      const inp = el('input', {
        class: 'pago-monto', type: 'number', min: '0', step: '1', value: '', disabled: true,
        placeholder: fmtMoneda(c.saldo)
      });
      chk.addEventListener('change', () => {
        if (chk.checked) {
          inp.disabled = false;
          if (!inp.value) inp.value = c.saldo;
          sel[c.id] = Number(inp.value);
        } else {
          inp.disabled = true; inp.value = ''; sel[c.id] = 0;
        }
        recalc();
      });
      inp.addEventListener('input', () => {
        let v = Number(inp.value || 0);
        if (v > c.saldo) { v = c.saldo; inp.value = c.saldo; }  // no más que el saldo
        sel[c.id] = v; recalc();
      });
      return el('div', { class: 'pago-fila' }, [
        el('label', { class: 'pago-chk' }, [chk]),
        el('div', { class: 'pago-info' }, [
          el('div', { class: 'pago-fac' }, (c.numero ? 'N° ' + c.numero : 'Factura') + '  ·  ' + fmtFecha(c.fecha)),
          el('div', { class: 'pago-saldo' }, 'Saldo: ' + fmtMoneda(c.saldo))
        ]),
        inp
      ]);
    });

    const selMedio = el('select', { id: 'pago-medio' }, [
      el('option', { value: 'transferencia' }, 'Transferencia'),
      el('option', { value: 'efectivo' }, 'Efectivo'),
      el('option', { value: 'tarjeta' }, 'Tarjeta')
    ]);
    const hoy = new Date().toISOString().slice(0, 10);

    const cuerpo = el('div', {}, [
      el('label', { class: 'sublabel' }, 'Elegí qué facturas pagás y cuánto'),
      el('div', { class: 'pago-lista' }, filas),
      el('div', { class: 'pago-total-fila' }, [ el('span', {}, 'Total a pagar'), totalLabel ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [ el('label', { for: 'pago-medio' }, 'Medio'), selMedio ]),
        el('div', { class: 'field' }, [ el('label', { for: 'pago-fecha' }, 'Fecha'), el('input', { id: 'pago-fecha', type: 'date', value: hoy }) ])
      ]),
      el('div', { class: 'field' }, [ el('label', { for: 'pago-comp' }, 'Comprobante de transferencia (opcional)'), el('input', { id: 'pago-comp', type: 'file', accept: 'image/*,.pdf' }) ]),
      el('div', { class: 'field' }, [ el('label', { for: 'pago-notas' }, 'Notas'), el('textarea', { id: 'pago-notas' }, '') ])
    ]);

    modal({
      titulo: 'Registrar pago — ' + proveedorNombre,
      cuerpo,
      textoGuardar: 'Registrar y generar orden',
      onGuardar: async () => {
        const aplicaciones = Object.entries(sel)
          .filter(([, m]) => Number(m) > 0)
          .map(([compra_id, monto]) => ({ compra_id, monto: Number(monto) }));
        if (!aplicaciones.length) { toast('Elegí al menos una factura.', 'error'); return false; }
        const total = aplicaciones.reduce((a, x) => a + x.monto, 0);

        const usuario_id = (auth.sesion() || {}).id || null;
        const medio = selMedio.value;
        const fecha = document.getElementById('pago-fecha').value || hoy;
        const compFile = document.getElementById('pago-comp').files[0];

        let comprobante_url = null;
        if (compFile) {
          comprobante_url = await subirArchivo(compFile, 'pagos');
          if (!comprobante_url) return false;
        }

        // 1. Cabecera del pago (orden de pago)
        const { data: pago, error: e1 } = await db.from('pagos').insert({
          proveedor_id: proveedorId, monto: total, medio_pago: medio, fecha,
          comprobante_url, notas: document.getElementById('pago-notas').value.trim() || null, usuario_id
        }).select('id, numero').single();
        if (e1 || !pago) { toast('No se pudo registrar el pago.', 'error'); return false; }

        // 2. Aplicaciones a cada factura
        await db.from('pago_aplicaciones').insert(aplicaciones.map(a => ({ pago_id: pago.id, compra_id: a.compra_id, monto: a.monto })));

        // 3. Egreso en caja
        await db.from('movimientos_caja').insert({
          tipo: 'egreso', monto: total, medio_pago: medio,
          concepto: 'Pago a ' + proveedorNombre + ' (OP ' + pago.numero + ')', usuario_id
        });

        toast('Pago registrado. OP ' + pago.numero + '.', 'ok');
        if (onDone) onDone();
        // Abrir la orden de pago.
        location.hash = '#/orden?id=' + pago.id;
      }
    });

    recalc();
  }

  /* ---------- Orden de pago (documento) ---------- */
  function idHash() {
    const m = location.hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function renderOrden(cont) {
    const pagoId = idHash();
    cont.appendChild(el('div', { class: 'loading' }, 'Cargando orden…'));

    const { data: pago } = await db.from('pagos')
      .select('*, proveedores(nombre, telefono), usuarios_app(nombre)')
      .eq('id', pagoId).maybeSingle();
    if (!pago) { cont.innerHTML = ''; cont.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty-title' }, 'Orden no encontrada')])); return; }

    const { data: aplic } = await db.from('pago_aplicaciones')
      .select('monto, compras(numero, fecha, total)')
      .eq('pago_id', pagoId);

    cont.innerHTML = '';
    const prov = pago.proveedores || {};

    // Barra de acciones (no se imprime)
    cont.appendChild(el('div', { class: 'orden-acciones no-print' }, [
      el('button', { class: 'back-link', onclick: () => history.back() }, '← Volver'),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.print() }, 'Imprimir'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => ui.descargarPDF(document.getElementById('orden-doc'), 'orden-pago-' + pago.numero + '.pdf') }, 'Descargar PDF'),
        prov.telefono ? el('a', {
          class: 'btn btn-accent btn-sm',
          href: 'https://wa.me/' + soloDigitos(prov.telefono) + '?text=' + encodeURIComponent(textoWhatsApp(pago, aplic, prov)),
          target: '_blank', rel: 'noopener'
        }, 'WhatsApp') : null
      ])
    ]));

    // Documento
    const filas = (aplic || []).map(a => el('div', { class: 'od-fila' }, [
      el('div', {}, a.compras ? ((a.compras.numero ? 'Factura N° ' + a.compras.numero : 'Factura') + '  ·  ' + fmtFecha(a.compras.fecha)) : 'Factura'),
      el('div', { class: 'od-monto' }, fmtMoneda(a.monto))
    ]));

    cont.appendChild(el('div', { class: 'orden-doc', id: 'orden-doc' }, [
      el('div', { class: 'od-head' }, [
        el('div', { class: 'od-brand' }, [
          el('div', { class: 'od-brand-name' }, 'PADDOCK'),
          el('div', { class: 'od-brand-sub' }, 'Car Center')
        ]),
        el('div', { class: 'od-title' }, [
          el('div', { class: 'od-title-txt' }, 'Orden de pago'),
          el('div', { class: 'od-numero' }, 'N° ' + pago.numero)
        ])
      ]),
      el('div', { class: 'od-datos' }, [
        el('div', {}, [ el('span', { class: 'od-lbl' }, 'Proveedor: '), el('strong', {}, prov.nombre || '—') ]),
        el('div', {}, [ el('span', { class: 'od-lbl' }, 'Fecha: '), fmtFecha(pago.fecha) ]),
        el('div', {}, [ el('span', { class: 'od-lbl' }, 'Medio de pago: '), (pago.medio_pago || '—') ]),
        (auth.esAdmin() && pago.usuarios_app) ? el('div', {}, [ el('span', { class: 'od-lbl' }, 'Registró: '), pago.usuarios_app.nombre ]) : null
      ]),
      el('div', { class: 'od-facturas' }, [
        el('div', { class: 'od-facturas-tit' }, 'Facturas abonadas'),
        ...filas
      ]),
      el('div', { class: 'od-total' }, [
        el('span', {}, 'TOTAL PAGADO'),
        el('span', { class: 'od-total-monto' }, fmtMoneda(pago.monto))
      ]),
      pago.notas ? el('div', { class: 'od-notas' }, pago.notas) : null,
      el('div', { class: 'od-firma' }, [
        el('div', { class: 'od-firma-linea' }),
        el('div', { class: 'od-firma-txt' }, 'Firma y aclaración')
      ])
    ]));
  }

  function textoWhatsApp(pago, aplic, prov) {
    const lineas = [];
    lineas.push('*PADDOCK Car Center*');
    lineas.push('Orden de pago N° ' + pago.numero);
    lineas.push('Proveedor: ' + (prov.nombre || ''));
    lineas.push('Fecha: ' + fmtFecha(pago.fecha));
    lineas.push('Medio: ' + (pago.medio_pago || ''));
    lineas.push('');
    (aplic || []).forEach(a => {
      const f = a.compras;
      lineas.push('• ' + (f && f.numero ? 'Factura N° ' + f.numero : 'Factura') + ': ' + fmtMoneda(a.monto));
    });
    lineas.push('');
    lineas.push('*Total pagado: ' + fmtMoneda(pago.monto) + '*');
    return lineas.join('\n');
  }

  router.registrar('orden', renderOrden);
  window.PADDOCK.pagos = { abrir };
})();
