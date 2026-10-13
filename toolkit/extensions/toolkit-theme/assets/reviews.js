// 911 Toolkit reviews: "show more" and the review form.
(function () {
  document.querySelectorAll(".tk-reviews:not([data-ready])").forEach(function (root) {
    root.setAttribute("data-ready", "");
    var more = root.querySelector("[data-tk-more]");
    if (more) {
      more.addEventListener("click", function () {
        var per = +root.dataset.perPage || 5;
        var hidden = root.querySelectorAll(".tk-review[hidden]");
        for (var i = 0; i < hidden.length && i < per; i++) hidden[i].hidden = false;
        if (!root.querySelector(".tk-review[hidden]")) more.remove();
      });
    }
    var write = root.querySelector("[data-tk-write]");
    var form = root.querySelector(".tk-form");
    if (!write || !form) return;
    write.addEventListener("click", function () {
      form.hidden = !form.hidden;
      write.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) form.querySelector("input[name=rating]").focus();
    });
    var msg = form.querySelector(".tk-form__msg");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var data = new FormData(form);
      if (!data.get("rating")) { msg.textContent = "Please choose a star rating."; return; }
      if (!String(data.get("author") || "").trim() || String(data.get("body") || "").trim().length < 3) {
        msg.textContent = "Please add your name and a few words.";
        return;
      }
      var button = form.querySelector("button[type=submit]");
      button.disabled = true;
      msg.textContent = "Sending…";
      fetch("/apps/toolkit/reviews", { method: "POST", body: data, headers: { Accept: "application/json" } })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.error || "Something went wrong, please try again.");
          form.reset();
          msg.textContent = res.status === "published"
            ? "Thank you! Your review is live after a page refresh."
            : "Thank you! Your review will appear once it's approved.";
        })
        .catch(function (e) { msg.textContent = e.message; })
        .finally(function () { button.disabled = false; });
    });
  });
})();
