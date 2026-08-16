(function () {
  "use strict";
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "rollout-resize") return;
    var frames = document.querySelectorAll("iframe[data-rollout-embed]");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        var h = Number(e.data.height);
        if (isFinite(h) && h > 0) frames[i].style.height = Math.ceil(h) + "px";
      }
    }
  });
})();
