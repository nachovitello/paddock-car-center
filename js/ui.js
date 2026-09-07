/* ============================================================
   Helpers de interfaz reutilizables: el(), toast, modal, confirm.
   ============================================================ */
(function () {
  const UI = {};

  // Crea un elemento con atributos e hijos. Ej: el('button', {class:'btn'}, 'Guardar')
  UI.el = function (tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  // Escapa texto para meterlo en innerHTML sin romper nada.
  UI.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  // Notificación efímera. tipo: 'ok' | 'error' | ''
  UI.toast = function (mensaje, tipo = '') {
    const cont = document.getElementById('toast-container');
    const t = UI.el('div', { class: 'toast ' + tipo }, mensaje);
    cont.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .3s';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  };

  /* Modal genérico.
     opts: { titulo, cuerpo (Node), textoGuardar, onGuardar, guardarClase } */
  UI.modal = function (opts) {
    const root = document.getElementById('modal-root');

    const cerrar = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };

    const btnGuardar = UI.el('button',
      { class: 'btn ' + (opts.guardarClase || 'btn-primary') },
      opts.textoGuardar || 'Guardar');

    if (opts.onGuardar) {
      btnGuardar.addEventListener('click', async () => {
        btnGuardar.disabled = true;
        const ok = await opts.onGuardar();
        btnGuardar.disabled = false;
        if (ok !== false) cerrar();
      });
    }

    const overlay = UI.el('div', { class: 'modal-overlay' }, [
      UI.el('div', { class: 'modal' }, [
        UI.el('div', { class: 'modal-head' }, [
          UI.el('h2', {}, opts.titulo || ''),
          UI.el('button', { class: 'modal-close', 'aria-label': 'Cerrar', onclick: cerrar }, '\u00d7')
        ]),
        UI.el('div', { class: 'modal-body' }, opts.cuerpo || ''),
        UI.el('div', { class: 'modal-foot' }, [
          UI.el('button', { class: 'btn btn-ghost', onclick: cerrar }, 'Cancelar'),
          btnGuardar
        ])
      ])
    ]);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);
    // Foco al primer input
    const primer = overlay.querySelector('input, select, textarea');
    if (primer) primer.focus();

    return { cerrar };
  };

  // Confirmación simple. Devuelve Promise<boolean>.
  UI.confirmar = function (mensaje, textoOk = 'Eliminar') {
    return new Promise((resolve) => {
      let decidido = false;
      const m = UI.modal({
        titulo: 'Confirmar',
        cuerpo: UI.el('p', {}, mensaje),
        textoGuardar: textoOk,
        guardarClase: 'btn-danger',
        onGuardar: () => { decidido = true; resolve(true); }
      });
      // Si cierra sin confirmar, resolvemos false
      const obs = new MutationObserver(() => {
        if (!document.body.contains(overlayCheck())) {
          if (!decidido) resolve(false);
          obs.disconnect();
        }
      });
      function overlayCheck() { return document.querySelector('.modal-overlay'); }
      obs.observe(document.getElementById('modal-root'), { childList: true });
    });
  };

  // Genera y descarga un PDF a partir de un nodo del DOM.
  UI.descargarPDF = function (nodo, nombre) {
    if (typeof html2pdf === 'undefined') { UI.toast('No se pudo generar el PDF. Recargá la página.', 'error'); return; }
    UI.toast('Generando PDF…');
    html2pdf().set({
      margin: 8,
      filename: nombre || 'comprobante.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(nodo).save();
  };

  window.PADDOCK.ui = UI;
})();
