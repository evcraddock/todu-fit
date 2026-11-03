//! Existing shopping document readers, extracted without schema conversion.
use super::{get_string, ReaderError};
use crate::{ManualItem, ShoppingCart};
use automerge::{AutoCommit, ObjId, ReadDoc, ROOT};

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
