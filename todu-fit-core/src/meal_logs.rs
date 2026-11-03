//! Local meal log repository that reads/writes Automerge documents.
//!
//! Network synchronization remains an explicit caller responsibility.
//! Log creation snapshots dish nutrients so history remains independent of
//! subsequent canonical dish edits or deletion.
//!
//! This module provides a repository layer that uses the user's personal
//! meallogs document. Identity must be initialized first.

use std::path::PathBuf;

use automerge::AutoCommit;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::{DocumentId, MultiDocStorage};

use crate::automerge as writer;
use crate::automerge::reader::{
    list_meallogs_by_date_range, read_all_meallogs, read_meallog_by_id, ReaderError,
};
use crate::context::{resolve_user_context, GroupContextError};
use crate::models::{MealLog, MealPlan, MealType};
use crate::{DishError, DishRepository};
use std::collections::HashMap;

/// Error type for local meal log operations.
#[derive(Debug)]
pub enum MealLogError {
    /// Reader error (parsing Automerge data).
    Reader(ReaderError),
    /// MealLog not found.
    NotFound(String),
    /// User context error.
    UserContext(GroupContextError),
    /// Multi-storage error.
    MultiStorage(crate::MultiStorageError),
}

impl std::fmt::Display for MealLogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MealLogError::Reader(e) => write!(f, "Reader error: {}", e),
            MealLogError::NotFound(id) => write!(f, "MealLog not found: {}", id),
            MealLogError::UserContext(e) => write!(f, "{}", e),
            MealLogError::MultiStorage(e) => write!(f, "Storage error: {}", e),
        }
    }
}

impl std::error::Error for MealLogError {}

impl From<ReaderError> for MealLogError {
    fn from(e: ReaderError) -> Self {
        MealLogError::Reader(e)
    }
}

impl From<GroupContextError> for MealLogError {
    fn from(e: GroupContextError) -> Self {
        MealLogError::UserContext(e)
    }
}

impl From<crate::MultiStorageError> for MealLogError {
    fn from(e: crate::MultiStorageError) -> Self {
        MealLogError::MultiStorage(e)
    }
}

/// Typed inputs for the existing unplanned logging operation.
pub struct MealLogDraft {
    pub date: NaiveDate,
    pub meal_type: MealType,
    pub dish_references: Vec<String>,
    pub created_by: String,
    pub notes: Option<String>,
}

/// Local meal log repository.
///
/// All operations work directly with Automerge documents.
/// Uses the user's personal meallogs document in a caller-supplied data root,
/// independently of group selection. Adapters own parsing, output and sync timing.
pub struct MealLogRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
}

impl MealLogRepository {
    /// Log a plan using currently available dishes, skipping missing references
    /// exactly as the CLI did before extraction. Existing snapshot encoding is unchanged.
    ///
    /// Composed operations retain the underlying repository errors (and missing-dish
    /// string errors) so adapters can preserve their existing diagnostics.
    pub fn log_from_plan(
        &self,
        plan: &MealPlan,
        dishes: &DishRepository,
        created_by: &str,
        notes: Option<&str>,
    ) -> Result<MealLog, Box<dyn std::error::Error>> {
        let mut plan_dishes = Vec::new();
        for dish_id in &plan.dish_ids {
            if let Some(dish) = dishes.get_by_id(*dish_id)? {
                plan_dishes.push(dish);
            }
        }
        let mut log = MealLog::new(plan.date, plan.meal_type, created_by)
            .with_mealplan_id(plan.id)
            .with_dishes(plan_dishes);
        if let Some(notes) = notes {
            log = log.with_notes(notes);
        }
        Ok(self.create(&log)?)
    }

    /// Resolve dish UUIDs/names in order and persist an unplanned log.
    pub fn log_unplanned(
        &self,
        draft: &MealLogDraft,
        dishes: &DishRepository,
    ) -> Result<MealLog, Box<dyn std::error::Error>> {
        let mut resolved_dishes = Vec::new();
        for dish_ref in &draft.dish_references {
            let dish = if let Ok(uuid) = Uuid::parse_str(dish_ref) {
                dishes.get_by_id(uuid)?
            } else {
                dishes.get_by_name(dish_ref)?
            };
            match dish {
                Some(dish) => resolved_dishes.push(dish),
                None => return Err(format!("Dish not found: {}", dish_ref).into()),
            }
        }
        let mut log = MealLog::new(draft.date, draft.meal_type, &draft.created_by)
            .with_dishes(resolved_dishes);
        if let Some(notes) = &draft.notes {
            log = log.with_notes(notes);
        }
        Ok(self.create(&log)?)
    }

    /// Creates a new local meal log repository.
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
        }
    }

    /// Resolves the meallogs document ID from user context.
    fn resolve_doc_id(&self) -> Result<DocumentId, MealLogError> {
        let ctx = resolve_user_context(&self.data_dir)?;
        Ok(ctx.meallogs_doc_id)
    }

    /// Loads the meallogs Automerge document, or creates a new empty one.
    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), MealLogError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes)
                .map_err(|e| MealLogError::Reader(ReaderError::AutomergeError(e.to_string())))?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    /// Saves the document to storage.
    fn save_doc(&self, doc: &mut AutoCommit, doc_id: &DocumentId) -> Result<(), MealLogError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    /// Creates a new meal log.
    pub fn create(&self, log: &MealLog) -> Result<MealLog, MealLogError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write to Automerge
        writer::write_meallog(&mut doc, log);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the log (read back to confirm)
        self.get_by_id(log.id)?
            .ok_or_else(|| MealLogError::NotFound(log.id.to_string()))
    }

    /// Updates an existing meal log.
    pub fn update(&self, log: &MealLog) -> Result<MealLog, MealLogError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write updated log to Automerge (overwrites existing)
        writer::write_meallog(&mut doc, log);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the updated log
        self.get_by_id(log.id)?
            .ok_or_else(|| MealLogError::NotFound(log.id.to_string()))
    }

    /// Deletes a meal log by ID.
    pub fn delete(&self, id: Uuid) -> Result<(), MealLogError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Delete from Automerge
        writer::delete_meallog(&mut doc, id);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        Ok(())
    }

    /// Gets a meal log by ID.
    pub fn get_by_id(&self, id: Uuid) -> Result<Option<MealLog>, MealLogError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_meallog_by_id(&doc, id)?)
    }

    /// Lists all meal logs.
    pub fn list(&self) -> Result<Vec<MealLog>, MealLogError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_meallogs(&doc)?)
    }

    /// Lists meal logs within a date range.
    pub fn list_range(&self, from: NaiveDate, to: NaiveDate) -> Result<Vec<MealLog>, MealLogError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(list_meallogs_by_date_range(&doc, from, to)?)
    }
}

/// Resolve only legacy UUID-reference placeholders for display, leaving embedded
/// snapshots and stored documents untouched. Missing references remain placeholders.
pub fn hydrate_referenced_dishes(
    logs: &mut [MealLog],
    dishes: &DishRepository,
) -> Result<(), DishError> {
    for log in logs {
        for dish in &mut log.dishes {
            if is_dish_reference_placeholder(dish) {
                if let Some(resolved) = dishes.get_by_id(dish.id)? {
                    *dish = resolved;
                }
            }
        }
    }

    Ok(())
}

fn is_dish_reference_placeholder(dish: &crate::models::Dish) -> bool {
    dish.name == format!("Dish {}", dish.id)
        && dish.ingredients.is_empty()
        && dish.instructions.is_empty()
        && dish.nutrients.is_none()
        && dish.created_by.is_empty()
}

/// Calculate total nutrients for a meal by summing all dish nutrients
pub fn calculate_meal_nutrients(log: &MealLog) -> HashMap<String, f64> {
    let mut totals: HashMap<String, f64> = HashMap::new();

    for dish in &log.dishes {
        let portion = log.portion_for(dish.id);
        if let Some(nutrients) = &dish.nutrients {
            for nutrient in nutrients {
                *totals.entry(nutrient.name.clone()).or_insert(0.0) += nutrient.amount * portion;
            }
        }
    }

    totals
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Dish, Nutrient};

    #[test]
    fn mixed_planned_and_unplanned_history_includes_portioned_nutrients() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 10).unwrap();
        let planned_dish = Dish::new("Planned chicken", "test").with_nutrients(vec![
            Nutrient::new("calories", 600.0, "kcal"),
            Nutrient::new("protein", 40.0, "g"),
        ]);
        let planned_dish_id = planned_dish.id;
        let planned = MealLog::new(date, MealType::Lunch, "test")
            .with_mealplan_id(Uuid::new_v4())
            .with_dishes(vec![planned_dish])
            .with_dish_portion(planned_dish_id, 0.5);

        let unplanned_dish = Dish::new("Unplanned shake", "test").with_nutrients(vec![
            Nutrient::new("calories", 200.0, "kcal"),
            Nutrient::new("protein", 20.0, "g"),
        ]);
        let unplanned =
            MealLog::new(date, MealType::Snack, "test").with_dishes(vec![unplanned_dish]);
        let logs = vec![planned, unplanned];

        let json = serde_json::to_value(&logs).unwrap();
        assert_eq!(json[0]["dishes"][0]["nutrients"][0]["amount"], 600.0);

        let mut daily_totals = HashMap::new();
        for log in &logs {
            for (name, amount) in calculate_meal_nutrients(log) {
                *daily_totals.entry(name).or_insert(0.0) += amount;
            }
        }

        assert_eq!(daily_totals.get("calories"), Some(&500.0));
        assert_eq!(daily_totals.get("protein"), Some(&40.0));
    }
}
