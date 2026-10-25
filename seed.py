"""Create the schema and load all research data.

    python seed.py           # idempotent: seeds only an empty database
    python seed.py --reset   # drop everything and rebuild from seed_data/research_data.json
"""
import os
import sys

os.environ.setdefault("AUTO_SEED", "false")  # this script seeds explicitly

from app import create_app  # noqa: E402
from app.seeding import seed  # noqa: E402

if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        print(seed(reset="--reset" in sys.argv))
