/* ============================================================
   Bootstrap: conecta login ↔ app, protege el acceso y arranca
   el router. Se ejecuta último (ver orden de scripts en index.html).
   ============================================================ */
(function () {
  const { auth, router, ui } = window.PADDOCK;

  const loginScreen = document.getElementById('login-screen');
  const appEl = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');

  function mostrarApp() {
    const s = auth.sesion();
    loginScreen.hidden = true;
    appEl.hidden = false;
    document.getElementById('user-label').textContent =
      (s.nombre || s.usuario) + (s.rol === 'admin' ? ' · admin' : '');
    // Oculta los accesos reservados al admin.
    document.querySelectorAll('[data-solo-admin]').forEach(a => {
      a.hidden = (s.rol !== 'admin');
    });
    if (!location.hash) location.hash = '#/clientes';
    router.resolver();
  }

  function mostrarLogin() {
    appEl.hidden = true;
    loginScreen.hidden = false;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Entrando…';

    const usuario = document.getElementById('login-user').value;
    const clave = document.getElementById('login-pass').value;
    const res = await auth.login(usuario, clave);

    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';

    if (!res.ok) {
      loginError.textContent = res.error;
      loginError.hidden = false;
      return;
    }
    document.getElementById('login-pass').value = '';
    mostrarApp();
  });

  document.getElementById('logout-btn').addEventListener('click', () => auth.salir());

  // Arranque: si ya hay sesión, entramos directo.
  if (auth.estaLogueado()) mostrarApp();
  else mostrarLogin();
})();
