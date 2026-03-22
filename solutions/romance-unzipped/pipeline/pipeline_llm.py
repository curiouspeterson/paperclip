#!/usr/bin/env python3
"""Shared OpenAI-compatible helpers for pipeline generation stages."""

from __future__ import annotations

import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

LOCAL_OPENAI_BASE_URLS = (
    "http://127.0.0.1:1234/v1",
    "http://localhost:1234/v1",
)
ZAI_OPENAI_BASE_URL = "https://api.z.ai/api/paas/v4"
ZAI_CODING_OPENAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4"
DEFAULT_LLM_TIMEOUT_SECONDS = max(5, int(os.environ.get("RU_LLM_TIMEOUT_SECONDS", "20")))


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def default_llm_api_key(base_url: str | None, api_key: str | None) -> str | None:
    if api_key:
        return api_key
    if base_url and ("localhost" in base_url or "127.0.0.1" in base_url):
        return "lm-studio"
    return None


def is_http_endpoint_reachable(base_url: str, *, timeout_seconds: float = 1.0) -> bool:
    try:
        parsed = urllib.parse.urlparse(base_url)
    except Exception:
        return False
    hostname = parsed.hostname
    port = parsed.port
    if port is None:
        if parsed.scheme == "https":
            port = 443
        elif parsed.scheme == "http":
            port = 80
    if not hostname or not port:
        return False
    try:
        with socket.create_connection((hostname, port), timeout=timeout_seconds):
            return True
    except OSError:
        return False


def fetch_model_list(base_url: str, api_key: str | None) -> list[str]:
    request = urllib.request.Request(
        base_url.rstrip("/") + "/models",
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=min(DEFAULT_LLM_TIMEOUT_SECONDS, 10)) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    models = []
    for entry in payload.get("data") or []:
        model_id = normalize_text(str((entry or {}).get("id") or ""))
        if model_id:
            models.append(model_id)
    return models


def choose_default_model(models: list[str]) -> str | None:
    if not models:
        return None
    preferred_patterns = (
        "glm-4.7",
        "glm-5",
        "glm-4.6",
        "glm-4.5",
        "qwen3.5",
        "qwen",
        "gpt-5",
        "sonnet",
        "claude",
        "llama",
        "mistral",
    )
    lowered = [(model, model.lower()) for model in models]
    for pattern in preferred_patterns:
        for original, lowered_value in lowered:
            if pattern in lowered_value:
                return original
    return models[0]


def resolve_requested_model(requested_model: str | None, available_models: list[str]) -> str | None:
    if not available_models:
        return requested_model
    if not requested_model:
        return choose_default_model(available_models)

    requested_normalized = normalize_text(requested_model).lower()
    exact_match = next((model for model in available_models if model.lower() == requested_normalized), None)
    if exact_match:
        return exact_match

    # Some providers expose nearby model variants for a family; if the requested
    # model is unavailable, keep the family when possible before falling back.
    requested_family = requested_normalized.split("-", 2)[:2]
    requested_family_key = "-".join(requested_family)
    family_match = next(
        (
            model
            for model in available_models
            if model.lower().startswith(requested_family_key)
        ),
        None,
    )
    if family_match:
        return family_match

    return choose_default_model(available_models)


def discover_llm_config(base_url: str | None, api_key: str | None, model: str | None) -> tuple[str | None, str | None, str | None]:
    candidate_urls = []
    if base_url:
        candidate_urls.append(base_url)
    else:
        candidate_urls.extend(LOCAL_OPENAI_BASE_URLS)

    for candidate_url in candidate_urls:
        if not is_http_endpoint_reachable(candidate_url):
            continue
        resolved_api_key = default_llm_api_key(candidate_url, api_key)
        available_models = fetch_model_list(candidate_url, resolved_api_key)
        resolved_model = resolve_requested_model(model, available_models)
        if resolved_model:
            return candidate_url, resolved_api_key, resolved_model
        if model:
            return candidate_url, resolved_api_key, model
    return base_url, default_llm_api_key(base_url, api_key), model


def extract_json_block(text: str) -> dict | None:
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(stripped[start : end + 1])
    except json.JSONDecodeError:
        return None


def chat_json(
    *,
    base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_payload: dict,
    timeout_seconds: int,
    max_tokens: int = 800,
    temperature: float = 0.3,
) -> dict | None:
    provider_overrides: dict = {}
    normalized_base_url = base_url.lower()
    normalized_model = model.lower()
    if "api.z.ai" in normalized_base_url or normalized_model.startswith("glm-"):
        provider_overrides["thinking"] = {"type": "disabled"}

    attempts = (
        {"response_format": {"type": "json_object"}},
        {},
    )
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
    ]

    for extra in attempts:
        body = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            **provider_overrides,
            **extra,
        }
        request = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=max(5, timeout_seconds)) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            continue

        choices = payload.get("choices") or []
        if not choices:
            continue
        message = choices[0].get("message") or {}
        parsed = extract_json_block(str(message.get("content") or ""))
        if isinstance(parsed, dict):
            return parsed
    return None
