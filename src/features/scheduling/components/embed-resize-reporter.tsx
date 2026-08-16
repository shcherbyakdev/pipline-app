"use client";

import * as React from "react";

// Height-only broadcast; no secrets, so targetOrigin "*" is acceptable —
// the PARENT side (embed.js) does the authenticating (source check).
export function EmbedResizeReporter() {
  React.useEffect(() => {
    const post = () =>
      window.parent?.postMessage(
        { type: "rollout-resize", height: document.documentElement.scrollHeight },
        "*",
      );
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    return () => ro.disconnect();
  }, []);
  return null;
}
