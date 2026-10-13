// 911 Toolkit countdown bar. Same timing rules as app/lib/countdown.ts.
(function () {
  var el = document.getElementById("tk-countdown-config");
  if (!el || document.querySelector(".tk-cd")) return;
  var c;
  try { c = JSON.parse(el.textContent); } catch (e) { return; }

  function offset(at, tz) {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(at)).forEach(function (x) { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at;
  }
  function zoned(day, time, tz) {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day), t = /^(\d{2}):(\d{2})$/.exec(time);
    if (!d || !t) return null;
    var guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
    var utc = guess - offset(guess, tz);
    return guess - offset(utc, tz);
  }
  function today(at, tz) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  }
  function target(now) {
    if (c.mode === "daily") {
      var t = zoned(today(now, c.timeZone), c.endTime, c.timeZone);
      return t > now ? t : zoned(today(now + 864e5, c.timeZone), c.endTime, c.timeZone);
    }
    return c.endsAtUtc ? Date.parse(c.endsAtUtc) : null;
  }
  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var hms = pad(Math.floor((s % 86400) / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
    return d ? d + "d " + hms : hms;
  }

  var key = "tk-cd-closed:" + (c.message || "") + (c.endsAtUtc || c.endTime);
  try { if (c.closable && sessionStorage.getItem(key)) return; } catch (e) { /* storage blocked (private mode) */ }

  var bar = document.createElement("div");
  bar.className = "tk-cd" + (c.position === "bottom" ? " tk-cd--bottom" : "");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Offer countdown");
  bar.style.background = c.background;
  bar.style.color = c.textColor;
  var inner = document.createElement(c.linkUrl ? "a" : "span");
  if (c.linkUrl) inner.href = c.linkUrl;
  var msg = document.createElement("span");
  var time = document.createElement("span");
  time.className = "tk-cd__time";
  time.style.color = c.accent;
  inner.appendChild(msg);
  inner.appendChild(time);
  bar.appendChild(inner);
  if (c.closable) {
    var x = document.createElement("button");
    x.type = "button";
    x.className = "tk-cd__close";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.onclick = function () {
      bar.remove();
      try { sessionStorage.setItem(key, "1"); } catch (e) { /* storage blocked (private mode) */ }
    };
    bar.appendChild(x);
  }

  var end = null;
  function tick() {
    var now = Date.now();
    if (end === null || (c.mode === "daily" && now >= end)) end = target(now);
    var left = end ? end - now : 0;
    if (left <= 0) {
      if (!c.endedMessage) { bar.remove(); return false; }
      msg.textContent = c.endedMessage;
      time.textContent = "";
      return false;
    }
    msg.textContent = c.message;
    time.textContent = fmt(left);
    return true;
  }
  if (!tick() && !c.endedMessage) return;
  if (c.position === "bottom") document.body.appendChild(bar);
  else document.body.insertBefore(bar, document.body.firstChild);
  var timer = setInterval(function () { if (!tick()) clearInterval(timer); }, 1000);
})();
