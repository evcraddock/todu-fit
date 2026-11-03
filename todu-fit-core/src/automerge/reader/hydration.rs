//! Existing hydration document readers, extracted without schema conversion.
use super::{get_i64, get_string, ReaderError};
use crate::{HydrationSettings, HydrationUnit, WaterEntry};
use automerge::{AutoCommit, ObjId, ReadDoc, ROOT};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Reads all water entries from an Automerge document.
pub fn read_all_water_entries(doc: &AutoCommit) -> Result<Vec<WaterEntry>, ReaderError> {
    let mut entries = Vec::new();

    for key in doc.keys(ROOT) {
        if key == "settings" {
            continue;
        }

        if let Some((_, obj_id)) = doc
            .get(ROOT, &key)
            .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
        {
            if let Some(entry) = read_water_entry(doc, &obj_id, &key)? {
                entries.push(entry);
            }
        }
    }

    entries.sort_by_key(|entry| entry.consumed_at);
    Ok(entries)
}

/// Reads a single water entry by ID.
pub fn read_water_entry_by_id(
    doc: &AutoCommit,
    id: Uuid,
) -> Result<Option<WaterEntry>, ReaderError> {
    let key = id.to_string();

    if let Some((_, obj_id)) = doc
        .get(ROOT, &key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        read_water_entry(doc, &obj_id, &key)
    } else {
        Ok(None)
    }
}

/// Reads the configured hydration timezone, if it has been persisted.
pub fn read_hydration_timezone(doc: &AutoCommit) -> Result<Option<String>, ReaderError> {
    let Some((_, settings_id)) = doc
        .get(ROOT, "settings")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    else {
        return Ok(None);
    };
    get_string(doc, &settings_id, "timezone")
}

/// Reads hydration settings from an Automerge document.
pub fn read_hydration_settings(doc: &AutoCommit) -> Result<Option<HydrationSettings>, ReaderError> {
    if let Some((_, obj_id)) = doc
        .get(ROOT, "settings")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        let daily_goal_ml = get_i64(doc, &obj_id, "daily_goal_ml")?.unwrap_or_default() as i32;
        let preferred_unit = match get_string(doc, &obj_id, "preferred_unit")?.as_deref() {
            Some("ml") => HydrationUnit::Ml,
            _ => HydrationUnit::Oz,
        };
        let quick_add_presets_ml = read_i64_list(doc, &obj_id, "quick_add_presets_ml")?
            .into_iter()
            .map(|value| value as i32)
            .collect();
        let timezone = get_string(doc, &obj_id, "timezone")?.unwrap_or_else(|| "UTC".to_string());

        Ok(Some(HydrationSettings {
            daily_goal_ml,
            preferred_unit,
            quick_add_presets_ml,
            timezone,
        }))
    } else {
        Ok(None)
    }
}

fn read_water_entry(
    doc: &AutoCommit,
    obj_id: &ObjId,
    id_str: &str,
) -> Result<Option<WaterEntry>, ReaderError> {
    let id = match Uuid::parse_str(id_str) {
        Ok(id) => id,
        Err(_) => return Ok(None),
    };

    let consumed_at = match get_string(doc, obj_id, "consumed_at")? {
        Some(value) => DateTime::parse_from_rfc3339(&value)
            .map_err(|e| {
                ReaderError::ParseError(format!("Invalid consumed_at '{}': {}", value, e))
            })?
            .with_timezone(&Utc),
        None => return Ok(None),
    };

    let amount_ml = get_i64(doc, obj_id, "amount_ml")?.unwrap_or_default() as i32;
    let created_at = get_string(doc, obj_id, "created_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let updated_at = get_string(doc, obj_id, "updated_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    Ok(Some(WaterEntry {
        id,
        consumed_at,
        amount_ml,
        created_at,
        updated_at,
    }))
}

// =============================================================================
// Helpers
// =============================================================================

fn read_i64_list(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Vec<i64>, ReaderError> {
    let mut result = Vec::new();

    if let Some((_, list_id)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        let len = doc.length(&list_id);
        for i in 0..len {
            if let Some((value, _)) = doc
                .get(&list_id, i)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                if let Some(n) = value.as_i64() {
                    result.push(n);
                }
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use automerge::{transaction::Transactable, ObjType};
    fn create_test_hydration_doc() -> AutoCommit {
        let mut doc = AutoCommit::new();
        let entry_id = "550e8400-e29b-41d4-a716-446655440004";

        let entry_obj = doc.put_object(ROOT, entry_id, ObjType::Map).unwrap();
        doc.put(&entry_obj, "consumed_at", "2026-04-08T12:00:00Z")
            .unwrap();
        doc.put(&entry_obj, "amount_ml", 500).unwrap();
        doc.put(&entry_obj, "created_at", "2026-04-08T12:00:00Z")
            .unwrap();
        doc.put(&entry_obj, "updated_at", "2026-04-08T12:00:00Z")
            .unwrap();

        let settings = doc.put_object(ROOT, "settings", ObjType::Map).unwrap();
        doc.put(&settings, "daily_goal_ml", 2000).unwrap();
        doc.put(&settings, "preferred_unit", "ml").unwrap();
        let presets = doc
            .put_object(&settings, "quick_add_presets_ml", ObjType::List)
            .unwrap();
        doc.insert(&presets, 0, 250).unwrap();
        doc.insert(&presets, 1, 500).unwrap();

        doc
    }

    #[test]
    fn test_read_all_water_entries() {
        let doc = create_test_hydration_doc();
        let entries = read_all_water_entries(&doc).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].amount_ml, 500);
    }

    #[test]
    fn test_read_water_entry_by_id() {
        let doc = create_test_hydration_doc();
        let id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440004").unwrap();

        let entry = read_water_entry_by_id(&doc, id).unwrap().unwrap();
        assert_eq!(entry.amount_ml, 500);
    }

    #[test]
    fn test_read_hydration_settings() {
        let doc = create_test_hydration_doc();
        let settings = read_hydration_settings(&doc).unwrap().unwrap();

        assert_eq!(settings.daily_goal_ml, 2000);
        assert_eq!(settings.preferred_unit, HydrationUnit::Ml);
        assert_eq!(settings.quick_add_presets_ml, vec![250, 500]);
        assert_eq!(settings.timezone, "UTC");
        assert_eq!(read_hydration_timezone(&doc).unwrap(), None);
    }
}
