import io
import json
from pathlib import Path
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from ..config import MAX_UPLOAD_BYTES, SOURCES
from ..models.contracts import DatasetInfo
from ..services.dataset_service import delete_dataset, inspect_dataset, list_datasets, safe_source, source_path, validate_frame
from ..services.validation_service import validate_inputs

router = APIRouter(prefix="/datasets", tags=["datasets"])

@router.get("")
def datasets() -> list[DatasetInfo]:
    return list_datasets()

@router.get("/validation")
def input_validation() -> dict:
    checks = validate_inputs()
    return {"status": "VALID" if all(item["valid"] for item in checks) else "FAILED", "checks": checks}

@router.post("/upload")
async def upload(source: str, file: UploadFile = File(...)) -> DatasetInfo:
    safe_source(source)
    filename = Path(file.filename or "dataset.tsv").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".tsv", ".csv"}:
        raise HTTPException(400, "Choose a TSV or CSV file.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"File must be non-empty and no larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    try:
        frame = pd.read_csv(io.BytesIO(content), sep="\t" if suffix == ".tsv" else ",", dtype=str, keep_default_na=False)
    except Exception as exc:
        raise HTTPException(400, "Could not read this tabular file.") from exc
    validation_errors = validate_frame(source, frame)
    if validation_errors:
        raise HTTPException(400, "Invalid dataset: " + " ".join(validation_errors))
    target = source_path(source)
    frame.to_csv(target, sep="\t", index=False)
    target.with_suffix(".meta").write_text(json.dumps({"filename": filename, "size_bytes": len(content)}), encoding="utf-8")
    return inspect_dataset(source, target, filename, len(content))

@router.delete("/{dataset_id}")
def remove_dataset(dataset_id: str) -> dict:
    delete_dataset(dataset_id)
    return {"deleted": dataset_id}
