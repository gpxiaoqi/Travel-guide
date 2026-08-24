#!/usr/bin/env python3
"""Validate out-of-province route conventions for dapeng-guide."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


DURATION_RE = re.compile(r"^(?P<days>[1-9]\d*)d(?P<nights>\d+)n$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="Repository root")
    parser.add_argument("--route", help="Validate one out-of-province route ID")
    return parser.parse_args()


def add_error(errors: list[str], message: str) -> None:
    errors.append(message)


def load_data(root: Path) -> dict[str, Any]:
    data_path = root / "assets" / "data" / "routes.json"
    try:
        return json.loads(data_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot parse {data_path}: {exc}") from exc


def run_shared_validator(root: Path, route_id: str | None) -> int:
    validator = (
        root
        / ".agents"
        / "skills"
        / "add-travel-destination"
        / "scripts"
        / "validate_destination.py"
    )
    if not validator.is_file():
        print(f"ERROR: shared validator is missing: {validator}")
        return 1

    command = [sys.executable, str(validator), "--root", str(root)]
    if route_id:
        command.extend(["--route", route_id])
    return subprocess.run(command, check=False).returncode


def validate_duration_pair(
    errors: list[str], route: dict[str, Any], templates: Any
) -> None:
    route_id = route["id"]
    configured_ids = route.get("durationTemplateIds")
    if not isinstance(configured_ids, list) or len(configured_ids) != 2:
        add_error(errors, f"route {route_id}: durationTemplateIds must contain two IDs")
        return
    if not isinstance(templates, list) or len(templates) != 2:
        add_error(errors, f"route {route_id}: exactly two itinerary templates are required")
        return

    template_ids = [item.get("id") for item in templates if isinstance(item, dict)]
    if template_ids != configured_ids:
        add_error(
            errors,
            f"route {route_id}: template order must match durationTemplateIds",
        )

    parsed: list[tuple[int, int]] = []
    for index, template in enumerate(templates):
        if not isinstance(template, dict):
            add_error(errors, f"route {route_id}: template {index + 1} must be an object")
            continue
        template_id = template.get("id")
        match = DURATION_RE.fullmatch(template_id or "")
        if not match:
            add_error(errors, f"route {route_id}: invalid duration ID {template_id}")
            continue
        days = int(match.group("days"))
        nights = int(match.group("nights"))
        parsed.append((days, nights))
        if template.get("days") != days or template.get("nights") != nights:
            add_error(
                errors,
                f"route {route_id} template {template_id}: ID and day/night values differ",
            )
        if nights != days - 1:
            add_error(
                errors,
                f"route {route_id} template {template_id}: nights must equal days - 1",
            )
        if not template.get("sourceRefs"):
            add_error(errors, f"route {route_id} template {template_id}: sourceRefs is empty")

    if len(parsed) == 2 and parsed[0][0] >= parsed[1][0]:
        add_error(errors, f"route {route_id}: shorter template must come first")

    first = templates[0]
    fallback_pairs = {
        "days": first.get("days"),
        "nights": first.get("nights"),
        "durationLabel": first.get("label"),
    }
    for field, expected in fallback_pairs.items():
        if route.get(field) != expected:
            add_error(
                errors,
                f"route {route_id}: route-level {field} must match the shorter template",
            )

    route_budget = route.get("budget", {})
    template_budget = first.get("budget", {})
    if not isinstance(route_budget.get("label"), str) or not route_budget["label"].strip():
        add_error(errors, f"route {route_id}: route-level budget.label is required")
    if route_budget.get("breakdown") != template_budget.get("breakdown"):
        add_error(
            errors,
            f"route {route_id}: route-level budget.breakdown must match the shorter template",
        )

    route_intensity = route.get("intensity", {})
    template_intensity = first.get("intensity", {})
    for field in ("level", "score"):
        if route_intensity.get(field) != template_intensity.get(field):
            add_error(
                errors,
                f"route {route_id}: route-level intensity.{field} must match the shorter template",
            )


def validate_route(
    errors: list[str], root: Path, route: dict[str, Any], data: dict[str, Any]
) -> None:
    route_id = route["id"]
    if route.get("category") != "poetry-distance":
        add_error(errors, f"route {route_id}: category must be poetry-distance")

    validate_duration_pair(
        errors, route, data.get("itineraryTemplates", {}).get(route_id)
    )

    drive = route.get("drive")
    if not isinstance(drive, dict):
        add_error(errors, f"route {route_id}: drive must be an object")
    else:
        for field in ("oneWayHours", "totalKm"):
            value = drive.get(field)
            if not isinstance(value, (int, float)) or value <= 0:
                add_error(errors, f"route {route_id}: drive.{field} must be positive")
        if not isinstance(drive.get("label"), str) or not drive["label"].strip():
            add_error(errors, f"route {route_id}: drive.label is required")

    if not route.get("bookings"):
        add_error(errors, f"route {route_id}: at least one official booking link is required")

    href = route.get("href")
    detail_path = root / href if isinstance(href, str) else root / "__missing__"
    if detail_path.is_file():
        html = detail_path.read_text(encoding="utf-8")
        if not re.search(
            r'<body[^>]*data-route-category=["\']poetry-distance["\']', html
        ):
            add_error(
                errors,
                f"route {route_id}: detail body must identify poetry-distance",
            )

    sources = {
        source.get("id"): source
        for source in data.get("researchSources", [])
        if isinstance(source, dict)
    }
    templates = data.get("itineraryTemplates", {}).get(route_id, [])
    referenced_ids = {
        source_id
        for template in templates
        if isinstance(template, dict)
        for source_id in template.get("sourceRefs", [])
    }
    for source_id in referenced_ids:
        source = sources.get(source_id, {})
        checked_at = source.get("checkedAt")
        if not isinstance(checked_at, str) or not DATE_RE.fullmatch(checked_at):
            add_error(
                errors,
                f"route {route_id}: source {source_id} needs YYYY-MM-DD checkedAt",
            )
        url = source.get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            add_error(errors, f"route {route_id}: source {source_id} needs an HTTPS URL")


def main() -> int:
    args = parse_args()
    root = (args.root or Path(__file__).resolve().parents[4]).resolve()

    shared_status = run_shared_validator(root, args.route)
    try:
        data = load_data(root)
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        return 1

    routes = {
        route.get("id"): route
        for route in data.get("routes", [])
        if isinstance(route, dict) and isinstance(route.get("id"), str)
    }
    if args.route:
        route = routes.get(args.route)
        if route is None:
            print(f"ERROR: requested route does not exist: {args.route}")
            return 1
        selected = [route]
    else:
        selected = [
            route for route in routes.values() if route.get("category") == "poetry-distance"
        ]

    errors: list[str] = []
    if not selected:
        add_error(errors, "no poetry-distance routes found")
    for route in selected:
        validate_route(errors, root, route, data)

    if errors:
        print("Out-of-province validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    if shared_status:
        print("Out-of-province checks passed, but shared validation failed.")
        return shared_status

    scope = f" for {args.route}" if args.route else ""
    print(f"Out-of-province validation passed{scope}: {len(selected)} route(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
