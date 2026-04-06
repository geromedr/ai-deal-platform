// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
/** Options for {@linkcode delay}. */ /**
 * Resolve a {@linkcode Promise} after a given amount of milliseconds.
 *
 * @example
 * ```ts
 * import { delay } from "https://deno.land/std@$STD_VERSION/async/delay.ts";
 *
 * // ...
 * const delayedPromise = delay(100);
 * const result = await delayedPromise;
 * // ...
 * ```
 *
 * To allow the process to continue to run as long as the timer exists.
 *
 * ```ts
 * import { delay } from "https://deno.land/std@$STD_VERSION/async/delay.ts";
 *
 * // ...
 * await delay(100, { persistent: false });
 * // ...
 * ```
 */ export function delay(ms, options = {}) {
  const { signal, persistent = true } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject)=>{
    const abort = ()=>{
      clearTimeout(i);
      reject(signal?.reason);
    };
    const done = ()=>{
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const i = setTimeout(done, ms);
    signal?.addEventListener("abort", abort, {
      once: true
    });
    if (persistent === false) {
      try {
        // @ts-ignore For browser compatibility
        Deno.unrefTimer(i);
      } catch (error) {
        if (!(error instanceof ReferenceError)) {
          throw error;
        }
        console.error("`persistent` option is only available in Deno");
      }
    }
  });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjIyNC4wL2FzeW5jL2RlbGF5LnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjQgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXHJcbi8vIFRoaXMgbW9kdWxlIGlzIGJyb3dzZXIgY29tcGF0aWJsZS5cclxuXHJcbi8qKiBPcHRpb25zIGZvciB7QGxpbmtjb2RlIGRlbGF5fS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBEZWxheU9wdGlvbnMge1xyXG4gIC8qKiBTaWduYWwgdXNlZCB0byBhYm9ydCB0aGUgZGVsYXkuICovXHJcbiAgc2lnbmFsPzogQWJvcnRTaWduYWw7XHJcbiAgLyoqIEluZGljYXRlcyB3aGV0aGVyIHRoZSBwcm9jZXNzIHNob3VsZCBjb250aW51ZSB0byBydW4gYXMgbG9uZyBhcyB0aGUgdGltZXIgZXhpc3RzLlxyXG4gICAqXHJcbiAgICogQGRlZmF1bHQge3RydWV9XHJcbiAgICovXHJcbiAgcGVyc2lzdGVudD86IGJvb2xlYW47XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSZXNvbHZlIGEge0BsaW5rY29kZSBQcm9taXNlfSBhZnRlciBhIGdpdmVuIGFtb3VudCBvZiBtaWxsaXNlY29uZHMuXHJcbiAqXHJcbiAqIEBleGFtcGxlXHJcbiAqIGBgYHRzXHJcbiAqIGltcG9ydCB7IGRlbGF5IH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vYXN5bmMvZGVsYXkudHNcIjtcclxuICpcclxuICogLy8gLi4uXHJcbiAqIGNvbnN0IGRlbGF5ZWRQcm9taXNlID0gZGVsYXkoMTAwKTtcclxuICogY29uc3QgcmVzdWx0ID0gYXdhaXQgZGVsYXllZFByb21pc2U7XHJcbiAqIC8vIC4uLlxyXG4gKiBgYGBcclxuICpcclxuICogVG8gYWxsb3cgdGhlIHByb2Nlc3MgdG8gY29udGludWUgdG8gcnVuIGFzIGxvbmcgYXMgdGhlIHRpbWVyIGV4aXN0cy5cclxuICpcclxuICogYGBgdHNcclxuICogaW1wb3J0IHsgZGVsYXkgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9hc3luYy9kZWxheS50c1wiO1xyXG4gKlxyXG4gKiAvLyAuLi5cclxuICogYXdhaXQgZGVsYXkoMTAwLCB7IHBlcnNpc3RlbnQ6IGZhbHNlIH0pO1xyXG4gKiAvLyAuLi5cclxuICogYGBgXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZGVsYXkobXM6IG51bWJlciwgb3B0aW9uczogRGVsYXlPcHRpb25zID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCB7IHNpZ25hbCwgcGVyc2lzdGVudCA9IHRydWUgfSA9IG9wdGlvbnM7XHJcbiAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuIFByb21pc2UucmVqZWN0KHNpZ25hbC5yZWFzb24pO1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcclxuICAgICAgY2xlYXJUaW1lb3V0KGkpO1xyXG4gICAgICByZWplY3Qoc2lnbmFsPy5yZWFzb24pO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IGRvbmUgPSAoKSA9PiB7XHJcbiAgICAgIHNpZ25hbD8ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0KTtcclxuICAgICAgcmVzb2x2ZSgpO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IGkgPSBzZXRUaW1lb3V0KGRvbmUsIG1zKTtcclxuICAgIHNpZ25hbD8uYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XHJcbiAgICBpZiAocGVyc2lzdGVudCA9PT0gZmFsc2UpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBAdHMtaWdub3JlIEZvciBicm93c2VyIGNvbXBhdGliaWxpdHlcclxuICAgICAgICBEZW5vLnVucmVmVGltZXIoaSk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBSZWZlcmVuY2VFcnJvcikpIHtcclxuICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmVycm9yKFwiYHBlcnNpc3RlbnRgIG9wdGlvbiBpcyBvbmx5IGF2YWlsYWJsZSBpbiBEZW5vXCIpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSk7XHJcbn1cclxuXHIiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsMEVBQTBFO0FBQzFFLHFDQUFxQztBQUVyQyxtQ0FBbUMsR0FXbkM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0FzQkMsR0FDRCxPQUFPLFNBQVMsTUFBTSxFQUFVLEVBQUUsVUFBd0IsQ0FBQyxDQUFDO0VBQzFELE1BQU0sRUFBRSxNQUFNLEVBQUUsYUFBYSxJQUFJLEVBQUUsR0FBRztFQUN0QyxJQUFJLFFBQVEsU0FBUyxPQUFPLFFBQVEsTUFBTSxDQUFDLE9BQU8sTUFBTTtFQUN4RCxPQUFPLElBQUksUUFBUSxDQUFDLFNBQVM7SUFDM0IsTUFBTSxRQUFRO01BQ1osYUFBYTtNQUNiLE9BQU8sUUFBUTtJQUNqQjtJQUNBLE1BQU0sT0FBTztNQUNYLFFBQVEsb0JBQW9CLFNBQVM7TUFDckM7SUFDRjtJQUNBLE1BQU0sSUFBSSxXQUFXLE1BQU07SUFDM0IsUUFBUSxpQkFBaUIsU0FBUyxPQUFPO01BQUUsTUFBTTtJQUFLO0lBQ3RELElBQUksZUFBZSxPQUFPO01BQ3hCLElBQUk7UUFDRix1Q0FBdUM7UUFDdkMsS0FBSyxVQUFVLENBQUM7TUFDbEIsRUFBRSxPQUFPLE9BQU87UUFDZCxJQUFJLENBQUMsQ0FBQyxpQkFBaUIsY0FBYyxHQUFHO1VBQ3RDLE1BQU07UUFDUjtRQUNBLFFBQVEsS0FBSyxDQUFDO01BQ2hCO0lBQ0Y7RUFDRjtBQUNGIn0=
// denoCacheMetadata=2473327855732019721,3133552459739714849