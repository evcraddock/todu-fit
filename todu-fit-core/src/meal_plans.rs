//! Local meal plan repository that reads/writes Automerge documents.
//!
//! Network synchronization remains an explicit caller responsibility.
//!
//! This module provides a repository layer that uses the current group's
//! mealplans document. Identity must be initialized first.

use std::path::PathBuf;

use automerge::AutoCommit;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::{DocumentId, MultiDocStorage};

use crate::automerge as writer;
use crate::automerge::reader::{
    get_mealplan_by_date_and_type, get_mealplans_by_date, list_mealplans_by_date_range,
    read_all_mealplans, read_mealplan_by_id, ReaderError,
};
use crate::context::{resolve_group_context, GroupContextError};
use crate::models::{MealPlan, MealType};
use crate::DishRepository;

/// Error type for local meal plan operations.
#[derive(Debug)]
pub enum MealPlanError {
    /// Reader error (parsing Automerge data).
    Reader(ReaderError),
    /// MealPlan not found.
    NotFound(String),
    /// Dish not found.
    DishNotFound(String),
    /// Dish already in plan.
    DishAlreadyInPlan(String),
    /// Dish not in plan.
    DishNotInPlan(String),
    /// Group context error.
    GroupContext(GroupContextError),
    /// Multi-storage error.
    MultiStorage(crate::MultiStorageError),
}

impl std::fmt::Display for MealPlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MealPlanError::Reader(e) => write!(f, "Reader error: {}", e),
            MealPlanError::NotFound(id) => write!(f, "MealPlan not found: {}", id),
            MealPlanError::DishNotFound(id) => write!(f, "Dish not found: {}", id),
            MealPlanError::DishAlreadyInPlan(name) => {
                write!(f, "Dish '{}' is already in this meal plan", name)
            }
            MealPlanError::DishNotInPlan(name) => {
                write!(f, "Dish '{}' is not in this meal plan", name)
            }
            MealPlanError::GroupContext(e) => write!(f, "{}", e),
            MealPlanError::MultiStorage(e) => write!(f, "Storage error: {}", e),
        }
    }
}

impl std::error::Error for MealPlanError {}

impl From<ReaderError> for MealPlanError {
    fn from(e: ReaderError) -> Self {
        MealPlanError::Reader(e)
    }
}

impl From<GroupContextError> for MealPlanError {
    fn from(e: GroupContextError) -> Self {
        MealPlanError::GroupContext(e)
    }
}

impl From<crate::MultiStorageError> for MealPlanError {
    fn from(e: crate::MultiStorageError) -> Self {
        MealPlanError::MultiStorage(e)
    }
}

/// Parsed inputs for creating a plan with the existing title/cook defaults.
pub struct MealPlanDraft {
    pub date: NaiveDate,
    pub meal_type: MealType,
    pub title: Option<String>,
    pub cook: Option<String>,
    pub dish_references: Vec<String>,
    pub uses_leftovers: bool,
    pub created_by: String,
}

/// Existing field-update semantics; absent fields, IDs and timestamps are retained.
#[derive(Default)]
pub struct MealPlanUpdate {
    pub date: Option<NaiveDate>,
    pub meal_type: Option<MealType>,
    pub title: Option<String>,
    pub cook: Option<String>,
    pub uses_leftovers: Option<bool>,
}

impl MealPlanUpdate {
    /// Apply parsed fields without changing timestamps, identity or dish membership.
    pub fn apply_to(&self, plan: &mut MealPlan) {
        if let Some(date) = self.date {
            plan.date = date;
        }
        if let Some(meal_type) = self.meal_type {
            plan.meal_type = meal_type;
        }
        if let Some(title) = &self.title {
            plan.title = title.clone();
        }
        if let Some(cook) = &self.cook {
            plan.cook = cook.clone();
        }
        if let Some(uses_leftovers) = self.uses_leftovers {
            plan.uses_leftovers = uses_leftovers;
        }
    }
}

/// Local meal plan repository.
///
/// All operations work directly with Automerge documents.
/// Uses the selected group's mealplans document in a caller-supplied data root.
/// Adapters own configuration parsing, output and synchronization timing.
pub struct MealPlanRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
    group_override: Option<String>,
}

impl MealPlanRepository {
    /// Create a plan after resolving dish UUIDs/names, preserving duplicate references
    /// and the existing default title and cook. Underlying errors are retained.
    pub fn create_with_dishes(
        &self,
        draft: &MealPlanDraft,
        dishes: &DishRepository,
    ) -> Result<MealPlan, Box<dyn std::error::Error>> {
        let title = draft.title.clone().unwrap_or_else(|| {
            format!(
                "{} on {}",
                capitalize(&draft.meal_type.to_string()),
                draft.date
            )
        });
        let cook = draft.cook.as_deref().unwrap_or(&draft.created_by);
        let mut plan = MealPlan::new(draft.date, draft.meal_type, title, &draft.created_by)
            .with_cook(cook)
            .with_uses_leftovers(draft.uses_leftovers);
        let mut resolved_ids = Vec::new();
        for dish_ref in &draft.dish_references {
            let dish = if let Ok(uuid) = Uuid::parse_str(dish_ref) {
                dishes.get_by_id(uuid)?
            } else {
                dishes.get_by_name(dish_ref)?
            };
            match dish {
                Some(dish) => resolved_ids.push(dish.id),
                None => return Err(format!("Dish not found: {}", dish_ref).into()),
            }
        }
        plan.dish_ids = resolved_ids;
        Ok(self.create(&plan)?)
    }

    /// Inclusive date-range query with the optional meal-type filter.
    pub fn list_range_filtered(
        &self,
        from: NaiveDate,
        to: NaiveDate,
        meal_type: Option<MealType>,
    ) -> Result<Vec<MealPlan>, MealPlanError> {
        let mut plans = self.list_range(from, to)?;
        if let Some(meal_type) = meal_type {
            plans.retain(|plan| plan.meal_type == meal_type);
        }
        Ok(plans)
    }

    /// Creates a new local meal plan repository.
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            group_override: None,
        }
    }

    /// Creates a new repository with a specific group override.
    pub fn with_group(data_dir: PathBuf, group_name: &str) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            group_override: Some(group_name.to_string()),
        }
    }

    /// Resolves the mealplans document ID from the current group context.
    fn resolve_doc_id(&self) -> Result<DocumentId, MealPlanError> {
        let ctx = resolve_group_context(&self.data_dir, self.group_override.as_deref())?;
        Ok(ctx.mealplans_doc_id)
    }

    /// Loads the mealplans Automerge document, or creates a new empty one.
    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), MealPlanError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes)
                .map_err(|e| MealPlanError::Reader(ReaderError::AutomergeError(e.to_string())))?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    fn dish_reference_keys(
        &self,
    ) -> Result<std::collections::HashMap<Uuid, String>, MealPlanError> {
        let ctx = resolve_group_context(&self.data_dir, self.group_override.as_deref())?;
        match self.storage.load(&ctx.dishes_doc_id)? {
            Some(bytes) => {
                let doc = AutoCommit::load(&bytes)
                    .map_err(|e| ReaderError::AutomergeError(e.to_string()))?;
                Ok(crate::automerge::reader::uuid_keys(&doc))
            }
            None => Ok(Default::default()),
        }
    }

    /// Saves the document to storage.
    fn save_doc(&self, doc: &mut AutoCommit, doc_id: &DocumentId) -> Result<(), MealPlanError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    /// Creates a new meal plan.
    pub fn create(&self, plan: &MealPlan) -> Result<MealPlan, MealPlanError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write to Automerge
        writer::write_mealplan_with_references(&mut doc, plan, &self.dish_reference_keys()?);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the plan (read back to confirm)
        self.get_by_id(plan.id)?
            .ok_or_else(|| MealPlanError::NotFound(plan.id.to_string()))
    }

    /// Updates an existing meal plan.
    pub fn update(&self, plan: &MealPlan) -> Result<MealPlan, MealPlanError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write updated plan to Automerge (overwrites existing)
        writer::write_mealplan_with_references(&mut doc, plan, &self.dish_reference_keys()?);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the updated plan
        self.get_by_id(plan.id)?
            .ok_or_else(|| MealPlanError::NotFound(plan.id.to_string()))
    }

    /// Deletes a meal plan by ID.
    pub fn delete(&self, id: Uuid) -> Result<(), MealPlanError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Delete from Automerge
        writer::delete_mealplan(&mut doc, id);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        Ok(())
    }

    /// Gets a meal plan by ID.
    pub fn get_by_id(&self, id: Uuid) -> Result<Option<MealPlan>, MealPlanError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_mealplan_by_id(&doc, id)?)
    }

    /// Lists all meal plans.
    pub fn list(&self) -> Result<Vec<MealPlan>, MealPlanError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_mealplans(&doc)?)
    }

    /// Lists meal plans within a date range.
    pub fn list_range(
        &self,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<MealPlan>, MealPlanError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(list_mealplans_by_date_range(&doc, from, to)?)
    }

    /// Gets meal plans for a specific date.
    pub fn get_by_date(&self, date: NaiveDate) -> Result<Vec<MealPlan>, MealPlanError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(get_mealplans_by_date(&doc, date)?)
    }

    /// Gets a meal plan for a specific date and meal type.
    pub fn get_by_date_and_type(
        &self,
        date: NaiveDate,
        meal_type: MealType,
    ) -> Result<Option<MealPlan>, MealPlanError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(get_mealplan_by_date_and_type(&doc, date, meal_type)?)
    }

    /// Adds a dish to a meal plan.
    pub fn add_dish(&self, plan_id: Uuid, dish_id: Uuid) -> Result<(), MealPlanError> {
        let mut plan = self
            .get_by_id(plan_id)?
            .ok_or_else(|| MealPlanError::NotFound(plan_id.to_string()))?;

        // Check if already in plan
        if plan.dish_ids.contains(&dish_id) {
            return Err(MealPlanError::DishAlreadyInPlan(dish_id.to_string()));
        }

        plan.dish_ids.push(dish_id);
        self.update(&plan)?;

        Ok(())
    }

    /// Removes a dish from a meal plan.
    pub fn remove_dish(&self, plan_id: Uuid, dish_id: Uuid) -> Result<(), MealPlanError> {
        let mut plan = self
            .get_by_id(plan_id)?
            .ok_or_else(|| MealPlanError::NotFound(plan_id.to_string()))?;

        // Check if in plan
        if !plan.dish_ids.contains(&dish_id) {
            return Err(MealPlanError::DishNotInPlan(dish_id.to_string()));
        }

        plan.dish_ids.retain(|id| id != &dish_id);
        self.update(&plan)?;

        Ok(())
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}
