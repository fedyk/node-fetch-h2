import test from "node:test"
import { fetchH2, disconnectAll } from "./index.js";
import { equal, ok } from "node:assert";
import { setTimeout } from "node:timers/promises";

test.describe("fetchH2", function () {
  test.after(function () {
    disconnectAll()
  })

  test.it("should do GET request", async function () {
    const resp = await fetchH2("https://httpbin.org/get?test=value")
    const text = await resp.text()
    const json = JSON.parse(text)

    equal(resp.status, 200)
    equal(json.args.test, "value")
  })

  test.it("should do GET request 2", async function () {
    const resp = await fetchH2("https://nghttp2.org/httpbin/get?test=value")
    const text = await resp.text()
    const json = JSON.parse(text)

    equal(resp.status, 200)
    equal(json.args.test, "value")
  })

  test.it("should do POST request", async function () {
    const resp = await fetchH2("https://httpbin.org/post", {
      method: "POST",
      headers: {
        "authorization": "Bearer test",
        "content-type": "application/test"
      },
      body: "test"
    })
    const text = await resp.text()
    const json = JSON.parse(text)

    equal(resp.status, 200)
    equal(json.data, "test")
    equal(json.headers["Authorization"], "Bearer test")
    equal(json.headers["Content-Type"], "application/test")
  })

  test.it("should send cookies", async function () {
    const resp = await fetchH2("https://httpbin.org/cookies", {
      headers: {
        "cookie": "key=test"
      }
    })
    const text = await resp.text()
    const json = JSON.parse(text)

    equal(resp.ok, true)
    equal(resp.status, 200)
    equal(json.cookies.key, "test")
  })

  test.it("should receive cookies", async function () {
    const resp = await fetchH2("https://httpbin.org/cookies/set?freeform=test")

    equal(resp.ok, true)
    equal(resp.status, 302)
    equal(resp.headers.get("set-cookie"), "freeform=test; Path=/")
  })

  test.it("should abort request", async function () {
    const abort = new AbortController()
    const signal = abort.signal
    const promise = fetchH2("https://httpbin.org/delay/10", {
      signal
    }).then(function (resp) {
      return [null, resp]
    }).catch(function (err) {
      return [err, null]
    })

    await setTimeout(100)

    abort.abort()

    const [err, resp] = await promise

    equal(resp, null)
    ok(err instanceof Error)
    equal(err.name, "AbortError")
  })

  test.it("should abort request 2", async function () {
    const abort = new AbortController()
    const signal = abort.signal

    abort.abort()

    const promise = await fetchH2("https://httpbin.org/delay/10", {
      signal
    }).then(function (resp) {
      return [null, resp]
    }).catch(function (err) {
      return [err, null]
    })

    const [err, resp] = await promise

    equal(resp, null)
    ok(err instanceof Error)
    equal(err.name, "AbortError")
  })
})
