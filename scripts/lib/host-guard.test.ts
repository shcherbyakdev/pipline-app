import { describe, it, expect } from "vitest";
import { hostnameOf, isLoopbackHost } from "./host-guard";

describe("hostnameOf", () => {
  it("extracts the hostname from a Postgres connection string", () => {
    expect(hostnameOf("postgresql://postgres:postgres@127.0.0.1:54352/postgres")).toBe("127.0.0.1");
  });

  it("extracts the hostname from an http(s) URL", () => {
    expect(hostnameOf("http://127.0.0.1:54351")).toBe("127.0.0.1");
  });

  it("extracts the hostname from a remote Postgres connection string", () => {
    expect(hostnameOf("postgresql://user:pass@db.example.com:5432/app")).toBe("db.example.com");
  });

  it("returns null for a malformed URL instead of throwing", () => {
    expect(hostnameOf("not a url")).toBeNull();
  });

  it("returns null for an absent value instead of throwing", () => {
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf(null)).toBeNull();
    expect(hostnameOf("")).toBeNull();
  });

  it("does not fall for a hostname-shaped query string on a remote host", () => {
    expect(hostnameOf("postgresql://evil.example.com/?x=127.0.0.1")).toBe("evil.example.com");
  });
});

describe("isLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects remote hosts", () => {
    expect(isLoopbackHost("db.example.com")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});
