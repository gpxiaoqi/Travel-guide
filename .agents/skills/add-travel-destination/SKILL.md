---
name: add-travel-destination
description: Add or update destinations in the dapeng-guide static travel site. Use when asked to add a city, island, scenic area, route section, travel guide page, destination card, or 2-day/3-day itinerary, including current official research, routes.json data, detail-page navigation, weather guidance, budgets, map stops, and responsive verification.
---

# Add Travel Destination

Add a destination as a complete site feature, not an isolated HTML page.

## Start

1. Resolve the repository root from the current working directory.
2. Read [references/project-contract.md](references/project-contract.md) completely before editing.
3. Inspect `git status` and preserve user changes.
4. Inspect one existing destination with similar distance and trip style before choosing content or layout.

## Research

Browse the web because opening rules, reservations, traffic controls, ticketing, and travel advice can change.

- Prefer government, attraction, museum, transport authority, and official ticketing sources.
- Record each material source in `researchSources` with a stable ID, title, publisher, URL, and today's `checkedAt` date.
- Use official sources for restrictions and reservations. Do not turn unverified social posts into operational advice.
- Verify drive time and route order against geography. Avoid repeated cross-city or cross-island travel.
- Treat prices as ranges and state the budget basis. Do not invent exact current ticket prices.
- Include a weather-safe alternative for exposed beaches, mountains, trails, or water activities.

## Model The Destination

Choose a lowercase hyphen-safe route ID and use it consistently in the JSON key, detail filename, links, weather configuration, and URL query parameters.

For a normal destination, add both `2d1n` and `3d2n` templates. Make them meaningfully different:

- Concentrate the two-day plan by geographic area and remove optional detours.
- Use the third day for a distinct district, cultural layer, theme park, nature area, or recovery stop.
- Recalculate lodging, meals, transport, admission ranges, and intensity for each template.
- Keep every template's navigation names resolvable to the route-level `navigation` array.

Keep a route fixed-duration only when the user explicitly requests a holiday special or event itinerary. `wuyi` is the existing fixed-duration exception.

## Implement

Update all applicable surfaces described in the project contract:

1. Add the route, sources, and templates to `assets/data/routes.json`.
2. Create `routes/<id>.html` from the closest existing route page while preserving required hooks.
3. Add destination weather guidance to `DESTINATIONS` in `assets/js/common.js`.
4. Assign the route to a JSON category, add its fallback link to that category page, and add an accessible static fallback card to `index.html` when the category is featured there.
5. Reuse shared CSS and rendering. Add destination-specific CSS only when the existing system cannot express the content.
6. Keep the map, booking links, image alt text, skip link behavior, and mobile navigation functional.

Do not duplicate the selectable-duration renderer in a detail page. The JSON templates are the source of truth.

## Validate

Run the bundled validator from the repository root:

```powershell
python .agents/skills/add-travel-destination/scripts/validate_destination.py --route <id>
```

Then run:

```powershell
node --check assets/js/common.js
git diff --check
```

Start a local HTTP server and use the browser to verify:

- the home card renders from JSON;
- 2-day and 3-day home filters include the new route;
- both duration buttons update the hero, overview, detailed plan, budget, intensity, and navigation;
- `?duration=3d2n` survives reload;
- weather guidance and source links render;
- the page has no horizontal overflow at 390px width;
- the fixed `wuyi` page still has no duration selector.

Report any unrelated pre-existing failure separately. In this repository, an unconfigured `__AMAP_KEY__` can cause the existing map fallback and must not be mistaken for a destination-template failure.
