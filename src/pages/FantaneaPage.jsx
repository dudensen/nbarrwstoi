import { useEffect, useMemo, useState } from "react"

const PAGES = [
  "/fantanea/001.webp",
  "/fantanea/002.webp",
  "/fantanea/003.webp",
  "/fantanea/004.webp",
  "/fantanea/005.webp",
  "/fantanea/006.webp",
  "/fantanea/007.webp",
  "/fantanea/008.jpg",
  "/fantanea/009.jpg",
  "/fantanea/010.jpg",
  "/fantanea/011.jpg",
  "/fantanea/012.webp",
  "/fantanea/013.jpg",
  "/fantanea/014.jpg",
  "/fantanea/015.jpg",
  "/fantanea/016.jpg",
  "/fantanea/017.jpg",
  "/fantanea/018.jpg",
  "/fantanea/019.jpg",
  "/fantanea/020.jpg",
  "/fantanea/021.jpg",
  "/fantanea/022.jpg",
  "/fantanea/023.jpg",
]

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < breakpoint
  })

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < breakpoint)
    }

    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [breakpoint])

  return isMobile
}

function PageImage({
  src,
  alt,
  onClick,
  large = false,
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (failed || !src) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "3 / 4.2",
          borderRadius: large ? 20 : 16,
          border: "1px solid #fed7aa",
          background: "linear-gradient(180deg, #fffaf5 0%, #fff7ed 100%)",
          display: "grid",
          placeItems: "center",
          color: "#9a3412",
          fontWeight: 700,
          padding: 20,
          textAlign: "center",
        }}
      >
        Image not found
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onClick={onClick}
      onError={() => setFailed(true)}
      style={{
        width: "100%",
        aspectRatio: "3 / 4.2",
        objectFit: "contain",
        display: "block",
        borderRadius: large ? 20 : 16,
        border: "1px solid #fed7aa",
        background: "#fffdf9",
        boxShadow: large
          ? "0 20px 40px rgba(17,24,39,0.16)"
          : "0 10px 24px rgba(17,24,39,0.08)",
        cursor: onClick ? "zoom-in" : "default",
      }}
    />
  )
}

function Thumbnail({
  src,
  index,
  active,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active ? "2px solid #f97316" : "1px solid #fed7aa",
        background: active ? "#fff7ed" : "#ffffff",
        borderRadius: 14,
        padding: 8,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      aria-label={`Go to page ${index + 1}`}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: active ? "#c2410c" : "#9a3412",
          marginBottom: 8,
        }}
      >
        Page {index + 1}
      </div>

      <div style={{ pointerEvents: "none" }}>
        <PageImage src={src} alt={`Thumbnail page ${index + 1}`} />
      </div>
    </button>
  )
}

export default function FantaneaPage() {
  const isMobile = useIsMobile()
  const [pageIndex, setPageIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const totalPages = PAGES.length

  const safeIndex = clamp(pageIndex, 0, Math.max(totalPages - 1, 0))

  useEffect(() => {
    setPageIndex((current) => clamp(current, 0, Math.max(totalPages - 1, 0)))
  }, [totalPages])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "ArrowRight") {
        event.preventDefault()
        goNext()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        goPrev()
      } else if (event.key === "Escape") {
        setLightboxIndex(null)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  function goPrev() {
    setPageIndex((current) => {
      if (isMobile) return clamp(current - 1, 0, totalPages - 1)
      const next = current - 2
      return clamp(next, 0, totalPages - 1)
    })
  }

  function goNext() {
    setPageIndex((current) => {
      if (isMobile) return clamp(current + 1, 0, totalPages - 1)
      const next = current + 2
      return clamp(next, 0, totalPages - 1)
    })
  }

  function openSpreadAt(index) {
    if (isMobile) {
      setPageIndex(index)
      return
    }

    const spreadStart = index % 2 === 0 ? index : index - 1
    setPageIndex(clamp(spreadStart, 0, totalPages - 1))
  }

  const visiblePages = useMemo(() => {
    if (isMobile) {
      return [
        {
          src: PAGES[safeIndex] || "",
          pageNumber: safeIndex + 1,
          index: safeIndex,
        },
      ]
    }

    return [
      {
        src: PAGES[safeIndex] || "",
        pageNumber: safeIndex + 1,
        index: safeIndex,
      },
      {
        src: PAGES[safeIndex + 1] || "",
        pageNumber: safeIndex + 2,
        index: safeIndex + 1,
      },
    ].filter((item) => item.src)
  }, [isMobile, safeIndex])

  const canGoPrev = safeIndex > 0
  const canGoNext = isMobile
    ? safeIndex < totalPages - 1
    : safeIndex < totalPages - 2

  return (
    <main style={{ maxWidth: 1380, margin: "0 auto", padding: "32px 20px 40px" }}>
      <section
        style={{
          background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
          color: "#ffffff",
          borderRadius: 24,
          padding: "28px 28px 30px",
          marginBottom: 24,
          boxShadow: "0 18px 40px rgba(249,115,22,0.18)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.95,
            marginBottom: 10,
          }}
        >
          Digital Book
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(28px, 4vw, 42px)",
            lineHeight: 1.05,
          }}
        >
          Fantanea
        </h1>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 16,
            opacity: 0.96,
            maxWidth: 820,
            lineHeight: 1.6,
          }}
        >
          A book-style viewer for the Fantanea pages. Use the arrows, click any
          thumbnail to jump, and click a page to view it larger.
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "280px minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <aside
          style={{
            background: "#ffffff",
            border: "1px solid #fed7aa",
            borderRadius: 24,
            padding: 16,
            boxShadow: "0 14px 34px rgba(17,24,39,0.08)",
            position: isMobile ? "static" : "sticky",
            top: 96,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "#f97316",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 10,
            }}
          >
            Contents
          </div>

          <div
            style={{
              fontWeight: 800,
              color: "#111827",
              marginBottom: 14,
            }}
          >
            {totalPages} pages
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
              maxHeight: isMobile ? "none" : "70vh",
              overflow: "auto",
              paddingRight: 4,
            }}
          >
            {PAGES.map((src, index) => {
              const active = isMobile
                ? safeIndex === index
                : (safeIndex === index || safeIndex + 1 === index)

              return (
                <Thumbnail
                  key={`${src}-${index}`}
                  src={src}
                  index={index}
                  active={active}
                  onClick={() => openSpreadAt(index)}
                />
              )
            })}
          </div>
        </aside>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #fed7aa",
            borderRadius: 28,
            padding: isMobile ? 16 : 22,
            boxShadow: "0 14px 34px rgba(17,24,39,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid #fed7aa",
                  background: "#fff7ed",
                  color: "#c2410c",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                {isMobile
                  ? `Page ${safeIndex + 1} / ${totalPages}`
                  : `Pages ${safeIndex + 1}${safeIndex + 1 < totalPages ? `–${Math.min(safeIndex + 2, totalPages)}` : ""} / ${totalPages}`}
              </span>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid #fed7aa",
                  background: "#ffffff",
                  color: "#6b7280",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                {isMobile ? "Single page" : "Two-page spread"}
              </span>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={goPrev}
                disabled={!canGoPrev}
                style={{
                  border: "1px solid #fed7aa",
                  background: canGoPrev ? "#ffffff" : "#f9fafb",
                  color: canGoPrev ? "#111827" : "#9ca3af",
                  borderRadius: 999,
                  padding: "10px 16px",
                  fontWeight: 700,
                  cursor: canGoPrev ? "pointer" : "not-allowed",
                }}
              >
                ← Previous
              </button>

              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext}
                style={{
                  border: "1px solid #fed7aa",
                  background: canGoNext ? "#f97316" : "#fdba74",
                  color: "#ffffff",
                  borderRadius: 999,
                  padding: "10px 16px",
                  fontWeight: 700,
                  cursor: canGoNext ? "pointer" : "not-allowed",
                }}
              >
                Next →
              </button>
            </div>
          </div>

          <div
            style={{
              background:
                "linear-gradient(180deg, #fffaf5 0%, #fff7ed 100%)",
              border: "1px solid #fed7aa",
              borderRadius: 24,
              padding: isMobile ? 14 : 20,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: 16,
                alignItems: "start",
              }}
            >
              {visiblePages.map((page, idx) => (
                <div key={`${page.src}-${page.index}`}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: isMobile
                        ? "center"
                        : idx === 0
                        ? "flex-start"
                        : "flex-end",
                      marginBottom: 10,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "7px 11px",
                        borderRadius: 999,
                        border: "1px solid #fed7aa",
                        background: "#ffffff",
                        color: "#9a3412",
                        fontWeight: 800,
                        fontSize: 13,
                      }}
                    >
                      Page {page.pageNumber}
                    </span>
                  </div>

                  <PageImage
                    src={page.src}
                    alt={`Fantanea page ${page.pageNumber}`}
                    onClick={() => setLightboxIndex(page.index)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {lightboxIndex != null && PAGES[lightboxIndex] ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxIndex(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.78)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1000px, 100%)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                color: "#ffffff",
                marginBottom: 12,
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 800 }}>
                Fantanea · Page {lightboxIndex + 1}
              </div>

              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                style={{
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#ffffff",
                  borderRadius: 999,
                  padding: "10px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Close ✕
              </button>
            </div>

            <PageImage
              src={PAGES[lightboxIndex]}
              alt={`Fantanea enlarged page ${lightboxIndex + 1}`}
              large
            />
          </div>
        </div>
      ) : null}
    </main>
  )
}