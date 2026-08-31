/* ============================================================
   Router por hash. Cada vista se registra con PADDOCK.router.registrar.
   La vista es una función que recibe el contenedor y lo llena.
   ============================================================ */
(function () {
  const rutas = {};
  const ROUTER = {};

  ROUTER.registrar = function (nombre, render) { rutas[nombre] = render; };

  ROUTER.ir = function (nombre) { location.hash = '#/' + nombre; };

  ROUTER.actual = function () {
    const h = location.hash.replace(/^#\//, '').split('?')[0];
    return h || 'clientes'; // ruta por defecto
  };

  ROUTER.resolver = function () {
    const nombre = ROUTER.actual();
    const render = rutas[nombre] || rutas['clientes'];
    const cont = document.getElementById('view');
    cont.innerHTML = '';

    // Marca el link activo de la nav.
    document.querySelectorAll('.mainnav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === nombre);
    });

    if (render) render(cont);
  };

  window.addEventListener('hashchange', ROUTER.resolver);
  window.PADDOCK.router = ROUTER;
})();
