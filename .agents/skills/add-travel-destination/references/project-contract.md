# Destination Project Contract

Read this file before adding or materially changing a destination.

## File Map

- `assets/data/routes.json`: catalog metadata, official sources, selectable itinerary templates.
- `assets/js/common.js`: catalog/detail renderers, weather advice, shared navigation, and interactions.
- `assets/css/style.css`: shared visual system and responsive breakpoints.
- `index.html`: navigation, filters, and no-script fallback cards.
- `categories/<id>.html`: category landing page, filtered catalog, and category fallback links.
- `routes/<id>.html`: destination hero, fallback itinerary, map data, food, lodging, and practical advice.

## Route Object

Add one object to `routes` with these required fields:

```json
{
  "id": "destination-id",
  "category": "shenzhen-nearby",
  "href": "routes/destination-id.html",
  "shortTitle": "Short destination title",
  "title": "Destination travel title",
  "summary": "One concise reason to choose this route.",
  "image": "https://...",
  "imageAlt": "Literal description of the destination image",
  "days": 2,
  "nights": 1,
  "durationLabel": "2 days 1 night",
  "departure": "Shenzhen self-drive",
  "drive": { "oneWayHours": 2.5, "totalKm": 400, "label": "About 2.5 hours one way" },
  "budget": {
    "perPersonMin": 800,
    "perPersonMax": 1400,
    "label": "Per person range",
    "breakdown": [
      { "label": "Lodging", "value": "..." },
      { "label": "Meals", "value": "..." },
      { "label": "Transport", "value": "..." },
      { "label": "Tickets and activities", "value": "..." }
    ]
  },
  "intensity": { "level": "Moderate", "score": 3, "description": "Explain walking, driving, transfers, and recovery time." },
  "bestFor": ["Couples", "Families"],
  "themes": ["Coast", "Culture"],
  "verifiedAt": "YYYY-MM-DD",
  "verificationNote": "What can change and must be rechecked.",
  "bookings": [{ "label": "Official booking", "channel": "Publisher", "url": "https://..." }],
  "navigation": [{ "day": "Day 1", "name": "Stop name", "lng": 113.0, "lat": 23.0, "note": "Parking or access note" }]
}
```

Write user-facing values in Simplified Chinese. Keep coordinates numeric and in WGS84 longitude/latitude order because `common.js` converts them for AMap.

The route-level duration, budget, and intensity are catalog fallbacks. Use the two-day values for a normal selectable route.

## Research Sources

Append material sources to `researchSources`:

```json
{
  "id": "destination-topic-year",
  "title": "Source title",
  "publisher": "Official publisher",
  "url": "https://official.example/...",
  "checkedAt": "YYYY-MM-DD"
}
```

Use stable unique IDs. Reference them from every applicable template through `sourceRefs`.

## Selectable Templates

Add `itineraryTemplates.<route-id>` containing exactly `2d1n` and `3d2n` for a normal destination:

```json
[
  {
    "id": "2d1n",
    "label": "2 days 1 night",
    "days": 2,
    "nights": 1,
    "title": "Destination - 2 days 1 night",
    "summary": "How this shorter plan is optimized.",
    "budget": {
      "label": "Per person range",
      "breakdown": [
        { "label": "Lodging", "value": "..." },
        { "label": "Meals", "value": "..." },
        { "label": "Transport", "value": "..." },
        { "label": "Tickets and activities", "value": "..." }
      ]
    },
    "intensity": { "level": "Moderate", "score": 3, "description": "..." },
    "sourceRefs": ["destination-topic-year"],
    "navigation": [{ "day": "Day 1", "name": "Exact route.navigation name" }],
    "dayPlans": [
      {
        "day": 1,
        "title": "Daily theme",
        "summary": "Daily route logic.",
        "items": [
          { "time": "09:00", "title": "Stop or action", "description": "Actionable advice.", "tag": "Category" }
        ]
      }
    ]
  }
]
```

Requirements:

- Set `dayPlans.length` equal to `days` and number days consecutively from 1.
- Include at least three timed items per day.
- Use `2d1n` and `3d2n` exactly; the renderer persists the ID in the `duration` query parameter.
- Provide four budget rows for comparable cards.
- Keep template navigation ordered and ensure every name matches a route-level stop exactly.
- Leave source-only attractions out of template navigation if they have no route-level coordinates.

## Detail Page Hooks

Create `routes/<id>.html` by copying the nearest comparable route and replacing its content. Retain:

- `<html lang="zh-CN">`, UTF-8 and viewport metadata, favicon, Font Awesome, and shared CSS.
- `.nav-bar`, `.nav-brand`, and `.nav-links`.
- `.hero > .container`, `.hero h1`, `.subtitle`, and `.meta-info`.
- `<main class="container">`.
- one `.overview-section` with `.grid-overview` fallback content.
- one `.itinerary-section` with fallback `.day-detail` content.
- a `#map` container and page-local `locations` plus route segments passed to `initMap`.
- `../assets/js/common.js` after page content.

Use descriptive image alt text. Do not add a duration selector to the page; shared code injects it from JSON.

## Weather Contract

Add one entry to `DESTINATIONS` in `assets/js/common.js`:

```js
destinationId: {
  name: 'Display name',
  weatherCity: 'AMap adcode',
  weatherLabel: 'Forecast label',
  sunny: {
    title: 'Sunny-plan title',
    summary: 'Why this route works in fair weather.',
    stops: ['Morning...', 'Afternoon...', 'Evening...'],
    tips: 'Sun, heat, hydration, tide, or parking advice.'
  },
  rainy: {
    title: 'Rain-plan title',
    summary: 'How exposed activities are reduced.',
    stops: ['Morning...', 'Afternoon...', 'Evening...'],
    tips: 'Warnings and cancellation conditions.'
  }
}
```

Use the correct AMap administrative code. Weather advice supplements the duration template; it does not replace it.

## Category, Navigation, And Fallbacks

Set `route.category` to an ID declared in the top-level `categories` array. Use `shenzhen-nearby` for Guangdong routes and `poetry-distance` for routes outside Guangdong unless the user asks for a new category.

Add a static fallback link to the matching category page. Category-page route links use `../routes/<id>.html`. Update the category's displayed route count when it contains a literal count.

The top navigation contains category links, not individual destination links. When adding a new category, add its link to `.nav-links` in `index.html`, every category page, and every route page. Do not add a normal destination to the top navigation.

If the route's category is featured on `index.html`, add a static fallback card to its `#route-catalog`. JavaScript replaces fallback content after loading JSON, but it remains important for no-script and failed-fetch behavior. Show both durations for normal routes.

The live catalog, comparison, decision panels, duration selector, source links, and stop navigation render from `routes.json`. Do not hand-code duplicates of those components.

## Validation Boundary

The validator checks structure, not factual correctness. Manually verify official-source dates, realistic route order, booking URLs, ticket caveats, responsive visuals, weather fallbacks, and map behavior with a valid AMap key.
