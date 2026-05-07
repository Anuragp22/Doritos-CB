"""Modal headless training function for Qwen2-VL LoRA fine-tuning.

Trains a LoRA adapter with LLaMA-Factory on a Modal A10G, then merges the
adapter into the base model so the existing inference server can load the
result directly via `MODEL_ID`. Both the training job and `modal_app.py`
share the `doritos-hf-cache` volume, so the merged checkpoint is immediately
visible to the inference deployment without any upload step.

End-to-end workflow
-------------------
1. Push your ShareGPT-format dataset to the dataset volume (one time):

    modal volume put doritos-datasets ./datasets/custard_v1.json /custard_v1.json
    modal volume put doritos-datasets ./datasets/custard_v1_images.zip /custard_v1_images.zip

2. Run training (creates the volume on first call):

    modal run MODEL/train.py \\
        --dataset-name custard_v1 \\
        --json-filename custard_v1.json \\
        --zip-filename custard_v1_images.zip \\
        --epochs 3

3. Point inference at the merged checkpoint and redeploy:

    # In MODEL/modal_app.py, change:
    #   DEFAULT_MODEL_ID = "/root/.cache/huggingface/models/custard_v1"
    modal deploy MODEL/modal_app.py

GPU choice
----------
Default A10G (24 GB) handles 2B LoRA bf16 with batch_size=1, grad_accum=8
comfortably. Switch `gpu="T4"` and pass `--qlora True` for 4-bit QLoRA on
the cheaper T4 if cost matters more than speed.
"""

from pathlib import Path

import modal

APP_NAME = "doritos-ai-trainer"
MODEL_DIR = Path(__file__).resolve().parent
BASE_MODEL = "Qwen/Qwen2-VL-2B-Instruct"
CHECKPOINT_ROOT = "/root/.cache/huggingface/checkpoints"
MERGED_ROOT = "/root/.cache/huggingface/models"

app = modal.App(APP_NAME)

# Shared with modal_app.py — checkpoints saved here are immediately reachable
# from the inference container.
hf_cache = modal.Volume.from_name("doritos-hf-cache", create_if_missing=True)
# Dedicated volume for raw training data (JSON + images zip).
datasets_vol = modal.Volume.from_name("doritos-datasets", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.1",
        "transformers>=4.45",
        "accelerate>=0.34",
        "qwen-vl-utils[decord]>=0.0.8",
        "pillow>=10",
        "llamafactory[torch,metrics]>=0.9.0",
        "pyyaml",
    )
    .add_local_dir(str(MODEL_DIR), "/app")
)


@app.function(
    image=image,
    gpu="A10G",
    volumes={
        "/root/.cache/huggingface": hf_cache,
        "/data": datasets_vol,
    },
    timeout=12 * 60 * 60,
)
def train(
    dataset_name: str,
    json_filename: str,
    zip_filename: str,
    epochs: float = 3.0,
    learning_rate: float = 1.0e-4,
    cutoff_len: int = 2048,
    lora_rank: int = 16,
    qlora: bool = False,
    merge: bool = True,
    output_name: str | None = None,
):
    """Run LoRA SFT on Qwen2-VL and (optionally) merge the adapter.

    Outputs:
      - LoRA adapter at  /root/.cache/huggingface/checkpoints/<output_name>
      - Merged model at  /root/.cache/huggingface/models/<output_name>      (if merge=True)
    """
    import subprocess
    import sys
    from pathlib import Path as P

    import yaml

    sys.path.insert(0, "/app")
    from register_dataset import register_dataset

    output_name = output_name or dataset_name
    data_dir = P("/tmp/lf_data")
    adapter_dir = P(CHECKPOINT_ROOT) / output_name
    merged_dir = P(MERGED_ROOT) / output_name

    print(f"Registering dataset {dataset_name!r} into {data_dir}")
    register_dataset(
        name=dataset_name,
        json_path=P("/data") / json_filename,
        zip_path=P("/data") / zip_filename,
        data_dir=data_dir,
    )

    train_config = {
        "model_name_or_path": BASE_MODEL,
        "stage": "sft",
        "do_train": True,
        "finetuning_type": "lora",
        "lora_target": "all",
        "lora_rank": lora_rank,
        "lora_alpha": lora_rank * 2,
        "dataset": dataset_name,
        "dataset_dir": str(data_dir),
        "template": "qwen2_vl",
        "cutoff_len": cutoff_len,
        "output_dir": str(adapter_dir),
        "per_device_train_batch_size": 1,
        "gradient_accumulation_steps": 8,
        "learning_rate": learning_rate,
        "num_train_epochs": epochs,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.1,
        "bf16": True,
        "logging_steps": 10,
        "save_steps": 200,
        "plot_loss": True,
        "overwrite_output_dir": True,
    }
    if qlora:
        train_config["quantization_bit"] = 4

    train_yaml = P("/tmp/train.yaml")
    train_yaml.write_text(yaml.safe_dump(train_config))
    print(f"Starting LoRA SFT -> {adapter_dir}")
    subprocess.run(["llamafactory-cli", "train", str(train_yaml)], check=True)

    if merge:
        merge_config = {
            "model_name_or_path": BASE_MODEL,
            "adapter_name_or_path": str(adapter_dir),
            "template": "qwen2_vl",
            "finetuning_type": "lora",
            "export_dir": str(merged_dir),
            "export_size": 2,
            "export_legacy_format": False,
        }
        merge_yaml = P("/tmp/merge.yaml")
        merge_yaml.write_text(yaml.safe_dump(merge_config))
        print(f"Merging LoRA into base model -> {merged_dir}")
        subprocess.run(["llamafactory-cli", "export", str(merge_yaml)], check=True)

    hf_cache.commit()

    if merge:
        print(f"\nDone. Set MODEL_ID={merged_dir} in modal_app.py and redeploy.")
        return str(merged_dir)
    print(f"\nDone. Adapter at {adapter_dir} (merge it before pointing inference at it).")
    return str(adapter_dir)


@app.local_entrypoint()
def main(
    dataset_name: str,
    json_filename: str,
    zip_filename: str,
    epochs: float = 3.0,
    learning_rate: float = 1.0e-4,
    lora_rank: int = 16,
    qlora: bool = False,
    merge: bool = True,
    output_name: str = "",
):
    result = train.remote(
        dataset_name=dataset_name,
        json_filename=json_filename,
        zip_filename=zip_filename,
        epochs=epochs,
        learning_rate=learning_rate,
        lora_rank=lora_rank,
        qlora=qlora,
        merge=merge,
        output_name=output_name or None,
    )
    print(f"\nCheckpoint path: {result}")
