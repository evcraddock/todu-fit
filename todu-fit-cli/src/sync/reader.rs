//! Automerge document readers for in-memory queries.
//!
//! This module provides functions to read and query data directly from
//! Automerge documents without SQLite.

use automerge::{AutoCommit, ObjId, ReadDoc, ROOT};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::models::{HydrationSettings, HydrationUnit, WaterEntry};

pub use todu_fit_core::automerge::reader::ReaderError;
use todu_fit_core::automerge::reader::{get_i64, get_string};

// =============================================================================
// Hydration Reader
// =============================================================================

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

// =============================================================================
// Shopping Cart Reader
// =============================================================================

use todu_fit_core::{ManualItem, ShoppingCart};

/// Reads a shopping cart for a specific week from an Automerge document.
pub fn read_shopping_cart_by_week(
    doc: &AutoCommit,
    week: &str,
) -> Result<Option<ShoppingCart>, ReaderError> {
    if let Some((_, obj_id)) = doc
        .get(ROOT, week)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        read_shopping_cart(doc, &obj_id, week)
    } else {
        Ok(None)
    }
}

/// Reads all shopping carts from an Automerge document.
pub fn read_all_shopping_carts(doc: &AutoCommit) -> Result<Vec<ShoppingCart>, ReaderError> {
    let mut carts = Vec::new();

    for key in doc.keys(ROOT) {
        // Shopping cart keys are dates in YYYY-MM-DD format
        if key.len() == 10 && key.chars().nth(4) == Some('-') && key.chars().nth(7) == Some('-') {
            if let Some((_, obj_id)) = doc
                .get(ROOT, &key)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                if let Some(cart) = read_shopping_cart(doc, &obj_id, &key)? {
                    carts.push(cart);
                }
            }
        }
    }

    // Sort by week (newest first)
    carts.sort_by(|a, b| b.week.cmp(&a.week));

    Ok(carts)
}

fn read_shopping_cart(
    doc: &AutoCommit,
    obj_id: &ObjId,
    week: &str,
) -> Result<Option<ShoppingCart>, ReaderError> {
    let mut cart = ShoppingCart::new(week);

    // Read checked items
    if let Some((_, checked_id)) = doc
        .get(obj_id, "checked")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        let len = doc.length(&checked_id);
        for i in 0..len {
            if let Some((value, _)) = doc
                .get(&checked_id, i)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                if let Ok(s) = value.into_string() {
                    cart.checked.push(s);
                }
            }
        }
    }

    // Read manual items
    if let Some((_, manual_items_id)) = doc
        .get(obj_id, "manual_items")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        let len = doc.length(&manual_items_id);
        for i in 0..len {
            if let Some((_, item_id)) = doc
                .get(&manual_items_id, i)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                let name = get_string(doc, &item_id, "name")?.unwrap_or_default();
                let quantity = get_string(doc, &item_id, "quantity")?;
                let unit = get_string(doc, &item_id, "unit")?;

                if !name.is_empty() {
                    let item = ManualItem {
                        name,
                        quantity,
                        unit,
                    };
                    cart.manual_items.push(item);
                }
            }
        }
    }

    Ok(Some(cart))
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

    fn create_test_shopping_cart_doc() -> AutoCommit {
        let mut doc = AutoCommit::new();
        let week = "2026-01-11";

        let cart_obj = doc.put_object(ROOT, week, ObjType::Map).unwrap();

        // Add checked items
        let checked = doc.put_object(&cart_obj, "checked", ObjType::List).unwrap();
        doc.insert(&checked, 0, "eggs").unwrap();
        doc.insert(&checked, 1, "milk").unwrap();

        // Add manual items
        let manual = doc
            .put_object(&cart_obj, "manual_items", ObjType::List)
            .unwrap();
        let item = doc.insert_object(&manual, 0, ObjType::Map).unwrap();
        doc.put(&item, "name", "Paper towels").unwrap();
        doc.put(&item, "quantity", "2").unwrap();
        doc.put(&item, "unit", "rolls").unwrap();

        doc
    }

    #[test]
    fn test_read_shopping_cart_by_week() {
        let doc = create_test_shopping_cart_doc();
        let cart = read_shopping_cart_by_week(&doc, "2026-01-11").unwrap();

        assert!(cart.is_some());
        let cart = cart.unwrap();
        assert_eq!(cart.week, "2026-01-11");
        assert_eq!(cart.checked.len(), 2);
        assert!(cart.checked.contains(&"eggs".to_string()));
        assert!(cart.checked.contains(&"milk".to_string()));
    }

    #[test]
    fn test_read_shopping_cart_manual_items() {
        let doc = create_test_shopping_cart_doc();
        let cart = read_shopping_cart_by_week(&doc, "2026-01-11")
            .unwrap()
            .unwrap();

        assert_eq!(cart.manual_items.len(), 1);
        assert_eq!(cart.manual_items[0].name, "Paper towels");
        assert_eq!(cart.manual_items[0].quantity, Some("2".to_string()));
        assert_eq!(cart.manual_items[0].unit, Some("rolls".to_string()));
    }

    #[test]
    fn test_read_shopping_cart_not_found() {
        let doc = create_test_shopping_cart_doc();
        let cart = read_shopping_cart_by_week(&doc, "2026-01-18").unwrap();

        assert!(cart.is_none());
    }

    #[test]
    fn test_read_all_shopping_carts() {
        let mut doc = create_test_shopping_cart_doc();

        // Add another cart for a different week
        let week2 = "2026-01-18";
        let cart_obj = doc.put_object(ROOT, week2, ObjType::Map).unwrap();
        let _ = doc.put_object(&cart_obj, "checked", ObjType::List).unwrap();
        let _ = doc
            .put_object(&cart_obj, "manual_items", ObjType::List)
            .unwrap();

        let carts = read_all_shopping_carts(&doc).unwrap();
        assert_eq!(carts.len(), 2);
        // Should be sorted newest first
        assert_eq!(carts[0].week, "2026-01-18");
        assert_eq!(carts[1].week, "2026-01-11");
    }
}
