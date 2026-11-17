import test from "node:test";
import assert from "node:assert/strict";
import { emailAllowed } from "./allowList.ts";

test("empty list allows everyone; a list allows only its emails, ignoring case and spaces", () => {
  assert.equal(emailAllowed("a@x.com", undefined), true);
  assert.equal(emailAllowed("a@x.com", " , "), true);
  assert.equal(emailAllowed("Friend@Gmail.com", " friend@gmail.com , other@x.com"), true);
  assert.equal(emailAllowed("stranger@gmail.com", "friend@gmail.com"), false);
  assert.equal(emailAllowed("friend@gmail.com.evil.com", "friend@gmail.com"), false);
});
