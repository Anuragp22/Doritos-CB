"""Local FastAPI inference server for the Doritos AI multimodal chat backend.

Loads a Qwen2-VL checkpoint at startup and exposes endpoints that match the
contract the Express backend speaks to via QWEN_API_URL.

Environment variables:
    MODEL_ID  HuggingFace repo id or local path (default: Qwen/Qwen2-VL-2B-Instruct).
    HOST      Bind address (default: 127.0.0.1).
    PORT      Bind port (default: 5000).
"""

import os
from contextlib import asynccontextmanager
from typing import List, Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from qwen_vl_utils import process_vision_info
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

DEFAULT_MODEL_ID = os.getenv("MODEL_ID", "Qwen/Qwen2-VL-2B-Instruct")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32

_state: dict = {"model": None, "processor": None, "model_id": None}


def _load(model_id: str) -> None:
    print(f"Loading model from {model_id} on {DEVICE}...")
    _state["model"] = Qwen2VLForConditionalGeneration.from_pretrained(
        model_id,
        torch_dtype=DTYPE,
        device_map="auto" if DEVICE == "cuda" else None,
    )
    _state["processor"] = AutoProcessor.from_pretrained(model_id)
    _state["model_id"] = model_id
    print("Model ready.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load(DEFAULT_MODEL_ID)
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


@app.get("/")
def health() -> dict:
    return {"status": "running", "model_id": _state["model_id"], "device": DEVICE}


@app.post("/set_model")
def set_model(req: SetModelRequest) -> dict:
    _load(req.model_id)
    return {"message": f"Model loaded: {req.model_id}"}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    if not req.user_text and not req.image_url:
        raise HTTPException(400, "Provide at least one of user_text or image_url.")
    if _state["model"] is None or _state["processor"] is None:
        raise HTTPException(503, "Model not yet loaded.")

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


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
