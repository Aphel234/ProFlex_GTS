const CACHE = "proflex-gts-angebotsmanager-v9-11-0";
const ASSETS = ["./", "./index.html", "./styles.css", "./assets/app.js", "./assets/jszip.min.js", "./assets/xlsx-import-fix.js", "./assets/survey-import.js", "./assets/table-sort.js", "./assets/attendance-check.js", "./favicon.svg", "./manifest.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
