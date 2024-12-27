from pydantic import BaseModel


class Settings(BaseModel):
    heartbit_interval: int = 5
    hard_max_events_log: int = 250_000
    compaction_max_events_log: int = 150_000
    document_size_limit: int = 50_000
    max_sites: int = 100


settings = Settings()
