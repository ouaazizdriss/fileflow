use std::{collections::HashMap, path::Path, sync::Arc};

use rusqlite::{params, Connection};
use tokio::sync::Mutex;

/// Shared handle to the single SQLite connection. The config stores keep an
/// in-memory cache for reads and write through to SQLite one row at a time,
/// replacing the previous whole-file JSON rewrites.
pub type Db = Arc<Mutex<Connection>>;

/// Every config store is persisted as a simple document table: one row per
/// entity, `data` holding that entity's JSON. This keeps serialization identical
/// to the previous on-disk format while turning each mutation into a single-row
/// upsert/delete instead of rewriting the entire collection.
pub const TABLES: &[&str] = &[
    "users",
    "groups",
    "shares",
    "collab",
    "internal_shares",
    "upload_requests",
    "favorites",
];

pub fn open(path: &Path) -> anyhow::Result<Db> {
    let conn = Connection::open(path)?;
    // WAL gives concurrent readers + a single writer with fast, durable commits.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    for table in TABLES {
        conn.execute(
            &format!(
                "CREATE TABLE IF NOT EXISTS {} (key TEXT PRIMARY KEY, data TEXT NOT NULL)",
                table
            ),
            [],
        )?;
    }
    Ok(Arc::new(Mutex::new(conn)))
}

// NOTE: `table` is always one of the constants in `TABLES`, never user input,
// so interpolating it into the SQL is safe from injection.

pub fn load_all(conn: &Connection, table: &str) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(&format!("SELECT key, data FROM {}", table))?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    rows.collect()
}

pub fn put(conn: &Connection, table: &str, key: &str, data: &str) -> rusqlite::Result<()> {
    conn.execute(
        &format!(
            "INSERT INTO {0} (key, data) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET data = excluded.data",
            table
        ),
        params![key, data],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, table: &str, key: &str) -> rusqlite::Result<()> {
    conn.execute(&format!("DELETE FROM {} WHERE key = ?1", table), params![key])?;
    Ok(())
}

/// Load a `HashMap<String, T>` store from `table`. On first run (empty table),
/// import the legacy `HashMap`-shaped JSON file at `migrate_from` if present,
/// writing each entity into SQLite so the old data survives the upgrade.
pub async fn hydrate_map<T>(db: &Db, table: &str, migrate_from: &Path) -> anyhow::Result<HashMap<String, T>>
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let mut map: HashMap<String, T> = HashMap::new();
    let conn = db.lock().await;

    for (k, data) in load_all(&conn, table)? {
        match serde_json::from_str::<T>(&data) {
            Ok(v) => { map.insert(k, v); }
            Err(e) => tracing::warn!("skipping unreadable {} row '{}': {}", table, k, e),
        }
    }

    if map.is_empty() && migrate_from.exists() {
        if let Ok(raw) = std::fs::read_to_string(migrate_from) {
            if let Ok(old) = serde_json::from_str::<HashMap<String, T>>(&raw) {
                for (k, v) in &old {
                    if let Ok(j) = serde_json::to_string(v) {
                        let _ = put(&conn, table, k, &j);
                    }
                }
                tracing::info!("migrated {} {} record(s) from {:?} into SQLite", old.len(), table, migrate_from);
                map = old;
            }
        }
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_tmp() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = open(&dir.path().join("t.db")).unwrap();
        (dir, db)
    }

    #[tokio::test]
    async fn put_get_delete_roundtrip() {
        let (_d, db) = open_tmp();
        let conn = db.lock().await;
        put(&conn, "shares", "k1", r#"{"a":1}"#).unwrap();
        let rows = load_all(&conn, "shares").unwrap();
        assert_eq!(rows, vec![("k1".to_string(), r#"{"a":1}"#.to_string())]);

        // upsert overwrites rather than duplicating
        put(&conn, "shares", "k1", r#"{"a":2}"#).unwrap();
        let rows = load_all(&conn, "shares").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, r#"{"a":2}"#);

        delete(&conn, "shares", "k1").unwrap();
        assert!(load_all(&conn, "shares").unwrap().is_empty());
    }

    #[tokio::test]
    async fn open_is_idempotent_and_creates_all_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let _db = open(&path).unwrap();
        // Re-opening the same file must not fail (CREATE TABLE IF NOT EXISTS).
        let db = open(&path).unwrap();
        let conn = db.lock().await;
        for t in TABLES {
            assert!(load_all(&conn, t).is_ok(), "table {} missing", t);
        }
    }

    #[tokio::test]
    async fn hydrate_map_reads_existing_rows() {
        let (_d, db) = open_tmp();
        {
            let conn = db.lock().await;
            put(&conn, "collab", "id1", r#"{"x":1}"#).unwrap();
        }
        let map: HashMap<String, serde_json::Value> =
            hydrate_map(&db, "collab", Path::new("/does/not/exist")).await.unwrap();
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("id1"));
    }

    #[tokio::test]
    async fn hydrate_map_migrates_legacy_json_once() {
        let (dir, db) = open_tmp();
        let json_path = dir.path().join("legacy.json");
        std::fs::write(&json_path, r#"{"a":{"n":1},"b":{"n":2}}"#).unwrap();

        let map: HashMap<String, serde_json::Value> =
            hydrate_map(&db, "shares", &json_path).await.unwrap();
        assert_eq!(map.len(), 2);

        // The rows are now persisted in SQLite.
        {
            let conn = db.lock().await;
            assert_eq!(load_all(&conn, "shares").unwrap().len(), 2);
        }

        // A second hydrate reads from the table and does NOT re-import.
        let map2: HashMap<String, serde_json::Value> =
            hydrate_map(&db, "shares", &json_path).await.unwrap();
        assert_eq!(map2.len(), 2);
    }

    #[tokio::test]
    async fn hydrate_map_empty_when_no_rows_and_no_file() {
        let (_d, db) = open_tmp();
        let map: HashMap<String, serde_json::Value> =
            hydrate_map(&db, "shares", Path::new("/nope")).await.unwrap();
        assert!(map.is_empty());
    }
}
