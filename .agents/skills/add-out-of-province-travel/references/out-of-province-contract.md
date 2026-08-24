# Out-Of-Province Route Contract

Read this file before adding or materially changing a route outside Guangdong. It extends the shared destination contract; it does not replace it.

## Existing Reference Routes

- `chenzhou`: neighboring-province pattern. It compares Shenzhen high-speed rail plus a local EV with full EV self-drive and offers `5d4n` and `7d6n`.
- `inner-mongolia`: distant, multi-region pattern. It compares full self-drive with flight plus segmented rentals and offers `20d19n` and `30d29n`.

Use these as bounds, not templates for factual claims. A new route may use other lengths when its geography and transport justify them.

## Catalog And Template Invariants

- Set `route.category` to `poetry-distance`.
- Add `durationTemplateIds` containing exactly two IDs in ascending duration order.
- Format each ID as `<days>d<nights>n`; keep `nights = days - 1` unless the user explicitly requests a different overnight structure and the renderer supports it.
- Keep the two `itineraryTemplates.<id>` entries in the same order as `durationTemplateIds`.
- Mirror the first template's `days`, `nights`, `durationLabel`, budget rows, and intensity level and score into the route-level catalog fields. Route-level budget bounds, a duration-qualified budget label, and a shorter intensity description may add catalog-specific context.
- Give each template four comparable budget rows and at least three timed items per day.
- Keep every template navigation name resolvable to the route-level `navigation` list.

## Transport Model

Start every plan in Shenzhen and account for the whole door-to-door journey.

For a neighboring province, compare credible choices such as:

- direct self-drive, including realistic charging or fuel and rest stops;
- high-speed rail plus local public transport or rental;
- a single transport mode when the alternative is clearly impractical, with the reason stated.

For a distant or geographically large province:

- make arrival and departure gateways explicit;
- define rental pickup, return city, one-way-return risk, and any second rental loop;
- distinguish flight or rail time from ground-driving time;
- protect arrival, return, and long-transfer days from major attraction loads;
- split long self-drive approaches into safe daytime legs and avoid consecutive night driving;
- do not draw flight segments as road routes on the map.

`drive.oneWayHours`, `drive.totalKm`, and `drive.label` describe the ground-travel comparison used by the catalog. Explain mixed-mode nuance in `departure`, summaries, budgets, intensity, and page copy.

## Itinerary Quality

- Group days by geographic area and minimize repeated hotel changes.
- Schedule no more than one demanding outdoor anchor on a long-transfer day.
- Give the longer template a distinct purpose. Suitable additions include another regional loop, a two-day nature section, a culture-focused city, or weather and recovery buffers.
- Do not present optional branches as simultaneous commitments. State which choice replaces which activity.
- Include meals, lodging areas, charging or refueling, and realistic check-in or return logistics where they affect feasibility.

## Research And Sources

Browse current primary sources and add stable entries to `researchSources` for material claims:

- provincial or municipal culture and tourism authorities for official route and safety guidance;
- attraction operators for reservations, closures, ticket channels, and access rules;
- China Railway, airports, airlines, or transport authorities for gateway and transfer facts;
- meteorological, emergency, forestry, traffic, and border authorities for seasonal hazards;
- official rental or charging guidance when a transport plan depends on it.

Use current dates and link to the exact supporting page when possible. Treat social posts and travel-platform summaries as leads, not authority for restrictions or safety. Put all applicable source IDs in each template's `sourceRefs`.

## Weather And Seasonal Safety

The shared weather card accepts one AMap administrative code. For a multi-region route, use a representative gateway city and state clearly that it is only a reference.

Require travelers to check every overnight stop and transfer corridor before departure. Add relevant alternatives or cancellation rules for exposed mountains, grasslands, deserts, islands, forests, snow roads, flood-prone valleys, altitude, wildfire restrictions, and border areas. Never advise entering closed, roadless, protected-core, or restricted zones.

## Budget Basis

Keep the route label as a per-person range, but make each breakdown row's basis explicit, such as `2人`, `每人`, `每车`, or `每晚`. Include:

1. lodging;
2. meals;
3. transport, with modes compared or separated;
4. tickets and activities.

Recalculate all four rows for both durations. Do not obtain the longer estimate by multiplying the shorter total without accounting for transport, extra lodging, and added regions.

## Page Integration

- Create `routes/<id>.html` and set `<body data-route-category="poetry-distance">`.
- Add the route only to the `poetry-distance` category and its no-script fallback catalog.
- Add a matching `DESTINATIONS` weather entry, even when the route spans several weather zones.
- Reuse shared CSS and rendering. Keep page-local HTML as meaningful fallback content.
- Use WGS84 longitude/latitude values in JSON. Let shared code convert them for AMap.
- Use actual destination imagery with descriptive alt text; avoid generic scenery that cannot represent the route.

## Manual Review

The validators cannot prove factual correctness. Manually verify route order, travel time, official links, reservation rules, image loading, map framing, weather limitations, transport-mode clarity, and mobile layout before reporting completion.
