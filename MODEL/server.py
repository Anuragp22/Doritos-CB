"""Local FastAPI inference server for the Doritos AI multimodal chat backend.

Loads a Qwen2-VL checkpoint and a sentence-transformer embedding model at
startup and exposes endpoints that match the contract the Express backend
speaks to via QWEN_API_URL and EMBED_API_URL.

Environment variables:
    MODEL_ID        Qwen repo id or local path (default: Qwen/Qwen2-VL-2B-Instruct).
    EMBED_MODEL_ID  Embedding model repo id (default: BAAI/bge-small-en-v1.5; 384 dims).
    HOST            Bind address (default: 127.0.0.1).
    PORT            Bind port (default: 5000).
"""

import os
from contextlib import asynccontextmanager
from typing import List, Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from qwen_vl_utils import process_vision_info
from sentence_transformers import SentenceTransformer
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

DEFAULT_MODEL_ID = os.getenv("MODEL_ID", "Qwen/Qwen2-VL-2B-Instruct")
EMBED_MODEL_ID = os.getenv("EMBED_MODEL_ID", "BAAI/bge-small-en-v1.5")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32

_state: dict = {
    "model": None,
    "processor": None,
    "model_id": None,
    "embed_model": None,
    "embed_model_id": None,
}


def _load_vlm(model_id: str) -> None:
    print(f"Loading VLM from {model_id} on {DEVICE}...")
    _state["model"] = Qwen2VLForConditionalGeneration.from_pretrained(
        model_id,
        torch_dtype=DTYPE,
        device_map="auto" if DEVICE == "cuda" else None,
    )
    _state["processor"] = AutoProcessor.from_pretrained(model_id)
    _state["model_id"] = model_id
    print("VLM ready.")


def _load_embed(model_id: str) -> None:
    print(f"Loading embedding model from {model_id} on {DEVICE}...")
    _state["embed_model"] = SentenceTransformer(model_id, device=DEVICE)
    _state["embed_model_id"] = model_id
    print("Embedding model ready.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        _load_vlm(DEFAULT_MODEL_ID)
    except Exception as exc:
        print(f"VLM load failed; /generate will return 503. Reason: {exc}")
    try:
        _load_embed(EMBED_MODEL_ID)
    except Exception as exc:
        print(f"Embedding load failed; /embed will return 503. Reason: {exc}")
    yield
    _state.clear()


app = FastAPI(title="Doritos AI Inference Server", lifespan=lifespan)


class GenerateRequest(BaseModel):
    user_text: Optional[str] = None
    image_url: Optional[str] = None
    max_new_tokens: int = 512


class GenerateResponse(BaseModel):
    description: str


class SetModelRequest(BaseModel):
    model_id: str


class EmbedRequest(BaseModel):
    inputs: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]


@app.get("/")
def health() -> dict:
    return {
        "status": "running",
        "model_id": _state["model_id"],
        "embed_model_id": _state["embed_model_id"],
        "device": DEVICE,
    }


@app.post("/set_model")
def set_model(req: SetModelRequest) -> dict:
    _load_vlm(req.model_id)
    return {"message": f"Model loaded: {req.model_id}"}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    if not req.user_text and not req.image_url:
        raise HTTPException(400, "Provide at least one of user_text or image_url.")
    if _state["model"] is None or _state["processor"] is None:
        raise HTTPException(503, "VLM not loaded.")

    content: List[dict] = []
    if req.image_url:
        content.append({"type": "image", "image": req.image_url})
    if req.user_text:
        content.append({"type": "text", "text": req.user_text})

    messages = [{"role": "user", "content": content}]
    processor = _state["processor"]
    model = _state["model"]

    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)

    inputs = processor(
        text=[text],
        images=image_inputs if req.image_url else None,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(DEVICE)

    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=req.max_new_tokens)

    trimmed = [out[len(inp):] for inp, out in zip(inputs.input_ids, generated)]
    output = processor.batch_decode(
        trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )
    return GenerateResponse(description=output[0])


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if _state["embed_model"] is None:
        raise HTTPException(503, "Embedding model not loaded.")
    if not req.inputs:
        return EmbedResponse(embeddings=[])
    vectors = _state["embed_model"].encode(
        req.inputs,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    return EmbedResponse(embeddings=vectors.tolist())


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
