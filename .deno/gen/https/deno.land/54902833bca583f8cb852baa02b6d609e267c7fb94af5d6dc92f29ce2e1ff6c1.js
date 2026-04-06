// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
import { delay } from "../async/delay.ts";
/** Thrown by Server after it has been closed. */ const ERROR_SERVER_CLOSED = "Server closed";
/** Default port for serving HTTP. */ const HTTP_PORT = 80;
/** Default port for serving HTTPS. */ const HTTPS_PORT = 443;
/** Initial backoff delay of 5ms following a temporary accept failure. */ const INITIAL_ACCEPT_BACKOFF_DELAY = 5;
/** Max backoff delay of 1s following a temporary accept failure. */ const MAX_ACCEPT_BACKOFF_DELAY = 1000;
/**
 * Used to construct an HTTP server.
 *
 * @deprecated This will be removed in 1.0.0. Use {@linkcode Deno.serve} instead.
 */ export class Server {
  #port;
  #host;
  #handler;
  #closed = false;
  #listeners = new Set();
  #acceptBackoffDelayAbortController = new AbortController();
  #httpConnections = new Set();
  #onError;
  /**
   * Constructs a new HTTP Server instance.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const port = 4505;
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ port, handler });
   * ```
   *
   * @param serverInit Options for running an HTTP server.
   */ constructor(serverInit){
    this.#port = serverInit.port;
    this.#host = serverInit.hostname;
    this.#handler = serverInit.handler;
    this.#onError = serverInit.onError ?? function(error) {
      console.error(error);
      return new Response("Internal Server Error", {
        status: 500
      });
    };
  }
  /**
   * Accept incoming connections on the given listener, and handle requests on
   * these connections with the given handler.
   *
   * HTTP/2 support is only enabled if the provided Deno.Listener returns TLS
   * connections and was configured with "h2" in the ALPN protocols.
   *
   * Throws a server closed error if called after the server has been closed.
   *
   * Will always close the created listener.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ handler });
   * const listener = Deno.listen({ port: 4505 });
   *
   * console.log("server listening on http://localhost:4505");
   *
   * await server.serve(listener);
   * ```
   *
   * @param listener The listener to accept connections from.
   */ async serve(listener) {
    if (this.#closed) {
      throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
    }
    this.#trackListener(listener);
    try {
      return await this.#accept(listener);
    } finally{
      this.#untrackListener(listener);
      try {
        listener.close();
      } catch  {
      // Listener has already been closed.
      }
    }
  }
  /**
   * Create a listener on the server, accept incoming connections, and handle
   * requests on these connections with the given handler.
   *
   * If the server was constructed without a specified port, 80 is used.
   *
   * If the server was constructed with the hostname omitted from the options, the
   * non-routable meta-address `0.0.0.0` is used.
   *
   * Throws a server closed error if the server has been closed.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const port = 4505;
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ port, handler });
   *
   * console.log("server listening on http://localhost:4505");
   *
   * await server.listenAndServe();
   * ```
   */ async listenAndServe() {
    if (this.#closed) {
      throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
    }
    const listener = Deno.listen({
      port: this.#port ?? HTTP_PORT,
      hostname: this.#host ?? "0.0.0.0",
      transport: "tcp"
    });
    return await this.serve(listener);
  }
  /**
   * Create a listener on the server, accept incoming connections, upgrade them
   * to TLS, and handle requests on these connections with the given handler.
   *
   * If the server was constructed without a specified port, 443 is used.
   *
   * If the server was constructed with the hostname omitted from the options, the
   * non-routable meta-address `0.0.0.0` is used.
   *
   * Throws a server closed error if the server has been closed.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const port = 4505;
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ port, handler });
   *
   * const certFile = "/path/to/certFile.crt";
   * const keyFile = "/path/to/keyFile.key";
   *
   * console.log("server listening on https://localhost:4505");
   *
   * await server.listenAndServeTls(certFile, keyFile);
   * ```
   *
   * @param certFile The path to the file containing the TLS certificate.
   * @param keyFile The path to the file containing the TLS private key.
   */ async listenAndServeTls(certFile, keyFile) {
    if (this.#closed) {
      throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
    }
    const listener = Deno.listenTls({
      port: this.#port ?? HTTPS_PORT,
      hostname: this.#host ?? "0.0.0.0",
      cert: Deno.readTextFileSync(certFile),
      key: Deno.readTextFileSync(keyFile),
      transport: "tcp"
    });
    return await this.serve(listener);
  }
  /**
   * Immediately close the server listeners and associated HTTP connections.
   *
   * Throws a server closed error if called after the server has been closed.
   */ close() {
    if (this.#closed) {
      throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
    }
    this.#closed = true;
    for (const listener of this.#listeners){
      try {
        listener.close();
      } catch  {
      // Listener has already been closed.
      }
    }
    this.#listeners.clear();
    this.#acceptBackoffDelayAbortController.abort();
    for (const httpConn of this.#httpConnections){
      this.#closeHttpConn(httpConn);
    }
    this.#httpConnections.clear();
  }
  /** Get whether the server is closed. */ get closed() {
    return this.#closed;
  }
  /** Get the list of network addresses the server is listening on. */ get addrs() {
    return Array.from(this.#listeners).map((listener)=>listener.addr);
  }
  /**
   * Responds to an HTTP request.
   *
   * @param requestEvent The HTTP request to respond to.
   * @param connInfo Information about the underlying connection.
   */ async #respond(requestEvent, connInfo) {
    let response;
    try {
      // Handle the request event, generating a response.
      response = await this.#handler(requestEvent.request, connInfo);
      if (response.bodyUsed && response.body !== null) {
        throw new TypeError("Response body already consumed.");
      }
    } catch (error) {
      // Invoke onError handler when request handler throws.
      response = await this.#onError(error);
    }
    try {
      // Send the response.
      await requestEvent.respondWith(response);
    } catch  {
    // `respondWith()` can throw for various reasons, including downstream and
    // upstream connection errors, as well as errors thrown during streaming
    // of the response content.  In order to avoid false negatives, we ignore
    // the error here and let `serveHttp` close the connection on the
    // following iteration if it is in fact a downstream connection error.
    }
  }
  /**
   * Serves all HTTP requests on a single connection.
   *
   * @param httpConn The HTTP connection to yield requests from.
   * @param connInfo Information about the underlying connection.
   */ async #serveHttp(httpConn, connInfo) {
    while(!this.#closed){
      let requestEvent;
      try {
        // Yield the new HTTP request on the connection.
        requestEvent = await httpConn.nextRequest();
      } catch  {
        break;
      }
      if (requestEvent === null) {
        break;
      }
      // Respond to the request. Note we do not await this async method to
      // allow the connection to handle multiple requests in the case of h2.
      this.#respond(requestEvent, connInfo);
    }
    this.#closeHttpConn(httpConn);
  }
  /**
   * Accepts all connections on a single network listener.
   *
   * @param listener The listener to accept connections from.
   */ async #accept(listener) {
    let acceptBackoffDelay;
    while(!this.#closed){
      let conn;
      try {
        // Wait for a new connection.
        conn = await listener.accept();
      } catch (error) {
        if (// The listener is closed.
        error instanceof Deno.errors.BadResource || // TLS handshake errors.
        error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof || error instanceof Deno.errors.ConnectionReset || error instanceof Deno.errors.NotConnected) {
          // Backoff after transient errors to allow time for the system to
          // recover, and avoid blocking up the event loop with a continuously
          // running loop.
          if (!acceptBackoffDelay) {
            acceptBackoffDelay = INITIAL_ACCEPT_BACKOFF_DELAY;
          } else {
            acceptBackoffDelay *= 2;
          }
          if (acceptBackoffDelay >= MAX_ACCEPT_BACKOFF_DELAY) {
            acceptBackoffDelay = MAX_ACCEPT_BACKOFF_DELAY;
          }
          try {
            await delay(acceptBackoffDelay, {
              signal: this.#acceptBackoffDelayAbortController.signal
            });
          } catch (err) {
            // The backoff delay timer is aborted when closing the server.
            if (!(err instanceof DOMException && err.name === "AbortError")) {
              throw err;
            }
          }
          continue;
        }
        throw error;
      }
      acceptBackoffDelay = undefined;
      // "Upgrade" the network connection into an HTTP connection.
      let httpConn;
      try {
        // deno-lint-ignore no-deprecated-deno-api
        httpConn = Deno.serveHttp(conn);
      } catch  {
        continue;
      }
      // Closing the underlying listener will not close HTTP connections, so we
      // track for closure upon server close.
      this.#trackHttpConnection(httpConn);
      const connInfo = {
        localAddr: conn.localAddr,
        remoteAddr: conn.remoteAddr
      };
      // Serve the requests that arrive on the just-accepted connection. Note
      // we do not await this async method to allow the server to accept new
      // connections.
      this.#serveHttp(httpConn, connInfo);
    }
  }
  /**
   * Untracks and closes an HTTP connection.
   *
   * @param httpConn The HTTP connection to close.
   */ #closeHttpConn(httpConn) {
    this.#untrackHttpConnection(httpConn);
    try {
      httpConn.close();
    } catch  {
    // Connection has already been closed.
    }
  }
  /**
   * Adds the listener to the internal tracking list.
   *
   * @param listener Listener to track.
   */ #trackListener(listener) {
    this.#listeners.add(listener);
  }
  /**
   * Removes the listener from the internal tracking list.
   *
   * @param listener Listener to untrack.
   */ #untrackListener(listener) {
    this.#listeners.delete(listener);
  }
  /**
   * Adds the HTTP connection to the internal tracking list.
   *
   * @param httpConn HTTP connection to track.
   */ #trackHttpConnection(httpConn) {
    this.#httpConnections.add(httpConn);
  }
  /**
   * Removes the HTTP connection from the internal tracking list.
   *
   * @param httpConn HTTP connection to untrack.
   */ #untrackHttpConnection(httpConn) {
    this.#httpConnections.delete(httpConn);
  }
}
/**
 * Constructs a server, accepts incoming connections on the given listener, and
 * handles requests on these connections with the given handler.
 *
 * ```ts
 * import { serveListener } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 *
 * const listener = Deno.listen({ port: 4505 });
 *
 * console.log("server listening on http://localhost:4505");
 *
 * await serveListener(listener, (request) => {
 *   const body = `Your user-agent is:\n\n${request.headers.get(
 *     "user-agent",
 *   ) ?? "Unknown"}`;
 *
 *   return new Response(body, { status: 200 });
 * });
 * ```
 *
 * @param listener The listener to accept connections from.
 * @param handler The handler for individual HTTP requests.
 * @param options Optional serve options.
 *
 * @deprecated This will be removed in 1.0.0. Use {@linkcode Deno.serve} instead.
 */ export async function serveListener(listener, handler, options) {
  const server = new Server({
    handler,
    onError: options?.onError
  });
  options?.signal?.addEventListener("abort", ()=>server.close(), {
    once: true
  });
  return await server.serve(listener);
}
function hostnameForDisplay(hostname) {
  // If the hostname is "0.0.0.0", we display "localhost" in console
  // because browsers in Windows don't resolve "0.0.0.0".
  // See the discussion in https://github.com/denoland/deno_std/issues/1165
  return hostname === "0.0.0.0" ? "localhost" : hostname;
}
/**
 * Serves HTTP requests with the given handler.
 *
 * You can specify an object with a port and hostname option, which is the
 * address to listen on. The default is port 8000 on hostname "0.0.0.0".
 *
 * The below example serves with the port 8000.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"));
 * ```
 *
 * You can change the listening address by the `hostname` and `port` options.
 * The below example serves with the port 3000.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"), { port: 3000 });
 * ```
 *
 * `serve` function prints the message `Listening on http://<hostname>:<port>/`
 * on start-up by default. If you like to change this message, you can specify
 * `onListen` option to override it.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"), {
 *   onListen({ port, hostname }) {
 *     console.log(`Server started at http://${hostname}:${port}`);
 *     // ... more info specific to your server ..
 *   },
 * });
 * ```
 *
 * You can also specify `undefined` or `null` to stop the logging behavior.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"), { onListen: undefined });
 * ```
 *
 * @param handler The handler for individual HTTP requests.
 * @param options The options. See `ServeInit` documentation for details.
 *
 * @deprecated This will be removed in 1.0.0. Use {@linkcode Deno.serve} instead.
 */ export async function serve(handler, options = {}) {
  let port = options.port ?? 8000;
  if (typeof port !== "number") {
    port = Number(port);
  }
  const hostname = options.hostname ?? "0.0.0.0";
  const server = new Server({
    port,
    hostname,
    handler,
    onError: options.onError
  });
  options?.signal?.addEventListener("abort", ()=>server.close(), {
    once: true
  });
  const listener = Deno.listen({
    port,
    hostname,
    transport: "tcp"
  });
  const s = server.serve(listener);
  port = server.addrs[0].port;
  if ("onListen" in options) {
    options.onListen?.({
      port,
      hostname
    });
  } else {
    console.log(`Listening on http://${hostnameForDisplay(hostname)}:${port}/`);
  }
  return await s;
}
/**
 * Serves HTTPS requests with the given handler.
 *
 * You must specify `key` or `keyFile` and `cert` or `certFile` options.
 *
 * You can specify an object with a port and hostname option, which is the
 * address to listen on. The default is port 8443 on hostname "0.0.0.0".
 *
 * The below example serves with the default port 8443.
 *
 * ```ts
 * import { serveTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 *
 * const cert = "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n";
 * const key = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n";
 * serveTls((_req) => new Response("Hello, world"), { cert, key });
 *
 * // Or
 *
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 * serveTls((_req) => new Response("Hello, world"), { certFile, keyFile });
 * ```
 *
 * `serveTls` function prints the message `Listening on https://<hostname>:<port>/`
 * on start-up by default. If you like to change this message, you can specify
 * `onListen` option to override it.
 *
 * ```ts
 * import { serveTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 * serveTls((_req) => new Response("Hello, world"), {
 *   certFile,
 *   keyFile,
 *   onListen({ port, hostname }) {
 *     console.log(`Server started at https://${hostname}:${port}`);
 *     // ... more info specific to your server ..
 *   },
 * });
 * ```
 *
 * You can also specify `undefined` or `null` to stop the logging behavior.
 *
 * ```ts
 * import { serveTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 * serveTls((_req) => new Response("Hello, world"), {
 *   certFile,
 *   keyFile,
 *   onListen: undefined,
 * });
 * ```
 *
 * @param handler The handler for individual HTTPS requests.
 * @param options The options. See `ServeTlsInit` documentation for details.
 * @returns
 *
 * @deprecated This will be removed in 1.0.0. Use {@linkcode Deno.serve} instead.
 */ export async function serveTls(handler, options) {
  if (!options.key && !options.keyFile) {
    throw new Error("TLS config is given, but 'key' is missing.");
  }
  if (!options.cert && !options.certFile) {
    throw new Error("TLS config is given, but 'cert' is missing.");
  }
  let port = options.port ?? 8443;
  if (typeof port !== "number") {
    port = Number(port);
  }
  const hostname = options.hostname ?? "0.0.0.0";
  const server = new Server({
    port,
    hostname,
    handler,
    onError: options.onError
  });
  options?.signal?.addEventListener("abort", ()=>server.close(), {
    once: true
  });
  // deno-lint-ignore no-sync-fn-in-async-fn
  const key = options.key || Deno.readTextFileSync(options.keyFile);
  // deno-lint-ignore no-sync-fn-in-async-fn
  const cert = options.cert || Deno.readTextFileSync(options.certFile);
  const listener = Deno.listenTls({
    port,
    hostname,
    cert,
    key,
    transport: "tcp"
  });
  const s = server.serve(listener);
  port = server.addrs[0].port;
  if ("onListen" in options) {
    options.onListen?.({
      port,
      hostname
    });
  } else {
    console.log(`Listening on https://${hostnameForDisplay(hostname)}:${port}/`);
  }
  return await s;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjIyNC4wL2h0dHAvc2VydmVyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjQgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXHJcbmltcG9ydCB7IGRlbGF5IH0gZnJvbSBcIi4uL2FzeW5jL2RlbGF5LnRzXCI7XHJcblxyXG4vKiogVGhyb3duIGJ5IFNlcnZlciBhZnRlciBpdCBoYXMgYmVlbiBjbG9zZWQuICovXHJcbmNvbnN0IEVSUk9SX1NFUlZFUl9DTE9TRUQgPSBcIlNlcnZlciBjbG9zZWRcIjtcclxuXHJcbi8qKiBEZWZhdWx0IHBvcnQgZm9yIHNlcnZpbmcgSFRUUC4gKi9cclxuY29uc3QgSFRUUF9QT1JUID0gODA7XHJcblxyXG4vKiogRGVmYXVsdCBwb3J0IGZvciBzZXJ2aW5nIEhUVFBTLiAqL1xyXG5jb25zdCBIVFRQU19QT1JUID0gNDQzO1xyXG5cclxuLyoqIEluaXRpYWwgYmFja29mZiBkZWxheSBvZiA1bXMgZm9sbG93aW5nIGEgdGVtcG9yYXJ5IGFjY2VwdCBmYWlsdXJlLiAqL1xyXG5jb25zdCBJTklUSUFMX0FDQ0VQVF9CQUNLT0ZGX0RFTEFZID0gNTtcclxuXHJcbi8qKiBNYXggYmFja29mZiBkZWxheSBvZiAxcyBmb2xsb3dpbmcgYSB0ZW1wb3JhcnkgYWNjZXB0IGZhaWx1cmUuICovXHJcbmNvbnN0IE1BWF9BQ0NFUFRfQkFDS09GRl9ERUxBWSA9IDEwMDA7XHJcblxyXG4vKipcclxuICogSW5mb3JtYXRpb24gYWJvdXQgdGhlIGNvbm5lY3Rpb24gYSByZXF1ZXN0IGFycml2ZWQgb24uXHJcbiAqXHJcbiAqIEBkZXByZWNhdGVkIFRoaXMgd2lsbCBiZSByZW1vdmVkIGluIDEuMC4wLiBVc2Uge0BsaW5rY29kZSBEZW5vLlNlcnZlSGFuZGxlckluZm99IGluc3RlYWQuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIENvbm5JbmZvIHtcclxuICAvKiogVGhlIGxvY2FsIGFkZHJlc3Mgb2YgdGhlIGNvbm5lY3Rpb24uICovXHJcbiAgcmVhZG9ubHkgbG9jYWxBZGRyOiBEZW5vLkFkZHI7XHJcbiAgLyoqIFRoZSByZW1vdGUgYWRkcmVzcyBvZiB0aGUgY29ubmVjdGlvbi4gKi9cclxuICByZWFkb25seSByZW1vdGVBZGRyOiBEZW5vLkFkZHI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBIGhhbmRsZXIgZm9yIEhUVFAgcmVxdWVzdHMuIENvbnN1bWVzIGEgcmVxdWVzdCBhbmQgY29ubmVjdGlvbiBpbmZvcm1hdGlvblxyXG4gKiBhbmQgcmV0dXJucyBhIHJlc3BvbnNlLlxyXG4gKlxyXG4gKiBJZiBhIGhhbmRsZXIgdGhyb3dzLCB0aGUgc2VydmVyIGNhbGxpbmcgdGhlIGhhbmRsZXIgd2lsbCBhc3N1bWUgdGhlIGltcGFjdFxyXG4gKiBvZiB0aGUgZXJyb3IgaXMgaXNvbGF0ZWQgdG8gdGhlIGluZGl2aWR1YWwgcmVxdWVzdC4gSXQgd2lsbCBjYXRjaCB0aGUgZXJyb3JcclxuICogYW5kIGNsb3NlIHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24uXHJcbiAqXHJcbiAqIEBkZXByZWNhdGVkIFRoaXMgd2lsbCBiZSByZW1vdmVkIGluIDEuMC4wLiBVc2Uge0BsaW5rY29kZSBEZW5vLlNlcnZlSGFuZGxlcn0gaW5zdGVhZC5cclxuICovXHJcbmV4cG9ydCB0eXBlIEhhbmRsZXIgPSAoXHJcbiAgcmVxdWVzdDogUmVxdWVzdCxcclxuICBjb25uSW5mbzogQ29ubkluZm8sXHJcbikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcclxuXHJcbi8qKlxyXG4gKiBPcHRpb25zIGZvciBydW5uaW5nIGFuIEhUVFAgc2VydmVyLlxyXG4gKlxyXG4gKiBAZGVwcmVjYXRlZCBUaGlzIHdpbGwgYmUgcmVtb3ZlZCBpbiAxLjAuMC4gVXNlIHtAbGlua2NvZGUgRGVuby5TZXJ2ZUluaXR9IGluc3RlYWQuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZlckluaXQgZXh0ZW5kcyBQYXJ0aWFsPERlbm8uTGlzdGVuT3B0aW9ucz4ge1xyXG4gIC8qKiBUaGUgaGFuZGxlciB0byBpbnZva2UgZm9yIGluZGl2aWR1YWwgSFRUUCByZXF1ZXN0cy4gKi9cclxuICBoYW5kbGVyOiBIYW5kbGVyO1xyXG5cclxuICAvKipcclxuICAgKiBUaGUgaGFuZGxlciB0byBpbnZva2Ugd2hlbiByb3V0ZSBoYW5kbGVycyB0aHJvdyBhbiBlcnJvci5cclxuICAgKlxyXG4gICAqIFRoZSBkZWZhdWx0IGVycm9yIGhhbmRsZXIgbG9ncyBhbmQgcmV0dXJucyB0aGUgZXJyb3IgaW4gSlNPTiBmb3JtYXQuXHJcbiAgICovXHJcbiAgb25FcnJvcj86IChlcnJvcjogdW5rbm93bikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcclxufVxyXG5cclxuLyoqXHJcbiAqIFVzZWQgdG8gY29uc3RydWN0IGFuIEhUVFAgc2VydmVyLlxyXG4gKlxyXG4gKiBAZGVwcmVjYXRlZCBUaGlzIHdpbGwgYmUgcmVtb3ZlZCBpbiAxLjAuMC4gVXNlIHtAbGlua2NvZGUgRGVuby5zZXJ2ZX0gaW5zdGVhZC5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBTZXJ2ZXIge1xyXG4gICNwb3J0PzogbnVtYmVyO1xyXG4gICNob3N0Pzogc3RyaW5nO1xyXG4gICNoYW5kbGVyOiBIYW5kbGVyO1xyXG4gICNjbG9zZWQgPSBmYWxzZTtcclxuICAjbGlzdGVuZXJzOiBTZXQ8RGVuby5MaXN0ZW5lcj4gPSBuZXcgU2V0KCk7XHJcbiAgI2FjY2VwdEJhY2tvZmZEZWxheUFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcclxuICAjaHR0cENvbm5lY3Rpb25zOiBTZXQ8RGVuby5IdHRwQ29ubj4gPSBuZXcgU2V0KCk7XHJcbiAgI29uRXJyb3I6IChlcnJvcjogdW5rbm93bikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcclxuXHJcbiAgLyoqXHJcbiAgICogQ29uc3RydWN0cyBhIG5ldyBIVFRQIFNlcnZlciBpbnN0YW5jZS5cclxuICAgKlxyXG4gICAqIGBgYHRzXHJcbiAgICogaW1wb3J0IHsgU2VydmVyIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcclxuICAgKlxyXG4gICAqIGNvbnN0IHBvcnQgPSA0NTA1O1xyXG4gICAqIGNvbnN0IGhhbmRsZXIgPSAocmVxdWVzdDogUmVxdWVzdCkgPT4ge1xyXG4gICAqICAgY29uc3QgYm9keSA9IGBZb3VyIHVzZXItYWdlbnQgaXM6XFxuXFxuJHtyZXF1ZXN0LmhlYWRlcnMuZ2V0KFxyXG4gICAqICAgIFwidXNlci1hZ2VudFwiLFxyXG4gICAqICAgKSA/PyBcIlVua25vd25cIn1gO1xyXG4gICAqXHJcbiAgICogICByZXR1cm4gbmV3IFJlc3BvbnNlKGJvZHksIHsgc3RhdHVzOiAyMDAgfSk7XHJcbiAgICogfTtcclxuICAgKlxyXG4gICAqIGNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoeyBwb3J0LCBoYW5kbGVyIH0pO1xyXG4gICAqIGBgYFxyXG4gICAqXHJcbiAgICogQHBhcmFtIHNlcnZlckluaXQgT3B0aW9ucyBmb3IgcnVubmluZyBhbiBIVFRQIHNlcnZlci5cclxuICAgKi9cclxuICBjb25zdHJ1Y3RvcihzZXJ2ZXJJbml0OiBTZXJ2ZXJJbml0KSB7XHJcbiAgICB0aGlzLiNwb3J0ID0gc2VydmVySW5pdC5wb3J0O1xyXG4gICAgdGhpcy4jaG9zdCA9IHNlcnZlckluaXQuaG9zdG5hbWU7XHJcbiAgICB0aGlzLiNoYW5kbGVyID0gc2VydmVySW5pdC5oYW5kbGVyO1xyXG4gICAgdGhpcy4jb25FcnJvciA9IHNlcnZlckluaXQub25FcnJvciA/P1xyXG4gICAgICBmdW5jdGlvbiAoZXJyb3I6IHVua25vd24pIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcclxuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIsIHsgc3RhdHVzOiA1MDAgfSk7XHJcbiAgICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBY2NlcHQgaW5jb21pbmcgY29ubmVjdGlvbnMgb24gdGhlIGdpdmVuIGxpc3RlbmVyLCBhbmQgaGFuZGxlIHJlcXVlc3RzIG9uXHJcbiAgICogdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cclxuICAgKlxyXG4gICAqIEhUVFAvMiBzdXBwb3J0IGlzIG9ubHkgZW5hYmxlZCBpZiB0aGUgcHJvdmlkZWQgRGVuby5MaXN0ZW5lciByZXR1cm5zIFRMU1xyXG4gICAqIGNvbm5lY3Rpb25zIGFuZCB3YXMgY29uZmlndXJlZCB3aXRoIFwiaDJcIiBpbiB0aGUgQUxQTiBwcm90b2NvbHMuXHJcbiAgICpcclxuICAgKiBUaHJvd3MgYSBzZXJ2ZXIgY2xvc2VkIGVycm9yIGlmIGNhbGxlZCBhZnRlciB0aGUgc2VydmVyIGhhcyBiZWVuIGNsb3NlZC5cclxuICAgKlxyXG4gICAqIFdpbGwgYWx3YXlzIGNsb3NlIHRoZSBjcmVhdGVkIGxpc3RlbmVyLlxyXG4gICAqXHJcbiAgICogYGBgdHNcclxuICAgKiBpbXBvcnQgeyBTZXJ2ZXIgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gICAqXHJcbiAgICogY29uc3QgaGFuZGxlciA9IChyZXF1ZXN0OiBSZXF1ZXN0KSA9PiB7XHJcbiAgICogICBjb25zdCBib2R5ID0gYFlvdXIgdXNlci1hZ2VudCBpczpcXG5cXG4ke3JlcXVlc3QuaGVhZGVycy5nZXQoXHJcbiAgICogICAgXCJ1c2VyLWFnZW50XCIsXHJcbiAgICogICApID8/IFwiVW5rbm93blwifWA7XHJcbiAgICpcclxuICAgKiAgIHJldHVybiBuZXcgUmVzcG9uc2UoYm9keSwgeyBzdGF0dXM6IDIwMCB9KTtcclxuICAgKiB9O1xyXG4gICAqXHJcbiAgICogY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcih7IGhhbmRsZXIgfSk7XHJcbiAgICogY29uc3QgbGlzdGVuZXIgPSBEZW5vLmxpc3Rlbih7IHBvcnQ6IDQ1MDUgfSk7XHJcbiAgICpcclxuICAgKiBjb25zb2xlLmxvZyhcInNlcnZlciBsaXN0ZW5pbmcgb24gaHR0cDovL2xvY2FsaG9zdDo0NTA1XCIpO1xyXG4gICAqXHJcbiAgICogYXdhaXQgc2VydmVyLnNlcnZlKGxpc3RlbmVyKTtcclxuICAgKiBgYGBcclxuICAgKlxyXG4gICAqIEBwYXJhbSBsaXN0ZW5lciBUaGUgbGlzdGVuZXIgdG8gYWNjZXB0IGNvbm5lY3Rpb25zIGZyb20uXHJcbiAgICovXHJcbiAgYXN5bmMgc2VydmUobGlzdGVuZXI6IERlbm8uTGlzdGVuZXIpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICh0aGlzLiNjbG9zZWQpIHtcclxuICAgICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLkh0dHAoRVJST1JfU0VSVkVSX0NMT1NFRCk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy4jdHJhY2tMaXN0ZW5lcihsaXN0ZW5lcik7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuI2FjY2VwdChsaXN0ZW5lcik7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICB0aGlzLiN1bnRyYWNrTGlzdGVuZXIobGlzdGVuZXIpO1xyXG5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsaXN0ZW5lci5jbG9zZSgpO1xyXG4gICAgICB9IGNhdGNoIHtcclxuICAgICAgICAvLyBMaXN0ZW5lciBoYXMgYWxyZWFkeSBiZWVuIGNsb3NlZC5cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIGEgbGlzdGVuZXIgb24gdGhlIHNlcnZlciwgYWNjZXB0IGluY29taW5nIGNvbm5lY3Rpb25zLCBhbmQgaGFuZGxlXHJcbiAgICogcmVxdWVzdHMgb24gdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cclxuICAgKlxyXG4gICAqIElmIHRoZSBzZXJ2ZXIgd2FzIGNvbnN0cnVjdGVkIHdpdGhvdXQgYSBzcGVjaWZpZWQgcG9ydCwgODAgaXMgdXNlZC5cclxuICAgKlxyXG4gICAqIElmIHRoZSBzZXJ2ZXIgd2FzIGNvbnN0cnVjdGVkIHdpdGggdGhlIGhvc3RuYW1lIG9taXR0ZWQgZnJvbSB0aGUgb3B0aW9ucywgdGhlXHJcbiAgICogbm9uLXJvdXRhYmxlIG1ldGEtYWRkcmVzcyBgMC4wLjAuMGAgaXMgdXNlZC5cclxuICAgKlxyXG4gICAqIFRocm93cyBhIHNlcnZlciBjbG9zZWQgZXJyb3IgaWYgdGhlIHNlcnZlciBoYXMgYmVlbiBjbG9zZWQuXHJcbiAgICpcclxuICAgKiBgYGB0c1xyXG4gICAqIGltcG9ydCB7IFNlcnZlciB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XHJcbiAgICpcclxuICAgKiBjb25zdCBwb3J0ID0gNDUwNTtcclxuICAgKiBjb25zdCBoYW5kbGVyID0gKHJlcXVlc3Q6IFJlcXVlc3QpID0+IHtcclxuICAgKiAgIGNvbnN0IGJvZHkgPSBgWW91ciB1c2VyLWFnZW50IGlzOlxcblxcbiR7cmVxdWVzdC5oZWFkZXJzLmdldChcclxuICAgKiAgICBcInVzZXItYWdlbnRcIixcclxuICAgKiAgICkgPz8gXCJVbmtub3duXCJ9YDtcclxuICAgKlxyXG4gICAqICAgcmV0dXJuIG5ldyBSZXNwb25zZShib2R5LCB7IHN0YXR1czogMjAwIH0pO1xyXG4gICAqIH07XHJcbiAgICpcclxuICAgKiBjb25zdCBzZXJ2ZXIgPSBuZXcgU2VydmVyKHsgcG9ydCwgaGFuZGxlciB9KTtcclxuICAgKlxyXG4gICAqIGNvbnNvbGUubG9nKFwic2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OjQ1MDVcIik7XHJcbiAgICpcclxuICAgKiBhd2FpdCBzZXJ2ZXIubGlzdGVuQW5kU2VydmUoKTtcclxuICAgKiBgYGBcclxuICAgKi9cclxuICBhc3luYyBsaXN0ZW5BbmRTZXJ2ZSgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICh0aGlzLiNjbG9zZWQpIHtcclxuICAgICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLkh0dHAoRVJST1JfU0VSVkVSX0NMT1NFRCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbGlzdGVuZXIgPSBEZW5vLmxpc3Rlbih7XHJcbiAgICAgIHBvcnQ6IHRoaXMuI3BvcnQgPz8gSFRUUF9QT1JULFxyXG4gICAgICBob3N0bmFtZTogdGhpcy4jaG9zdCA/PyBcIjAuMC4wLjBcIixcclxuICAgICAgdHJhbnNwb3J0OiBcInRjcFwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc2VydmUobGlzdGVuZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIGEgbGlzdGVuZXIgb24gdGhlIHNlcnZlciwgYWNjZXB0IGluY29taW5nIGNvbm5lY3Rpb25zLCB1cGdyYWRlIHRoZW1cclxuICAgKiB0byBUTFMsIGFuZCBoYW5kbGUgcmVxdWVzdHMgb24gdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cclxuICAgKlxyXG4gICAqIElmIHRoZSBzZXJ2ZXIgd2FzIGNvbnN0cnVjdGVkIHdpdGhvdXQgYSBzcGVjaWZpZWQgcG9ydCwgNDQzIGlzIHVzZWQuXHJcbiAgICpcclxuICAgKiBJZiB0aGUgc2VydmVyIHdhcyBjb25zdHJ1Y3RlZCB3aXRoIHRoZSBob3N0bmFtZSBvbWl0dGVkIGZyb20gdGhlIG9wdGlvbnMsIHRoZVxyXG4gICAqIG5vbi1yb3V0YWJsZSBtZXRhLWFkZHJlc3MgYDAuMC4wLjBgIGlzIHVzZWQuXHJcbiAgICpcclxuICAgKiBUaHJvd3MgYSBzZXJ2ZXIgY2xvc2VkIGVycm9yIGlmIHRoZSBzZXJ2ZXIgaGFzIGJlZW4gY2xvc2VkLlxyXG4gICAqXHJcbiAgICogYGBgdHNcclxuICAgKiBpbXBvcnQgeyBTZXJ2ZXIgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gICAqXHJcbiAgICogY29uc3QgcG9ydCA9IDQ1MDU7XHJcbiAgICogY29uc3QgaGFuZGxlciA9IChyZXF1ZXN0OiBSZXF1ZXN0KSA9PiB7XHJcbiAgICogICBjb25zdCBib2R5ID0gYFlvdXIgdXNlci1hZ2VudCBpczpcXG5cXG4ke3JlcXVlc3QuaGVhZGVycy5nZXQoXHJcbiAgICogICAgXCJ1c2VyLWFnZW50XCIsXHJcbiAgICogICApID8/IFwiVW5rbm93blwifWA7XHJcbiAgICpcclxuICAgKiAgIHJldHVybiBuZXcgUmVzcG9uc2UoYm9keSwgeyBzdGF0dXM6IDIwMCB9KTtcclxuICAgKiB9O1xyXG4gICAqXHJcbiAgICogY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcih7IHBvcnQsIGhhbmRsZXIgfSk7XHJcbiAgICpcclxuICAgKiBjb25zdCBjZXJ0RmlsZSA9IFwiL3BhdGgvdG8vY2VydEZpbGUuY3J0XCI7XHJcbiAgICogY29uc3Qga2V5RmlsZSA9IFwiL3BhdGgvdG8va2V5RmlsZS5rZXlcIjtcclxuICAgKlxyXG4gICAqIGNvbnNvbGUubG9nKFwic2VydmVyIGxpc3RlbmluZyBvbiBodHRwczovL2xvY2FsaG9zdDo0NTA1XCIpO1xyXG4gICAqXHJcbiAgICogYXdhaXQgc2VydmVyLmxpc3RlbkFuZFNlcnZlVGxzKGNlcnRGaWxlLCBrZXlGaWxlKTtcclxuICAgKiBgYGBcclxuICAgKlxyXG4gICAqIEBwYXJhbSBjZXJ0RmlsZSBUaGUgcGF0aCB0byB0aGUgZmlsZSBjb250YWluaW5nIHRoZSBUTFMgY2VydGlmaWNhdGUuXHJcbiAgICogQHBhcmFtIGtleUZpbGUgVGhlIHBhdGggdG8gdGhlIGZpbGUgY29udGFpbmluZyB0aGUgVExTIHByaXZhdGUga2V5LlxyXG4gICAqL1xyXG4gIGFzeW5jIGxpc3RlbkFuZFNlcnZlVGxzKGNlcnRGaWxlOiBzdHJpbmcsIGtleUZpbGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKHRoaXMuI2Nsb3NlZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuSHR0cChFUlJPUl9TRVJWRVJfQ0xPU0VEKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsaXN0ZW5lciA9IERlbm8ubGlzdGVuVGxzKHtcclxuICAgICAgcG9ydDogdGhpcy4jcG9ydCA/PyBIVFRQU19QT1JULFxyXG4gICAgICBob3N0bmFtZTogdGhpcy4jaG9zdCA/PyBcIjAuMC4wLjBcIixcclxuICAgICAgY2VydDogRGVuby5yZWFkVGV4dEZpbGVTeW5jKGNlcnRGaWxlKSxcclxuICAgICAga2V5OiBEZW5vLnJlYWRUZXh0RmlsZVN5bmMoa2V5RmlsZSksXHJcbiAgICAgIHRyYW5zcG9ydDogXCJ0Y3BcIixcclxuICAgICAgLy8gQUxQTiBwcm90b2NvbCBzdXBwb3J0IG5vdCB5ZXQgc3RhYmxlLlxyXG4gICAgICAvLyBhbHBuUHJvdG9jb2xzOiBbXCJoMlwiLCBcImh0dHAvMS4xXCJdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc2VydmUobGlzdGVuZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSW1tZWRpYXRlbHkgY2xvc2UgdGhlIHNlcnZlciBsaXN0ZW5lcnMgYW5kIGFzc29jaWF0ZWQgSFRUUCBjb25uZWN0aW9ucy5cclxuICAgKlxyXG4gICAqIFRocm93cyBhIHNlcnZlciBjbG9zZWQgZXJyb3IgaWYgY2FsbGVkIGFmdGVyIHRoZSBzZXJ2ZXIgaGFzIGJlZW4gY2xvc2VkLlxyXG4gICAqL1xyXG4gIGNsb3NlKCkge1xyXG4gICAgaWYgKHRoaXMuI2Nsb3NlZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuSHR0cChFUlJPUl9TRVJWRVJfQ0xPU0VEKTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLiNjbG9zZWQgPSB0cnVlO1xyXG5cclxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy4jbGlzdGVuZXJzKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGlzdGVuZXIuY2xvc2UoKTtcclxuICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgLy8gTGlzdGVuZXIgaGFzIGFscmVhZHkgYmVlbiBjbG9zZWQuXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aGlzLiNsaXN0ZW5lcnMuY2xlYXIoKTtcclxuXHJcbiAgICB0aGlzLiNhY2NlcHRCYWNrb2ZmRGVsYXlBYm9ydENvbnRyb2xsZXIuYWJvcnQoKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGh0dHBDb25uIG9mIHRoaXMuI2h0dHBDb25uZWN0aW9ucykge1xyXG4gICAgICB0aGlzLiNjbG9zZUh0dHBDb25uKGh0dHBDb25uKTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLiNodHRwQ29ubmVjdGlvbnMuY2xlYXIoKTtcclxuICB9XHJcblxyXG4gIC8qKiBHZXQgd2hldGhlciB0aGUgc2VydmVyIGlzIGNsb3NlZC4gKi9cclxuICBnZXQgY2xvc2VkKCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuI2Nsb3NlZDtcclxuICB9XHJcblxyXG4gIC8qKiBHZXQgdGhlIGxpc3Qgb2YgbmV0d29yayBhZGRyZXNzZXMgdGhlIHNlcnZlciBpcyBsaXN0ZW5pbmcgb24uICovXHJcbiAgZ2V0IGFkZHJzKCk6IERlbm8uQWRkcltdIHtcclxuICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuI2xpc3RlbmVycykubWFwKChsaXN0ZW5lcikgPT4gbGlzdGVuZXIuYWRkcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZXNwb25kcyB0byBhbiBIVFRQIHJlcXVlc3QuXHJcbiAgICpcclxuICAgKiBAcGFyYW0gcmVxdWVzdEV2ZW50IFRoZSBIVFRQIHJlcXVlc3QgdG8gcmVzcG9uZCB0by5cclxuICAgKiBAcGFyYW0gY29ubkluZm8gSW5mb3JtYXRpb24gYWJvdXQgdGhlIHVuZGVybHlpbmcgY29ubmVjdGlvbi5cclxuICAgKi9cclxuICBhc3luYyAjcmVzcG9uZChcclxuICAgIHJlcXVlc3RFdmVudDogRGVuby5SZXF1ZXN0RXZlbnQsXHJcbiAgICBjb25uSW5mbzogQ29ubkluZm8sXHJcbiAgKSB7XHJcbiAgICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gSGFuZGxlIHRoZSByZXF1ZXN0IGV2ZW50LCBnZW5lcmF0aW5nIGEgcmVzcG9uc2UuXHJcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgdGhpcy4jaGFuZGxlcihyZXF1ZXN0RXZlbnQucmVxdWVzdCwgY29ubkluZm8pO1xyXG5cclxuICAgICAgaWYgKHJlc3BvbnNlLmJvZHlVc2VkICYmIHJlc3BvbnNlLmJvZHkgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUmVzcG9uc2UgYm9keSBhbHJlYWR5IGNvbnN1bWVkLlwiKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcclxuICAgICAgLy8gSW52b2tlIG9uRXJyb3IgaGFuZGxlciB3aGVuIHJlcXVlc3QgaGFuZGxlciB0aHJvd3MuXHJcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgdGhpcy4jb25FcnJvcihlcnJvcik7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gU2VuZCB0aGUgcmVzcG9uc2UuXHJcbiAgICAgIGF3YWl0IHJlcXVlc3RFdmVudC5yZXNwb25kV2l0aChyZXNwb25zZSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgLy8gYHJlc3BvbmRXaXRoKClgIGNhbiB0aHJvdyBmb3IgdmFyaW91cyByZWFzb25zLCBpbmNsdWRpbmcgZG93bnN0cmVhbSBhbmRcclxuICAgICAgLy8gdXBzdHJlYW0gY29ubmVjdGlvbiBlcnJvcnMsIGFzIHdlbGwgYXMgZXJyb3JzIHRocm93biBkdXJpbmcgc3RyZWFtaW5nXHJcbiAgICAgIC8vIG9mIHRoZSByZXNwb25zZSBjb250ZW50LiAgSW4gb3JkZXIgdG8gYXZvaWQgZmFsc2UgbmVnYXRpdmVzLCB3ZSBpZ25vcmVcclxuICAgICAgLy8gdGhlIGVycm9yIGhlcmUgYW5kIGxldCBgc2VydmVIdHRwYCBjbG9zZSB0aGUgY29ubmVjdGlvbiBvbiB0aGVcclxuICAgICAgLy8gZm9sbG93aW5nIGl0ZXJhdGlvbiBpZiBpdCBpcyBpbiBmYWN0IGEgZG93bnN0cmVhbSBjb25uZWN0aW9uIGVycm9yLlxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2VydmVzIGFsbCBIVFRQIHJlcXVlc3RzIG9uIGEgc2luZ2xlIGNvbm5lY3Rpb24uXHJcbiAgICpcclxuICAgKiBAcGFyYW0gaHR0cENvbm4gVGhlIEhUVFAgY29ubmVjdGlvbiB0byB5aWVsZCByZXF1ZXN0cyBmcm9tLlxyXG4gICAqIEBwYXJhbSBjb25uSW5mbyBJbmZvcm1hdGlvbiBhYm91dCB0aGUgdW5kZXJseWluZyBjb25uZWN0aW9uLlxyXG4gICAqL1xyXG4gIGFzeW5jICNzZXJ2ZUh0dHAoaHR0cENvbm46IERlbm8uSHR0cENvbm4sIGNvbm5JbmZvOiBDb25uSW5mbykge1xyXG4gICAgd2hpbGUgKCF0aGlzLiNjbG9zZWQpIHtcclxuICAgICAgbGV0IHJlcXVlc3RFdmVudDogRGVuby5SZXF1ZXN0RXZlbnQgfCBudWxsO1xyXG5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBZaWVsZCB0aGUgbmV3IEhUVFAgcmVxdWVzdCBvbiB0aGUgY29ubmVjdGlvbi5cclxuICAgICAgICByZXF1ZXN0RXZlbnQgPSBhd2FpdCBodHRwQ29ubi5uZXh0UmVxdWVzdCgpO1xyXG4gICAgICB9IGNhdGNoIHtcclxuICAgICAgICAvLyBDb25uZWN0aW9uIGhhcyBiZWVuIGNsb3NlZC5cclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHJlcXVlc3RFdmVudCA9PT0gbnVsbCkge1xyXG4gICAgICAgIC8vIENvbm5lY3Rpb24gaGFzIGJlZW4gY2xvc2VkLlxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBSZXNwb25kIHRvIHRoZSByZXF1ZXN0LiBOb3RlIHdlIGRvIG5vdCBhd2FpdCB0aGlzIGFzeW5jIG1ldGhvZCB0b1xyXG4gICAgICAvLyBhbGxvdyB0aGUgY29ubmVjdGlvbiB0byBoYW5kbGUgbXVsdGlwbGUgcmVxdWVzdHMgaW4gdGhlIGNhc2Ugb2YgaDIuXHJcbiAgICAgIHRoaXMuI3Jlc3BvbmQocmVxdWVzdEV2ZW50LCBjb25uSW5mbyk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy4jY2xvc2VIdHRwQ29ubihodHRwQ29ubik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBY2NlcHRzIGFsbCBjb25uZWN0aW9ucyBvbiBhIHNpbmdsZSBuZXR3b3JrIGxpc3RlbmVyLlxyXG4gICAqXHJcbiAgICogQHBhcmFtIGxpc3RlbmVyIFRoZSBsaXN0ZW5lciB0byBhY2NlcHQgY29ubmVjdGlvbnMgZnJvbS5cclxuICAgKi9cclxuICBhc3luYyAjYWNjZXB0KGxpc3RlbmVyOiBEZW5vLkxpc3RlbmVyKSB7XHJcbiAgICBsZXQgYWNjZXB0QmFja29mZkRlbGF5OiBudW1iZXIgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgd2hpbGUgKCF0aGlzLiNjbG9zZWQpIHtcclxuICAgICAgbGV0IGNvbm46IERlbm8uQ29ubjtcclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gV2FpdCBmb3IgYSBuZXcgY29ubmVjdGlvbi5cclxuICAgICAgICBjb25uID0gYXdhaXQgbGlzdGVuZXIuYWNjZXB0KCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgaWYgKFxyXG4gICAgICAgICAgLy8gVGhlIGxpc3RlbmVyIGlzIGNsb3NlZC5cclxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuQmFkUmVzb3VyY2UgfHxcclxuICAgICAgICAgIC8vIFRMUyBoYW5kc2hha2UgZXJyb3JzLlxyXG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5JbnZhbGlkRGF0YSB8fFxyXG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mIHx8XHJcbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLkNvbm5lY3Rpb25SZXNldCB8fFxyXG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5Ob3RDb25uZWN0ZWRcclxuICAgICAgICApIHtcclxuICAgICAgICAgIC8vIEJhY2tvZmYgYWZ0ZXIgdHJhbnNpZW50IGVycm9ycyB0byBhbGxvdyB0aW1lIGZvciB0aGUgc3lzdGVtIHRvXHJcbiAgICAgICAgICAvLyByZWNvdmVyLCBhbmQgYXZvaWQgYmxvY2tpbmcgdXAgdGhlIGV2ZW50IGxvb3Agd2l0aCBhIGNvbnRpbnVvdXNseVxyXG4gICAgICAgICAgLy8gcnVubmluZyBsb29wLlxyXG4gICAgICAgICAgaWYgKCFhY2NlcHRCYWNrb2ZmRGVsYXkpIHtcclxuICAgICAgICAgICAgYWNjZXB0QmFja29mZkRlbGF5ID0gSU5JVElBTF9BQ0NFUFRfQkFDS09GRl9ERUxBWTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGFjY2VwdEJhY2tvZmZEZWxheSAqPSAyO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGlmIChhY2NlcHRCYWNrb2ZmRGVsYXkgPj0gTUFYX0FDQ0VQVF9CQUNLT0ZGX0RFTEFZKSB7XHJcbiAgICAgICAgICAgIGFjY2VwdEJhY2tvZmZEZWxheSA9IE1BWF9BQ0NFUFRfQkFDS09GRl9ERUxBWTtcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBhd2FpdCBkZWxheShhY2NlcHRCYWNrb2ZmRGVsYXksIHtcclxuICAgICAgICAgICAgICBzaWduYWw6IHRoaXMuI2FjY2VwdEJhY2tvZmZEZWxheUFib3J0Q29udHJvbGxlci5zaWduYWwsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XHJcbiAgICAgICAgICAgIC8vIFRoZSBiYWNrb2ZmIGRlbGF5IHRpbWVyIGlzIGFib3J0ZWQgd2hlbiBjbG9zaW5nIHRoZSBzZXJ2ZXIuXHJcbiAgICAgICAgICAgIGlmICghKGVyciBpbnN0YW5jZW9mIERPTUV4Y2VwdGlvbiAmJiBlcnIubmFtZSA9PT0gXCJBYm9ydEVycm9yXCIpKSB7XHJcbiAgICAgICAgICAgICAgdGhyb3cgZXJyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgfVxyXG5cclxuICAgICAgYWNjZXB0QmFja29mZkRlbGF5ID0gdW5kZWZpbmVkO1xyXG5cclxuICAgICAgLy8gXCJVcGdyYWRlXCIgdGhlIG5ldHdvcmsgY29ubmVjdGlvbiBpbnRvIGFuIEhUVFAgY29ubmVjdGlvbi5cclxuICAgICAgbGV0IGh0dHBDb25uOiBEZW5vLkh0dHBDb25uO1xyXG5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWRlcHJlY2F0ZWQtZGVuby1hcGlcclxuICAgICAgICBodHRwQ29ubiA9IERlbm8uc2VydmVIdHRwKGNvbm4pO1xyXG4gICAgICB9IGNhdGNoIHtcclxuICAgICAgICAvLyBDb25uZWN0aW9uIGhhcyBiZWVuIGNsb3NlZC5cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ2xvc2luZyB0aGUgdW5kZXJseWluZyBsaXN0ZW5lciB3aWxsIG5vdCBjbG9zZSBIVFRQIGNvbm5lY3Rpb25zLCBzbyB3ZVxyXG4gICAgICAvLyB0cmFjayBmb3IgY2xvc3VyZSB1cG9uIHNlcnZlciBjbG9zZS5cclxuICAgICAgdGhpcy4jdHJhY2tIdHRwQ29ubmVjdGlvbihodHRwQ29ubik7XHJcblxyXG4gICAgICBjb25zdCBjb25uSW5mbzogQ29ubkluZm8gPSB7XHJcbiAgICAgICAgbG9jYWxBZGRyOiBjb25uLmxvY2FsQWRkcixcclxuICAgICAgICByZW1vdGVBZGRyOiBjb25uLnJlbW90ZUFkZHIsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBTZXJ2ZSB0aGUgcmVxdWVzdHMgdGhhdCBhcnJpdmUgb24gdGhlIGp1c3QtYWNjZXB0ZWQgY29ubmVjdGlvbi4gTm90ZVxyXG4gICAgICAvLyB3ZSBkbyBub3QgYXdhaXQgdGhpcyBhc3luYyBtZXRob2QgdG8gYWxsb3cgdGhlIHNlcnZlciB0byBhY2NlcHQgbmV3XHJcbiAgICAgIC8vIGNvbm5lY3Rpb25zLlxyXG4gICAgICB0aGlzLiNzZXJ2ZUh0dHAoaHR0cENvbm4sIGNvbm5JbmZvKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFVudHJhY2tzIGFuZCBjbG9zZXMgYW4gSFRUUCBjb25uZWN0aW9uLlxyXG4gICAqXHJcbiAgICogQHBhcmFtIGh0dHBDb25uIFRoZSBIVFRQIGNvbm5lY3Rpb24gdG8gY2xvc2UuXHJcbiAgICovXHJcbiAgI2Nsb3NlSHR0cENvbm4oaHR0cENvbm46IERlbm8uSHR0cENvbm4pIHtcclxuICAgIHRoaXMuI3VudHJhY2tIdHRwQ29ubmVjdGlvbihodHRwQ29ubik7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgaHR0cENvbm4uY2xvc2UoKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAvLyBDb25uZWN0aW9uIGhhcyBhbHJlYWR5IGJlZW4gY2xvc2VkLlxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQWRkcyB0aGUgbGlzdGVuZXIgdG8gdGhlIGludGVybmFsIHRyYWNraW5nIGxpc3QuXHJcbiAgICpcclxuICAgKiBAcGFyYW0gbGlzdGVuZXIgTGlzdGVuZXIgdG8gdHJhY2suXHJcbiAgICovXHJcbiAgI3RyYWNrTGlzdGVuZXIobGlzdGVuZXI6IERlbm8uTGlzdGVuZXIpIHtcclxuICAgIHRoaXMuI2xpc3RlbmVycy5hZGQobGlzdGVuZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmVtb3ZlcyB0aGUgbGlzdGVuZXIgZnJvbSB0aGUgaW50ZXJuYWwgdHJhY2tpbmcgbGlzdC5cclxuICAgKlxyXG4gICAqIEBwYXJhbSBsaXN0ZW5lciBMaXN0ZW5lciB0byB1bnRyYWNrLlxyXG4gICAqL1xyXG4gICN1bnRyYWNrTGlzdGVuZXIobGlzdGVuZXI6IERlbm8uTGlzdGVuZXIpIHtcclxuICAgIHRoaXMuI2xpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQWRkcyB0aGUgSFRUUCBjb25uZWN0aW9uIHRvIHRoZSBpbnRlcm5hbCB0cmFja2luZyBsaXN0LlxyXG4gICAqXHJcbiAgICogQHBhcmFtIGh0dHBDb25uIEhUVFAgY29ubmVjdGlvbiB0byB0cmFjay5cclxuICAgKi9cclxuICAjdHJhY2tIdHRwQ29ubmVjdGlvbihodHRwQ29ubjogRGVuby5IdHRwQ29ubikge1xyXG4gICAgdGhpcy4jaHR0cENvbm5lY3Rpb25zLmFkZChodHRwQ29ubik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZW1vdmVzIHRoZSBIVFRQIGNvbm5lY3Rpb24gZnJvbSB0aGUgaW50ZXJuYWwgdHJhY2tpbmcgbGlzdC5cclxuICAgKlxyXG4gICAqIEBwYXJhbSBodHRwQ29ubiBIVFRQIGNvbm5lY3Rpb24gdG8gdW50cmFjay5cclxuICAgKi9cclxuICAjdW50cmFja0h0dHBDb25uZWN0aW9uKGh0dHBDb25uOiBEZW5vLkh0dHBDb25uKSB7XHJcbiAgICB0aGlzLiNodHRwQ29ubmVjdGlvbnMuZGVsZXRlKGh0dHBDb25uKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBZGRpdGlvbmFsIHNlcnZlIG9wdGlvbnMuXHJcbiAqXHJcbiAqIEBkZXByZWNhdGVkIFRoaXMgd2lsbCBiZSByZW1vdmVkIGluIDEuMC4wLiBVc2Uge0BsaW5rY29kZSBEZW5vLlNlcnZlSW5pdH0gaW5zdGVhZC5cclxuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU2VydmVJbml0IGV4dGVuZHMgUGFydGlhbDxEZW5vLkxpc3Rlbk9wdGlvbnM+IHtcclxuICAvKiogQW4gQWJvcnRTaWduYWwgdG8gY2xvc2UgdGhlIHNlcnZlciBhbmQgYWxsIGNvbm5lY3Rpb25zLiAqL1xyXG4gIHNpZ25hbD86IEFib3J0U2lnbmFsO1xyXG5cclxuICAvKiogVGhlIGhhbmRsZXIgdG8gaW52b2tlIHdoZW4gcm91dGUgaGFuZGxlcnMgdGhyb3cgYW4gZXJyb3IuICovXHJcbiAgb25FcnJvcj86IChlcnJvcjogdW5rbm93bikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcclxuXHJcbiAgLyoqIFRoZSBjYWxsYmFjayB3aGljaCBpcyBjYWxsZWQgd2hlbiB0aGUgc2VydmVyIHN0YXJ0ZWQgbGlzdGVuaW5nICovXHJcbiAgb25MaXN0ZW4/OiAocGFyYW1zOiB7IGhvc3RuYW1lOiBzdHJpbmc7IHBvcnQ6IG51bWJlciB9KSA9PiB2b2lkO1xyXG59XHJcblxyXG4vKipcclxuICogQWRkaXRpb25hbCBzZXJ2ZSBsaXN0ZW5lciBvcHRpb25zLlxyXG4gKlxyXG4gKiBAZGVwcmVjYXRlZCBUaGlzIHdpbGwgYmUgcmVtb3ZlZCBpbiAxLjAuMC4gVXNlIHtAbGlua2NvZGUgRGVuby5TZXJ2ZU9wdGlvbnN9IGluc3RlYWQuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZlTGlzdGVuZXJPcHRpb25zIHtcclxuICAvKiogQW4gQWJvcnRTaWduYWwgdG8gY2xvc2UgdGhlIHNlcnZlciBhbmQgYWxsIGNvbm5lY3Rpb25zLiAqL1xyXG4gIHNpZ25hbD86IEFib3J0U2lnbmFsO1xyXG5cclxuICAvKiogVGhlIGhhbmRsZXIgdG8gaW52b2tlIHdoZW4gcm91dGUgaGFuZGxlcnMgdGhyb3cgYW4gZXJyb3IuICovXHJcbiAgb25FcnJvcj86IChlcnJvcjogdW5rbm93bikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcclxuXHJcbiAgLyoqIFRoZSBjYWxsYmFjayB3aGljaCBpcyBjYWxsZWQgd2hlbiB0aGUgc2VydmVyIHN0YXJ0ZWQgbGlzdGVuaW5nICovXHJcbiAgb25MaXN0ZW4/OiAocGFyYW1zOiB7IGhvc3RuYW1lOiBzdHJpbmc7IHBvcnQ6IG51bWJlciB9KSA9PiB2b2lkO1xyXG59XHJcblxyXG4vKipcclxuICogQ29uc3RydWN0cyBhIHNlcnZlciwgYWNjZXB0cyBpbmNvbWluZyBjb25uZWN0aW9ucyBvbiB0aGUgZ2l2ZW4gbGlzdGVuZXIsIGFuZFxyXG4gKiBoYW5kbGVzIHJlcXVlc3RzIG9uIHRoZXNlIGNvbm5lY3Rpb25zIHdpdGggdGhlIGdpdmVuIGhhbmRsZXIuXHJcbiAqXHJcbiAqIGBgYHRzXHJcbiAqIGltcG9ydCB7IHNlcnZlTGlzdGVuZXIgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gKlxyXG4gKiBjb25zdCBsaXN0ZW5lciA9IERlbm8ubGlzdGVuKHsgcG9ydDogNDUwNSB9KTtcclxuICpcclxuICogY29uc29sZS5sb2coXCJzZXJ2ZXIgbGlzdGVuaW5nIG9uIGh0dHA6Ly9sb2NhbGhvc3Q6NDUwNVwiKTtcclxuICpcclxuICogYXdhaXQgc2VydmVMaXN0ZW5lcihsaXN0ZW5lciwgKHJlcXVlc3QpID0+IHtcclxuICogICBjb25zdCBib2R5ID0gYFlvdXIgdXNlci1hZ2VudCBpczpcXG5cXG4ke3JlcXVlc3QuaGVhZGVycy5nZXQoXHJcbiAqICAgICBcInVzZXItYWdlbnRcIixcclxuICogICApID8/IFwiVW5rbm93blwifWA7XHJcbiAqXHJcbiAqICAgcmV0dXJuIG5ldyBSZXNwb25zZShib2R5LCB7IHN0YXR1czogMjAwIH0pO1xyXG4gKiB9KTtcclxuICogYGBgXHJcbiAqXHJcbiAqIEBwYXJhbSBsaXN0ZW5lciBUaGUgbGlzdGVuZXIgdG8gYWNjZXB0IGNvbm5lY3Rpb25zIGZyb20uXHJcbiAqIEBwYXJhbSBoYW5kbGVyIFRoZSBoYW5kbGVyIGZvciBpbmRpdmlkdWFsIEhUVFAgcmVxdWVzdHMuXHJcbiAqIEBwYXJhbSBvcHRpb25zIE9wdGlvbmFsIHNlcnZlIG9wdGlvbnMuXHJcbiAqXHJcbiAqIEBkZXByZWNhdGVkIFRoaXMgd2lsbCBiZSByZW1vdmVkIGluIDEuMC4wLiBVc2Uge0BsaW5rY29kZSBEZW5vLnNlcnZlfSBpbnN0ZWFkLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlcnZlTGlzdGVuZXIoXHJcbiAgbGlzdGVuZXI6IERlbm8uTGlzdGVuZXIsXHJcbiAgaGFuZGxlcjogSGFuZGxlcixcclxuICBvcHRpb25zPzogU2VydmVMaXN0ZW5lck9wdGlvbnMsXHJcbik6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoeyBoYW5kbGVyLCBvbkVycm9yOiBvcHRpb25zPy5vbkVycm9yIH0pO1xyXG5cclxuICBvcHRpb25zPy5zaWduYWw/LmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCAoKSA9PiBzZXJ2ZXIuY2xvc2UoKSwge1xyXG4gICAgb25jZTogdHJ1ZSxcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIGF3YWl0IHNlcnZlci5zZXJ2ZShsaXN0ZW5lcik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGhvc3RuYW1lRm9yRGlzcGxheShob3N0bmFtZTogc3RyaW5nKSB7XHJcbiAgLy8gSWYgdGhlIGhvc3RuYW1lIGlzIFwiMC4wLjAuMFwiLCB3ZSBkaXNwbGF5IFwibG9jYWxob3N0XCIgaW4gY29uc29sZVxyXG4gIC8vIGJlY2F1c2UgYnJvd3NlcnMgaW4gV2luZG93cyBkb24ndCByZXNvbHZlIFwiMC4wLjAuMFwiLlxyXG4gIC8vIFNlZSB0aGUgZGlzY3Vzc2lvbiBpbiBodHRwczovL2dpdGh1Yi5jb20vZGVub2xhbmQvZGVub19zdGQvaXNzdWVzLzExNjVcclxuICByZXR1cm4gaG9zdG5hbWUgPT09IFwiMC4wLjAuMFwiID8gXCJsb2NhbGhvc3RcIiA6IGhvc3RuYW1lO1xyXG59XHJcblxyXG4vKipcclxuICogU2VydmVzIEhUVFAgcmVxdWVzdHMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cclxuICpcclxuICogWW91IGNhbiBzcGVjaWZ5IGFuIG9iamVjdCB3aXRoIGEgcG9ydCBhbmQgaG9zdG5hbWUgb3B0aW9uLCB3aGljaCBpcyB0aGVcclxuICogYWRkcmVzcyB0byBsaXN0ZW4gb24uIFRoZSBkZWZhdWx0IGlzIHBvcnQgODAwMCBvbiBob3N0bmFtZSBcIjAuMC4wLjBcIi5cclxuICpcclxuICogVGhlIGJlbG93IGV4YW1wbGUgc2VydmVzIHdpdGggdGhlIHBvcnQgODAwMC5cclxuICpcclxuICogYGBgdHNcclxuICogaW1wb3J0IHsgc2VydmUgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gKiBzZXJ2ZSgoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpKTtcclxuICogYGBgXHJcbiAqXHJcbiAqIFlvdSBjYW4gY2hhbmdlIHRoZSBsaXN0ZW5pbmcgYWRkcmVzcyBieSB0aGUgYGhvc3RuYW1lYCBhbmQgYHBvcnRgIG9wdGlvbnMuXHJcbiAqIFRoZSBiZWxvdyBleGFtcGxlIHNlcnZlcyB3aXRoIHRoZSBwb3J0IDMwMDAuXHJcbiAqXHJcbiAqIGBgYHRzXHJcbiAqIGltcG9ydCB7IHNlcnZlIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcclxuICogc2VydmUoKF9yZXEpID0+IG5ldyBSZXNwb25zZShcIkhlbGxvLCB3b3JsZFwiKSwgeyBwb3J0OiAzMDAwIH0pO1xyXG4gKiBgYGBcclxuICpcclxuICogYHNlcnZlYCBmdW5jdGlvbiBwcmludHMgdGhlIG1lc3NhZ2UgYExpc3RlbmluZyBvbiBodHRwOi8vPGhvc3RuYW1lPjo8cG9ydD4vYFxyXG4gKiBvbiBzdGFydC11cCBieSBkZWZhdWx0LiBJZiB5b3UgbGlrZSB0byBjaGFuZ2UgdGhpcyBtZXNzYWdlLCB5b3UgY2FuIHNwZWNpZnlcclxuICogYG9uTGlzdGVuYCBvcHRpb24gdG8gb3ZlcnJpZGUgaXQuXHJcbiAqXHJcbiAqIGBgYHRzXHJcbiAqIGltcG9ydCB7IHNlcnZlIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcclxuICogc2VydmUoKF9yZXEpID0+IG5ldyBSZXNwb25zZShcIkhlbGxvLCB3b3JsZFwiKSwge1xyXG4gKiAgIG9uTGlzdGVuKHsgcG9ydCwgaG9zdG5hbWUgfSkge1xyXG4gKiAgICAgY29uc29sZS5sb2coYFNlcnZlciBzdGFydGVkIGF0IGh0dHA6Ly8ke2hvc3RuYW1lfToke3BvcnR9YCk7XHJcbiAqICAgICAvLyAuLi4gbW9yZSBpbmZvIHNwZWNpZmljIHRvIHlvdXIgc2VydmVyIC4uXHJcbiAqICAgfSxcclxuICogfSk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBZb3UgY2FuIGFsc28gc3BlY2lmeSBgdW5kZWZpbmVkYCBvciBgbnVsbGAgdG8gc3RvcCB0aGUgbG9nZ2luZyBiZWhhdmlvci5cclxuICpcclxuICogYGBgdHNcclxuICogaW1wb3J0IHsgc2VydmUgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gKiBzZXJ2ZSgoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpLCB7IG9uTGlzdGVuOiB1bmRlZmluZWQgfSk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBAcGFyYW0gaGFuZGxlciBUaGUgaGFuZGxlciBmb3IgaW5kaXZpZHVhbCBIVFRQIHJlcXVlc3RzLlxyXG4gKiBAcGFyYW0gb3B0aW9ucyBUaGUgb3B0aW9ucy4gU2VlIGBTZXJ2ZUluaXRgIGRvY3VtZW50YXRpb24gZm9yIGRldGFpbHMuXHJcbiAqXHJcbiAqIEBkZXByZWNhdGVkIFRoaXMgd2lsbCBiZSByZW1vdmVkIGluIDEuMC4wLiBVc2Uge0BsaW5rY29kZSBEZW5vLnNlcnZlfSBpbnN0ZWFkLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlcnZlKFxyXG4gIGhhbmRsZXI6IEhhbmRsZXIsXHJcbiAgb3B0aW9uczogU2VydmVJbml0ID0ge30sXHJcbik6IFByb21pc2U8dm9pZD4ge1xyXG4gIGxldCBwb3J0ID0gb3B0aW9ucy5wb3J0ID8/IDgwMDA7XHJcbiAgaWYgKHR5cGVvZiBwb3J0ICE9PSBcIm51bWJlclwiKSB7XHJcbiAgICBwb3J0ID0gTnVtYmVyKHBvcnQpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgaG9zdG5hbWUgPSBvcHRpb25zLmhvc3RuYW1lID8/IFwiMC4wLjAuMFwiO1xyXG4gIGNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoe1xyXG4gICAgcG9ydCxcclxuICAgIGhvc3RuYW1lLFxyXG4gICAgaGFuZGxlcixcclxuICAgIG9uRXJyb3I6IG9wdGlvbnMub25FcnJvcixcclxuICB9KTtcclxuXHJcbiAgb3B0aW9ucz8uc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgKCkgPT4gc2VydmVyLmNsb3NlKCksIHtcclxuICAgIG9uY2U6IHRydWUsXHJcbiAgfSk7XHJcblxyXG4gIGNvbnN0IGxpc3RlbmVyID0gRGVuby5saXN0ZW4oe1xyXG4gICAgcG9ydCxcclxuICAgIGhvc3RuYW1lLFxyXG4gICAgdHJhbnNwb3J0OiBcInRjcFwiLFxyXG4gIH0pO1xyXG5cclxuICBjb25zdCBzID0gc2VydmVyLnNlcnZlKGxpc3RlbmVyKTtcclxuXHJcbiAgcG9ydCA9IChzZXJ2ZXIuYWRkcnNbMF0gYXMgRGVuby5OZXRBZGRyKS5wb3J0O1xyXG5cclxuICBpZiAoXCJvbkxpc3RlblwiIGluIG9wdGlvbnMpIHtcclxuICAgIG9wdGlvbnMub25MaXN0ZW4/Lih7IHBvcnQsIGhvc3RuYW1lIH0pO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjb25zb2xlLmxvZyhgTGlzdGVuaW5nIG9uIGh0dHA6Ly8ke2hvc3RuYW1lRm9yRGlzcGxheShob3N0bmFtZSl9OiR7cG9ydH0vYCk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gYXdhaXQgcztcclxufVxyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpemF0aW9uIHBhcmFtZXRlcnMgZm9yIHtAbGlua2NvZGUgc2VydmVUbHN9LlxyXG4gKlxyXG4gKiBAZGVwcmVjYXRlZCBUaGlzIHdpbGwgYmUgcmVtb3ZlZCBpbiAxLjAuMC4gVXNlIHtAbGlua2NvZGUgRGVuby5TZXJ2ZVRsc09wdGlvbnN9IGluc3RlYWQuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZlVGxzSW5pdCBleHRlbmRzIFNlcnZlSW5pdCB7XHJcbiAgLyoqIFNlcnZlciBwcml2YXRlIGtleSBpbiBQRU0gZm9ybWF0ICovXHJcbiAga2V5Pzogc3RyaW5nO1xyXG5cclxuICAvKiogQ2VydCBjaGFpbiBpbiBQRU0gZm9ybWF0ICovXHJcbiAgY2VydD86IHN0cmluZztcclxuXHJcbiAgLyoqIFRoZSBwYXRoIHRvIHRoZSBmaWxlIGNvbnRhaW5pbmcgdGhlIFRMUyBwcml2YXRlIGtleS4gKi9cclxuICBrZXlGaWxlPzogc3RyaW5nO1xyXG5cclxuICAvKiogVGhlIHBhdGggdG8gdGhlIGZpbGUgY29udGFpbmluZyB0aGUgVExTIGNlcnRpZmljYXRlICovXHJcbiAgY2VydEZpbGU/OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZXJ2ZXMgSFRUUFMgcmVxdWVzdHMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cclxuICpcclxuICogWW91IG11c3Qgc3BlY2lmeSBga2V5YCBvciBga2V5RmlsZWAgYW5kIGBjZXJ0YCBvciBgY2VydEZpbGVgIG9wdGlvbnMuXHJcbiAqXHJcbiAqIFlvdSBjYW4gc3BlY2lmeSBhbiBvYmplY3Qgd2l0aCBhIHBvcnQgYW5kIGhvc3RuYW1lIG9wdGlvbiwgd2hpY2ggaXMgdGhlXHJcbiAqIGFkZHJlc3MgdG8gbGlzdGVuIG9uLiBUaGUgZGVmYXVsdCBpcyBwb3J0IDg0NDMgb24gaG9zdG5hbWUgXCIwLjAuMC4wXCIuXHJcbiAqXHJcbiAqIFRoZSBiZWxvdyBleGFtcGxlIHNlcnZlcyB3aXRoIHRoZSBkZWZhdWx0IHBvcnQgODQ0My5cclxuICpcclxuICogYGBgdHNcclxuICogaW1wb3J0IHsgc2VydmVUbHMgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gKlxyXG4gKiBjb25zdCBjZXJ0ID0gXCItLS0tLUJFR0lOIENFUlRJRklDQVRFLS0tLS1cXG4uLi5cXG4tLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tXFxuXCI7XHJcbiAqIGNvbnN0IGtleSA9IFwiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXFxuLi4uXFxuLS0tLS1FTkQgUFJJVkFURSBLRVktLS0tLVxcblwiO1xyXG4gKiBzZXJ2ZVRscygoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpLCB7IGNlcnQsIGtleSB9KTtcclxuICpcclxuICogLy8gT3JcclxuICpcclxuICogY29uc3QgY2VydEZpbGUgPSBcIi9wYXRoL3RvL2NlcnRGaWxlLmNydFwiO1xyXG4gKiBjb25zdCBrZXlGaWxlID0gXCIvcGF0aC90by9rZXlGaWxlLmtleVwiO1xyXG4gKiBzZXJ2ZVRscygoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpLCB7IGNlcnRGaWxlLCBrZXlGaWxlIH0pO1xyXG4gKiBgYGBcclxuICpcclxuICogYHNlcnZlVGxzYCBmdW5jdGlvbiBwcmludHMgdGhlIG1lc3NhZ2UgYExpc3RlbmluZyBvbiBodHRwczovLzxob3N0bmFtZT46PHBvcnQ+L2BcclxuICogb24gc3RhcnQtdXAgYnkgZGVmYXVsdC4gSWYgeW91IGxpa2UgdG8gY2hhbmdlIHRoaXMgbWVzc2FnZSwgeW91IGNhbiBzcGVjaWZ5XHJcbiAqIGBvbkxpc3RlbmAgb3B0aW9uIHRvIG92ZXJyaWRlIGl0LlxyXG4gKlxyXG4gKiBgYGB0c1xyXG4gKiBpbXBvcnQgeyBzZXJ2ZVRscyB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XHJcbiAqIGNvbnN0IGNlcnRGaWxlID0gXCIvcGF0aC90by9jZXJ0RmlsZS5jcnRcIjtcclxuICogY29uc3Qga2V5RmlsZSA9IFwiL3BhdGgvdG8va2V5RmlsZS5rZXlcIjtcclxuICogc2VydmVUbHMoKF9yZXEpID0+IG5ldyBSZXNwb25zZShcIkhlbGxvLCB3b3JsZFwiKSwge1xyXG4gKiAgIGNlcnRGaWxlLFxyXG4gKiAgIGtleUZpbGUsXHJcbiAqICAgb25MaXN0ZW4oeyBwb3J0LCBob3N0bmFtZSB9KSB7XHJcbiAqICAgICBjb25zb2xlLmxvZyhgU2VydmVyIHN0YXJ0ZWQgYXQgaHR0cHM6Ly8ke2hvc3RuYW1lfToke3BvcnR9YCk7XHJcbiAqICAgICAvLyAuLi4gbW9yZSBpbmZvIHNwZWNpZmljIHRvIHlvdXIgc2VydmVyIC4uXHJcbiAqICAgfSxcclxuICogfSk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBZb3UgY2FuIGFsc28gc3BlY2lmeSBgdW5kZWZpbmVkYCBvciBgbnVsbGAgdG8gc3RvcCB0aGUgbG9nZ2luZyBiZWhhdmlvci5cclxuICpcclxuICogYGBgdHNcclxuICogaW1wb3J0IHsgc2VydmVUbHMgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xyXG4gKiBjb25zdCBjZXJ0RmlsZSA9IFwiL3BhdGgvdG8vY2VydEZpbGUuY3J0XCI7XHJcbiAqIGNvbnN0IGtleUZpbGUgPSBcIi9wYXRoL3RvL2tleUZpbGUua2V5XCI7XHJcbiAqIHNlcnZlVGxzKChfcmVxKSA9PiBuZXcgUmVzcG9uc2UoXCJIZWxsbywgd29ybGRcIiksIHtcclxuICogICBjZXJ0RmlsZSxcclxuICogICBrZXlGaWxlLFxyXG4gKiAgIG9uTGlzdGVuOiB1bmRlZmluZWQsXHJcbiAqIH0pO1xyXG4gKiBgYGBcclxuICpcclxuICogQHBhcmFtIGhhbmRsZXIgVGhlIGhhbmRsZXIgZm9yIGluZGl2aWR1YWwgSFRUUFMgcmVxdWVzdHMuXHJcbiAqIEBwYXJhbSBvcHRpb25zIFRoZSBvcHRpb25zLiBTZWUgYFNlcnZlVGxzSW5pdGAgZG9jdW1lbnRhdGlvbiBmb3IgZGV0YWlscy5cclxuICogQHJldHVybnNcclxuICpcclxuICogQGRlcHJlY2F0ZWQgVGhpcyB3aWxsIGJlIHJlbW92ZWQgaW4gMS4wLjAuIFVzZSB7QGxpbmtjb2RlIERlbm8uc2VydmV9IGluc3RlYWQuXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VydmVUbHMoXHJcbiAgaGFuZGxlcjogSGFuZGxlcixcclxuICBvcHRpb25zOiBTZXJ2ZVRsc0luaXQsXHJcbik6IFByb21pc2U8dm9pZD4ge1xyXG4gIGlmICghb3B0aW9ucy5rZXkgJiYgIW9wdGlvbnMua2V5RmlsZSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVExTIGNvbmZpZyBpcyBnaXZlbiwgYnV0ICdrZXknIGlzIG1pc3NpbmcuXCIpO1xyXG4gIH1cclxuXHJcbiAgaWYgKCFvcHRpb25zLmNlcnQgJiYgIW9wdGlvbnMuY2VydEZpbGUpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcIlRMUyBjb25maWcgaXMgZ2l2ZW4sIGJ1dCAnY2VydCcgaXMgbWlzc2luZy5cIik7XHJcbiAgfVxyXG5cclxuICBsZXQgcG9ydCA9IG9wdGlvbnMucG9ydCA/PyA4NDQzO1xyXG4gIGlmICh0eXBlb2YgcG9ydCAhPT0gXCJudW1iZXJcIikge1xyXG4gICAgcG9ydCA9IE51bWJlcihwb3J0KTtcclxuICB9XHJcblxyXG4gIGNvbnN0IGhvc3RuYW1lID0gb3B0aW9ucy5ob3N0bmFtZSA/PyBcIjAuMC4wLjBcIjtcclxuICBjb25zdCBzZXJ2ZXIgPSBuZXcgU2VydmVyKHtcclxuICAgIHBvcnQsXHJcbiAgICBob3N0bmFtZSxcclxuICAgIGhhbmRsZXIsXHJcbiAgICBvbkVycm9yOiBvcHRpb25zLm9uRXJyb3IsXHJcbiAgfSk7XHJcblxyXG4gIG9wdGlvbnM/LnNpZ25hbD8uYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsICgpID0+IHNlcnZlci5jbG9zZSgpLCB7XHJcbiAgICBvbmNlOiB0cnVlLFxyXG4gIH0pO1xyXG5cclxuICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLXN5bmMtZm4taW4tYXN5bmMtZm5cclxuICBjb25zdCBrZXkgPSBvcHRpb25zLmtleSB8fCBEZW5vLnJlYWRUZXh0RmlsZVN5bmMob3B0aW9ucy5rZXlGaWxlISk7XHJcbiAgLy8gZGVuby1saW50LWlnbm9yZSBuby1zeW5jLWZuLWluLWFzeW5jLWZuXHJcbiAgY29uc3QgY2VydCA9IG9wdGlvbnMuY2VydCB8fCBEZW5vLnJlYWRUZXh0RmlsZVN5bmMob3B0aW9ucy5jZXJ0RmlsZSEpO1xyXG5cclxuICBjb25zdCBsaXN0ZW5lciA9IERlbm8ubGlzdGVuVGxzKHtcclxuICAgIHBvcnQsXHJcbiAgICBob3N0bmFtZSxcclxuICAgIGNlcnQsXHJcbiAgICBrZXksXHJcbiAgICB0cmFuc3BvcnQ6IFwidGNwXCIsXHJcbiAgICAvLyBBTFBOIHByb3RvY29sIHN1cHBvcnQgbm90IHlldCBzdGFibGUuXHJcbiAgICAvLyBhbHBuUHJvdG9jb2xzOiBbXCJoMlwiLCBcImh0dHAvMS4xXCJdLFxyXG4gIH0pO1xyXG5cclxuICBjb25zdCBzID0gc2VydmVyLnNlcnZlKGxpc3RlbmVyKTtcclxuXHJcbiAgcG9ydCA9IChzZXJ2ZXIuYWRkcnNbMF0gYXMgRGVuby5OZXRBZGRyKS5wb3J0O1xyXG5cclxuICBpZiAoXCJvbkxpc3RlblwiIGluIG9wdGlvbnMpIHtcclxuICAgIG9wdGlvbnMub25MaXN0ZW4/Lih7IHBvcnQsIGhvc3RuYW1lIH0pO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjb25zb2xlLmxvZyhcclxuICAgICAgYExpc3RlbmluZyBvbiBodHRwczovLyR7aG9zdG5hbWVGb3JEaXNwbGF5KGhvc3RuYW1lKX06JHtwb3J0fS9gLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBhd2FpdCBzO1xyXG59XHJcblxyIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLDBFQUEwRTtBQUMxRSxTQUFTLEtBQUssUUFBUSxvQkFBb0I7QUFFMUMsK0NBQStDLEdBQy9DLE1BQU0sc0JBQXNCO0FBRTVCLG1DQUFtQyxHQUNuQyxNQUFNLFlBQVk7QUFFbEIsb0NBQW9DLEdBQ3BDLE1BQU0sYUFBYTtBQUVuQix1RUFBdUUsR0FDdkUsTUFBTSwrQkFBK0I7QUFFckMsa0VBQWtFLEdBQ2xFLE1BQU0sMkJBQTJCO0FBOENqQzs7OztDQUlDLEdBQ0QsT0FBTyxNQUFNO0VBQ1gsQ0FBQSxJQUFLLENBQVU7RUFDZixDQUFBLElBQUssQ0FBVTtFQUNmLENBQUEsT0FBUSxDQUFVO0VBQ2xCLENBQUEsTUFBTyxHQUFHLE1BQU07RUFDaEIsQ0FBQSxTQUFVLEdBQXVCLElBQUksTUFBTTtFQUMzQyxDQUFBLGlDQUFrQyxHQUFHLElBQUksa0JBQWtCO0VBQzNELENBQUEsZUFBZ0IsR0FBdUIsSUFBSSxNQUFNO0VBQ2pELENBQUEsT0FBUSxDQUFtRDtFQUUzRDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CQyxHQUNELFlBQVksVUFBc0IsQ0FBRTtJQUNsQyxJQUFJLENBQUMsQ0FBQSxJQUFLLEdBQUcsV0FBVyxJQUFJO0lBQzVCLElBQUksQ0FBQyxDQUFBLElBQUssR0FBRyxXQUFXLFFBQVE7SUFDaEMsSUFBSSxDQUFDLENBQUEsT0FBUSxHQUFHLFdBQVcsT0FBTztJQUNsQyxJQUFJLENBQUMsQ0FBQSxPQUFRLEdBQUcsV0FBVyxPQUFPLElBQ2hDLFNBQVUsS0FBYztNQUN0QixRQUFRLEtBQUssQ0FBQztNQUNkLE9BQU8sSUFBSSxT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
// denoCacheMetadata=18215301348417812746,16142876437217970449