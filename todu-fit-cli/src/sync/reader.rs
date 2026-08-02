//! Automerge document readers for in-memory queries.
//!
//! This module provides functions to read and query data directly from
//! Automerge documents without SQLite.

use automerge::{AutoCommit, ObjId, ObjType, ReadDoc, Value, ROOT};
use chrono::{DateTime, NaiveDate, Utc};
use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{
    Dish, HydrationSettings, HydrationUnit, Ingredient, MealLog, MealPlan, MealType, Nutrient,
    WaterEntry,
};

/// Error type for reader operations.
#[derive(Debug)]
pub enum ReaderError {
    /// Automerge operation failed.
    AutomergeError(String),
    /// Failed to parse a value.
    ParseError(String),
    /// Document data did not have the expected Automerge shape.
    MalformedData(String),
}

impl std::fmt::Display for ReaderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReaderError::AutomergeError(e) => write!(f, "Automerge error: {}", e),
            ReaderError::ParseError(e) => write!(f, "Parse error: {}", e),
            ReaderError::MalformedData(e) => write!(f, "Malformed data: {}", e),
        }
    }
}

impl std::error::Error for ReaderError {}

// =============================================================================
// Dish Reader
// =============================================================================

/// Reads all dishes from an Automerge document.
pub fn read_all_dishes(doc: &AutoCommit) -> Result<Vec<Dish>, ReaderError> {
    let mut dishes = Vec::new();

    for key in doc.keys(ROOT) {
        if let Some((_, obj_id)) = doc
            .get(ROOT, &key)
            .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
        {
            if let Some(dish) = read_dish(doc, &obj_id, &key)? {
                dishes.push(dish);
            }
        }
    }

    Ok(dishes)
}

/// Reads a single dish by ID from an Automerge document.
pub fn read_dish_by_id(doc: &AutoCommit, id: Uuid) -> Result<Option<Dish>, ReaderError> {
    let key = id.to_string();

    if let Some((_, obj_id)) = doc
        .get(ROOT, &key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        read_dish(doc, &obj_id, &key)
    } else {
        Ok(None)
    }
}

/// Searches dishes by name, tags, or ingredient names (case-insensitive partial match).
pub fn search_dishes(doc: &AutoCommit, query: &str) -> Result<Vec<Dish>, ReaderError> {
    let query_lower = query.to_lowercase();
    let dishes = read_all_dishes(doc)?;

    Ok(dishes
        .into_iter()
        .filter(|d| {
            d.name.to_lowercase().contains(&query_lower)
                || d.tags
                    .iter()
                    .any(|tag| tag.to_lowercase().contains(&query_lower))
                || d.ingredients
                    .iter()
                    .any(|ingredient| ingredient.name.to_lowercase().contains(&query_lower))
        })
        .collect())
}

/// Finds a dish by exact name (case-insensitive).
pub fn find_dish_by_name(doc: &AutoCommit, name: &str) -> Result<Option<Dish>, ReaderError> {
    let name_lower = name.to_lowercase();
    let dishes = read_all_dishes(doc)?;

    Ok(dishes
        .into_iter()
        .find(|d| d.name.to_lowercase() == name_lower))
}

#[allow(dead_code)]
/// Filters dishes by tag.
pub fn filter_dishes_by_tag(doc: &AutoCommit, tag: &str) -> Result<Vec<Dish>, ReaderError> {
    let tag_lower = tag.to_lowercase();
    let dishes = read_all_dishes(doc)?;

    Ok(dishes
        .into_iter()
        .filter(|d| d.tags.iter().any(|t| t.to_lowercase() == tag_lower))
        .collect())
}

fn read_dish(doc: &AutoCommit, obj_id: &ObjId, id_str: &str) -> Result<Option<Dish>, ReaderError> {
    let id = match Uuid::parse_str(id_str) {
        Ok(id) => id,
        Err(_) => return Ok(None), // Skip invalid UUIDs
    };

    let name = match get_string(doc, obj_id, "name")? {
        Some(n) => n,
        None => return Ok(None),
    };

    let instructions = get_string(doc, obj_id, "instructions")?.unwrap_or_default();
    let created_by = get_string(doc, obj_id, "created_by")?.unwrap_or_default();

    let created_at = get_string(doc, obj_id, "created_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let updated_at = get_string(doc, obj_id, "updated_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let prep_time = get_i64(doc, obj_id, "prep_time")?.map(|v| v as i32);
    let cook_time = get_i64(doc, obj_id, "cook_time")?.map(|v| v as i32);
    let servings = get_i64(doc, obj_id, "servings")?.map(|v| v as i32);
    let image_url = get_string(doc, obj_id, "image_url")?;
    let source_url = get_string(doc, obj_id, "source_url")?;

    let tags = read_string_list(doc, obj_id, "tags")?;
    let ingredients = read_ingredients(doc, obj_id)?;
    let nutrients = read_nutrients(doc, obj_id)?;

    Ok(Some(Dish {
        id,
        name,
        ingredients,
        instructions,
        nutrients,
        prep_time,
        cook_time,
        servings,
        tags,
        image_url,
        source_url,
        created_by,
        created_at,
        updated_at,
    }))
}

fn read_ingredients(doc: &AutoCommit, obj_id: &ObjId) -> Result<Vec<Ingredient>, ReaderError> {
    let mut ingredients = Vec::new();

    if let Some((_, list_id)) = doc
        .get(obj_id, "ingredients")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        let len = doc.length(&list_id);
        for i in 0..len {
            if let Some((_, ing_id)) = doc
                .get(&list_id, i)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                let name = get_string(doc, &ing_id, "name")?.unwrap_or_default();
                let quantity = get_quantity(doc, &ing_id, "quantity")?.unwrap_or(0.0);
                let unit = get_string(doc, &ing_id, "unit")?.unwrap_or_default();

                ingredients.push(Ingredient::new(name, quantity, unit));
            }
        }
    }

    Ok(ingredients)
}

fn read_nutrients(doc: &AutoCommit, obj_id: &ObjId) -> Result<Option<Vec<Nutrient>>, ReaderError> {
    if let Some((_, list_id)) = doc
        .get(obj_id, "nutrients")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        let mut nutrients = Vec::new();
        let len = doc.length(&list_id);

        for i in 0..len {
            if let Some((_, nut_id)) = doc
                .get(&list_id, i)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                let name = get_string(doc, &nut_id, "name")?.unwrap_or_default();
                let amount = get_f64(doc, &nut_id, "amount")?.unwrap_or(0.0);
                let unit = get_string(doc, &nut_id, "unit")?.unwrap_or_default();

                nutrients.push(Nutrient::new(name, amount, unit));
            }
        }

        if nutrients.is_empty() {
            Ok(None)
        } else {
            Ok(Some(nutrients))
        }
    } else {
        Ok(None)
    }
}

// =============================================================================
// MealPlan Reader
// =============================================================================

/// Reads all meal plans from an Automerge document.
pub fn read_all_mealplans(doc: &AutoCommit) -> Result<Vec<MealPlan>, ReaderError> {
    let mut plans = Vec::new();

    for key in doc.keys(ROOT) {
        if let Some((_, obj_id)) = doc
            .get(ROOT, &key)
            .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
        {
            if let Some(plan) = read_mealplan(doc, &obj_id, &key)? {
                plans.push(plan);
            }
        }
    }

    Ok(plans)
}

/// Reads a single meal plan by ID.
pub fn read_mealplan_by_id(doc: &AutoCommit, id: Uuid) -> Result<Option<MealPlan>, ReaderError> {
    let key = id.to_string();

    if let Some((_, obj_id)) = doc
        .get(ROOT, &key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        read_mealplan(doc, &obj_id, &key)
    } else {
        Ok(None)
    }
}

/// Lists meal plans within a date range.
pub fn list_mealplans_by_date_range(
    doc: &AutoCommit,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<MealPlan>, ReaderError> {
    let plans = read_all_mealplans(doc)?;

    Ok(plans
        .into_iter()
        .filter(|p| p.date >= from && p.date <= to)
        .collect())
}

/// Gets meal plans for a specific date.
pub fn get_mealplans_by_date(
    doc: &AutoCommit,
    date: NaiveDate,
) -> Result<Vec<MealPlan>, ReaderError> {
    let plans = read_all_mealplans(doc)?;

    Ok(plans.into_iter().filter(|p| p.date == date).collect())
}

/// Gets a meal plan by date and type.
pub fn get_mealplan_by_date_and_type(
    doc: &AutoCommit,
    date: NaiveDate,
    meal_type: MealType,
) -> Result<Option<MealPlan>, ReaderError> {
    let plans = read_all_mealplans(doc)?;

    Ok(plans
        .into_iter()
        .find(|p| p.date == date && p.meal_type == meal_type))
}

fn read_mealplan(
    doc: &AutoCommit,
    obj_id: &ObjId,
    id_str: &str,
) -> Result<Option<MealPlan>, ReaderError> {
    let id = match Uuid::parse_str(id_str) {
        Ok(id) => id,
        Err(_) => return Ok(None),
    };

    let date_str = match get_string(doc, obj_id, "date")? {
        Some(d) => d,
        None => return Ok(None),
    };

    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|e| ReaderError::ParseError(format!("Invalid date '{}': {}", date_str, e)))?;

    let meal_type_str = get_string(doc, obj_id, "meal_type")?.unwrap_or_default();
    let meal_type: MealType = meal_type_str.parse().unwrap_or(MealType::Dinner);

    let title = get_string(doc, obj_id, "title")?.unwrap_or_default();
    let cook = get_string(doc, obj_id, "cook")?.unwrap_or_default();
    let uses_leftovers = get_bool(doc, obj_id, "uses_leftovers")?.unwrap_or(false);
    let created_by = get_string(doc, obj_id, "created_by")?.unwrap_or_default();

    let created_at = get_string(doc, obj_id, "created_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let updated_at = get_string(doc, obj_id, "updated_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let dish_ids = read_dish_ids(doc, obj_id, "dish_ids")?;

    Ok(Some(MealPlan {
        id,
        date,
        meal_type,
        title,
        cook,
        dish_ids,
        uses_leftovers,
        created_by,
        created_at,
        updated_at,
    }))
}

// =============================================================================
// MealLog Reader
// =============================================================================

/// Reads all meal logs from an Automerge document.
pub fn read_all_meallogs(doc: &AutoCommit) -> Result<Vec<MealLog>, ReaderError> {
    let mut logs = Vec::new();

    for key in doc.keys(ROOT) {
        if let Some((value, obj_id)) = doc
            .get(ROOT, &key)
            .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
        {
            if !is_obj_type(&value, ObjType::Map) {
                if Uuid::parse_str(&key).is_ok() {
                    return Err(malformed_expected(
                        format!("meal log '{}'", key),
                        "map",
                        &value,
                    ));
                }
                continue;
            }
            if let Some(log) = read_meallog(doc, &obj_id, &key)? {
                logs.push(log);
            }
        }
    }

    Ok(logs)
}

/// Reads a single meal log by ID.
pub fn read_meallog_by_id(doc: &AutoCommit, id: Uuid) -> Result<Option<MealLog>, ReaderError> {
    let key = id.to_string();

    if let Some((value, obj_id)) = doc
        .get(ROOT, &key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        if !is_obj_type(&value, ObjType::Map) {
            return Err(malformed_expected(
                format!("meal log '{}'", key),
                "map",
                &value,
            ));
        }
        read_meallog(doc, &obj_id, &key)
    } else {
        Ok(None)
    }
}

/// Lists meal logs within a date range.
pub fn list_meallogs_by_date_range(
    doc: &AutoCommit,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<MealLog>, ReaderError> {
    let logs = read_all_meallogs(doc)?;

    Ok(logs
        .into_iter()
        .filter(|l| l.date >= from && l.date <= to)
        .collect())
}

fn read_meallog(
    doc: &AutoCommit,
    obj_id: &ObjId,
    id_str: &str,
) -> Result<Option<MealLog>, ReaderError> {
    let id = match Uuid::parse_str(id_str) {
        Ok(id) => id,
        Err(_) => return Ok(None),
    };

    let date_str = match get_string(doc, obj_id, "date")? {
        Some(d) => d,
        None => return Ok(None),
    };

    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|e| ReaderError::ParseError(format!("Invalid date '{}': {}", date_str, e)))?;

    let meal_type_str = get_string(doc, obj_id, "meal_type")?.unwrap_or_default();
    let meal_type: MealType = meal_type_str.parse().unwrap_or(MealType::Dinner);

    let mealplan_id =
        get_string(doc, obj_id, "mealplan_id")?.and_then(|s| Uuid::parse_str(&s).ok());

    let notes = get_string(doc, obj_id, "notes")?;
    let created_by = get_string(doc, obj_id, "created_by")?.unwrap_or_default();

    let created_at = get_string(doc, obj_id, "created_at")?
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    // Read dish snapshots
    let dishes = read_dish_snapshots(doc, obj_id)?;
    let dish_portions = read_dish_portions(doc, obj_id)?;

    Ok(Some(MealLog {
        id,
        date,
        meal_type,
        mealplan_id,
        dishes,
        dish_portions,
        notes,
        created_by,
        created_at,
    }))
}

fn read_dish_portions(doc: &AutoCommit, obj_id: &ObjId) -> Result<HashMap<Uuid, f64>, ReaderError> {
    let mut portions = HashMap::new();
    let Some((value, portions_id)) = doc
        .get(obj_id, "dish_portions")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    else {
        return Ok(portions);
    };

    if !is_obj_type(&value, ObjType::Map) {
        return Err(malformed_expected("meal log dish_portions", "map", &value));
    }

    for key in doc.keys(&portions_id) {
        if let (Ok(dish_id), Some(portion)) = (
            Uuid::parse_str(&key),
            get_quantity(doc, &portions_id, &key)?,
        ) {
            portions.insert(dish_id, portion);
        }
    }

    Ok(portions)
}

fn read_dish_snapshots(doc: &AutoCommit, obj_id: &ObjId) -> Result<Vec<Dish>, ReaderError> {
    let mut dishes = Vec::new();

    if let Some((value, list_id)) = doc
        .get(obj_id, "dishes")
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        if !is_obj_type(&value, ObjType::List) {
            return Err(malformed_expected(
                "meal log field 'dishes'",
                "list",
                &value,
            ));
        }

        let len = doc.length(&list_id);
        for i in 0..len {
            if let Some((value, dish_id)) = doc
                .get(&list_id, i)
                .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
            {
                if let Ok(dish_ref) = value.clone().into_string() {
                    if let Some(dish) = dish_from_reference(&dish_ref) {
                        dishes.push(dish);
                    }
                    continue;
                }

                if !is_obj_type(&value, ObjType::Map) {
                    return Err(malformed_expected(
                        format!("meal log field 'dishes[{}]'", i),
                        "dish snapshot map or dish UUID string",
                        &value,
                    ));
                }

                // Read dish snapshot from embedded object
                let id_str = get_string(doc, &dish_id, "id")?.unwrap_or_default();
                let id = Uuid::parse_str(&id_str).unwrap_or_else(|_| Uuid::new_v4());

                let name = get_string(doc, &dish_id, "name")?.unwrap_or_default();
                let instructions = get_string(doc, &dish_id, "instructions")?.unwrap_or_default();
                let created_by = get_string(doc, &dish_id, "created_by")?.unwrap_or_default();

                let tags = read_string_list(doc, &dish_id, "tags")?;
                let ingredients = read_ingredients(doc, &dish_id)?;

                let prep_time = get_i64(doc, &dish_id, "prep_time")?.map(|v| v as i32);
                let cook_time = get_i64(doc, &dish_id, "cook_time")?.map(|v| v as i32);
                let servings = get_i64(doc, &dish_id, "servings")?.map(|v| v as i32);

                dishes.push(Dish {
                    id,
                    name,
                    ingredients,
                    instructions,
                    nutrients: None,
                    prep_time,
                    cook_time,
                    servings,
                    tags,
                    image_url: None,
                    source_url: None,
                    created_by,
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                });
            }
        }
    }

    Ok(dishes)
}

fn dish_from_reference(dish_ref: &str) -> Option<Dish> {
    let id = Uuid::parse_str(dish_ref).ok()?;

    Some(Dish {
        id,
        name: format!("Dish {}", id),
        ingredients: Vec::new(),
        instructions: String::new(),
        nutrients: None,
        prep_time: None,
        cook_time: None,
        servings: None,
        tags: Vec::new(),
        image_url: None,
        source_url: None,
        created_by: String::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

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

fn is_obj_type(value: &Value<'_>, expected: ObjType) -> bool {
    value.to_objtype() == Some(expected)
}

fn malformed_expected(
    context: impl Into<String>,
    expected: &'static str,
    value: &Value<'_>,
) -> ReaderError {
    ReaderError::MalformedData(format!(
        "{} expected {}, found {}",
        context.into(),
        expected,
        describe_value(value)
    ))
}

fn describe_value(value: &Value<'_>) -> &'static str {
    match value {
        Value::Object(ObjType::Map) => "map",
        Value::Object(ObjType::List) => "list",
        Value::Object(ObjType::Text) => "text",
        Value::Object(ObjType::Table) => "table",
        Value::Scalar(_) => "scalar",
    }
}

fn get_string(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<String>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        Ok(value.into_string().ok())
    } else {
        Ok(None)
    }
}

fn get_bool(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<bool>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        Ok(value.to_bool())
    } else {
        Ok(None)
    }
}

fn get_i64(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<i64>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        Ok(value.to_i64())
    } else {
        Ok(None)
    }
}

fn get_f64(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<f64>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        // Try f64 first, then fall back to i64 (for values stored as integers)
        if let Some(f) = value.to_f64() {
            Ok(Some(f))
        } else if let Some(i) = value.to_i64() {
            Ok(Some(i as f64))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

/// Gets a quantity value, handling scalar numbers, scalar strings, and Text objects.
/// The UI may store quantities as strings or Text CRDTs, while the CLI writes them as f64.
fn get_quantity(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<f64>, ReaderError> {
    if let Some((value, obj_id_value)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        // Try f64 first (CLI writes this format)
        if let Some(f) = value.to_f64() {
            return Ok(Some(f));
        }
        // Try i64 (integers stored numerically)
        if let Some(i) = value.to_i64() {
            return Ok(Some(i as f64));
        }
        // Try scalar strings (web writes this format for ingredient quantities)
        if let Ok(s) = value.clone().into_string() {
            if let Ok(f) = s.trim().parse::<f64>() {
                return Ok(Some(f));
            }
        }
        // Check if it's a Text object (UI can write this format)
        if value.is_object() {
            // Read the text content and parse as number
            let text = doc
                .text(&obj_id_value)
                .map_err(|e| ReaderError::AutomergeError(format!("Failed to read text: {}", e)))?;
            if let Ok(f) = text.trim().parse::<f64>() {
                return Ok(Some(f));
            }
        }
        Ok(None)
    } else {
        Ok(None)
    }
}

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
                if let Some(n) = value.to_i64() {
                    result.push(n);
                }
            }
        }
    }

    Ok(result)
}

fn read_string_list(
    doc: &AutoCommit,
    obj_id: &ObjId,
    key: &str,
) -> Result<Vec<String>, ReaderError> {
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
                if let Ok(s) = value.into_string() {
                    result.push(s);
                }
            }
        }
    }

    Ok(result)
}

fn read_dish_ids(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Vec<Uuid>, ReaderError> {
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
                if let Ok(s) = value.into_string() {
                    if let Ok(id) = Uuid::parse_str(&s) {
                        result.push(id);
                    }
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

    fn create_test_dish_doc() -> AutoCommit {
        let mut doc = AutoCommit::new();
        let dish_id = "550e8400-e29b-41d4-a716-446655440001";

        let dish_obj = doc.put_object(ROOT, dish_id, ObjType::Map).unwrap();
        doc.put(&dish_obj, "name", "Test Pasta").unwrap();
        doc.put(&dish_obj, "instructions", "Cook pasta").unwrap();
        doc.put(&dish_obj, "created_by", "testuser").unwrap();
        doc.put(&dish_obj, "created_at", "2025-01-01T00:00:00Z")
            .unwrap();
        doc.put(&dish_obj, "updated_at", "2025-01-01T00:00:00Z")
            .unwrap();

        let tags = doc.put_object(&dish_obj, "tags", ObjType::List).unwrap();
        doc.insert(&tags, 0, "italian").unwrap();
        doc.insert(&tags, 1, "pasta").unwrap();

        let ingredients = doc
            .put_object(&dish_obj, "ingredients", ObjType::List)
            .unwrap();
        let ing = doc.insert_object(&ingredients, 0, ObjType::Map).unwrap();
        doc.put(&ing, "name", "pasta").unwrap();
        doc.put(&ing, "quantity", 200.0).unwrap();
        doc.put(&ing, "unit", "g").unwrap();
        let ing = doc.insert_object(&ingredients, 1, ObjType::Map).unwrap();
        doc.put(&ing, "name", "San Marzano tomato").unwrap();
        doc.put(&ing, "quantity", 1.0).unwrap();
        doc.put(&ing, "unit", "can").unwrap();

        doc
    }

    #[test]
    fn test_read_all_dishes() {
        let doc = create_test_dish_doc();
        let dishes = read_all_dishes(&doc).unwrap();

        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].name, "Test Pasta");
    }

    #[test]
    fn test_read_dish_by_id() {
        let doc = create_test_dish_doc();
        let id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440001").unwrap();

        let dish = read_dish_by_id(&doc, id).unwrap();
        assert!(dish.is_some());
        assert_eq!(dish.unwrap().name, "Test Pasta");
    }

    #[test]
    fn test_read_dish_by_id_not_found() {
        let doc = create_test_dish_doc();
        let id = Uuid::new_v4();

        let dish = read_dish_by_id(&doc, id).unwrap();
        assert!(dish.is_none());
    }

    #[test]
    fn test_search_dishes_by_name() {
        let doc = create_test_dish_doc();
        let dishes = search_dishes(&doc, "pasta").unwrap();

        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].name, "Test Pasta");
    }

    #[test]
    fn test_search_dishes_by_tag() {
        let doc = create_test_dish_doc();
        let dishes = search_dishes(&doc, "italian").unwrap();

        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].name, "Test Pasta");
    }

    #[test]
    fn test_search_dishes_by_ingredient() {
        let doc = create_test_dish_doc();
        let dishes = search_dishes(&doc, "tomato").unwrap();

        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].ingredients[1].name, "San Marzano tomato");
    }

    #[test]
    fn test_search_dishes_is_case_insensitive() {
        let doc = create_test_dish_doc();
        let dishes = search_dishes(&doc, "TOMATO").unwrap();

        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].name, "Test Pasta");
    }

    #[test]
    fn test_filter_dishes_by_tag() {
        let doc = create_test_dish_doc();
        let dishes = filter_dishes_by_tag(&doc, "italian").unwrap();

        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].name, "Test Pasta");
    }

    #[test]
    fn test_read_ingredients() {
        let doc = create_test_dish_doc();
        let dishes = read_all_dishes(&doc).unwrap();

        assert_eq!(dishes[0].ingredients.len(), 2);
        assert_eq!(dishes[0].ingredients[0].name, "pasta");
        assert_eq!(dishes[0].ingredients[0].quantity, 200.0);
        assert_eq!(dishes[0].ingredients[0].unit, "g");
        assert_eq!(dishes[0].ingredients[1].name, "San Marzano tomato");
        assert_eq!(dishes[0].ingredients[1].quantity, 1.0);
        assert_eq!(dishes[0].ingredients[1].unit, "can");
    }

    #[test]
    fn test_read_ingredient_quantity_from_scalar_string() {
        let mut doc = create_test_dish_doc();
        let dish_id = "550e8400-e29b-41d4-a716-446655440001";
        let (_, dish_obj) = doc.get(ROOT, dish_id).unwrap().unwrap();
        let (_, ingredients) = doc.get(&dish_obj, "ingredients").unwrap().unwrap();
        let ingredient = doc.insert_object(&ingredients, 2, ObjType::Map).unwrap();
        doc.put(&ingredient, "name", "salt").unwrap();
        doc.put(&ingredient, "quantity", "2").unwrap();
        doc.put(&ingredient, "unit", "tsp").unwrap();

        let dishes = read_all_dishes(&doc).unwrap();

        assert_eq!(dishes[0].ingredients[2].name, "salt");
        assert_eq!(dishes[0].ingredients[2].quantity, 2.0);
        assert_eq!(dishes[0].ingredients[2].unit, "tsp");
    }

    fn create_test_mealplan_doc() -> AutoCommit {
        let mut doc = AutoCommit::new();
        let plan_id = "550e8400-e29b-41d4-a716-446655440002";

        let plan_obj = doc.put_object(ROOT, plan_id, ObjType::Map).unwrap();
        doc.put(&plan_obj, "date", "2025-01-15").unwrap();
        doc.put(&plan_obj, "meal_type", "dinner").unwrap();
        doc.put(&plan_obj, "title", "Test Dinner").unwrap();
        doc.put(&plan_obj, "cook", "Chef").unwrap();
        doc.put(&plan_obj, "created_by", "testuser").unwrap();
        doc.put(&plan_obj, "created_at", "2025-01-01T00:00:00Z")
            .unwrap();
        doc.put(&plan_obj, "updated_at", "2025-01-01T00:00:00Z")
            .unwrap();

        let dish_ids = doc
            .put_object(&plan_obj, "dish_ids", ObjType::List)
            .unwrap();
        doc.insert(&dish_ids, 0, "550e8400-e29b-41d4-a716-446655440001")
            .unwrap();

        doc
    }

    #[test]
    fn test_read_all_mealplans() {
        let doc = create_test_mealplan_doc();
        let plans = read_all_mealplans(&doc).unwrap();

        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].title, "Test Dinner");
        assert!(!plans[0].uses_leftovers);
    }

    #[test]
    fn test_list_mealplans_by_date_range() {
        let doc = create_test_mealplan_doc();
        let from = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let to = NaiveDate::from_ymd_opt(2025, 1, 31).unwrap();

        let plans = list_mealplans_by_date_range(&doc, from, to).unwrap();
        assert_eq!(plans.len(), 1);
    }

    #[test]
    fn test_get_mealplan_by_date_and_type() {
        let doc = create_test_mealplan_doc();
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();

        let plan = get_mealplan_by_date_and_type(&doc, date, MealType::Dinner).unwrap();
        assert!(plan.is_some());
        assert_eq!(plan.unwrap().title, "Test Dinner");
    }

    #[test]
    fn test_read_mealplan_with_uses_leftovers() {
        let mut doc = create_test_mealplan_doc();
        let plan_id = "550e8400-e29b-41d4-a716-446655440002";
        let (_, plan_obj) = doc.get(ROOT, plan_id).unwrap().unwrap();
        doc.put(&plan_obj, "uses_leftovers", true).unwrap();

        let plans = read_all_mealplans(&doc).unwrap();
        assert_eq!(plans.len(), 1);
        assert!(plans[0].uses_leftovers);
    }

    fn create_test_meallog_doc() -> AutoCommit {
        let mut doc = AutoCommit::new();
        let log_id = "550e8400-e29b-41d4-a716-446655440003";

        let log_obj = doc.put_object(ROOT, log_id, ObjType::Map).unwrap();
        doc.put(&log_obj, "date", "2025-01-15").unwrap();
        doc.put(&log_obj, "meal_type", "lunch").unwrap();
        doc.put(&log_obj, "notes", "Delicious!").unwrap();
        doc.put(&log_obj, "created_by", "testuser").unwrap();
        doc.put(&log_obj, "created_at", "2025-01-01T00:00:00Z")
            .unwrap();

        // Add dish snapshot
        let dishes = doc.put_object(&log_obj, "dishes", ObjType::List).unwrap();
        let dish = doc.insert_object(&dishes, 0, ObjType::Map).unwrap();
        doc.put(&dish, "id", "550e8400-e29b-41d4-a716-446655440001")
            .unwrap();
        doc.put(&dish, "name", "Snapshot Pasta").unwrap();
        doc.put(&dish, "instructions", "Cook it").unwrap();
        doc.put(&dish, "created_by", "testuser").unwrap();
        let _ = doc.put_object(&dish, "tags", ObjType::List).unwrap();
        let _ = doc.put_object(&dish, "ingredients", ObjType::List).unwrap();

        doc
    }

    #[test]
    fn test_read_all_meallogs() {
        let doc = create_test_meallog_doc();
        let logs = read_all_meallogs(&doc).unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, Some("Delicious!".to_string()));
    }

    #[test]
    fn test_read_meallog_with_dish_snapshots() {
        let doc = create_test_meallog_doc();
        let logs = read_all_meallogs(&doc).unwrap();

        assert_eq!(logs[0].dishes.len(), 1);
        assert_eq!(logs[0].dishes[0].name, "Snapshot Pasta");
        assert_eq!(logs[0].portion_for(logs[0].dishes[0].id), 1.0);
    }

    #[test]
    fn test_read_meallog_with_fractional_portion() {
        let mut doc = create_test_meallog_doc();
        let log_id = "550e8400-e29b-41d4-a716-446655440003";
        let (_, log_obj) = doc.get(ROOT, log_id).unwrap().unwrap();
        let portions = doc
            .put_object(&log_obj, "dish_portions", ObjType::Map)
            .unwrap();
        let dish_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440001").unwrap();
        doc.put(&portions, dish_id.to_string(), 0.5).unwrap();

        let logs = read_all_meallogs(&doc).unwrap();

        assert_eq!(logs[0].portion_for(dish_id), 0.5);
    }

    #[test]
    fn test_read_meallog_with_web_dish_references() {
        let mut doc = AutoCommit::new();
        let log_id = "550e8400-e29b-41d4-a716-446655440003";
        let dish_id = "550e8400-e29b-41d4-a716-446655440001";

        let log_obj = doc.put_object(ROOT, log_id, ObjType::Map).unwrap();
        doc.put(&log_obj, "date", "2025-01-15").unwrap();
        doc.put(&log_obj, "meal_type", "lunch").unwrap();
        doc.put(&log_obj, "created_by", "testuser").unwrap();
        doc.put(&log_obj, "created_at", "2025-01-01T00:00:00Z")
            .unwrap();

        let dishes = doc.put_object(&log_obj, "dishes", ObjType::List).unwrap();
        doc.insert(&dishes, 0, dish_id).unwrap();

        let logs = read_all_meallogs(&doc).unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].dishes.len(), 1);
        assert_eq!(logs[0].dishes[0].id.to_string(), dish_id);
        assert_eq!(logs[0].dishes[0].name, format!("Dish {}", dish_id));
    }

    #[test]
    fn test_read_meallog_reports_malformed_root_record_context() {
        let mut doc = AutoCommit::new();
        let log_id = "550e8400-e29b-41d4-a716-446655440003";
        doc.put(ROOT, log_id, "not-a-meal-log").unwrap();

        let err = read_all_meallogs(&doc).unwrap_err();

        assert!(matches!(err, ReaderError::MalformedData(_)));
        assert!(err.to_string().contains(log_id));
        assert!(err.to_string().contains("expected map"));
    }

    #[test]
    fn test_list_meallogs_by_date_range() {
        let doc = create_test_meallog_doc();
        let from = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let to = NaiveDate::from_ymd_opt(2025, 1, 31).unwrap();

        let logs = list_meallogs_by_date_range(&doc, from, to).unwrap();
        assert_eq!(logs.len(), 1);
    }

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
