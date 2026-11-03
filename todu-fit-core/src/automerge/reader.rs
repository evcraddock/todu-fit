//! Reusable document readers and their scalar/list fields.

mod meals;
pub use meals::{
    get_mealplan_by_date_and_type, get_mealplans_by_date, list_meallogs_by_date_range,
    list_mealplans_by_date_range, read_all_meallogs, read_all_mealplans, read_meallog_by_id,
    read_mealplan_by_id,
};

use automerge::{AutoCommit, ObjId, ReadDoc, ROOT};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::models::{Dish, Ingredient, Nutrient};

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

/// Read the nested ingredient list, preserving numeric/string/text quantity support.
pub fn read_ingredients(doc: &AutoCommit, obj_id: &ObjId) -> Result<Vec<Ingredient>, ReaderError> {
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

/// Read the nested nutrient list; absent or empty lists return `None`.
pub fn read_nutrients(
    doc: &AutoCommit,
    obj_id: &ObjId,
) -> Result<Option<Vec<Nutrient>>, ReaderError> {
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

/// Read a scalar string without converting collaborative text objects.
pub fn get_string(
    doc: &AutoCommit,
    obj_id: &ObjId,
    key: &str,
) -> Result<Option<String>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        Ok(value.into_string().ok())
    } else {
        Ok(None)
    }
}

/// Read an integer scalar field.
pub fn get_i64(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<i64>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        Ok(value.as_i64())
    } else {
        Ok(None)
    }
}

/// Read a floating-point scalar, falling back to an integer scalar.
pub fn get_f64(doc: &AutoCommit, obj_id: &ObjId, key: &str) -> Result<Option<f64>, ReaderError> {
    if let Some((value, _)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        // Try f64 first, then fall back to i64 (for values stored as integers)
        if let Some(f) = value.as_f64() {
            Ok(Some(f))
        } else if let Some(i) = value.as_i64() {
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
pub fn get_quantity(
    doc: &AutoCommit,
    obj_id: &ObjId,
    key: &str,
) -> Result<Option<f64>, ReaderError> {
    if let Some((value, obj_id_value)) = doc
        .get(obj_id, key)
        .map_err(|e| ReaderError::AutomergeError(e.to_string()))?
    {
        // Try f64 first (CLI writes this format)
        if let Some(f) = value.as_f64() {
            return Ok(Some(f));
        }
        // Try i64 (integers stored numerically)
        if let Some(i) = value.as_i64() {
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

/// Read scalar strings from a list, skipping non-string values.
pub fn read_string_list(
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
}
