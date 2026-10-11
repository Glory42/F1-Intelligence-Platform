import json
import resource


def log_job_failure(job: str, error: Exception, **context) -> None:
    """Structured failure log per CLAUDE.md: {"job": ..., "status": "failed", "error": ...}."""
    payload = {"job": job, "status": "failed", "error": str(error), **context}
    print(json.dumps(payload))


def peak_rss_mb() -> int:
    """Process high-water mark (Linux reports KB); Render Free kills the service at 512 MB."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024


def log_job_ok(job: str, **context) -> None:
    payload = {"job": job, "status": "ok", "peak_rss_mb": peak_rss_mb(), **context}
    print(json.dumps(payload))
