/* ============================================================
   Vista TURNOS — agenda del taller.
   Turnos por día y hora. Podés elegir un vehículo/cliente ya
   cargado (autocompleta) o escribir los datos si es nuevo.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let fechaSel = hoyISO();
  let cache = [];
  let vehiculos = [];
  let contActual = null;

  function hoyISO() { return new Date().toISOString().slice(0, 10); }
  function fmtFechaLarga(f) {
    const [a, m, d] = f.split('-').map(Number);
    const dt = new Date(a, m - 1, d);
    return dt.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  async function traer() {
    const { data, error } = await db.from('turnos')
      .select('*')
      .eq('fecha', fechaSel)
      .order('hora', { ascending: true });
    if (error) { toast('No se pudieron cargar los turnos.', 'error'); return []; }
    return data || [];
  }
  async function traerVehiculos() {
    const { data } = await db.from('vehiculos').select('id, patente, marca, modelo, cliente_id, clientes(nombre, telefono)').order('patente');
    return data || [];
  }

  /* ---------- Nuevo / editar turno ---------- */
  function abrirForm(turno) {
    const t = turno || {};
    let vehiculoSel = null;

    const inpPatente = el('input', { id: 't-patente', type: 'text', value: t.patente || '', autocapitalize: 'characters', style: 'text-transform:uppercase' });
    const inpNombre = el('input', { id: 't-nombre', type: 'text', value: t.cliente_nombre || '' });
    const inpTel = el('input', { id: 't-tel', type: 'tel', value: t.telefono || '' });

    // Buscador de vehículo existente
    const vehResultados = el('div', { class: 'venta-resultados' });
    const vehBusq = el('input', { type: 'text', class: 'search', placeholder: 'Buscar vehículo cargado por patente…' });
    vehBusq.addEventListener('input', () => {
      vehResultados.innerHTML = '';
      const q = vehBusq.value.trim().toLowerCase();
      if (!q) return;
      vehiculos.filter(v => (v.patente || '').toLowerCase().includes(q)).slice(0, 6).forEach(v => {
        vehResultados.appendChild(el('div', { class: 'busq-item', onclick: () => {
          vehiculoSel = v;
          inpPatente.value = v.patente || '';
          inpNombre.value = v.clientes ? (v.clientes.nombre || '') : '';
          inpTel.value = v.clientes ? (v.clientes.telefono || '') : '';
          vehBusq.value = ''; vehResultados.innerHTML = '';
          toast('Datos cargados de ' + v.patente, 'ok');
        } }, [
          el('div', {}, [ el('div', { class: 'busq-nombre' }, v.patente), el('div', { class: 'busq-sub' }, [v.marca, v.modelo].filter(Boolean).join(' ') + (v.clientes ? '  ·  ' + v.clientes.nombre : '')) ])
        ]));
      });
    });

    modal({
      titulo: turno ? 'Editar turno' : 'Nuevo turno',
      cuerpo: el('div', {}, [
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [ el('label', { for: 't-fecha' }, 'Fecha'), el('input', { id: 't-fecha', type: 'date', value: t.fecha || fechaSel }) ]),
          el('div', { class: 'field' }, [ el('label', { for: 't-hora' }, 'Hora'), el('input', { id: 't-hora', type: 'time', value: t.hora || '' }) ])
        ]),
        el('label', { class: 'sublabel' }, 'Buscar vehículo cargado (opcional)'),
        el('div', {}, [vehBusq, vehResultados]),
        el('div', { class: 'field', style: 'margin-top:12px' }, [ el('label', { for: 't-patente' }, 'Patente / vehículo'), inpPatente ]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [ el('label', { for: 't-nombre' }, 'Cliente'), inpNombre ]),
          el('div', { class: 'field' }, [ el('label', { for: 't-tel' }, 'Teléfono'), inpTel ])
        ]),
        el('div', { class: 'field' }, [ el('label', { for: 't-motivo' }, 'Motivo'), el('textarea', { id: 't-motivo', placeholder: 'ej. service, ruido, revisión…' }, t.motivo || '') ])
      ]),
      textoGuardar: turno ? 'Guardar' : 'Agendar',
      onGuardar: async () => {
        const fecha = document.getElementById('t-fecha').value;
        if (!fecha) { toast('Elegí una fecha.', 'error'); return false; }
        const payload = {
          fecha,
          hora: document.getElementById('t-hora').value || null,
          vehiculo_id: vehiculoSel ? vehiculoSel.id : (t.vehiculo_id || null),
          cliente_id: vehiculoSel ? (vehiculoSel.cliente_id || null) : (t.cliente_id || null),
          patente: inpPatente.value.trim().toUpperCase() || null,
          cliente_nombre: inpNombre.value.trim() || null,
          telefono: inpTel.value.trim() || null,
          motivo: document.getElementById('t-motivo').value.trim() || null,
          usuario_id: (auth.sesion() || {}).id || null
        };
        const q = turno ? db.from('turnos').update(payload).eq('id', turno.id) : db.from('turnos').insert(payload);
        const { error } = await q;
        if (error) { toast('No se pudo guardar.', 'error'); return false; }
        toast(turno ? 'Turno actualizado.' : 'Turno agendado.', 'ok');
        fechaSel = fecha;
        recargar(true);
      }
    });
  }

  async function marcarAtendido(t) {
    const nuevo = t.estado === 'atendido' ? 'pendiente' : 'atendido';
    const { error } = await db.from('turnos').update({ estado: nuevo }).eq('id', t.id);
    if (error) { toast('No se pudo actualizar.', 'error'); return; }
    recargar();
  }
  async function eliminar(t) {
    const ok = await confirmar('¿Eliminar este turno?');
    if (!ok) return;
    const { error } = await db.from('turnos').delete().eq('id', t.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Turno eliminado.', 'ok');
    recargar();
  }

  function pintarLista(cont) {
    const wrap = cont.querySelector('#lista-turnos');
    wrap.innerHTML = '';
    if (!cache.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Sin turnos este día'),
        el('div', {}, 'Agendá uno con el botón de arriba.')
      ]));
      return;
    }
    const card = el('div', { class: 'card' });
    cache.forEach(t => {
      const atendido = t.estado === 'atendido';
      card.appendChild(el('div', { class: 'list-row' + (atendido ? ' turno-hecho' : '') }, [
        el('div', { class: 'turno-hora' }, t.hora || '—'),
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, [
            t.patente ? el('span', { class: 'patente-tag' }, t.patente) : el('span', {}, 'Sin patente'),
            el('span', { style: 'margin-left:8px;font-weight:500' }, t.cliente_nombre || '')
          ]),
          el('div', { class: 'list-row-sub' }, t.motivo || 'Sin motivo')
        ]),
        el('div', { class: 'list-row-actions' }, [
          t.telefono ? el('a', { class: 'btn btn-accent btn-sm', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + t.telefono.replace(/[^0-9]/g, '') }, 'WhatsApp') : null,
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => marcarAtendido(t) }, atendido ? '↺' : '✓'),
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => abrirForm(t) }, 'Editar'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(t) }, 'Borrar')
        ])
      ]));
    });
    wrap.appendChild(card);
  }

  async function recargar(recargarVeh) {
    if (recargarVeh) vehiculos = await traerVehiculos();
    cache = await traer();
    if (contActual) { pintarCabecera(contActual); pintarLista(contActual); }
  }

  function pintarCabecera(cont) {
    const lbl = cont.querySelector('#turno-fecha-lbl');
    if (lbl) lbl.textContent = fmtFechaLarga(fechaSel);
    const inp = cont.querySelector('#turno-fecha-inp');
    if (inp) inp.value = fechaSel;
  }

  async function render(cont) {
    contActual = cont;
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Turnos'),
      el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '+ Nuevo turno')
    ]));
    cont.appendChild(el('div', { class: 'turno-barra' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { fechaSel = corrDia(-1); recargar(); } }, '‹'),
      el('input', { id: 'turno-fecha-inp', type: 'date', value: fechaSel, onchange: (e) => { fechaSel = e.target.value; recargar(); } }),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { fechaSel = corrDia(1); recargar(); } }, '›'),
      el('div', { id: 'turno-fecha-lbl', class: 'turno-fecha-lbl' }, fmtFechaLarga(fechaSel))
    ]));
    cont.appendChild(el('div', { id: 'lista-turnos' }, [ el('div', { class: 'loading' }, 'Cargando…') ]));

    vehiculos = await traerVehiculos();
    cache = await traer();
    pintarLista(cont);
  }

  function corrDia(delta) {
    const [a, m, d] = fechaSel.split('-').map(Number);
    const dt = new Date(a, m - 1, d + delta);
    return dt.toISOString().slice(0, 10);
  }

  router.registrar('turnos', render);
})();
