"""What a weekend's format and sessions mean to the data engine, in one place. Imported by jobs and by
weekend_pipeline alike, so it imports neither."""
from typing import Optional

# event_format values whose weekend runs Sprint Qualifying and a sprint ("sprint_shootout" is 2023's name).
SPRINT_FORMATS = frozenset({"sprint", "sprint_qualifying", "sprint_shootout"})


def is_sprint_weekend(event_format: Optional[str]) -> bool:
    return event_format in SPRINT_FORMATS
