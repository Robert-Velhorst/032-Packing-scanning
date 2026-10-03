import type { ItemCategory, ItemPriority, LibraryItem, Trip, TripActivity } from './types.ts';

export interface TripSuggestion {
  id: string;
  name: string;
  category: ItemCategory;
  quantity: number;
  priority: ItemPriority;
  accessPriority: number;
  reason: string;
  matchTerms?: string[];
}

const baseSuggestions: TripSuggestion[] = [
  {
    id: 'travel-documents',
    name: 'Travel documents',
    category: 'documents',
    quantity: 1,
    priority: 'preferred',
    accessPriority: 5,
    reason: 'Add the documents you personally need and confirm destination requirements from an official source.',
    matchTerms: ['passport', 'document', 'ticket', 'identity', 'insurance'],
  },
  {
    id: 'phone-charger',
    name: 'Phone and charging cable',
    category: 'electronics',
    quantity: 1,
    priority: 'preferred',
    accessPriority: 5,
    reason: 'A practical reminder; check plug or power needs for your own trip.',
    matchTerms: ['phone', 'charger', 'charging', 'cable', 'power bank', 'adapter'],
  },
  {
    id: 'daily-toiletries',
    name: 'Everyday toiletries',
    category: 'toiletries',
    quantity: 1,
    priority: 'preferred',
    accessPriority: 3,
    reason: 'Use your usual personal-care items and adjust the quantity yourself.',
    matchTerms: ['toiletr', 'toothbrush', 'toothpaste', 'soap', 'shampoo', 'wash bag', 'hygiene'],
  },
];

const activitySuggestions: Record<TripActivity, TripSuggestion[]> = {
  city: [
    {
      id: 'walking-shoes',
      name: 'Comfortable walking shoes',
      category: 'footwear',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected city walking; choose footwear that suits your own plans.',
      matchTerms: ['shoe', 'trainer', 'boot', 'sandal', 'sneaker'],
    },
  ],
  business: [
    {
      id: 'work-outfit',
      name: 'Work-appropriate clothing',
      category: 'clothing',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected a business trip; adjust it to your dress requirements.',
      matchTerms: ['suit', 'blazer', 'formal', 'work shirt', 'office'],
    },
    {
      id: 'work-electronics',
      name: 'Work device and charger',
      category: 'electronics',
      quantity: 1,
      priority: 'optional',
      accessPriority: 4,
      reason: 'Suggested because you selected a business trip.',
      matchTerms: ['laptop', 'computer', 'tablet', 'work device', 'work charger'],
    },
  ],
  beach: [
    {
      id: 'swimwear',
      name: 'Swimwear',
      category: 'clothing',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected a beach activity.',
    },
    {
      id: 'sun-protection',
      name: 'Sun protection',
      category: 'toiletries',
      quantity: 1,
      priority: 'optional',
      accessPriority: 3,
      reason: 'Suggested because you selected a beach activity; check the products and rules relevant to your destination.',
      matchTerms: ['sunscreen', 'sun cream', 'sun hat', 'sunglasses', 'sun protection'],
    },
  ],
  outdoors: [
    {
      id: 'outdoor-layer',
      name: 'Outdoor layer',
      category: 'clothing',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected outdoor activities; choose a layer for the conditions you expect.',
      matchTerms: ['jacket', 'coat', 'rain', 'fleece', 'layer', 'poncho'],
    },
    {
      id: 'outdoor-footwear',
      name: 'Outdoor footwear',
      category: 'footwear',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected outdoor activities.',
      matchTerms: ['shoe', 'trainer', 'boot', 'hiking', 'sandal'],
    },
  ],
  formal_event: [
    {
      id: 'formal-outfit',
      name: 'Formal clothing',
      category: 'clothing',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected a formal event.',
      matchTerms: ['formal', 'suit', 'dress', 'blazer', 'evening'],
    },
  ],
  sports: [
    {
      id: 'sports-clothing',
      name: 'Activity clothing',
      category: 'clothing',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected sports or exercise.',
      matchTerms: ['sportswear', 'activewear', 'workout', 'gym', 'training'],
    },
    {
      id: 'sports-footwear',
      name: 'Activity footwear',
      category: 'footwear',
      quantity: 1,
      priority: 'optional',
      accessPriority: 2,
      reason: 'Suggested because you selected sports or exercise.',
      matchTerms: ['sports shoe', 'trainer', 'sneaker', 'running shoe', 'gym shoe'],
    },
  ],
};

export function tripDurationDays(trip: Pick<Trip, 'startDate' | 'endDate'>): number | undefined {
  if (!trip.startDate || !trip.endDate) return undefined;
  const start = parseDate(trip.startDate);
  const end = parseDate(trip.endDate);
  if (start === undefined || end === undefined || end < start) return undefined;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function buildTripSuggestions(trip: Pick<Trip, 'packingOnly' | 'startDate' | 'endDate' | 'activities' | 'laundryAvailable'>): TripSuggestion[] {
  if (trip.packingOnly) return [];
  const days = tripDurationDays(trip);
  const clothesQuantity = days === undefined ? 1 : Math.max(1, Math.min(days, trip.laundryAvailable ? 4 : 7));
  const clothingReason = days === undefined
    ? 'A starting point only. Add trip dates for a duration-based suggestion, then adjust for re-wearing and your plans.'
    : `A starting point for ${days} ${days === 1 ? 'day' : 'days'}${trip.laundryAvailable ? ' with laundry available' : ''}; adjust for re-wearing and your plans.`;

  const suggestions: TripSuggestion[] = [
    ...baseSuggestions,
    {
      id: 'everyday-clothing',
      name: 'Everyday clothing',
      category: 'clothing',
      quantity: clothesQuantity,
      priority: 'preferred',
      accessPriority: 2,
      reason: clothingReason,
      matchTerms: ['shirt', 'top', 'trouser', 'jean', 'dress', 'underwear', 'sock', 'jacket', 'coat', 'clothing', 'outfit'],
    },
  ];

  const activities = new Set(trip.activities ?? []);
  for (const activity of Object.keys(activitySuggestions) as TripActivity[]) {
    if (activities.has(activity)) suggestions.push(...activitySuggestions[activity]);
  }

  return suggestions;
}

export function matchTripSuggestionItems(suggestion: TripSuggestion, library: LibraryItem[]): LibraryItem[] {
  const terms = suggestion.matchTerms?.map((term) => term.toLocaleLowerCase()) ?? [];
  return library.filter((item) => {
    if (item.category !== suggestion.category) return false;
    if (terms.length === 0) return true;
    const name = item.name.toLocaleLowerCase();
    return terms.some((term) => term.length <= 2 ? new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(name) : name.includes(term));
  });
}

function parseDate(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const checked = new Date(timestamp);
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return undefined;
  return timestamp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
