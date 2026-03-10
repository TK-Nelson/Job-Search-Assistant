"""One-time script: restore logo_url for companies where it is NULL."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.logo import build_logo_url
from app.db.database import get_connection

conn = get_connection()
rows = conn.execute("SELECT id, name, careers_url, logo_url FROM companies").fetchall()
refreshed = 0
for r in rows:
    if not r[3]:
        logo = build_logo_url(r[1], r[2] or "")
        conn.execute("UPDATE companies SET logo_url = ?, updated_at = datetime('now') WHERE id = ?", (logo, r[0]))
        refreshed += 1
        print(f"  Refreshed ID={r[0]} {r[1]} -> {logo[:60]}...")
conn.commit()
conn.close()
print(f"\nDone. Refreshed {refreshed} of {len(rows)} companies.")
