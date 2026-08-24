---
name: add-out-of-province-travel
description: Add or update Guangdong-outbound and other out-of-province travel routes in the dapeng-guide static site. Use when asked to add a mainland China destination outside Guangdong, a cross-province itinerary, a long-holiday route, a high-speed-rail or flight-plus-rental plan, or a multi-region road trip, including official research, custom duration templates, transport alternatives, seasonal and weather safeguards, budgets, maps, category integration, and responsive verification.
---

# Add Out Of Province Travel

Add an out-of-province route as a researched, selectable site feature in the `poetry-distance` category.

## Start

1. Resolve the repository root from the current working directory.
2. Read [references/out-of-province-contract.md](references/out-of-province-contract.md) completely.
3. Read `../add-travel-destination/references/project-contract.md` completely for the shared JSON, page, weather, and fallback contracts.
4. Inspect `git status` and preserve user changes.
5. Inspect `chenzhou` for a neighboring-province trip or `inner-mongolia` for a long, multi-region trip. Use the closest route only as a structural reference; do not copy its facts.

## Research

Browse the web because transport schedules, reservations, opening rules, road controls, seasonal closures, and safety advice change.

- Prefer government tourism bureaus, attraction operators, railway and airport operators, meteorological authorities, transport departments, and official booking platforms.
- Verify every operational claim against a current primary source. Record material sources in `researchSources` with today's `checkedAt` date.
- Research the complete journey from Shenzhen: arrival gateway, local transfers, rental or self-drive feasibility, return logistics, and recovery time.
- Verify the route geographically. Avoid backtracking, same-day long transfers plus major attractions, night driving, and optimistic cross-region timing.
- Treat fares, fuel, charging, lodging, and tickets as ranges with an explicit party-size basis.
- Use a real, inspectable destination image and literal alt text. Verify that the image URL loads and is suitable for the actual place.

## Choose The Route Model

Use one of these models, then adapt it to the destination:

- **Neighboring province:** compare direct Shenzhen self-drive with high-speed rail plus local transport or rental. Keep the itinerary regionally compact.
- **Distant province:** compare flight or rail plus segmented rental with full self-drive only when both are credible. Split large provinces into geographic loops and protect transfer days.

Use exactly two selectable durations. Define `durationTemplateIds` when the IDs are not `2d1n` and `3d2n`; format each ID as `<days>d<nights>n`. Put the shorter template first and use it for route-level catalog defaults.

Make the longer plan materially different. Add a distinct region, loop, cultural layer, nature area, or recovery buffer rather than stretching the shorter schedule.

## Implement

1. Add the route to `assets/data/routes.json` with `category: "poetry-distance"`, two duration IDs, sources, bookings, navigable stops, and both templates.
2. Model transport choices explicitly in `departure`, budget rows, intensity text, daily transfers, and practical notes. Do not imply that one map or weather city covers a multi-region journey.
3. Create `routes/<id>.html` from the closest province-outside page and set `data-route-category="poetry-distance"`.
4. Add representative weather guidance to `DESTINATIONS` in `assets/js/common.js`. For large regions, state the representative city's limitation and require per-stop forecasts.
5. Add an accessible static fallback card to `categories/poetry-distance.html`. Do not add a normal destination to the top navigation or the Guangdong-nearby home catalog.
6. Keep booking links, source links, map stops, image alt text, skip behavior, and mobile navigation functional.

Do not duplicate the shared duration renderer, catalog cards, comparison UI, source list, or stop-navigation UI in the page. JSON remains the source of truth.

## Validate

Run the province-outside validator from the repository root:

```powershell
python .agents/skills/add-out-of-province-travel/scripts/validate_out_of_province.py --route <id>
```

Then run:

```powershell
node --check assets/js/common.js
git diff --check
```

Start a local HTTP server and verify the category page plus both duration variants at desktop and 390px mobile width:

- the new fallback card and JSON-rendered card both point to the detail page;
- both duration buttons update facts, day plans, budgets, intensity, sources, and navigation;
- the duration query parameter survives reload;
- transport alternatives are understandable without reading every day;
- multi-region weather limitations and unsafe-weather alternatives are visible;
- maps contain only credible ground segments and the page has no horizontal overflow.

Report unrelated pre-existing failures separately. An unconfigured `__AMAP_KEY__` may trigger the existing map fallback and is not itself a route-template failure.
