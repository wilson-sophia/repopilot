import assert from "node:assert/strict";
import { test } from "node:test";
import { usesSecureAuthCookies } from "../../lib/auth-cookies";

function withAuthEnvironment(
  values: Record<string, string | undefined>,
  run: () => void
) {
  const keys = ["AUTH_URL", "NEXTAUTH_URL", "NODE_ENV"];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  for (const key of keys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
  try {
    run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("HTTP production uses the unprefixed session cookie; protocol wins over NODE_ENV", () => {
  for (const environment of ["development", "production", "test"]) {
    withAuthEnvironment({ NODE_ENV: environment }, () => {
      assert.equal(
        usesSecureAuthCookies(new Request("http://localhost:3000/research")),
        false
      );
      assert.equal(
        usesSecureAuthCookies(new Request("https://app.example/research")),
        true
      );
    });
  }
});

test("HTTPS AUTH_URL selects secure cookies behind an HTTP reverse proxy", () => {
  withAuthEnvironment(
    { AUTH_URL: "https://app.example", NODE_ENV: "production" },
    () => {
      assert.equal(
        usesSecureAuthCookies(new Request("http://localhost:3000/research")),
        true
      );
    }
  );
});

test("AUTH_URL takes precedence over NEXTAUTH_URL and the incoming request URL", () => {
  withAuthEnvironment(
    {
      AUTH_URL: "http://localhost:3000",
      NEXTAUTH_URL: "https://legacy.example",
    },
    () => {
      assert.equal(
        usesSecureAuthCookies(new Request("https://request.example/research")),
        false
      );
    }
  );
});

test("legacy NEXTAUTH_URL is honored when AUTH_URL is absent", () => {
  withAuthEnvironment(
    { NEXTAUTH_URL: "https://legacy.example/api/auth" },
    () => {
      assert.equal(
        usesSecureAuthCookies(new Request("http://localhost:3000/research")),
        true
      );
    }
  );
});

test("empty AUTH_URL matches Auth.js fallback behavior rather than choosing the legacy URL", () => {
  withAuthEnvironment(
    { AUTH_URL: "", NEXTAUTH_URL: "https://legacy.example" },
    () => {
      assert.equal(
        usesSecureAuthCookies(new Request("http://localhost:3000/research")),
        false
      );
    }
  );
});

test("untrusted forwarded protocol headers do not override cookie policy", () => {
  withAuthEnvironment({}, () => {
    assert.equal(
      usesSecureAuthCookies(
        new Request("http://localhost:3000/research", {
          headers: { "x-forwarded-proto": "https" },
        })
      ),
      false
    );
  });
});

test("invalid explicit deployment URLs fail rather than silently selecting a different cookie", () => {
  withAuthEnvironment({ AUTH_URL: "not-a-valid-url" }, () => {
    assert.throws(
      () =>
        usesSecureAuthCookies(new Request("http://localhost:3000/research")),
      TypeError
    );
  });
});
