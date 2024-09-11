import http2 from "node:http2"
import Debug from "debug"

const debug = Debug("fetch-h2")
const sessions = new Map<string, http2.ClientHttp2Session>()

export function disconnectAll() {
  for (const session of sessions.values()) {
    session.close()
  }
}

export function fetchH2(url: string, params?: Pick<RequestInit, "method" | "headers" | "body" | "signal">) {
  return new Promise<H2Response>(function (resolve, reject) {
    const { protocol, pathname, search, origin } = new URL(url)
    const scheme = protocol.replace(":", "")
    const path = `${pathname}${search}`
    const session = resolveSession(origin)
    const headers: http2.OutgoingHttpHeaders = {}
    const options: http2.ClientSessionRequestOptions = {}
    const incomingHeaders = new Headers()
    let data = ""
    let status = 0

    if (params?.headers) {
      Object.entries(params.headers).forEach(function ([key, value]) {
        headers[key] = value
      })
    }

    headers[http2.constants.HTTP2_HEADER_PATH] = path
    headers[http2.constants.HTTP2_HEADER_METHOD] = "GET"
    headers[http2.constants.HTTP2_HEADER_SCHEME] = scheme

    if (params?.method) {
      if (params.method === "POST") {
        headers[http2.constants.HTTP2_HEADER_METHOD] = params.method
      }
      else {
        throw new RangeError("Unsupperted method: " + params?.method)
      }
    }

    if (params?.body) {
      if (typeof params.body === "string") {
        headers[http2.constants.HTTP2_HEADER_CONTENT_LENGTH] = Buffer.byteLength(params.body)
      }
      else {
        throw new RangeError("Unsupported body type: " + typeof params.body)
      }
    }

    if (params?.signal) {
      options.signal = params.signal
    }

    debug("http2 request url=%s headers=%o options=%o", url, headers, options)

    const req = session.request(headers, options);

    req.setEncoding("utf-8");

    if (typeof params?.body === "string") {
      req.write(params.body, "utf-8", function (err) {
        if (err) {
          reject(err)
        }
      })
    }

    req.on("response", onResponse)
    req.on("error", onError)
    req.on("aborted", onAborted)
    req.on("data", onData)
    req.on("close", onClose)
    req.end()

    function onResponse(headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader) {
      for (const header in headers) {
        if (header === http2.constants.HTTP2_HEADER_STATUS) {
          status = Number(headers[header] || 0);
        }
        else {
          let headerValue = headers[header]

          if (Array.isArray(headerValue)) {
            headerValue.forEach(function (value) {
              incomingHeaders.append(header, String(value))
            })
          }
          else {
            incomingHeaders.append(header, String(headerValue))
          }
        }
      }
    }

    function onError(err: unknown) {
      debug("error %s", err)
      reject(err)
    }

    function onAborted() {
      reject(new AbortError("Request aborted"))
    }

    function onData(chunk: any) {
      data += chunk;
    }

    function onClose() {
      if (status === 0) {
        reject(new Error("fetch failed"))
      }
      else {
        resolve(new H2Response(
          status >= 200 && status <= 399,
          url,
          status,
          incomingHeaders,
          data
        ))
      }

      req.off("response", onResponse)
      req.off("error", onError)
      req.off("aborted", onAborted)
      req.off("data", onData)
      req.off("close", onClose)
    }
  })
}

function resolveSession(origin: string): http2.ClientHttp2Session {
  let session = sessions.get(origin)

  if (session) {
    return session
  }

  const PING_TIMEOUT = 5000
  const PONG_TIMEOUT = 2000
  let pingTimeout: NodeJS.Timeout | null = null;
  let pongTimeout: NodeJS.Timeout | null = null;

  session = http2.connect(origin)

  const onConnect = function () {
    ping()
  }

  const onClose = function () {
    if (pongTimeout) {
      clearTimeout(pongTimeout)
    }

    if (pingTimeout) {
      clearTimeout(pingTimeout)
    }

    session.off("connect", onConnect)
    session.off("error", onError)
    session.off("close", onClose)

    sessions.delete(origin)
  }

  const onError = function (err: unknown) {
    debug("session error origin=%s err=%s", origin, err)
  }

  const ping = function () {
    const sent = session.ping(function (err, duration) {
      if (pongTimeout) {
        clearTimeout(pongTimeout)
      }

      if (pingTimeout) {
        clearTimeout(pingTimeout)
      }

      if (!err) {
        pingTimeout = setTimeout(ping, PING_TIMEOUT)
      }
    })

    if (!sent) {
      return session.close()
    }

    pongTimeout = setTimeout(function () {
      session.destroy()
    }, PONG_TIMEOUT).unref()
  }

  session.on("connect", onConnect)
  session.on("error", onError)
  session.on("close", onClose)

  sessions.set(origin, session)

  return session
}

class H2Response {
  constructor(
    public ok: boolean,
    public url: string,
    public status: number,
    public headers: Headers,
    public $text: string
  ) { }

  async text() {
    return this.$text
  }
}

class AbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AbortError"
  }
}
