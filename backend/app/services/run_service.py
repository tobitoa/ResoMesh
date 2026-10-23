from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Dict, List, Optional, Tuple

import pandas as pd

from ..config import AWS_MAIN_ML_DIR, RUNS_DIR, SOURCES, UPLOADS_DIR
from ..ml.adapter import get_resolver
from ..models.contracts import (
    PreFlightResponse,
    PreFlightSourceCheck,
    ReadinessResponse,
    RunInfo,
    RunStage,
)
from .dataset_service import inspect_dataset, load_inputs, source_path

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="resomesh-worker")
_lock = RLock()
_runs: Dict[str, RunInfo] = {}
_futures: Dict[str, Future] = {}
_cancel_flags: Dict[str, bool] = {}

DEFAULT_TIMEOUT_SECONDS = 600

def generate_run_id() -> str:
    now = datetime.now(timezone.utc)
    return f"RUN-{now.strftime('%Y-%m%d')}-{uuid.uuid4().hex[:6].upper()}"

def _persist(info: RunInfo) -> None:
    folder = RUNS_DIR / info.run_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "run.json").write_text(info.model_dump_json(indent=2), encoding="utf-8")

def _set(info: RunInfo) -> None:
    with _lock:
        _runs[info.run_id] = info
        _persist(info)

def _log(run_id: str, stage: str, message: str) -> None:
    try:
        log_dir = RUNS_DIR / run_id / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        line = f"[{ts}] [{stage.upper()}] {message}\n"
        with open(log_dir / "execution.log", "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass

def get_run(run_id: str) -> Optional[RunInfo]:
    if not run_id or Path(run_id).name != run_id:
        return None
    with _lock:
        if run_id in _runs:
            return _runs[run_id]
    path = RUNS_DIR / run_id / "run.json"
    if not path.is_file():
        return None
    try:
        info = RunInfo.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if info.status in {"queued", "validating", "preprocessing", "candidate_generation", "matching", "validation"}:
        info.status = "failed"
        info.stage = "failed"
        info.error = "The API worker restarted before this background execution finished."
        info.error_stage = info.stage or "unknown"
        info.error_category = "PROCESS_INTERRUPTED"
        info.completed_at = datetime.now(timezone.utc)
        _persist(info)
    with _lock:
        _runs[run_id] = info
    return info

def list_runs() -> List[RunInfo]:
    found: List[RunInfo] = []
    if RUNS_DIR.is_dir():
        for path in RUNS_DIR.glob("*/run.json"):
            run = get_run(path.parent.name)
            if run is not None:
                found.append(run)
    return sorted(found, key=lambda item: item.created_at, reverse=True)

def get_run_logs(run_id: str) -> str:
    log_file = RUNS_DIR / run_id / "logs" / "execution.log"
    if log_file.is_file():
        return log_file.read_text(encoding="utf-8", errors="replace")
    return "No execution logs recorded yet."

def compute_inputs_signature() -> str:
    h = hashlib.sha256()
    for s in SOURCES:
        p = source_path(s)
        if p.is_file():
            h.update(s.encode("utf-8"))
            h.update(p.read_bytes())
    return h.hexdigest()[:16]

def check_readiness() -> ReadinessResponse:
    errors: list[str] = []
    deps = {}
    for package_name in ("pandas", "numpy", "rapidfuzz", "sklearn", "anyascii", "joblib"):
        try:
            __import__(package_name)
            deps[package_name] = True
        except Exception as exc:
            deps[package_name] = False
            errors.append(f"Missing Python package {package_name}: {exc}")

    core_files = (
        AWS_MAIN_ML_DIR / "src" / "normalization.py",
        AWS_MAIN_ML_DIR / "src" / "signal_ranked_blocking.py",
        AWS_MAIN_ML_DIR / "src" / "model_pipeline.py",
        AWS_MAIN_ML_DIR / "utils" / "validate_submission.py",
    )
    for cf in core_files:
        if not cf.is_file():
            errors.append(f"Required aws-main-ml module missing: {cf.name}")

    storage_writable = False
    try:
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        probe = RUNS_DIR / ".storage_probe"
        probe.write_text("probe", encoding="utf-8")
        probe.unlink(missing_ok=True)
        storage_writable = True
    except Exception as exc:
        errors.append(f"Workspace directory {RUNS_DIR} is not writable: {exc}")

    ml_ready = all(deps.values()) and not any("module missing" in e for e in errors)
    ready = ml_ready and storage_writable and len(errors) == 0

    return ReadinessResponse(
        ready=ready,
        api_online=True,
        ml_ready=ml_ready,
        model_name="aws-main-ml Production Pipeline",
        dependencies=deps,
        storage_writable=storage_writable,
        errors=errors,
    )

def run_preflight_check() -> PreFlightResponse:
    readiness = check_readiness()
    all_sources_valid = True
    source_checks: list[PreFlightSourceCheck] = []
    reasons: list[str] = []

    for source in SOURCES:
        path = source_path(source)
        role = "Reference entities" if source == "source1" else "Candidate entities"
        if not path.is_file():
            all_sources_valid = False
            reasons.append(f"Missing required source dataset {source}.tsv")
            source_checks.append(PreFlightSourceCheck(
                source=source,
                role=role,
                valid=False,
                errors=["File not uploaded or missing."]
            ))
            continue

        filename = path.name
        info = inspect_dataset(source, path, filename, path.stat().st_size)

        source_checks.append(PreFlightSourceCheck(
            source=source,
            role=role,
            filename=info.filename,
            valid=info.valid,
            record_count=info.record_count,
            errors=info.errors,
        ))
        if not info.valid:
            all_sources_valid = False
            reasons.append(f"{source} ({role}) schema check failed: {'; '.join(info.errors)}")
        elif not info.record_count:
            all_sources_valid = False
            reasons.append(f"{source} contains 0 records.")

    can_run = readiness.ready and all_sources_valid

    return PreFlightResponse(
        can_run=can_run,
        ml_ready=readiness.ml_ready,
        ml_model_name=readiness.model_name,
        sources_valid=all_sources_valid,
        storage_writable=readiness.storage_writable,
        sources=source_checks,
        reasons=reasons,
    )

def cancel_run(run_id: str) -> Optional[RunInfo]:
    with _lock:
        info = get_run(run_id)
        if not info:
            return None

        if info.status in {"completed", "failed", "cancelled"}:
            return info

        _cancel_flags[run_id] = True
        info.status = "cancelled"
        info.stage = "cancelled"
        info.completed_at = datetime.now(timezone.utc)
        if info.started_at:
            info.duration_seconds = round((info.completed_at - info.started_at).total_seconds(), 2)
        _set(info)
    _log(run_id, "cancelled", "Run execution was cancelled by user request.")
    return info

def _execute(run_id: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
    with _lock:
        info = get_run(run_id)
        if info is None or info.status == "cancelled" or _cancel_flags.get(run_id, False):
            return

        _cancel_flags.setdefault(run_id, False)
        start_time = time.time()
        info.started_at = datetime.now(timezone.utc)
        info.status = "validating"
        info.stage = "validating"
        _set(info)
    _log(run_id, "start", f"Initiating execution workspace for {run_id}")

    workspace = RUNS_DIR / run_id
    input_dir = workspace / "input"
    output_dir = workspace / "output"
    working_dir = workspace / "working"
    log_dir = workspace / "logs"

    for d in (input_dir, output_dir, working_dir, log_dir):
        d.mkdir(parents=True, exist_ok=True)

    def stage_callback(stage_name: str, message: str) -> None:
        with _lock:
            current = get_run(run_id)
            if _cancel_flags.get(run_id, False) or (current and current.status == "cancelled"):
                raise InterruptedError("Execution cancelled by user.")
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Execution exceeded maximum timeout of {timeout} seconds.")

            info.status = stage_name  # type: ignore
            info.stage = stage_name
            _set(info)
        _log(run_id, stage_name, message)

    try:
        resolver = get_resolver()
        info.model, info.mode = resolver.name, resolver.mode

        stage_callback("validating", "Auditing uploaded tabular files and schema invariants")
        inputs = load_inputs(input_dir)

        pipeline_output = resolver.resolve(
            inputs[0],
            inputs[1],
            inputs[2],
            output_dir=output_dir,
            test_dir=input_dir,
            stage_callback=stage_callback,
        )

        if _cancel_flags.get(run_id, False):
            raise InterruptedError("Execution cancelled by user.")

        stage_callback("validation", "Verifying output schema and candidate subset invariants")
        matching_file = output_dir / "matching_results.tsv"
        candidates_file = output_dir / "candidate_pairs.tsv"

        if not matching_file.is_file() or not candidates_file.is_file():
            raise FileNotFoundError("Expected output TSV artifacts were not generated.")

        if not pipeline_output.validation_passed:
            err_msg = "; ".join(pipeline_output.validation_errors) or "Submission validator failed output verification."
            raise ValueError(f"Output validation failed: {err_msg}")

        end_time = datetime.now(timezone.utc)
        duration = round((end_time - info.started_at).total_seconds(), 2)

        # Cache rich details
        if hasattr(pipeline_output, "matches_df") and pipeline_output.matches_df is not None:
            pipeline_output.matches_df.to_json(workspace / "matches_detail.json", orient="records", indent=2)
        if hasattr(pipeline_output, "candidates_df") and pipeline_output.candidates_df is not None:
            pipeline_output.candidates_df.to_json(workspace / "candidates_detail.json", orient="records", indent=2)

        with _lock:
            info.status = "completed"
            info.stage = "completed"
            info.exit_code = 0
            info.record_count = pipeline_output.total_records
            info.records_processed = pipeline_output.total_records
            info.matched_count = pipeline_output.matched_records
            info.unmatched_count = pipeline_output.unmatched_records
            info.candidate_count = pipeline_output.candidate_pairs_count
            info.completed_at = end_time
            info.duration_seconds = duration
            _set(info)

        _log(run_id, "completed", f"Successfully processed {pipeline_output.total_records} records in {duration}s")

    except InterruptedError:
        _log(run_id, "cancelled", "Run execution stopped: user cancelled.")
        with _lock:
            info.status = "cancelled"
            info.stage = "cancelled"
            info.completed_at = datetime.now(timezone.utc)
            if info.started_at:
                info.duration_seconds = round((info.completed_at - info.started_at).total_seconds(), 2)
            _set(info)
    except TimeoutError as exc:
        _log(run_id, "failed", f"Execution timed out: {exc}")
        with _lock:
            failed_stage = info.stage or "matching"
            info.status = "failed"
            info.stage = "failed"
            info.error_stage = failed_stage
            info.error_category = "PIPELINE_TIMEOUT"
            info.error = str(exc)
            info.completed_at = datetime.now(timezone.utc)
            if info.started_at:
                info.duration_seconds = round((info.completed_at - info.started_at).total_seconds(), 2)
            _set(info)
    except Exception as exc:
        _log(run_id, "failed", f"ML Pipeline error during stage '{info.stage}': {exc}")
        with _lock:
            failed_stage = info.stage or "matching"
            info.status = "failed"
            info.stage = "failed"
            info.error_stage = failed_stage
            info.error_category = "ML_EXECUTION_FAILED"
            info.error = str(exc)
            info.completed_at = datetime.now(timezone.utc)
            if info.started_at:
                info.duration_seconds = round((info.completed_at - info.started_at).total_seconds(), 2)
            _set(info)

def create_run(idempotency_key: Optional[str] = None) -> RunInfo:
    inputs_sig = compute_inputs_signature()
    key = idempotency_key or f"sig-{inputs_sig}"

    with _lock:
        for existing in _runs.values():
            if getattr(existing, "idempotency_key", None) == key:
                if existing.status in {"queued", "validating", "preprocessing", "candidate_generation", "matching", "validation"}:
                    return existing
                if existing.status == "completed":
                    return existing

    resolver = get_resolver()
    run_id = generate_run_id()
    workspace_dir = RUNS_DIR / run_id
    for sub in ("input", "working", "output", "logs"):
        (workspace_dir / sub).mkdir(parents=True, exist_ok=True)
    input_dir = workspace_dir / "input"

    for source in SOURCES:
        src = UPLOADS_DIR / f"{source}.tsv"
        dst = input_dir / f"{source}.tsv"
        if src.is_file():
            shutil.copyfile(src, dst)

    info = RunInfo(
        run_id=run_id,
        status="queued",
        stage="queued",
        model=resolver.name,
        mode=resolver.mode,
        created_at=datetime.now(timezone.utc),
        idempotency_key=key,
        workspace_dir=str(workspace_dir),
    )
    _set(info)
    _log(run_id, "queued", f"Run registered and queued. Idempotency key: {key}")

    future = _pool.submit(_execute, run_id, DEFAULT_TIMEOUT_SECONDS)
    with _lock:
        _futures[run_id] = future

    return info

def output_file(run_id: str, name: str) -> Path:
    if name not in {"matching_results.tsv", "candidate_pairs.tsv"}:
        raise ValueError("Unknown output file requested.")
    info = get_run(run_id)
    if not info or info.status != "completed":
        raise FileNotFoundError(f"Run {run_id} is not completed (current status: {getattr(info, 'status', 'unknown')}).")

    path = RUNS_DIR / run_id / "output" / name
    if path.is_file():
        return path

    fallback = RUNS_DIR / run_id / name
    if fallback.is_file():
        return fallback

    raise FileNotFoundError(f"Output file '{name}' was not found in run workspace {run_id}.")
