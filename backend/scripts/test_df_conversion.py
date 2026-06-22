import json
import sys
from pathlib import Path
from typing import Any, List, Dict

from app.services.dataformatter import format_ads_data


def print_sample_types(records: List[Dict[str, Any]]) -> None:
    if not records:
        print("No records to inspect")
        return
    sample = records[0]
    print("=== SAMPLE KEYS ===")
    print(list(sample.keys())[:30])
    print(f"Total keys: {len(sample.keys())}")

    def t(v: Any):
        return type(v).__name__

    print("=== TYPES ===")
    for key in [
        "clicks",
        "impressions",
        "inline_link_clicks",
        "reach",
        "spend",
        "cpm",
        "ctr",
        "frequency",
        "website_ctr",
        "video_play_curve_actions",
    ]:
        print(f"{key}: {t(sample.get(key))}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m backend.scripts.test_df_conversion <path_to_raw_json>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(1)

    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, list):
        print("Input JSON must be a list of records from Meta insights")
        sys.exit(1)

    df = format_ads_data(raw)
    # Convert back to list of dicts
    records: List[Dict[str, Any]] = df.to_dict("records")

    print("=== CONVERSION RESULT ===")
    print(f"Records: {len(records)}")
    print_sample_types(records)


if __name__ == "__main__":
    main()


