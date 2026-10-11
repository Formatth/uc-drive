const ALLOWED_HOST = "drive.ucweb.com";

function isValidShareUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === ALLOWED_HOST &&
      url.pathname.startsWith("/s/") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function cleanText(value) {
  return value
    .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, "")
    .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function findDownloadLink(html, baseUrl) {
  const anchors = html.match(/<a\\b[^>]*>[\\s\\S]*?<\\/a>/gi) || [];
  for (const anchor of anchors) {
    const hrefMatch = anchor.match(/\\bhref\\s*=\\s*["']([^"']+)["']/i);
    if (!hrefMatch || !/download|unduh/i.test(cleanText(anchor))) continue;
    try {
      const url = new URL(hrefMatch[1], baseUrl);
      if (url.protocol === "https:" && url.hostname === ALLOWED_HOST) return url.href;
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Gunakan metode POST." });
  }

  const shareUrl = req.body?.url;
  if (typeof shareUrl !== "string" || shareUrl.length > 2048 || !isValidShareUrl(shareUrl)) {
    return res.status(400).json({
      ok: false,
      message: "Masukkan link HTTPS dari drive.ucweb.com/s/ yang valid."
    });
  }

  try {
    const response = await fetch(shareUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Accept": "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; ShareLinkChecker/1.0)"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      return res.status(200).json({
        ok: true, mode: "redirect",
        message: "UC Drive mengarahkan halaman ke lokasi lain. Buka halaman resmi untuk melanjutkan.",
        shareUrl
      });
    }

    if (!response.ok) {
      return res.status(200).json({
        ok: true, mode: "unavailable",
        message: `Halaman UC Drive tidak dapat diperiksa (HTTP ${response.status}). Coba buka halaman resminya secara langsung.`,
        shareUrl
      });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return res.status(200).json({
        ok: true, mode: "unavailable",
        message: "UC Drive tidak mengembalikan halaman HTML yang dapat diperiksa.",
        shareUrl
      });
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : "Halaman UC Drive";
    const downloadUrl = findDownloadLink(html, shareUrl);

    if (downloadUrl) {
      return res.status(200).json({
        ok: true, mode: "download-link", title,
        message: "Tautan unduhan ditemukan di halaman resmi.",
        shareUrl, downloadUrl
      });
    }

    return res.status(200).json({
      ok: true, mode: "app-required-or-dynamic", title,
      message: "Tidak ditemukan tautan unduhan langsung di HTML. Halaman mungkin memerlukan JavaScript, login, atau aplikasi UC Drive.",
      shareUrl
    });
  } catch {
    return res.status(200).json({
      ok: true, mode: "unavailable",
      message: "Halaman UC Drive tidak dapat dijangkau dari server. Kemungkinan ada pembatasan jaringan atau permintaan server.",
      shareUrl
    });
  }
}