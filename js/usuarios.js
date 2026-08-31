/* ============================================================
   Vista USUARIOS — ABM de usuarios_app. SOLO ADMIN.
   El hasheo de la contraseña pasa acá adentro: nunca más
   hay que generar hashes a mano en la consola.

   Nota de seguridad: el control "solo admin" acá es del lado
   del cliente. El blindaje real (que un empleado no pueda
   escribir en esta tabla ni aunque quiera) llega en la fase
   de endurecimiento con RLS por rol / función RPC.
   ============================================================ */
(function () {
  const { db, ui, router, auth } = window.PADDOCK;
  const { el, toast, modal, confirmar } = ui;

  let cache = [];
  let filtro = '';
  let contActual = null;

  async function traer() {
    const { data, error } = await db
      .from('usuarios_app')
      .select('id, usuario, nombre, rol, activo, creado_en')
      .order('usuario', { ascending: true });
    if (error) { toast('No se pudieron cargar los usuarios.', 'error'); return []; }
    return data || [];
  }

  function coincide(u) {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return (u.usuario || '').toLowerCase().includes(q) ||
           (u.nombre || '').toLowerCase().includes(q);
  }

  function formulario(usuario) {
    const u = usuario || {};
    const esNuevo = !usuario;
    return el('div', {}, [
      el('div', { class: 'field' }, [
        el('label', { for: 'f-nombre' }, 'Nombre'),
        el('input', { id: 'f-nombre', type: 'text', value: u.nombre || '' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-usuario' }, 'Usuario (para entrar)'),
        el('input', {
          id: 'f-usuario', type: 'text', value: u.usuario || '',
          required: true, autocapitalize: 'none', spellcheck: 'false'
        })
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'f-pass' }, esNuevo ? 'Contraseña' : 'Contraseña (dejá en blanco para no cambiarla)'),
        el('input', { id: 'f-pass', type: 'password', autocomplete: 'new-password', placeholder: esNuevo ? '' : '••••••••' })
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'f-rol' }, 'Rol'),
          el('select', { id: 'f-rol' }, [
            el('option', { value: 'empleado', selected: u.rol === 'empleado' }, 'Empleado'),
            el('option', { value: 'admin', selected: u.rol === 'admin' }, 'Admin')
          ])
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'f-activo' }, 'Estado'),
          el('select', { id: 'f-activo' }, [
            el('option', { value: 'si', selected: u.activo !== false }, 'Activo'),
            el('option', { value: 'no', selected: u.activo === false }, 'Inactivo')
          ])
        ])
      ])
    ]);
  }

  function abrirForm(usuario) {
    const esNuevo = !usuario;
    modal({
      titulo: esNuevo ? 'Nuevo usuario' : 'Editar usuario',
      cuerpo: formulario(usuario),
      textoGuardar: esNuevo ? 'Crear' : 'Guardar',
      onGuardar: async () => {
        const nombre = document.getElementById('f-nombre').value.trim();
        const usr = document.getElementById('f-usuario').value.trim();
        const pass = document.getElementById('f-pass').value;
        const rol = document.getElementById('f-rol').value;
        const activo = document.getElementById('f-activo').value === 'si';

        if (!usr) { toast('El usuario es obligatorio.', 'error'); return false; }
        if (esNuevo && !pass) { toast('Poné una contraseña.', 'error'); return false; }

        const payload = { usuario: usr, nombre: nombre || null, rol, activo };
        // Solo hasheamos si es nuevo o si escribió una contraseña nueva.
        if (pass) payload.pass_hash = await auth.hash(pass);

        const q = esNuevo
          ? db.from('usuarios_app').insert(payload)
          : db.from('usuarios_app').update(payload).eq('id', usuario.id);
        const { error } = await q;
        if (error) {
          const msg = error.code === '23505'
            ? 'Ya existe un usuario con ese nombre de acceso.'
            : 'No se pudo guardar.';
          toast(msg, 'error');
          return false;
        }
        toast(esNuevo ? 'Usuario creado.' : 'Cambios guardados.', 'ok');
        recargar();
      }
    });
  }

  async function eliminar(u) {
    const yo = auth.sesion();
    if (yo && yo.id === u.id) {
      toast('No podés eliminar tu propio usuario.', 'error');
      return;
    }
    const ok = await confirmar('¿Eliminar al usuario "' + u.usuario + '"?');
    if (!ok) return;
    const { error } = await db.from('usuarios_app').delete().eq('id', u.id);
    if (error) { toast('No se pudo eliminar.', 'error'); return; }
    toast('Usuario eliminado.', 'ok');
    recargar();
  }

  function pintarLista(cont) {
    const lista = cache.filter(coincide);
    const wrap = cont.querySelector('#lista-usuarios');
    wrap.innerHTML = '';

    if (!lista.length) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Sin resultados'),
        el('div', {}, 'Probá con otra búsqueda.')
      ]));
      return;
    }

    const yo = auth.sesion();
    const card = el('div', { class: 'card' });
    lista.forEach(u => {
      const etiquetas = [
        u.rol === 'admin' ? 'Admin' : 'Empleado',
        u.activo === false ? 'Inactivo' : null,
        (yo && yo.id === u.id) ? 'Vos' : null
      ].filter(Boolean).join('  ·  ');

      card.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, u.nombre || u.usuario),
          el('div', { class: 'list-row-sub' }, '@' + u.usuario + '  ·  ' + etiquetas)
        ]),
        el('div', { class: 'list-row-actions' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => abrirForm(u) }, 'Editar'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => eliminar(u) }, 'Borrar')
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
    // Guardia: si no es admin, no mostramos nada.
    if (!auth.esAdmin()) {
      cont.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, 'Acceso restringido'),
        el('div', {}, 'Solo el administrador puede gestionar usuarios.')
      ]));
      return;
    }

    contActual = cont;
    cont.appendChild(el('div', { class: 'view-head' }, [
      el('h1', {}, 'Usuarios'),
      el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '+ Nuevo')
    ]));
    cont.appendChild(el('div', { class: 'toolbar' }, [
      el('input', {
        class: 'search', type: 'text', placeholder: 'Buscar por usuario o nombre…',
        oninput: (e) => { filtro = e.target.value; pintarLista(cont); }
      })
    ]));
    cont.appendChild(el('div', { id: 'lista-usuarios' }, [
      el('div', { class: 'loading' }, 'Cargando…')
    ]));

    cache = await traer();
    pintarLista(cont);
  }

  router.registrar('usuarios', render);
})();
