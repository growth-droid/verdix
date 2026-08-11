import { useEffect, useState } from 'react'

/** Reactive CSS media query — re-renders on resize/rotate (unlike a bare window.innerWidth read). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** True below Tailwind's `sm` breakpoint — i.e. phone width. */
export const useIsPhone = () => useMedia('(max-width: 639px)')
