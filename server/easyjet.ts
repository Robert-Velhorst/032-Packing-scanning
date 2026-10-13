import { createHash } from 'node:crypto';
import { CARRIER_ADAPTER_VERSION, EASYJET_SOURCE, isCarrierCatalog, type CarrierCatalog } from '../src/carrier-catalog.ts';

const MAX_BYTES = 1500000;
export class SourceUnavailable extends Error {}

/** No scripts, embedded JSON or navigation text can supply an allowance. */
function pageText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ')
    .replace(/&(?:rsquo|lsquo|#39|#8217);/g, "'").replace(/&amp;/g, '&')
    .replace(/&(?:times|#215);/g, 'x').replace(/\s+/g, ' ').trim();
}

function segment(text: string, start: string, end: string): string {
  const offset = text.indexOf(start), endOffset = text.indexOf(end, offset + start.length);
  if (offset < 0 || endOffset < 0 || endOffset - offset > 6000) throw new SourceUnavailable('Carrier page structure changed.');
  return text.slice(offset, endOffset);
}

function dimensions(text: string) {
  const matches = [...text.matchAll(/(?:maximum size(?: of)?|max\.)\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm(?:\s*\(|,\s*)including any handles and wheels\)/gi)];
  if (matches.length !== 1) throw new SourceUnavailable('Carrier dimensions are missing or ambiguous.');
  const sides = matches[0].slice(1).map((value) => Number(value) * 10);
  return { length: sides[0], width: sides[1], height: sides[2] };
}
function weight(text: string) {
  const matches = [...text.matchAll(/(?:Maximum weight|weigh up to)\s*(\d+(?:\.\d+)?)\s*kg\b/gi)];
  if (matches.length !== 1) throw new SourceUnavailable('Carrier weight is missing or ambiguous.');
  return Number(matches[0][1]) * 1000;
}

function count(text: string, kind: 'small' | 'large') {
  const matches = [...text.matchAll(new RegExp(`\\b(One|Two|\\d+)\\s+${kind}\\s+cabin bags?\\b`, 'gi'))];
  if (matches.length !== 1 || matches[0][1].toLowerCase() !== 'one') throw new SourceUnavailable('Carrier piece allowance is missing, changed or ambiguous.');
  return 1;
}

/** Fail closed if any required rule or applicability statement has changed. */
export function parseEasyjet(html: string, retrievedAt: string): CarrierCatalog {
  if (Buffer.byteLength(html) > MAX_BYTES) throw new SourceUnavailable('Carrier page is too large.');
  const text = pageText(html);
  const intro = segment(text, 'Everyone can bring one small under seat cabin bag per person on board for free.', 'Cabin bags explained');
  const small = segment(text, 'All customers can bring on board:', 'Customers who have paid to add a large cabin bag');
  const large = segment(text, 'Customers who have paid to add a large cabin bag', 'Your cabin bag allowance - All customers');
  const benefit = segment(text, 'easyJet Plus members:', 'Your cabin bag allowance - easyJet Plus cardholders');
  const required = [
    [intro, 'maximum number of cabin bags available per person is two'],
    [small, 'One small cabin bag'], [small, 'Needs to fit under the seat in front of you'],
    [large, 'easyJet Plus membership and have booked a large cabin bag'], [large, 'One large cabin bag'],
    [large, 'Needs to fit in an overhead locker'], [large, 'subject to available space'],
    [benefit, 'If you do not book a large cabin bag in advance'], [benefit, 'hold free of charge'],
    [benefit, 'Inclusive Plus Fare'], [benefit, 'Your large cabin bag will be subject to available space on board.'],
    [text, "if you're auto-allocated an Up Front or Extra Legroom seat, your cabin bag allowance will be one small under seat cabin bag."],
  ];
  if (!required.every(([section, phrase]) => section.includes(phrase))) throw new SourceUnavailable('Carrier applicability statements changed.');
  const smallDimensions = dimensions(small), largeDimensions = dimensions(large);
  // Repeated values must agree, rather than accepting the first convenient number.
  const introSmall = segment(intro, 'Everyone can bring', "If you'd also like to bring");
  const introLarge = segment(intro, "If you'd also like to bring", "If you're an easyJet Plus");
  const smallWeight = weight(small), largeWeight = weight(large);
  if (JSON.stringify(smallDimensions) !== JSON.stringify(dimensions(introSmall)) || smallWeight !== weight(introSmall)
    || JSON.stringify(largeDimensions) !== JSON.stringify(dimensions(introLarge))) throw new SourceUnavailable('Carrier page contains conflicting limits.');
  const caveats = 'Outside dimensions include handles and wheels. You must lift and carry the bag yourself. Check your exact booking and operating airline before travel. This adapter excludes hold luggage, infant exceptions, dangerous goods and extra items; it does not verify a booking or guarantee carriage.';
  const catalog: CarrierCatalog = {
    carrier: 'easyJet', sourceUrl: EASYJET_SOURCE, retrievedAt,
    sourceHash: createHash('sha256').update(html).digest('hex'), adapterVersion: CARRIER_ADAPTER_VERSION, staleAfterDays: 7,
    allowances: [
      { id: 'small', title: 'Small under-seat cabin bag', applicability: 'One small under-seat cabin bag per seated passenger, included across fares. Selecting or being allocated an Up Front or Extra Legroom seat alone does not establish a large-bag entitlement.', caveats,
        limits: { maxOuterDimensionsMm: smallDimensions, maxWeightGrams: smallWeight, weightScope: 'per_bag', maxBagCount: count(small, 'small') } },
      { id: 'large-booked', title: 'Large cabin bag added to booking', applicability: 'One large overhead cabin bag in addition to the small bag, only where a large cabin bag is added to this flight booking (paid add-on or easyJet Plus member benefit). Confirm the booked allowance.', caveats,
        limits: { maxOuterDimensionsMm: largeDimensions, maxWeightGrams: largeWeight, weightScope: 'per_bag', maxBagCount: count(large, 'large') } },
      { id: 'large-benefit', title: 'Large bag with Inclusive Plus / unbooked Plus benefit', applicability: 'One large bag in addition to the small bag for Inclusive Plus fare customers or easyJet Plus members without a pre-booked large bag. Cabin carriage is subject to available locker space; the bag may be placed in the hold free of charge.', caveats,
        limits: { maxOuterDimensionsMm: largeDimensions, maxWeightGrams: largeWeight, weightScope: 'per_bag', maxBagCount: count(large, 'large') } },
    ],
  };
  if (!isCarrierCatalog(catalog)) throw new SourceUnavailable('Carrier values are outside the supported schema.');
  return catalog;
}

/** A fixed public URL: no cookies, booking IDs, caller URLs or unrestricted redirects. */
export async function retrieveEasyjet(fetcher: typeof fetch = fetch, now = () => Date.now()): Promise<CarrierCatalog> {
  const signal = AbortSignal.timeout(15000);
  const response = await fetcher(EASYJET_SOURCE, { signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'text/html' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new SourceUnavailable('Official carrier source unavailable.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) { await response.body?.cancel(); throw new SourceUnavailable('Carrier page is too large.'); }
  if (!response.body) throw new SourceUnavailable('Carrier page has no content.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new SourceUnavailable('Carrier page is too large.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  return parseEasyjet(Buffer.concat(chunks).toString('utf8'), new Date(now()).toISOString());
}
