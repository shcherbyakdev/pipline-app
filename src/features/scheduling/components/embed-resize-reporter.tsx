"use client";

import * as React from "react";

// Height-only broadcast; no secrets, so targetOrigin "*" is acceptable —
// the PARENT side (embed.js) does the authenticating (source check).
export function EmbedResizeReporter() {
  React.useEffect(() => {
    const post = () =>
      // Report document.body's own height, not documentElement.scrollHeight —
      // scrollHeight is floored at the iframe's (viewport) height, so once
      // the widget grows tall the reported height can never shrink back
      // down when a later step is shorter. body.offsetHeight is the metric
      // we actually observe below, so it can go down as well as up.
      window.parent?.postMessage(
        { type: "rollout-resize", height: document.body.offsetHeight },
        "*",
      );
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    return () => ro.disconnect();
  }, []);
  return null;
}
