/* Indicador "SCROLL": desaparece en cuanto la persona empieza a desplazarse */
(() => {
  const el = document.getElementById("scroll");
  if (!el) return;
  const f = () => el.classList.toggle("oculto", scrollY > 40);
  addEventListener("scroll", f, { passive: true });
  f();
})();
