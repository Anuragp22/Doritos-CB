# MODEL

Local Python services that back the Doritos AI chat experience. Replaces the
Kaggle/Colab notebooks that previously lived at the repo root.

## Offline mode (default)

The app runs fully offline on CPU. `docker compose up --build` starts:

- `ollama` — generation runtime; `ollama-pull` pulls `GEN_MODEL` (default
  `qwen3.5:2b`) on first start. The first pull needs internet (~2 GB) and is
  cached in the `ollama_data` volume afterward.
- `model` — `server.py` with `ENABLE_GENERATION=false`: it skips the VLM and
  serves only `/embed` and `/rerank` on CPU.

Generation is slow on CPU (~6–10 tok/s); a 2B model is the sweet spot. Swap it
with `GEN_MODEL` (e.g. `gemma4:e2b`).

The Modal/GPU path (`modal_app.py`, `train.py`, and `server.py`'s generation
code) stays in the repo as the dormant cloud alternative.

## Contents

| File | Purpose |
|------|---------|
| `server.py` | FastAPI inference server. Loads a Qwen2-VL checkpoint and exposes `/generate`, `/set_model`, and `/`. |
| `register_dataset.py` | CLI for adding a ShareGPT-formatted dataset to a LLaMA-Factory `data/` directory. |
| `requirements.txt` | Python dependencies for the inference server. |

## Requirements

- Python 3.10+
- A CUDA GPU with >= 8 GB VRAM is recommended for the 2B model. CPU works but is slow.
- For training: clone [LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory) separately and follow its instructions.

## Setup

```bash
cd MODEL
python -m venv .venv
# Windows
.\.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
```

## Running the inference server

```bash
python server.py
```

Defaults bind to `127.0.0.1:5000`. The Express backend points at this via the
`QWEN_API_URL` environment variable; with the defaults you want
`QWEN_API_URL=http://127.0.0.1:5000/generate` in `BACKEND/.env`.

Override with environment variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `MODEL_ID` | `Qwen/Qwen2-VL-2B-Instruct` | HuggingFace repo id or local checkpoint path for the VLM. |
| `EMBED_MODEL_ID` | `BAAI/bge-small-en-v1.5` | Sentence-transformer model for `/embed` (must match the vector(N) DB column). |
| `HOST` | `127.0.0.1` | Bind address. |
| `PORT` | `5000` | Bind port. |

## Endpoints

### `GET /`

Health probe. Returns `{ "status": "running", "model_id": "...", "device": "cuda" | "cpu" }`.

### `POST /generate`

```json
{
  "user_text": "Describe this image.",
  "image_url": "http://127.0.0.1:3000/uploads/file-...png",
  "max_new_tokens": 512
}
```

Returns:

```json
{ "description": "..." }
```

At least one of `user_text` or `image_url` must be provided. `max_new_tokens` defaults to 512.

### `POST /set_model`

```json
{ "model_id": "./checkpoints/custard_v1" }
```

Reloads the server with a different checkpoint. Accepts a HuggingFace repo id or a local directory path.

### `POST /embed`

```json
{ "inputs": ["first chunk of text", "second chunk"] }
```

Returns L2-normalized 384-dimensional embeddings:

```json
{ "embeddings": [[0.012, -0.054, ...], [0.031, 0.008, ...]] }
```

The default model is `BAAI/bge-small-en-v1.5` (384 dims). Override with the
`EMBED_MODEL_ID` environment variable; the dimension must match the
`vector(N)` column on the database (`DocumentChunk.embedding`).

### `POST /rerank`

```json
{
  "query": "what is the migration freeze date",
  "documents": ["chunk text 1", "chunk text 2", "chunk text 3"],
  "top_k": 5
}
```

Returns the indices and scores of the most relevant documents:

```json
{ "indices": [2, 0, 1], "scores": [4.21, 1.05, -0.34] }
```

Powered by `BAAI/bge-reranker-base` (cross-encoder). Scores are unnormalized
logits — higher is more relevant. Override the model with
`RERANK_MODEL_ID`.

## Registering a training dataset

```bash
python register_dataset.py custard_v1 \
    --json ./datasets/custard_v1.json \
    --zip ./datasets/custard_v1_images.zip \
    --data-dir ../LLaMA-Factory-main/data
```

This copies the JSON next to the extracted images and updates
`dataset_info.json` so `llamafactory-cli train` can find the dataset by name.

## Hosting on Modal (serverless GPU)

For cheap pay-per-second GPU hosting, deploy `server.py` to [Modal](https://modal.com)
via the wrapper at `modal_app.py`:

```bash
pip install modal
modal token new                       # one-time auth
modal deploy MODEL/modal_app.py
```

Defaults to `Qwen/Qwen2-VL-2B-Instruct-AWQ` on a T4 GPU with a persistent
HuggingFace cache. Scales to zero when idle. After deploy, Modal prints a URL
you point the Express backend at via `QWEN_API_URL` / `EMBED_API_URL` /
`RERANK_API_URL`.

## Training

### Path A — local Gradio Web UI

Clone LLaMA-Factory and run training with the registered dataset:

```bash
git clone https://github.com/hiyouga/LLaMA-Factory.git
cd LLaMA-Factory
pip install -e ".[torch,metrics]"
llamafactory-cli train \
    --model_name_or_path Qwen/Qwen2-VL-2B-Instruct \
    --dataset custard_v1 \
    --output_dir ./checkpoints/custard_v1 \
    --stage sft \
    --do_train
```

Then point the inference server at the resulting checkpoint:

```bash
MODEL_ID=./LLaMA-Factory/checkpoints/custard_v1 python server.py
```

### Path B — Modal headless training (no local GPU required)

The `train.py` Modal app fine-tunes on a Modal A10G and writes the merged
checkpoint to the same `doritos-hf-cache` volume that `modal_app.py` reads
from, so inference picks up the new weights on the next deploy.

```bash
# 1. Push your ShareGPT-format dataset to the dataset volume (one time):
modal volume put doritos-datasets ./datasets/custard_v1.json /custard_v1.json
modal volume put doritos-datasets ./datasets/custard_v1_images.zip /custard_v1_images.zip

# 2. Run training:
modal run MODEL/train.py \
    --dataset-name custard_v1 \
    --json-filename custard_v1.json \
    --zip-filename custard_v1_images.zip \
    --epochs 3

# 3. Point inference at the merged checkpoint:
#    Edit MODEL/modal_app.py:
#       DEFAULT_MODEL_ID = "/root/.cache/huggingface/models/custard_v1"
#    Then redeploy:
modal deploy MODEL/modal_app.py
```

Defaults: T4 GPU + 4-bit QLoRA + fp16 (~$0.30–0.60 per fine-tune). Pass
`--qlora False` and edit `gpu="T4"` to `gpu="A10G"` in `train.py` if you
specifically need bf16 or the extra speed.
