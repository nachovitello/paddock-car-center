/* ============================================================
   Autenticación propia (mismo patrón que BarberSys).
   - Hash SHA-256 con Web Crypto (requiere https o localhost).
   - Valida contra la tabla usuarios_app.
   - Sesión en sessionStorage (se cierra al cerrar la pestaña).

   >>> Para crear el PRIMER admin:
       1. Abrí la consola del navegador (F12) con la app cargada.
       2. Corré:  await PADDOCK.auth.hash('tu-clave')
       3. Copiá el hash que devuelve.
       4. En Supabase → SQL Editor, insertá el usuario:
          insert into usuarios_app (usuario, pass_hash, nombre, rol)
          values ('nacho', 'EL-HASH-QUE-COPIASTE', 'Nacho', 'admin');
   ============================================================ */
(function () {
  const db = window.PADDOCK.db;
  const AUTH = {};
  const SESS_KEY = 'paddock_sesion';

  // SHA-256 en hexadecimal.
  AUTH.hash = async function (texto) {
    const datos = new TextEncoder().encode(texto);
    const buf = await crypto.subtle.digest('SHA-256', datos);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Intenta loguear. Devuelve { ok, error, usuario }.
  AUTH.login = async function (usuario, clave) {
    usuario = (usuario || '').trim();
    if (!usuario || !clave) return { ok: false, error: 'Completá usuario y contraseña.' };

    const hash = await AUTH.hash(clave);

    // Traemos sólo la fila de ESE usuario activo.
    const { data, error } = await db
      .from('usuarios_app')
      .select('id, usuario, nombre, rol, pass_hash, activo')
      .eq('usuario', usuario)
      .eq('activo', true)
      .maybeSingle();

    if (error) return { ok: false, error: 'Error de conexión. Probá de nuevo.' };
    if (!data || data.pass_hash !== hash) {
      return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    }

    // Guardamos la sesión SIN el hash.
    const sesion = { id: data.id, usuario: data.usuario, nombre: data.nombre, rol: data.rol };
    sessionStorage.setItem(SESS_KEY, JSON.stringify(sesion));
    return { ok: true, usuario: sesion };
  };

  AUTH.sesion = function () {
    try { return JSON.parse(sessionStorage.getItem(SESS_KEY)); }
    catch { return null; }
  };

  AUTH.estaLogueado = function () { return !!AUTH.sesion(); };

  AUTH.rol = function () { const s = AUTH.sesion(); return s ? s.rol : null; };

  AUTH.esAdmin = function () { return AUTH.rol() === 'admin'; };

  AUTH.salir = function () {
    sessionStorage.removeItem(SESS_KEY);
    location.hash = '';
    location.reload();
  };

  window.PADDOCK.auth = AUTH;
})();
