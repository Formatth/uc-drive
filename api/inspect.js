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

function stripMarkup(value) {
  return value.split("<").map((part, index) => index === 0 ? part : part.slice(part.indexOf(">") + 1)).join(" ");
}

function cleanText(value) {
  return stripMarkup(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function findDownloadLink(html, baseUrl) {
  const anchors = html.split("<a").slice(1);
  for (const part of anchors) {
    const end = part.toLowerCase().indexOf("</a>");
    if (end < 0) continue;
    const anchor = part.slice(0, end);
    if (!/download|unduh/i.test(cleanText(anchor))) continue;
    const match = anchor.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!match) continue;
    try {
      const url = new URL(match[1], baseUrl);
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
    return res.status(400).json({ ok: false, message: "Masukkan link HTTPS dari drive.ucweb.com/s/ yang valid." });
  }

  try {
    const response = await fetch(shareUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0 (compatible; ShareLinkChecker/1.0)" }
    });

    if (response.status >= 300 && response.status < 400) {
      return res.status(200).json({ ok: true, mode: "redirect", message: "UC Drive mengarahkan halaman ke lokasi lain. Buka halaman resmi untuk melanjutkan.", shareUrl });
    }
    if (!response.ok) {
      return res.status(200).json({ ok: true, mode: "unavailable", message: "Halaman UC Drive tidak dapat diperiksa (HTTP " + response.status + ").", shareUrl });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return res.status(200).json({ ok: true, mode: "unavailable", message: "UC Drive tidak mengembalikan halaman HTML yang dapat diperiksa.", shareUrl });
    }

    const html = await response.text();
    const titleStart = html.toLowerCase().indexOf("<title");
    const titleOpenEnd = titleStart >= 0 ? html.indexOf(">", titleStart) : -1;
    const titleEnd = titleOpenEnd >= 0 ? html.toLowerCase().indexOf("</title>", titleOpenEnd) : -1;
    const title = titleEnd > titleOpenEnd ? cleanText(html.slice(titleOpenEnd + 1, titleEnd)) : "Halaman UC Drive";
    const downloadUrl = findDownloadLink(html, shareUrl);

    if (downloadUrl) {
      return res.status(200).json({ ok: true, mode: "download-link", title, message: "Tautan unduhan ditemukan di halaman resmi.", shareUrl, downloadUrl });
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