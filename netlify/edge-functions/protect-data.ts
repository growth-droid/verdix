// Anti-scrape guard for the data + geometry endpoints.
//
// The app fetches /data/*.json and /geo/*.geojson from its OWN origin, so those
// requests carry `Sec-Fetch-Site: same-origin` (modern browsers) and a Referer on
// our own host. A scraper hitting the file directly (curl/wget, a browser address
// bar, or another website hotlinking it) sends neither — we 403 those.
//
// This stops casual + automated scraping and hotlinking. It is NOT absolute: a
// determined actor can drive a real browser on the page or spoof these headers.
// Bulletproof protection requires an authenticated, rate-limited API backend.
import type { Context } from 'https://edge.netlify.com'

export default async (request: Request, context: Context) => {
  const url = new URL(request.url)
  const sfs = (request.headers.get('sec-fetch-site') || '').toLowerCase()
  const referer = request.headers.get('referer') || ''

  const sameSite = sfs === 'same-origin' || sfs === 'same-site'
  const refererOk = referer.startsWith(`${url.origin}/`)

  // Allow only our own app to read the data; block everything else.
  if (sameSite || refererOk) return context.next()

  return new Response('Forbidden — this endpoint is only available to the Verdix app.', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  })
}

export const config = { path: ['/data/*', '/geo/*'] }
