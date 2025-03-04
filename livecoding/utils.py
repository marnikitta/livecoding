import datetime
import os
import random

import logging
import socket
import sys
from functools import lru_cache
from typing import Optional

import requests

logger = logging.getLogger(__name__)


def generate_phonetic_name(length: int = 14) -> str:
    """
    Ported from hastebin name generator
    https://github.com/toptal/haste-server/blob/master/lib/key_generators/phonetic.js
    """
    vowels = "aeiou"
    consonants = "bcdfghjklmnpqrstvwxyz"

    text = ""
    start = random.random() < 0.5

    for i in range(length):
        if i % 2 == start:
            text += random.choice(consonants)
        else:
            text += random.choice(vowels)

    return text


def try_notify_systemd() -> None:
    systemd_socket = os.getenv("NOTIFY_SOCKET")
    if systemd_socket:
        logger.info("Notifying systemd")
        notify_systemd(systemd_socket)


def notify_systemd(notify_socket: str) -> None:
    # Ensure the socket path starts with a '@' if it's abstract
    if notify_socket.startswith("@"):
        notify_socket = "\0" + notify_socket[1:]

    # Create a socket and connect to the systemd notify socket
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
            sock.connect(notify_socket)
            sock.sendall(b"READY=1")
            logger.info("Notification sent: READY=1")
    except Exception as e:
        logger.exception("Failed to notify", e)


def format_uptime(start: datetime.datetime, end: datetime.datetime) -> str:
    delta = end - start
    days = delta.days
    seconds = delta.seconds
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60

    uptime = f"{days} days, {hours:02}:{minutes:02}"
    return uptime


@lru_cache
def get_stars(repository: str, cache_ts: int) -> Optional[int]:
    """
    :param repository:
    :param cache_ts: is a hacky way to cache responses.
    """
    try:
        res = requests.get(f"https://api.github.com/repos/{repository}")
        res.raise_for_status()
        data = res.json()
        return data["stargazers_count"]
    except Exception as e:
        logger.exception("Failed to fetch stars", e)
        return None


def configure_logging():
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root_logger.addHandler(handler)


if __name__ == "__main__":
    print(generate_phonetic_name(14))
