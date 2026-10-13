// 911 Toolkit bundle offers: clicking an offer sets the quantity field.
(function () {
  document.querySelectorAll(".tk-tiers:not([data-ready])").forEach(function (root) {
    root.setAttribute("data-ready", "");
    var section = root.closest(".shopify-section") || document;
    var qty = section.querySelector('input[name="quantity"]') || document.querySelector('form[action*="/cart/add"] input[name="quantity"]');
    var rows = root.querySelectorAll(".tk-tier");
    function mark(n) {
      rows.forEach(function (r) { r.setAttribute("aria-pressed", String(+r.dataset.qty === n)); });
    }
    rows.forEach(function (row) {
      row.addEventListener("click", function () {
        var n = +row.dataset.qty;
        if (qty) {
          qty.value = n;
          qty.dispatchEvent(new Event("change", { bubbles: true }));
          qty.dispatchEvent(new Event("input", { bubbles: true }));
        }
        mark(n);
      });
    });
    if (qty) {
      var sync = function () { mark(+qty.value); };
      qty.addEventListener("change", sync);
      qty.addEventListener("input", sync);
      sync();
    }
  });
})();
