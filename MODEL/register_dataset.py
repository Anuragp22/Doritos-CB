"""Register a ShareGPT-formatted dataset with LLaMA-Factory's dataset_info.json.

Replaces the Gradio dataset registration cell that previously lived in the
training notebooks. Copies the JSON file into the data directory, extracts the
images zip alongside it, and updates dataset_info.json so that
``llamafactory-cli train`` can find it by name.

Example:
    python register_dataset.py custard_v1 \\
        --json ./datasets/custard_v1.json \\
        --zip ./datasets/custard_v1_images.zip \\
        --data-dir ./LLaMA-Factory-main/data
"""

import argparse
import json
import shutil
import zipfile
from pathlib import Path


def register_dataset(name: str, json_path: Path, zip_path: Path, data_dir: Path) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(json_path, data_dir / json_path.name)

    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(data_dir)

    info_path = data_dir / "dataset_info.json"
    info = json.loads(info_path.read_text()) if info_path.exists() else {}

    info[name] = {
        "file_name": json_path.name,
        "formatting": "sharegpt",
        "columns": {"messages": "messages", "images": "images"},
        "tags": {
            "role_tag": "role",
            "content_tag": "content",
            "user_tag": "user",
            "assistant_tag": "assistant",
        },
    }
    info_path.write_text(json.dumps(info, indent=4))
    return info_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("name", help="Dataset name to reference in training configs.")
    parser.add_argument("--json", required=True, type=Path, help="ShareGPT-formatted JSON file.")
    parser.add_argument("--zip", required=True, type=Path, help="Images zip archive.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("./data"),
        help="LLaMA-Factory data directory (default: ./data).",
    )
    args = parser.parse_args()

    info_path = register_dataset(args.name, args.json, args.zip, args.data_dir)
    print(f"Registered dataset '{args.name}' -> {info_path}")


if __name__ == "__main__":
    main()
