import { describe, it, expect } from "vitest";
import {
  parseEnvFile,
  parseSupabaseStatusEnv,
  supabaseEnvToAppEnv,
  fillBlankEnvValues,
} from "./env-file";

describe("parseEnvFile", () => {
  it("reads bare and quoted values, skipping comments and blanks", () => {
    const contents = [
      "# a comment",
      "",
      "BARE=hello",
      'QUOTED="world"',
      "SINGLE='quoted'",
      "  SPACED  =  padded  ",
    ].join("\n");

    expect(parseEnvFile(contents)).toEqual({
      BARE: "hello",
      QUOTED: "world",
      SINGLE: "quoted",
      SPACED: "padded",
    });
  });

  it("keeps '=' that appear inside the value", () => {
    expect(parseEnvFile("DATABASE_URL=postgres://u:p@h/db?a=1&b=2")).toEqual({
      DATABASE_URL: "postgres://u:p@h/db?a=1&b=2",
    });
  });

  it("records a declared-but-empty key as an empty string", () => {
    expect(parseEnvFile("DATABASE_URL=")).toEqual({ DATABASE_URL: "" });
  });

  it("recognises a leading `export ` prefix (dotenv/shell honour it)", () => {
    expect(parseEnvFile("export DATABASE_URL=postgres://REMOTE-PRODUCTION")).toEqual({
      DATABASE_URL: "postgres://REMOTE-PRODUCTION",
    });
  });
});

describe("parseSupabaseStatusEnv", () => {
  it("ignores non-assignment noise lines from the CLI", () => {
    const stdout = [
      "Stopped services: [supabase_imgproxy_pipline-app supabase_pooler_pipline-app]",
      'API_URL="http://127.0.0.1:54351"',
      'ANON_KEY="anon-key-value"',
      'DB_URL="postgresql://postgres:postgres@127.0.0.1:54352/postgres"',
      "A new version of Supabase CLI is available: v2.113.0 (currently installed v2.75.0)",
      "We recommend updating regularly for new features and bug fixes: https://example.com",
    ].join("\n");

    expect(parseSupabaseStatusEnv(stdout)).toEqual({
      API_URL: "http://127.0.0.1:54351",
      ANON_KEY: "anon-key-value",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54352/postgres",
    });
  });
});

describe("supabaseEnvToAppEnv", () => {
  it("maps CLI keys onto the app's env var names", () => {
    const mapped = supabaseEnvToAppEnv({
      API_URL: "http://127.0.0.1:54351",
      ANON_KEY: "anon",
      SERVICE_ROLE_KEY: "service",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54352/postgres",
      STUDIO_URL: "http://127.0.0.1:54353",
    });

    expect(mapped).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54352/postgres",
    });
  });

  it("omits keys the CLI did not report", () => {
    expect(supabaseEnvToAppEnv({ API_URL: "http://127.0.0.1:54351" })).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351",
    });
  });
});

describe("fillBlankEnvValues", () => {
  it("fills a declared-but-blank key in place", () => {
    const result = fillBlankEnvValues("DATABASE_URL=\n", { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe("DATABASE_URL=postgres://local\n");
    expect(result.filled).toEqual(["DATABASE_URL"]);
  });

  it("NEVER overwrites a non-empty existing value", () => {
    const contents = "DATABASE_URL=postgres://remote-production\n";
    const result = fillBlankEnvValues(contents, { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe(contents);
    expect(result.filled).toEqual([]);
  });

  it("appends keys absent from the file", () => {
    const result = fillBlankEnvValues("EXISTING=kept\n", { NEW_KEY: "added" });

    expect(result.contents).toBe("EXISTING=kept\nNEW_KEY=added\n");
    expect(result.filled).toEqual(["NEW_KEY"]);
  });

  it("preserves comments, blank lines, and original ordering", () => {
    const contents = ["# --- Supabase ---", "NEXT_PUBLIC_SUPABASE_URL=", "", "# --- App ---", "OTHER=keep"].join("\n");
    const result = fillBlankEnvValues(contents, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351" });

    expect(result.contents).toBe(
      ["# --- Supabase ---", "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54351", "", "# --- App ---", "OTHER=keep", ""].join("\n"),
    );
    expect(result.filled).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("returns an empty filled list when there is nothing to do", () => {
    const result = fillBlankEnvValues("A=1\n", { A: "2" });
    expect(result.filled).toEqual([]);
  });

  it("NEVER overwrites a non-empty exported value, and does not duplicate it", () => {
    const contents = "export DATABASE_URL=postgres://REMOTE-PRODUCTION\n";
    const result = fillBlankEnvValues(contents, { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe(contents);
    expect(result.filled).toEqual([]);
  });

  it("fills a declared-but-blank exported key in place, preserving the `export ` prefix", () => {
    const result = fillBlankEnvValues("export DATABASE_URL=\n", { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe("export DATABASE_URL=postgres://local\n");
    expect(result.filled).toEqual(["DATABASE_URL"]);
  });

  it("still behaves exactly as before for a plain, non-exported line", () => {
    const result = fillBlankEnvValues("DATABASE_URL=\n", { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe("DATABASE_URL=postgres://local\n");
    expect(result.filled).toEqual(["DATABASE_URL"]);
  });
});
