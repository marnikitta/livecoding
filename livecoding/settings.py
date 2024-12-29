from typing import Optional

from pydantic import BaseModel


class Settings(BaseModel):
    heartbit_interval: int = 5
    events_hard_limit: int = 250_000
    events_compaction_limit: int = 150_000
    document_size_limit: int = 50_000
    max_sites: int = 100
    repository: Optional[str] = "marnikitta/livecoding"


settings = Settings()
