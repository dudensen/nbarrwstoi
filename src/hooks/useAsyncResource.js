import { useEffect, useState } from 'react'

export function useAsyncResource(factory, deps) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError('')
      try {
        const result = await factory()
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Something went wrong')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, deps)

  return { data, loading, error }
}
