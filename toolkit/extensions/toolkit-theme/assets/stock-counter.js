// 911 Toolkit stock counter: follows the selected variant.
(function () {
  document.querySelectorAll(".tk-stock:not([data-ready])").forEach(function (root) {
    root.setAttribute("data-ready", "");
    var cfg;
    try { cfg = JSON.parse(root.querySelector("script").textContent); } catch (e) { return; }
    var s = cfg.settings || {};
    if (s.enabled === false) return;
    var showBelow = +s.showBelow || 10;
    var max = +s.barMax || 20;
    var text = root.querySelector(".tk-stock__text");
    var bar = root.querySelector(".tk-stock__bar");
    var fill = root.querySelector(".tk-stock__fill");
    var form = root.closest("section, .shopify-section") || document;

    function currentId() {
      var input = form.querySelector('form[action*="/cart/add"] [name="id"]') ||
        document.querySelector('form[action*="/cart/add"] [name="id"]');
      var fromUrl = new URLSearchParams(location.search).get("variant");
      return (input && input.value) || fromUrl || String(cfg.current);
    }

    var last = null;
    function update() {
      var id = currentId();
      if (id === last) return;
      last = id;
      var q = cfg.variants[id];
      if (q === null || q === undefined) { root.hidden = true; return; }
      if (q <= 0) {
        if (!s.soldOutMessage) { root.hidden = true; return; }
        text.textContent = s.soldOutMessage;
        bar.hidden = true;
        root.hidden = false;
        return;
      }
      if (q > showBelow) { root.hidden = true; return; }
      text.textContent = String(s.message || "").replace("{count}", q);
      bar.hidden = !s.showBar;
      fill.style.width = Math.max(4, Math.min(100, (q / max) * 100)) + "%";
      root.hidden = false;
    }
    update();
    // Themes switch variants in different ways; checking is cheap and always works.
    document.addEventListener("change", function () { setTimeout(update, 50); });
    setInterval(update, 700);
  });
})();
