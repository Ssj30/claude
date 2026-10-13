// 911 Toolkit Sales Kit: recent-sale pop-ups and free-shipping progress bar.
(function () {
  var el = document.getElementById("tk-saleskit-config");
  if (!el) return;
  var cfg;
  try { cfg = JSON.parse(el.textContent); } catch (e) { return; }
  var s = cfg.settings || {};
  var Shop = window.Shopify || {};
  var rate = (Shop.currency && +Shop.currency.rate) || 1;
  var currency = (Shop.currency && Shop.currency.active) || cfg.currency || "EUR";
  var locale = Shop.locale || cfg.locale || document.documentElement.lang || "en";

  function money(cents) {
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: currency }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2) + " " + currency; }
  }
  function ago(iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 60) return m <= 1 ? "just now" : m + " minutes ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  // Pop-ups ------------------------------------------------------------------
  var sales = (cfg.sales || []).filter(function (x) {
    return Date.now() - Date.parse(x.at) < 30 * 864e5; // only the last 30 days
  });
  var dismissed = false;
  try { dismissed = !!sessionStorage.getItem("tk-pop-off"); } catch (e) { /* storage blocked (private mode) */ }
  if (s.popupsEnabled && sales.length && !dismissed) {
    var i = 0;
    var pop = document.createElement("a");
    pop.className = "tk-pop " + (s.popupPosition === "bottom-right" ? "tk-pop--right" : "tk-pop--left");
    pop.setAttribute("role", "status");
    document.body.appendChild(pop);
    var show = function () {
      if (dismissed || document.hidden) return;
      var sale = sales[i++ % sales.length];
      pop.href = sale.handle ? "/products/" + sale.handle : "#";
      pop.innerHTML = "";
      if (sale.image) {
        var img = document.createElement("img");
        img.src = sale.image; img.alt = ""; img.loading = "lazy";
        pop.appendChild(img);
      }
      var text = document.createElement("div");
      var who = document.createElement("div");
      who.textContent = sale.name + (s.popupShowCity && sale.city ? " from " + sale.city : "") + " bought";
      var what = document.createElement("div");
      what.className = "tk-pop__product"; what.textContent = sale.product;
      var when = document.createElement("div");
      when.className = "tk-pop__time"; when.textContent = ago(sale.at);
      text.appendChild(who); text.appendChild(what); text.appendChild(when);
      pop.appendChild(text);
      var x = document.createElement("button");
      x.type = "button"; x.className = "tk-pop__close"; x.setAttribute("aria-label", "Close"); x.textContent = "×";
      x.onclick = function (ev) {
        ev.preventDefault(); dismissed = true; pop.classList.remove("is-in");
        try { sessionStorage.setItem("tk-pop-off", "1"); } catch (e) { /* storage blocked (private mode) */ }
      };
      pop.appendChild(x);
      pop.classList.add("is-in");
      setTimeout(function () { pop.classList.remove("is-in"); }, 6000);
    };
    setTimeout(function () {
      show();
      setInterval(show, Math.max(5, +s.popupInterval || 20) * 1000);
    }, Math.max(0, +s.popupFirstDelay || 0) * 1000);
  }

  // Free-shipping bar ------------------------------------------------------------
  if (!s.freeShippingEnabled || !(s.freeShippingThreshold > 0)) return;
  var goal = Math.round(s.freeShippingThreshold * 100 * rate);

  function render(box, total) {
    var left = goal - total;
    box.innerHTML = "";
    var text = document.createElement("div");
    text.textContent = left > 0
      ? String(s.freeShippingMessage || "").replace("{amount}", money(left))
      : s.freeShippingSuccess || "";
    var bar = document.createElement("div"); bar.className = "tk-ship__bar";
    var fill = document.createElement("div"); fill.className = "tk-ship__fill";
    fill.style.width = Math.min(100, (total / goal) * 100) + "%";
    bar.appendChild(fill);
    box.appendChild(text); box.appendChild(bar);
  }

  // Cart page form and common cart drawers (Dawn-based themes like Shrine).
  var spots = ["cart-drawer .drawer__header", "form#cart", "form[action$='/cart'][method='post']", "#CartDrawer .drawer__header"];
  function place(total) {
    spots.forEach(function (sel) {
      var anchor = document.querySelector(sel);
      if (!anchor) return;
      var box = anchor.parentNode.querySelector(":scope > .tk-ship");
      if (!box) {
        box = document.createElement("div");
        box.className = "tk-ship";
        box.setAttribute("aria-live", "polite");
        anchor.insertAdjacentElement(sel.indexOf("header") > -1 ? "afterend" : "beforebegin", box);
      }
      render(box, total);
    });
  }
  var pending = null;
  function refresh() {
    clearTimeout(pending);
    pending = setTimeout(load, 150);
  }
  function load() {
    fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (cart) { place(cart.total_price); })
      .catch(function () {});
  }
  place(cfg.cartTotal || 0);

  // Refresh after anything that changes the cart.
  var origFetch = window.fetch;
  window.fetch = function () {
    var url = String(arguments[0] && arguments[0].url || arguments[0]);
    var p = origFetch.apply(this, arguments);
    if (/\/cart\/(add|change|update|clear)/.test(url)) p.then(refresh);
    return p;
  };
  document.addEventListener("cart:refresh", refresh);
  var drawer = document.querySelector("cart-drawer, #CartDrawer");
  if (drawer && window.MutationObserver) {
    new MutationObserver(function () {
      if (!drawer.querySelector(".tk-ship")) refresh();
    }).observe(drawer, { childList: true, subtree: true });
  }
})();
