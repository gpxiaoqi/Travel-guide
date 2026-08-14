#!/usr/bin/env python3
"""Validate destination data and page integration for dapeng-guide."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


REQUIRED_ROUTE_FIELDS = {
    "id", "category", "href", "shortTitle", "title", "summary", "image", "imageAlt",
    "days", "nights", "durationLabel", "departure", "drive", "budget",
    "intensity", "bestFor", "themes", "verifiedAt", "verificationNote",
    "bookings", "navigation",
}
REQUIRED_TEMPLATE_IDS = {"2d1n", "3d2n"}
FIXED_ROUTE_IDS = {"wuyi"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="Repository root")
    parser.add_argument("--route", help="Validate one route ID plus global contracts")
    return parser.parse_args()


def add_error(errors: list[str], message: str) -> None:
    errors.append(message)


def require_keys(
    errors: list[str], value: dict[str, Any], keys: set[str], label: str
) -> None:
    missing = sorted(keys - value.keys())
    if missing:
        add_error(errors, f"{label}: missing keys {', '.join(missing)}")


def extract_nav(html: str) -> str:
    match = re.search(r'<div class="nav-links"[^>]*>(.*?)</div>', html, re.S)
    return match.group(1) if match else ""


def validate_template(
    errors: list[str],
    route_id: str,
    template: dict[str, Any],
    source_ids: set[str],
    navigation_names: set[str],
) -> None:
    template_id = template.get("id", "unknown")
    label = f"route {route_id} template {template_id}"
    require_keys(
        errors,
        template,
        {
            "id", "label", "days", "nights", "title", "summary", "budget",
            "intensity", "sourceRefs", "navigation", "dayPlans",
        },
        label,
    )

    days = template.get("days")
    plans = template.get("dayPlans", [])
    if not isinstance(days, int) or not isinstance(plans, list) or len(plans) != days:
        add_error(errors, f"{label}: dayPlans length must equal days")
    else:
        numbers = [plan.get("day") for plan in plans if isinstance(plan, dict)]
        if numbers != list(range(1, days + 1)):
            add_error(errors, f"{label}: dayPlans must be sequential from 1")
        for day_index, plan in enumerate(plans, start=1):
            items = plan.get("items", []) if isinstance(plan, dict) else []
            if not isinstance(items, list) or len(items) < 3:
                add_error(errors, f"{label}: day {day_index} needs at least three timed items")

    breakdown = template.get("budget", {}).get("breakdown", [])
    if not isinstance(breakdown, list) or len(breakdown) != 4:
        add_error(errors, f"{label}: budget breakdown must contain four rows")

    unknown_sources = sorted(set(template.get("sourceRefs", [])) - source_ids)
    if unknown_sources:
        add_error(errors, f"{label}: unknown source refs {', '.join(unknown_sources)}")

    for stop in template.get("navigation", []):
        if isinstance(stop, dict) and stop.get("name") not in navigation_names:
            add_error(
                errors,
                f"{label}: route-level navigation does not define {stop.get('name')}",
            )


def main() -> int:
    args = parse_args()
    root = (args.root or Path(__file__).resolve().parents[4]).resolve()
    data_path = root / "assets" / "data" / "routes.json"
    common_path = root / "assets" / "js" / "common.js"
    index_path = root / "index.html"
    errors: list[str] = []

    for path in (data_path, common_path, index_path):
        if not path.is_file():
            add_error(errors, f"Missing project file: {path}")
    if errors:
        print("\n".join(f"ERROR: {item}" for item in errors))
        return 1

    try:
        data = json.loads(data_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot parse {data_path}: {exc}")
        return 1

    routes = data.get("routes")
    if not isinstance(routes, list) or not routes:
        print("ERROR: routes must be a non-empty array")
        return 1

    categories = data.get("categories", [])
    category_ids = {
        item.get("id") for item in categories if isinstance(item, dict)
    }
    if not categories or len(category_ids) != len(categories) or None in category_ids:
        add_error(errors, "categories must be non-empty with unique IDs")

    route_by_id: dict[str, dict[str, Any]] = {}
    for index, route in enumerate(routes):
        if not isinstance(route, dict):
            add_error(errors, f"routes[{index}] must be an object")
            continue
        require_keys(errors, route, REQUIRED_ROUTE_FIELDS, f"routes[{index}]")
        route_id = route.get("id")
        if not isinstance(route_id, str) or not re.fullmatch(
            r"[a-z0-9]+(?:-[a-z0-9]+)*", route_id
        ):
            add_error(errors, f"routes[{index}].id must be lowercase and hyphen-safe")
            continue
        if route_id in route_by_id:
            add_error(errors, f"Duplicate route ID: {route_id}")
        route_by_id[route_id] = route
        if route.get("category") not in category_ids:
            add_error(errors, f"route {route_id}: unknown category {route.get('category')}")

    if args.route and args.route not in route_by_id:
        add_error(errors, f"Requested route does not exist: {args.route}")

    sources = data.get("researchSources", [])
    source_ids = {item.get("id") for item in sources if isinstance(item, dict)}
    if len(source_ids) != len(sources) or None in source_ids:
        add_error(errors, "researchSources IDs must be present and unique")
    templates_by_route = data.get("itineraryTemplates", {})

    common_js = common_path.read_text(encoding="utf-8")
    weather_match = re.search(
        r"const DESTINATIONS = \{(.*?)\n  \};\n\n  const RAIN_WORDS",
        common_js,
        re.S,
    )
    weather_block = weather_match.group(1) if weather_match else ""
    if not weather_block:
        add_error(errors, "Cannot locate the DESTINATIONS weather configuration")
    if re.search(r"data\.routes\.length\s*!==\s*\d+", common_js):
        add_error(errors, "common.js hard-codes an exact route count")

    category_paths = sorted((root / "categories").glob("*.html"))
    route_paths = sorted((root / "routes").glob("*.html"))
    html_paths = [index_path, *category_paths, *route_paths]
    index_html = index_path.read_text(encoding="utf-8")
    featured_categories = set(
        re.findall(r'id="route-catalog"[^>]*data-category="([^"]+)"', index_html)
    )

    for category_id in category_ids:
        category_path = root / "categories" / f"{category_id}.html"
        if not category_path.is_file():
            add_error(errors, f"category {category_id}: missing category page")
        for html_path in html_paths:
            nav = extract_nav(html_path.read_text(encoding="utf-8"))
            if html_path == index_path:
                target = f"categories/{category_id}.html"
            elif html_path.parent.name == "categories":
                target = f"{category_id}.html"
            else:
                target = f"../categories/{category_id}.html"
            if f'href="{target}"' not in nav:
                add_error(
                    errors,
                    f"category {category_id}: navigation link missing from {html_path.relative_to(root)}",
                )

    selected_ids = [args.route] if args.route in route_by_id else list(route_by_id)

    for route_id in selected_ids:
        route = route_by_id[route_id]
        label = f"route {route_id}"
        href = route.get("href")
        detail_path = root / href if isinstance(href, str) else root / "__missing__"

        if not detail_path.is_file():
            add_error(errors, f"{label}: detail page does not exist at {href}")
        else:
            detail_html = detail_path.read_text(encoding="utf-8")
            hooks = [
                '<main class="container">',
                'class="overview-section"',
                'id="map"',
                '../assets/js/common.js',
            ]
            if route_id not in FIXED_ROUTE_IDS:
                hooks.append('class="itinerary-section"')
            for hook in hooks:
                if hook not in detail_html:
                    add_error(errors, f"{label}: detail page missing hook {hook}")

        navigation = route.get("navigation", [])
        navigation_names: set[str] = set()
        if not isinstance(navigation, list) or not navigation:
            add_error(errors, f"{label}: navigation must be a non-empty array")
        else:
            for stop_index, stop in enumerate(navigation):
                stop_label = f"{label} navigation[{stop_index}]"
                if not isinstance(stop, dict):
                    add_error(errors, f"{stop_label}: must be an object")
                    continue
                for key in ("day", "name", "lng", "lat", "note"):
                    if key not in stop:
                        add_error(errors, f"{stop_label}: missing {key}")
                if isinstance(stop.get("name"), str):
                    navigation_names.add(stop["name"])
                if not isinstance(stop.get("lng"), (int, float)) or not isinstance(
                    stop.get("lat"), (int, float)
                ):
                    add_error(errors, f"{stop_label}: lng and lat must be numeric")

        if route_id not in FIXED_ROUTE_IDS:
            templates = templates_by_route.get(route_id)
            if not isinstance(templates, list):
                add_error(errors, f"{label}: itineraryTemplates entry is required")
                templates = []
            template_ids = {
                item.get("id") for item in templates if isinstance(item, dict)
            }
            configured_template_ids = route.get("durationTemplateIds")
            expected_template_ids = (
                set(configured_template_ids)
                if isinstance(configured_template_ids, list)
                else REQUIRED_TEMPLATE_IDS
            )
            if (
                len(expected_template_ids) != 2
                or template_ids != expected_template_ids
                or len(templates) != 2
            ):
                expected = " and ".join(sorted(expected_template_ids))
                add_error(errors, f"{label}: templates must be exactly {expected}")
            for template in templates:
                if isinstance(template, dict):
                    validate_template(
                        errors, route_id, template, source_ids, navigation_names
                    )

        weather_key = rf"(?:['\"])?{re.escape(route_id)}(?:['\"])?"
        if not re.search(rf"\n\s{{4}}{weather_key}:\s*\{{", weather_block):
            add_error(errors, f"{label}: missing weather configuration in DESTINATIONS")

        category_id = route.get("category")
        category_path = root / "categories" / f"{category_id}.html"
        if category_path.is_file() and isinstance(href, str):
            category_html = category_path.read_text(encoding="utf-8")
            if f'href="../{href}"' not in category_html:
                add_error(errors, f"{label}: fallback link missing from category page")
        if (
            category_id in featured_categories
            and isinstance(href, str)
            and f'href="{href}"' not in index_html
        ):
            add_error(errors, f"{label}: featured home fallback card is missing")

    if errors:
        print("Destination validation failed:")
        for item in errors:
            print(f"- {item}")
        return 1

    suffix = f" for {args.route}" if args.route else ""
    print(f"Destination validation passed{suffix}: {len(routes)} routes available.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
