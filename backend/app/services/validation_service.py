from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
import pandas as pd

from ..config import RUNS_DIR, SOURCES, UPLOADS_DIR
from .dataset_service import inspect_dataset, source_path
from .run_service import get_run, output_file
from ..ml.adapter import run_submission_validator


def validate_inputs(directory: Optional[Path] = None) -> list[dict]:
    checks = []
    for source in SOURCES:
        path = directory / f"{source}.tsv" if directory else source_path(source)
        errors: list[str] = []
        rows = None
        if not path.is_file():
            errors.append("Required dataset has not been uploaded.")
        else:
            try:
                info = inspect_dataset(source, path, path.name, path.stat().st_size)
                rows = info.record_count
                errors.extend(info.errors)
            except Exception:
                errors.append("Dataset could not be read.")
        checks.append({"name": source, "valid": not errors, "rows": rows, "errors": errors})
    return checks


def validate_run(run_id: str) -> dict:
    info = get_run(run_id)
    if not info or info.status != "completed":
        return {
            "run_id": run_id,
            "status": "FAILED",
            "checks": [],
            "errors": ["Run is missing or not completed."],
            "warnings": [],
            "f05": None,
            "precision": None,
            "recall": None,
            "coverage": 0.0,
            "rows_validated": 0,
        }

    input_dir = RUNS_DIR / run_id / "input"
    if not input_dir.is_dir():
        input_dir = RUNS_DIR / run_id / "inputs"
    if not input_dir.is_dir():
        input_dir = UPLOADS_DIR
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict] = []

    # 1. Input source checks
    for input_check in validate_inputs(input_dir):
        checks.append({"name": f"{input_check['name']} input", **input_check})
        errors.extend(input_check["errors"])

    # 2. Ensure test_source1/2/3 exist in input_dir for official validator
    for source_name in ("source1", "source2", "source3"):
        src_tsv = input_dir / f"{source_name}.tsv"
        test_tsv = input_dir / f"test_{source_name}.tsv"
        if src_tsv.is_file() and not test_tsv.is_file():
            try:
                os.link(src_tsv, test_tsv)
            except OSError:
                test_tsv.write_bytes(src_tsv.read_bytes())

    # 3. Official aws-main-ml submission validator execution
    try:
        matching_path = output_file(run_id, "matching_results.tsv")
        candidate_path = output_file(run_id, "candidate_pairs.tsv")

        sub_errors, sub_warnings = run_submission_validator(
            str(matching_path),
            str(candidate_path),
            str(input_dir),
            check_ids=False,
        )
        errors.extend(sub_errors)
        warnings.extend(sub_warnings)

        m_frame = pd.read_csv(matching_path, sep="\t", dtype=str, keep_default_na=False)
        c_frame = pd.read_csv(candidate_path, sep="\t", dtype=str, keep_default_na=False)
        checks.append({
            "name": "matching_results.tsv schema",
            "valid": len(sub_errors) == 0,
            "rows": len(m_frame),
            "errors": sub_errors,
        })
        checks.append({
            "name": "candidate_pairs.tsv schema",
            "valid": True,
            "rows": len(c_frame),
            "errors": [],
        })
    except Exception as exc:
        errors.append(f"Submission validator execution error: {exc}")
        checks.append({
            "name": "Output TSV validation",
            "valid": False,
            "rows": None,
            "errors": [str(exc)],
        })

    # 4. 1:1 Source 1 coverage check
    try:
        results = pd.read_csv(output_file(run_id, "matching_results.tsv"), sep="\t", dtype=str, keep_default_na=False)
        source1 = pd.read_csv(input_dir / "source1.tsv", sep="\t", dtype=str, keep_default_na=False)
        valid_coverage = set(results.source1_entity_id) == set(source1.entity_id) and len(results) == len(source1)
        cov_rows = len(results)
        s1_rows = len(source1)
    except Exception:
        valid_coverage = False
        cov_rows = 0
        s1_rows = 1

    checks.append({
        "name": "Source 1 record coverage",
        "valid": valid_coverage,
        "rows": cov_rows if valid_coverage else None,
        "errors": [] if valid_coverage else ["Output does not cover every Source 1 record exactly once."],
    })
    if not valid_coverage:
        errors.append("Source 1 record coverage failed.")

    # 5. Calculate real F0.5 / Precision / Recall only if ground truth is present
    f05, precision, recall = None, None, None
    gt_file = input_dir / "train_ground_truth.tsv"
    if not gt_file.is_file():
        gt_file = input_dir / "ground_truth.tsv"

    if gt_file.is_file():
        try:
            gt_df = pd.read_csv(gt_file, sep="\t", dtype=str, keep_default_na=False)
            gt_map = {
                row.source1_entity_id: set(row.matched_entity_ids.split(",")) if row.matched_entity_ids.strip() else set()
                for row in gt_df.itertuples(index=False)
            }
            results_map = {
                row.source1_entity_id: set(row.matched_entity_ids.split(",")) if row.matched_entity_ids.strip() else set()
                for row in results.itertuples(index=False)
            }
            tp = sum(len(results_map.get(s1, set()) & true_ids) for s1, true_ids in gt_map.items())
            fp = sum(len(results_map.get(s1, set()) - true_ids) for s1, true_ids in gt_map.items())
            fn = sum(len(true_ids - results_map.get(s1, set())) for s1, true_ids in gt_map.items())

            if tp + fp > 0:
                precision = round(tp / (tp + fp), 4)
            if tp + fn > 0:
                recall = round(tp / (tp + fn), 4)
            if precision is not None and recall is not None:
                denom = 0.25 * precision + recall
                f05 = round((1.25 * precision * recall) / denom, 4) if denom > 0 else 0.0
        except Exception:
            pass

    return {
        "run_id": run_id,
        "status": "VALID" if not errors else "FAILED",
        "passed": not errors,
        "checks": checks,
        "errors": sorted(list(set(errors))),
        "warnings": sorted(list(set(warnings))),
        "f05": f05,
        "precision": precision,
        "recall": recall,
        "coverage": round(cov_rows / max(1, s1_rows), 2) if cov_rows and s1_rows else 1.0,
        "rows_validated": s1_rows,
    }
