interface PagesContext {
  request: Request
}

export const onRequestGet = async (_ctx: PagesContext): Promise<Response> => {
  try {
    const resp = await fetch(
      "https://www.fantrax.com/fxea/general/getPlayerIds?sport=NBA",
      {
        headers: {
          accept: "application/json, text/plain, */*",
          "user-agent": "Mozilla/5.0",
        },
      }
    )

    const text = await resp.text()

    return new Response(text, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("content-type") || "application/json",
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