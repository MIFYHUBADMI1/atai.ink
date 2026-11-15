export interface EmailShellOptions {
  title: string
  preheader: string
  heading: string
  bodyHtml: string
  eyebrow?: string
  footerNote?: string
  footerHtml?: string
  publication?: string
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return character
    }
  })
}

export function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""
  } catch {
    return ""
  }
}

const DARK_MODE_CSS = `
  @media (prefers-color-scheme: dark) {
    .email-page { background-color: #09090b !important; }
    .email-card { background-color: #111115 !important; border-color: #27272a !important; }
    .email-brand { color: #f4f4f5 !important; }
    .email-accent { color: #a5b4fc !important; }
    .email-eyebrow { background-color: #1e1b4b !important; border-color: #312e81 !important; color: #a5b4fc !important; }
    .email-heading { color: #fafafa !important; }
    .email-text { color: #d4d4d8 !important; }
    .email-strong { color: #f4f4f5 !important; }
    .email-muted { color: #a1a1aa !important; }
    .email-faint { color: #71717a !important; }
    .email-link { color: #a5b4fc !important; }
    .email-box { background-color: #18181b !important; border-color: #27272a !important; }
    .email-code-box { background-color: #09090b !important; border-color: #3f3f46 !important; }
    .email-code { color: #c4b5fd !important; }
    .email-footer { background-color: #0c0c0e !important; border-color: #1f1f23 !important; }
    .email-footer-text { color: #71717a !important; }
  }
`

export function renderEmailShell(options: EmailShellOptions): string {
  const publication = options.publication?.trim() || "Atai"
  const eyebrow = options.eyebrow?.trim()

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${escapeHtml(options.title)}</title>
    <!--[if mso]>
    <style type="text/css">
      body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
    </style>
    <![endif]-->
    <style type="text/css">
      body { margin: 0 !important; padding: 0 !important; }
      table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { border: 0; outline: none; text-decoration: none; }
      a { text-decoration: none; }
      ${DARK_MODE_CSS}
    </style>
  </head>
  <body class="email-page" bgcolor="#f4f4f5" style="margin:0;padding:0;background-color:#f4f4f5;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(options.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-page" bgcolor="#f4f4f5" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
            <tr>
              <td class="email-card" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td height="4" bgcolor="#6366f1" class="email-accent-bar" style="background-color:#6366f1;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:28px 32px 0 32px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="36" height="36" bgcolor="#6366f1" style="width:36px;height:36px;background-color:#6366f1;border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:16px;font-weight:800;line-height:36px;">A</td>
                          <td style="padding-left:10px;font-size:16px;font-weight:700;letter-spacing:-0.01em;">
                            <span class="email-brand" style="color:#18181b;">Atai</span><span class="email-accent" style="color:#6366f1;">.ink</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                    ${eyebrow ? `<td align="right" valign="middle" style="padding:28px 32px 0 0;">
                      <span class="email-eyebrow" style="display:inline-block;padding:4px 10px;background-color:#eef2ff;border:1px solid #e0e7ff;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#4f46e5;">${escapeHtml(eyebrow)}</span>
                    </td>` : ""}
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:24px 32px 32px 32px;">
                      <h1 class="email-heading" style="margin:0 0 14px 0;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#18181b;">${escapeHtml(options.heading)}</h1>
                      ${options.bodyHtml}
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="email-footer" bgcolor="#fafafa" style="padding:20px 32px;background-color:#fafafa;border-top:1px solid #e4e4e7;">
                      <p class="email-footer-text" style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">&copy; 2026 ${escapeHtml(publication)} &middot; Your business. Your AI teams.</p>
                      ${options.footerNote ? `<p class="email-footer-text" style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:#71717a;">${escapeHtml(options.footerNote)}</p>` : ""}
                      ${options.footerHtml ?? ""}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function emailParagraph(html: string): string {
  return `<p class="email-text" style="margin:0 0 18px 0;font-size:15px;line-height:1.7;color:#3f3f46;">${html}</p>`
}

export function emailStrong(value: string): string {
  return `<strong class="email-strong" style="color:#18181b;font-weight:700;">${escapeHtml(value)}</strong>`
}

export function emailButton(href: string, label: string): string {
  const safeHref = safeHttpUrl(href)
  if (!safeHref) return emailParagraph(escapeHtml(label))
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;">
    <tr>
      <td align="center" bgcolor="#6366f1" style="border-radius:10px;background-color:#6366f1;">
        <a href="${escapeHtml(safeHref)}" class="email-btn" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
  <p class="email-faint" style="margin:0 0 20px 0;font-size:12px;line-height:1.6;color:#71717a;word-break:break-all;">If the button does not work, paste this link into your browser:<br /><a href="${escapeHtml(safeHref)}" class="email-link" style="color:#4f46e5;word-break:break-all;">${escapeHtml(safeHref)}</a></p>`
}

export function emailCodeBlock(value: string, label = "Verification code"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
    <tr>
      <td class="email-code-box" bgcolor="#f4f4f5" style="background-color:#f4f4f5;border:1px solid #e4e4e7;border-top:2px solid #6366f1;border-radius:12px;padding:20px 16px;text-align:center;">
        <div class="email-faint" style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">${escapeHtml(label)}</div>
        <div class="email-code" style="font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:6px;line-height:1.2;color:#4f46e5;word-break:break-all;">${escapeHtml(value)}</div>
      </td>
    </tr>
  </table>`
}

export function emailNote(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
    <tr>
      <td class="email-box email-muted" bgcolor="#f8fafc" style="background-color:#f8fafc;border:1px solid #e4e4e7;border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;color:#52525b;">${html}</td>
    </tr>
  </table>`
}

export function emailMetaTable(rows: Array<{ label: string; value: string }>): string {
  const body = rows
    .map((row, index) => {
      const border = index < rows.length - 1 ? "border-bottom:1px solid #e4e4e7;" : ""
      return `<tr>
        <td class="email-faint" style="padding:12px 16px;${border}font-size:12px;line-height:1.5;color:#71717a;">${escapeHtml(row.label)}</td>
        <td align="right" class="email-strong" style="padding:12px 16px;${border}font-size:12px;line-height:1.5;font-weight:600;color:#27272a;">${escapeHtml(row.value)}</td>
      </tr>`
    })
    .join("")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-box" bgcolor="#f8fafc" style="margin:0 0 20px 0;background-color:#f8fafc;border:1px solid #e4e4e7;border-radius:12px;">
    ${body}
  </table>`
}

export function emailFooterLink(href: string, label: string): string {
  const safeHref = safeHttpUrl(href)
  if (!safeHref) return ""
  return `<p class="email-faint" style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:#71717a;"><a href="${escapeHtml(safeHref)}" class="email-link" style="color:#4f46e5;">${escapeHtml(label)}</a></p>`
}
