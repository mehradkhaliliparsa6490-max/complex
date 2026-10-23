/* ======================================================
   Service Worker — مدیریت هزینه‌های مجتمع
   نسخه: v3.0.0
   برای: https://mehradkhaliliparsa6490-max.github.io/complex/
   ====================================================== */

const VERSION = 'v3.0.0';
const SHELL_CACHE = `complex-shell-${VERSION}`;
const RUNTIME_CACHE = `complex-runtime-${VERSION}`;

// فایل‌های اصلی که باید همیشه آفلاین در دسترس باشند
const APP_SHELL = [
  './index.html',
  './manifest.json'
];

// آیکون‌ها (جدا کش می‌شوند تا در صورت نبود فایل، نصب SW شکست نخورد)
const ICONS = [
  './icon-192.png',
  './icon-512.png'
];

/* ========== نصب ========== */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      // فایل‌های حیاتی — اگر یکی خطا داد، نصب متوقف می‌شود
      try {
        await cache.addAll(APP_SHELL);
      } catch (err) {
        console.warn('[SW] خطا در کش فایل‌های اصلی:', err);
      }

      // آیکون‌ها — اختیاری، خطا نادیده گرفته می‌شود
      await Promise.all(
        ICONS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] آیکون کش نشد:', url, err);
          })
        )
      );

      // فعال‌سازی فوری SW جدید
      self.skipWaiting();
    })()
  );
});

/* ========== فعال‌سازی ========== */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // پاک‌سازی کش‌های نسخه‌های قدیمی
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );

      // کنترل فوری همه تب‌های باز
      await self.clients.claim();
    })()
  );
});

/* ========== مدیریت درخواست‌ها ========== */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // فقط GET را مدیریت می‌کنیم
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* --- ۱) ناوبری (باز کردن صفحه) — Network First با fallback به کش --- */
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetch(req);
          // به‌روزرسانی کش با نسخه جدید
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, networkRes.clone());
          return networkRes;
        } catch (err) {
          // آفلاین: تلاش برای کش دقیق درخواست
          const exact = await caches.match(req);
          if (exact) return exact;
          // آفلاین: بازگشت به index.html
          const shell =
            (await caches.match('./index.html')) ||
            (await caches.match('./')) ||
            (await caches.match(req, { ignoreSearch: true }));
          if (shell) return shell;
          // آخرین راه‌حل: صفحه‌ای ساده
          return new Response(
            '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>آفلاین</title></head><body style="font-family:Tahoma;text-align:center;padding:40px;"><h2>📴 شما آفلاین هستید</h2><p>برای اولین بار، برنامه را در حالت آنلاین باز کنید.</p></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  /* --- ۲) Google Fonts — Stale While Revalidate --- */
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })()
    );
    return;
  }

  /* --- ۳) فایل‌های همان دامنه — Cache First با به‌روزرسانی در پس‌زمینه --- */
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        // ابتدا از کش (سریع‌ترین)
        const cached = await caches.match(req);
        if (cached) {
          // در پس‌زمینه به‌روزرسانی کن (بدون انتظار)
          fetch(req)
            .then((res) => {
              if (res && res.ok) {
                caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
              }
            })
            .catch(() => {});
          return cached;
        }

        // اگر در کش نبود، از شبکه بگیر
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          // آفلاین: اگر HTML درخواست شده بود، index.html را بده
          if (req.headers.get('accept')?.includes('text/html')) {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
          }
          throw err;
        }
      })()
    );
    return;
  }

  /* --- ۴) سایر دامنه‌ها — Network با fallback به کش --- */
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })()
  );
});

/* ========== پیام‌ها از سمت کلاینت ========== */
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
  if (event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: VERSION });
  }
});