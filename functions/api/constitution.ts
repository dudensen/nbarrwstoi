interface PagesContext {
  request: Request
}

const CONSTITUTION_URL =
  "https://docs.google.com/document/d/e/2PACX-1vR-jSaigrCTjaZm6yib7d9ayeOGHT3BACWAHwCgkU0odU_HYRw1d8cDiv2O8hI6JQ/pub"

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|table)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
  )
}

export const onRequestGet = async (_ctx: PagesContext): Promise<Response> => {
  try {
    const resp = await fetch(CONSTITUTION_URL, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/html,application/xhtml+xml",
      },
    })

    const html = await resp.text()

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: `Constitution fetch failed (${resp.status})` }),
        {
          status: resp.status,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const text = htmlToPlainText(html)

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}