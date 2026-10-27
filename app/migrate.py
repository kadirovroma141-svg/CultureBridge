"""Tiny forward-only schema migrator.

``db.create_all()`` creates missing *tables* but never adds columns to existing ones. When a release adds nullable
columns (e.g. the alumni survey fields in schema v2) an already-deployed SQLite/PostgreSQL database would crash on the
first query. ``ensure_schema`` closes that gap: it creates missing tables, then ``ALTER TABLE … ADD COLUMN`` for every
model column that the live table lacks, plus the matching indexes. It never drops or rewrites data.
"""
import logging

from sqlalchemy import inspect, text

from .extensions import db

log = logging.getLogger(__name__)


def _default_clause(column) -> str:
    default = column.server_default
    if default is None:
        return ""
    arg = getattr(default, "arg", None)
    if arg is None:
        return ""
    sql = str(arg.compile(dialect=db.engine.dialect)) if hasattr(arg, "compile") else str(arg)
    return f" DEFAULT {sql}"


def ensure_schema() -> list[str]:
    """Create tables, add missing columns. Returns a list of the changes applied."""
    db.create_all()
    engine = db.engine
    inspector = inspect(engine)
    dialect = engine.dialect
    changes: list[str] = []

    with engine.begin() as conn:
        for table in db.metadata.sorted_tables:
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                if not column.nullable and column.server_default is None:
                    log.warning("Cannot auto-add NOT NULL column %s.%s without a default", table.name, column.name)
                    continue
                ddl = (f'ALTER TABLE {table.name} ADD COLUMN {dialect.identifier_preparer.quote(column.name)} '
                       f'{column.type.compile(dialect=dialect)}{_default_clause(column)}')
                conn.execute(text(ddl))
                changes.append(f"{table.name}.{column.name}")
                if column.unique:
                    conn.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table.name}_{column.name} "
                                      f"ON {table.name} ({column.name})"))
                elif column.index:
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table.name}_{column.name} "
                                      f"ON {table.name} ({column.name})"))
        # Supabase exposes every public table through its REST API; RLS with no policies closes that door,
        # while the app itself connects as the table owner and is not affected.
        if dialect.name == "postgresql":
            for table in db.metadata.sorted_tables:
                conn.execute(text(f"ALTER TABLE {table.name} ENABLE ROW LEVEL SECURITY"))
    if changes:
        log.info("Schema migrated, added columns: %s", ", ".join(changes))
    return changes
