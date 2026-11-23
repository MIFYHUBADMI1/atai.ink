/**
 * Atai product analytics — drop-in collector.
 *
 *   <script defer src="https://atai.ink/atai-analytics.js"
 *           data-atai-key="atai_production_pk_..."></script>
 *
 * Install once, in the head of every page. It reports what visitors actually
 * do — pages, journeys, clicks, where they leave — to the app's own Atai
 * project, so the founder's Growth page can say what to fix.
 *
 * What it never does:
 *   - no cookies, no fingerprint, no IP (the server stores none);
 *   - no input values, no form text, no page content;
 *   - no third-party call: everything goes to the endpoint below;
 *   - nothing at all when the visitor sends Do Not Track, unless the site
 *     owner opts out with data-atai-dnt="ignore".
 *
 * Everything is bounded and best-effort: a failed send is dropped, never
 * retried in a loop, and no error ever escapes into the host page.
 */
(function () {
  "use strict"

  var script = document.currentScript
  if (!script) {
    var all = document.getElementsByTagName("script")
    for (var i = all.length - 1; i >= 0; i--) {
      if (/atai-analytics\.js/.test(all[i].src || "")) {
        script = all[i]
        break
      }
    }
  }
  if (!script) return

  var key = script.getAttribute("data-atai-key")
  if (!key) return

  var dnt = navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || navigator.msDoNotTrack === "1"
  if (dnt && script.getAttribute("data-atai-dnt") !== "ignore") return

  var endpoint = script.getAttribute("data-atai-endpoint") || defaultEndpoint(script.src)
  var BATCH_MS = 5000
  var BATCH_MAX = 20
  var QUEUE_MAX = 200
  var SESSION_IDLE_MS = 30 * 60 * 1000

  var queue = []
  var timer = null
  var session = readSession()
  var pageEnteredAt = now()
  var lastPath = location.pathname
  var pendingReferrer = document.referrer || ""

  function defaultEndpoint(src) {
    try {
      return new URL(src).origin + "/api/analytics/collect"
    } catch (e) {
      return "/api/analytics/collect"
    }
  }

  function now() {
    return Date.now()
  }

  function randomId() {
    var bytes = new Uint8Array(12)
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes)
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    var out = ""
    for (var j = 0; j < bytes.length; j++) out += ("0" + bytes[j].toString(16)).slice(-2)
    return out
  }

  function readStore(kind, name, value) {
    try {
      if (value === undefined) return kind.getItem(name)
      if (value === null) kind.removeItem(name)
      else kind.setItem(name, value)
    } catch (e) {
      /* private mode, disabled storage: fall through to memory */
    }
    return null
  }

  var memoryVisitorId = null

  function visitorId() {
    var id = readStore(localStorage, "atai_vid")
    if (!id) {
      id = memoryVisitorId || randomId()
      memoryVisitorId = id
      readStore(localStorage, "atai_vid", id)
    }
    return id
  }

  function readSession() {
    var raw = readStore(sessionStorage, "atai_sid")
    if (raw) {
      try {
        var parsed = JSON.parse(raw)
        if (parsed && parsed.expiresAt > now()) return parsed
      } catch (e) {
        /* a corrupted value starts a new session, it never breaks the page */
      }
    }
    var fresh = { id: randomId(), expiresAt: now() + SESSION_IDLE_MS }
    readStore(sessionStorage, "atai_sid", JSON.stringify(fresh))
    return fresh
  }

  function touchSession() {
    session.expiresAt = now() + SESSION_IDLE_MS
    readStore(sessionStorage, "atai_sid", JSON.stringify(session))
  }

  function device() {
    var ua = navigator.userAgent || ""
    if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return "tablet"
    if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) return "mobile"
    return "desktop"
  }

  function labelFor(el) {
    var label =
      el.getAttribute("aria-label") || el.getAttribute("data-atai-label") || el.getAttribute("title")
    if (!label) {
      var text = (el.textContent || "").replace(/\s+/g, " ").trim()
      if (text && text.length <= 80) label = text
    }
    if (!label) {
      var tag = (el.tagName || "").toLowerCase()
      var type = el.getAttribute("type")
      label = type ? tag + "[type=" + type + "]" : tag
    }
    return String(label).replace(/\s+/g, " ").trim().slice(0, 80)
  }

  function roleFor(el) {
    var explicit = el.getAttribute("role")
    if (explicit) return explicit
    var tag = (el.tagName || "").toLowerCase()
    if (tag === "a") return "link"
    if (tag === "button") return "button"
    if (tag === "input" || tag === "select" || tag === "textarea") return "field"
    return tag || "element"
  }

  function push(event) {
    if (queue.length >= QUEUE_MAX) return
    event.visitorId = visitorId()
    event.sessionId = session.id
    event.device = device()
    event.timestamp = now()
    queue.push(event)
    if (queue.length >= BATCH_MAX) flush(false)
    else schedule()
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(function () {
      timer = null
      flush(false)
    }, BATCH_MS)
  }

  function pageView() {
    push({
      name: "page_view",
      kind: "page_view",
      path: lastPath,
      referrer: pendingReferrer || undefined,
    })
    pendingReferrer = ""
  }

  function flush(useBeacon) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!queue.length) return
    var events = queue.splice(0, queue.length)
    var payload = JSON.stringify({ key: key, events: events })
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: "text/plain" }))
        return
      }
      fetch(endpoint, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: payload,
      }).catch(function () {})
    } catch (e) {
      /* offline, blocked, beacon quota: the events are gone, never the page */
    }
  }

  function onRouteChange() {
    var next = location.pathname
    if (next === lastPath) return
    var spent = now() - pageEnteredAt
    if (spent > 500) {
      push({ name: "page_leave", kind: "page_leave", path: lastPath, durationMs: spent })
    }
    lastPath = next
    pageEnteredAt = now()
    touchSession()
    pageView()
  }

  function patchHistory() {
    function wrap(name) {
      var original = history[name]
      if (typeof original !== "function") return
      history[name] = function () {
        var result = original.apply(this, arguments)
        setTimeout(onRouteChange, 0)
        return result
      }
    }
    wrap("pushState")
    wrap("replaceState")
    window.addEventListener("popstate", onRouteChange)
  }

  function onClick(event) {
    var target = event.target
    for (var depth = 0; target && depth < 4; depth++) {
      var tag = (target.tagName || "").toLowerCase()
      if (tag === "a" || tag === "button" || tag === "input" || target.getAttribute("role") === "button") {
        var label = labelFor(target)
        if (!label) return
        push({
          name: "click",
          kind: "click",
          path: location.pathname,
          element: { role: roleFor(target), label: label },
        })
        return
      }
      target = target.parentElement
    }
  }

  function onHide() {
    push({ name: "page_leave", kind: "page_leave", path: lastPath, durationMs: now() - pageEnteredAt })
    flush(true)
  }

  try {
    visitorId()
    pageView()
    patchHistory()
    document.addEventListener("click", onClick, true)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") onHide()
    })
    window.addEventListener("pagehide", onHide)
  } catch (e) {
    /* never break the host page */
  }
})()
