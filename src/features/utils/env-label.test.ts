import { describe, it, expect } from "vitest";
import { envLabel } from "./env-label";

describe("envLabel", () => {
  it("names the environment and the app host", () => {
    expect(envLabel("development", "http://localhost:3000")).toBe("development · localhost:3000");
    expect(envLabel("production", "https://booklo.app")).toBe("production · booklo.app");
  });
  it("falls back when NODE_ENV is unset or the URL is unparseable", () => {
    expect(envLabel(undefined, "https://booklo.app")).toBe("unknown · booklo.app");
    expect(envLabel("production", "not a url")).toBe("production · not a url");
  });
});
