#![allow(dead_code)]

//! Automerge document schemas for Todu Fit entities.
//!
//! Each document type wraps an Automerge document and provides type-safe
//! operations for the corresponding entity type. Documents are structured as
//! maps where keys are UUID strings and values are the entity objects.
//!
//! # Document Schemas
//!
//! ## DishesDoc
//! ```text
//! {
//!   "<uuid>": {
//!     "id": "<uuid>",
//!     "name": "string",
//!     "ingredients": [...],
//!     "instructions": "string",
//!     "nutrients": [...] | null,
//!     "prep_time": number | null,
//!     "cook_time": number | null,
//!     "servings": number | null,
//!     "tags": [...],
//!     "image_url": "string" | null,
//!     "source_url": "string" | null,
//!     "created_by": "string",
//!     "created_at": "iso8601",
//!     "updated_at": "iso8601"
//!   },
//!   ...
//! }
//! ```
//!
//! ## MealPlansDoc
//! ```text
//! {
//!   "<uuid>": {
//!     "id": "<uuid>",
//!     "date": "YYYY-MM-DD",
//!     "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
//!     "title": "string",
//!     "cook": "string",
//!     "dishes": [...],
//!     "created_by": "string",
//!     "created_at": "iso8601",
//!     "updated_at": "iso8601"
//!   },
//!   ...
//! }
//! ```
//!
//! ## MealLogsDoc
//! ```text
//! {
//!   "<uuid>": {
//!     "id": "<uuid>",
//!     "date": "YYYY-MM-DD",
//!     "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
//!     "mealplan_id": "<uuid>" | null,
//!     "dishes": [...],
//!     "notes": "string" | null,
//!     "created_by": "string",
//!     "created_at": "iso8601"
//!   },
//!   ...
//! }
//! ```
//!
//! ## HydrationDoc
//! ```text
//! {
//!   "settings": {
//!     "daily_goal_ml": 2366,
//!     "preferred_unit": "oz",
//!     "quick_add_presets_ml": [237, 355, 473, 500, 750]
//!   },
//!   "<uuid>": {
//!     "consumed_at": "iso8601",
//!     "amount_ml": 500,
//!     "created_at": "iso8601",
//!     "updated_at": "iso8601"
//!   }
//! }
//! ```

#![cfg_attr(not(test), allow(dead_code))]

use automerge::{AutoCommit, ReadDoc};

/// Automerge document for storing dishes.
///
/// Structure: Map of dish_id (UUID string) -> Dish object
///
/// # Example
///
/// ```ignore
/// use crate::sync::schema::DishesDoc;
///
/// let doc = DishesDoc::new();
/// assert!(doc.is_empty());
/// ```
pub struct DishesDoc {
    doc: AutoCommit,
}

impl DishesDoc {
    /// Creates a new empty dishes document.
    pub fn new() -> Self {
        Self {
            doc: AutoCommit::new(),
        }
    }

    /// Returns a reference to the underlying Automerge document.
    pub fn doc(&self) -> &AutoCommit {
        &self.doc
    }

    /// Returns a mutable reference to the underlying Automerge document.
    pub fn doc_mut(&mut self) -> &mut AutoCommit {
        &mut self.doc
    }

    /// Returns true if the document contains no dishes.
    pub fn is_empty(&self) -> bool {
        self.doc.length(automerge::ROOT) == 0
    }

    /// Returns the number of dishes in the document.
    pub fn len(&self) -> usize {
        self.doc.length(automerge::ROOT)
    }
}

impl Default for DishesDoc {
    fn default() -> Self {
        Self::new()
    }
}

/// Automerge document for storing meal plans.
///
/// Structure: Map of mealplan_id (UUID string) -> MealPlan object
///
/// # Example
///
/// ```ignore
/// use crate::sync::schema::MealPlansDoc;
///
/// let doc = MealPlansDoc::new();
/// assert!(doc.is_empty());
/// ```
pub struct MealPlansDoc {
    doc: AutoCommit,
}

impl MealPlansDoc {
    /// Creates a new empty meal plans document.
    pub fn new() -> Self {
        Self {
            doc: AutoCommit::new(),
        }
    }

    /// Returns a reference to the underlying Automerge document.
    pub fn doc(&self) -> &AutoCommit {
        &self.doc
    }

    /// Returns a mutable reference to the underlying Automerge document.
    pub fn doc_mut(&mut self) -> &mut AutoCommit {
        &mut self.doc
    }

    /// Returns true if the document contains no meal plans.
    pub fn is_empty(&self) -> bool {
        self.doc.length(automerge::ROOT) == 0
    }

    /// Returns the number of meal plans in the document.
    pub fn len(&self) -> usize {
        self.doc.length(automerge::ROOT)
    }
}

impl Default for MealPlansDoc {
    fn default() -> Self {
        Self::new()
    }
}

/// Automerge document for storing meal logs.
///
/// Structure: Map of meallog_id (UUID string) -> MealLog object
///
/// # Example
///
/// ```ignore
/// use crate::sync::schema::MealLogsDoc;
///
/// let doc = MealLogsDoc::new();
/// assert!(doc.is_empty());
/// ```
pub struct MealLogsDoc {
    doc: AutoCommit,
}

impl MealLogsDoc {
    /// Creates a new empty meal logs document.
    pub fn new() -> Self {
        Self {
            doc: AutoCommit::new(),
        }
    }

    /// Returns a reference to the underlying Automerge document.
    pub fn doc(&self) -> &AutoCommit {
        &self.doc
    }

    /// Returns a mutable reference to the underlying Automerge document.
    pub fn doc_mut(&mut self) -> &mut AutoCommit {
        &mut self.doc
    }

    /// Returns true if the document contains no meal logs.
    pub fn is_empty(&self) -> bool {
        self.doc.length(automerge::ROOT) == 0
    }

    /// Returns the number of meal logs in the document.
    pub fn len(&self) -> usize {
        self.doc.length(automerge::ROOT)
    }
}

impl Default for MealLogsDoc {
    fn default() -> Self {
        Self::new()
    }
}

/// Automerge document for storing personal hydration data.
pub struct HydrationDoc {
    doc: AutoCommit,
}

impl HydrationDoc {
    pub fn new() -> Self {
        Self {
            doc: AutoCommit::new(),
        }
    }

    pub fn doc(&self) -> &AutoCommit {
        &self.doc
    }

    pub fn doc_mut(&mut self) -> &mut AutoCommit {
        &mut self.doc
    }

    pub fn is_empty(&self) -> bool {
        self.doc.length(automerge::ROOT) == 0
    }

    pub fn len(&self) -> usize {
        self.doc.length(automerge::ROOT)
    }
}

impl Default for HydrationDoc {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dishes_doc_new() {
        let doc = DishesDoc::new();
        assert!(doc.is_empty());
        assert_eq!(doc.len(), 0);
    }

    #[test]
    fn test_dishes_doc_default() {
        let doc = DishesDoc::default();
        assert!(doc.is_empty());
    }

    #[test]
    fn test_mealplans_doc_new() {
        let doc = MealPlansDoc::new();
        assert!(doc.is_empty());
        assert_eq!(doc.len(), 0);
    }

    #[test]
    fn test_mealplans_doc_default() {
        let doc = MealPlansDoc::default();
        assert!(doc.is_empty());
    }

    #[test]
    fn test_meallogs_doc_new() {
        let doc = MealLogsDoc::new();
        assert!(doc.is_empty());
        assert_eq!(doc.len(), 0);
    }

    #[test]
    fn test_meallogs_doc_default() {
        let doc = MealLogsDoc::default();
        assert!(doc.is_empty());
    }

    #[test]
    fn test_hydration_doc_new() {
        let doc = HydrationDoc::new();
        assert!(doc.is_empty());
        assert_eq!(doc.len(), 0);
    }

    #[test]
    fn test_hydration_doc_default() {
        let doc = HydrationDoc::default();
        assert!(doc.is_empty());
    }
}
