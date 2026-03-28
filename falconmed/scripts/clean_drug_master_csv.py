import argparse
import csv
from pathlib import Path

TARGET_COLUMNS = [
    "drug_code",
    "brand_name",
    "generic_name",
    "strength",
    "dosage_form",
    "package_size",
    "dispense_mode",
    "public_price",
    "pharmacy_price",
    "agent_name",
    "manufacturer_name",
    "upp_scope",
    "included_thiqa_abm",
    "included_basic",
]


def normalize_header(header: str) -> str:
    """Strip, lowercase, remove BOM, collapse spaces/slashes/dashes to underscores."""
    text = (header or "").strip().lower().replace("\ufeff", "")
    # Replace common problematic characters with underscores
    for ch in (" ", "/", "-", "&"):
        text = text.replace(ch, "_")
    # Remove any remaining non-alphanumeric/underscore characters
    text = "".join(c if c.isalnum() or c == "_" else "_" for c in text)
    while "__" in text:
        text = text.replace("__", "_")
    text = text.strip("_")
    return text


def resolve_source_columns(fieldnames):
    normalized_lookup = {}
    for original in fieldnames or []:
        normalized_lookup[normalize_header(original)] = original

    candidates = {
        "drug_code":          ["drug_code", "drugcode"],
        "brand_name":         ["brand_name", "brandname"],
        "generic_name":       ["generic_name", "genericname"],
        "strength":           ["strength"],
        "dosage_form":        ["dosage_form", "dosageform"],
        "package_size":       ["package_size", "packagesize"],
        "dispense_mode":      ["dispense_mode", "dispensemode"],
        "public_price":       ["public_price", "publicprice"],
        "pharmacy_price":     ["pharmacy_price", "pharmacyprice"],
        "agent_name":         ["agent_name", "agentname"],
        "manufacturer_name":  ["manufacturer_name", "manufacturername"],
        "upp_scope":          ["upp_scope", "uppscope"],
        # Matches "Included in Thiqa/ ABM - other than 1&7- Drug Formulary"
        # normalized → "included_in_thiqa_abm_other_than_1_7_drug_formulary"
        "included_thiqa_abm": [
            "included_in_thiqa_abm_other_than_1_7_drug_formulary",
            "included_thiqa_abm",
            "included_in_thiqa",
        ],
        "included_basic":     ["included_basic", "includedbasic"],
    }

    source_map = {}
    for target, options in candidates.items():
        source = None
        for option in options:
            if option in normalized_lookup:
                source = normalized_lookup[option]
                break
        source_map[target] = source

    return source_map


def transform_csv(input_path: Path, output_path: Path):
    with input_path.open("r", encoding="utf-8-sig", newline="") as infile:
        reader = csv.DictReader(infile)
        source_map = resolve_source_columns(reader.fieldnames)

        missing = [key for key, source in source_map.items() if source is None]
        if missing:
            # Print what we actually found so the user can debug
            print("Available normalized headers:")
            for original in (reader.fieldnames or []):
                print(f"  '{original}' -> '{normalize_header(original)}'")
            raise ValueError("Missing source columns for: " + ", ".join(missing))

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8", newline="") as outfile:
            writer = csv.DictWriter(outfile, fieldnames=TARGET_COLUMNS)
            writer.writeheader()

            for row in reader:
                cleaned_row = {
                    target: (row.get(source_map[target], "") or "").strip()
                    for target in TARGET_COLUMNS
                }
                writer.writerow(cleaned_row)

    return source_map


def main():
    parser = argparse.ArgumentParser(description="Clean drugs master CSV for Supabase import")
    parser.add_argument(
        "--input",
        default="src/data/drugs_master.csv",
        help="Input CSV path",
    )
    parser.add_argument(
        "--output",
        default="drug_master_clean.csv",
        help="Output cleaned CSV path",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    source_map = transform_csv(input_path, output_path)

    print("Created:", output_path)
    print("Column mapping:")
    for target in TARGET_COLUMNS:
        print(f"  {source_map[target]} -> {target}")


if __name__ == "__main__":
    main()
