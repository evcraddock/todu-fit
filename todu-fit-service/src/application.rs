use crate::error;
use api::{ErrorCode as Code, Operation as Op, Value as V};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;
use todu_fit_core as core;
use todu_fit_protocol as api;
use uuid::Uuid;

pub struct Context {
    pub created_by: String,
    pub default_timezone: fn() -> String,
}
impl Default for Context {
    fn default() -> Self {
        Self {
            created_by: "default".into(),
            default_timezone: || "UTC".into(),
        }
    }
}
fn convert<T: DeserializeOwned>(value: impl Serialize) -> Result<T, api::ApiError> {
    serde_json::from_value(serde_json::to_value(value).map_err(crate::internal)?)
        .map_err(crate::internal)
}
fn invalid(message: impl Into<String>) -> api::ApiError {
    error(Code::InvalidInput, message)
}
fn name(value: &str) -> Result<&str, api::ApiError> {
    if value.trim().is_empty() {
        Err(invalid("Name cannot be empty"))
    } else {
        Ok(value.trim())
    }
}
fn dates(from: NaiveDate, to: NaiveDate) -> Result<(), api::ApiError> {
    if from > to {
        Err(invalid("from must be on or before to"))
    } else {
        Ok(())
    }
}
fn week_start(date: NaiveDate) -> Result<NaiveDate, api::ApiError> {
    let start = date
        .checked_sub_signed(Duration::days(date.weekday().num_days_from_sunday().into()))
        .ok_or_else(|| invalid("Week is outside the supported date range"))?;
    start
        .checked_add_signed(Duration::days(6))
        .ok_or_else(|| invalid("Week is outside the supported date range"))?;
    Ok(core::shopping::week_start(date))
}
fn failure(e: impl Into<Box<dyn std::error::Error>>) -> api::ApiError {
    let e = e.into();
    let code = if let Some(e) = e.downcast_ref::<api::ApiError>() {
        return e.clone();
    } else if let Some(e) = e.downcast_ref::<core::DishError>() {
        match e {
            core::DishError::NotFound(_) => Code::NotFound,
            core::DishError::GroupContext(e) => return context_error(e),
            _ => Code::Storage,
        }
    } else if let Some(e) = e.downcast_ref::<core::MealPlanError>() {
        match e {
            core::MealPlanError::NotFound(_)
            | core::MealPlanError::DishNotFound(_)
            | core::MealPlanError::DishNotInPlan(_) => Code::NotFound,
            core::MealPlanError::DishAlreadyInPlan(_) => Code::Conflict,
            core::MealPlanError::GroupContext(e) => return context_error(e),
            _ => Code::Storage,
        }
    } else if let Some(e) = e.downcast_ref::<core::MealLogError>() {
        match e {
            core::MealLogError::NotFound(_) => Code::NotFound,
            core::MealLogError::UserContext(e) => return context_error(e),
            _ => Code::Storage,
        }
    } else if let Some(e) = e.downcast_ref::<core::HydrationError>() {
        match e {
            core::HydrationError::NotFound(_) => Code::NotFound,
            core::HydrationError::Validation(_) => Code::InvalidInput,
            core::HydrationError::UserContext(e) => return context_error(e),
            _ => Code::Storage,
        }
    } else if let Some(e) = e.downcast_ref::<core::ShoppingError>() {
        match e {
            core::ShoppingError::NotFound(_) | core::ShoppingError::ItemNotFound(_) => {
                Code::NotFound
            }
            core::ShoppingError::NotManualItem(_) => Code::InvalidInput,
            core::ShoppingError::GroupContext(e) => return context_error(e),
            _ => Code::Storage,
        }
    } else if let Some(e) = e.downcast_ref::<core::IdentityError>() {
        match e {
            core::IdentityError::NotInitialized => Code::NotInitialized,
            core::IdentityError::AlreadyInitialized | core::IdentityError::AlreadyInGroup(_) => {
                Code::Conflict
            }
            core::IdentityError::DocumentNotFound(_) => Code::PendingSync,
            _ => Code::Storage,
        }
    } else {
        Code::Storage
    };
    error(code, e.to_string())
}
fn context_error(e: &core::context::GroupContextError) -> api::ApiError {
    use core::context::GroupContextError as E;
    error(
        match e {
            E::NotInitialized => Code::NotInitialized,
            E::PendingSync | E::GroupNotSynced(_) => Code::PendingSync,
            E::NoGroups | E::GroupNotFound(_) => Code::NotFound,
            E::IdentityError(_) => Code::Storage,
        },
        e.to_string(),
    )
}
fn selected(path: &Path) -> Result<Option<String>, api::ApiError> {
    match std::fs::read_to_string(path.join("current_group")) {
        Ok(s) => Ok(Some(s.trim().into())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(failure(e)),
    }
}
fn groups(path: &Path, identity: &core::Identity) -> Result<Vec<api::Group>, api::ApiError> {
    let selected = selected(path)?;
    let refs = identity.list_groups().map_err(failure)?;
    refs.iter()
        .enumerate()
        .map(|(i, g)| {
            let doc = match identity.load_group(&g.doc_id) {
                Ok(doc) => Some(doc),
                Err(core::IdentityError::DocumentNotFound(_)) => None,
                Err(e) => return Err(failure(e)),
            };
            Ok(api::Group {
                id: g.doc_id.to_bs58check(),
                name: g.name.clone(),
                selected: selected
                    .as_ref()
                    .map(|s| s.eq_ignore_ascii_case(&g.name))
                    .unwrap_or(i == 0),
                dishes_doc_id: doc.as_ref().map(|d| d.dishes_doc_id.to_bs58check()),
                mealplans_doc_id: doc.as_ref().map(|d| d.mealplans_doc_id.to_bs58check()),
                shopping_carts_doc_id: doc.as_ref().map(|d| d.shopping_carts_doc_id.to_bs58check()),
            })
        })
        .collect()
}
fn identity_view(path: &Path, identity: &core::Identity) -> Result<api::Identity, api::ApiError> {
    let root = identity.root_doc_id().map_err(failure)?;
    let state = match identity.state() {
        core::IdentityState::Uninitialized => api::IdentityState::Uninitialized,
        core::IdentityState::PendingSync => api::IdentityState::PendingSync,
        core::IdentityState::Initialized => api::IdentityState::Initialized,
    };
    let groups = if matches!(state, api::IdentityState::Initialized) {
        groups(path, identity)?
    } else {
        vec![]
    };
    Ok(api::Identity {
        state,
        root_id: root.map(|r| r.to_bs58check()),
        groups,
    })
}
fn resolve_dish(repo: &core::DishRepository, reference: &str) -> Result<core::Dish, api::ApiError> {
    let dish = if let Ok(id) = Uuid::parse_str(reference) {
        repo.get_by_id(id)
    } else {
        repo.get_by_name(reference)
    }
    .map_err(failure)?;
    dish.ok_or_else(|| error(Code::NotFound, format!("Dish not found: {reference}")))
}
fn plan(repo: &core::MealPlanRepository, id: Uuid) -> Result<core::MealPlan, api::ApiError> {
    repo.get_by_id(id)
        .map_err(failure)?
        .ok_or_else(|| error(Code::NotFound, format!("Meal plan not found: {id}")))
}
fn plan_view(
    value: core::MealPlan,
    dishes: &core::DishRepository,
) -> Result<api::Plan, api::ApiError> {
    let mut found = vec![];
    for id in &value.dish_ids {
        if let Some(d) = dishes.get_by_id(*id).map_err(failure)? {
            found.push(convert(d)?);
        }
    }
    Ok(api::Plan {
        plan: convert(value)?,
        dishes: found,
    })
}
fn meal_view(log: core::MealLog) -> Result<api::Meal, api::ApiError> {
    let nutrients = core::meal_logs::calculate_meal_nutrients(&log);
    Ok(api::Meal {
        log: convert(log)?,
        nutrients,
    })
}
fn apply_dish(
    dish: &mut core::Dish,
    n: Option<String>,
    fields: &api::DishFields,
) -> Result<(), api::ApiError> {
    if let Some(n) = &n {
        name(n)?;
    }
    core::dishes::DishUpdate {
        name: n,
        instructions: fields.instructions.clone(),
        prep_time: fields.prep_time,
        cook_time: fields.cook_time,
        servings: fields.servings,
        image_url: fields.image_url.clone(),
        source_url: fields.source_url.clone(),
        add_tags: fields.add_tags.clone(),
        remove_tags: fields.remove_tags.clone(),
        nutrients: convert(&fields.nutrients)?,
    }
    .apply_to(dish);
    Ok(())
}
fn mutation(changed: bool, count: usize) -> V {
    V::Mutation { changed, count }
}

/// Local application dispatch. The caller supplies transaction staging, never a client-selected path.
pub fn execute(path: &Path, context: &Context, operation: &Op) -> Result<V, api::ApiError> {
    let storage = core::MultiDocStorage::new(path.to_owned());
    let identity = core::Identity::new(storage.clone());
    let dishes = core::DishRepository::new(path.to_owned());
    let plans = core::MealPlanRepository::new(path.to_owned());
    let logs = core::MealLogRepository::new(path.to_owned());
    let shopping = core::ShoppingRepository::new(path.to_owned());
    let water = core::HydrationRepository::with_timezone_provider(
        path.to_owned(),
        context.default_timezone,
    );
    match operation {
        Op::IdentityGet => Ok(V::Identity(identity_view(path, &identity)?)),
        Op::IdentityCreate { replace } | Op::IdentityJoin { replace, .. } => {
            // Validate join ID before any replacement. Existing document formats remain unchanged.
            let join = if let Op::IdentityJoin { root_id, .. } = operation {
                Some(
                    core::DocumentId::from_bs58check(root_id)
                        .map_err(|e| invalid(e.to_string()))?,
                )
            } else {
                None
            };
            let exists = identity.root_doc_id().map_err(failure)?.is_some();
            if exists && !replace {
                return Err(error(
                    Code::Conflict,
                    "Identity already exists; explicit replace required",
                ));
            }
            if exists {
                for id in storage.list().map_err(failure)? {
                    storage.delete(&id).map_err(failure)?;
                }
                std::fs::remove_file(path.join("root_doc_id")).map_err(failure)?;
                if path.join("current_group").exists() {
                    std::fs::remove_file(path.join("current_group")).map_err(failure)?;
                }
            }
            if let Some(id) = join {
                identity.initialize_join(id).map_err(failure)?;
            } else {
                identity.initialize_new().map_err(failure)?;
            }
            Ok(V::Identity(identity_view(path, &identity)?))
        }
        Op::GroupsList => Ok(V::Groups(groups(path, &identity)?)),
        Op::GroupGet { name } => {
            let gs = groups(path, &identity)?;
            Ok(V::Group(
                gs.into_iter()
                    .find(|g| {
                        name.as_ref()
                            .map(|s| g.name.eq_ignore_ascii_case(s))
                            .unwrap_or(g.selected)
                    })
                    .ok_or_else(|| error(Code::NotFound, "Group not found"))?,
            ))
        }
        Op::GroupCreate { name: n } => {
            let n = name(n)?;
            let id = identity.create_group(n).map_err(failure)?;
            if identity.list_groups().map_err(failure)?.len() == 1 {
                std::fs::write(path.join("current_group"), n).map_err(failure)?;
            }
            Ok(V::Group(
                groups(path, &identity)?
                    .into_iter()
                    .find(|g| g.id == id.to_bs58check())
                    .unwrap(),
            ))
        }
        Op::GroupJoin { root_id, name: n } => {
            let id =
                core::DocumentId::from_bs58check(root_id).map_err(|e| invalid(e.to_string()))?;
            let n = name(n.as_deref().unwrap_or("Shared Group"))?;
            identity.join_group(id, n).map_err(failure)?;
            if identity.list_groups().map_err(failure)?.len() == 1 {
                std::fs::write(path.join("current_group"), n).map_err(failure)?;
            }
            Ok(V::Group(
                groups(path, &identity)?
                    .into_iter()
                    .find(|g| g.id == id.to_bs58check())
                    .unwrap(),
            ))
        }
        Op::GroupSelect { name: n } | Op::GroupLeave { name: n } => {
            let g = groups(path, &identity)?
                .into_iter()
                .find(|g| g.name.eq_ignore_ascii_case(n))
                .ok_or_else(|| error(Code::NotFound, "Group not found"))?;
            if matches!(operation, Op::GroupSelect { .. }) {
                std::fs::write(path.join("current_group"), &g.name).map_err(failure)?;
            } else {
                identity
                    .leave_group(
                        &core::DocumentId::from_bs58check(&g.id)
                            .map_err(|e| invalid(e.to_string()))?,
                    )
                    .map_err(failure)?;
                if selected(path)?.is_some_and(|s| s.eq_ignore_ascii_case(n)) {
                    std::fs::remove_file(path.join("current_group")).map_err(failure)?;
                }
            }
            Ok(V::Groups(groups(path, &identity)?))
        }
        Op::DishCreate { name: n, fields } => {
            let mut dish = core::Dish::new(name(n)?, &context.created_by);
            apply_dish(&mut dish, None, fields)?;
            Ok(V::Dish(convert(dishes.create(&dish).map_err(failure)?)?))
        }
        Op::DishesList { tag, query } => {
            let mut found = if let Some(q) = query {
                if q.trim().is_empty() {
                    return Err(invalid("Search query cannot be empty"));
                }
                dishes.search(q)
            } else {
                dishes.list()
            }
            .map_err(failure)?;
            if let Some(tag) = tag {
                let ids = dishes.filter_by_tag(tag).map_err(failure)?;
                found.retain(|d| ids.iter().any(|f| f.id == d.id));
            }
            Ok(V::Dishes(convert(found)?))
        }
        Op::DishGet { identifier } => Ok(V::Dish(convert(resolve_dish(&dishes, identifier)?)?)),
        Op::DishUpdate {
            identifier,
            name,
            fields,
        } => {
            let mut d = resolve_dish(&dishes, identifier)?;
            apply_dish(&mut d, name.clone(), fields)?;
            Ok(V::Dish(convert(dishes.update(&d).map_err(failure)?)?))
        }
        Op::DishDelete { identifier } => {
            let d = resolve_dish(&dishes, identifier)?;
            dishes.delete(d.id).map_err(failure)?;
            Ok(V::Dish(convert(d)?))
        }
        Op::DishAddIngredient {
            identifier,
            ingredient,
        } => {
            let d = resolve_dish(&dishes, identifier)?;
            name(&ingredient.name)?;
            if !ingredient.quantity.is_finite() || ingredient.quantity <= 0.0 {
                return Err(invalid("Quantity must be a positive number"));
            }
            dishes
                .add_ingredient(d.id, convert(ingredient)?)
                .map_err(failure)?;
            Ok(V::Dish(convert(resolve_dish(&dishes, identifier)?)?))
        }
        Op::DishRemoveIngredient { identifier, name } => {
            let d = resolve_dish(&dishes, identifier)?;
            if !d
                .ingredients
                .iter()
                .any(|i| i.name.to_lowercase() == name.to_lowercase())
            {
                return Err(error(
                    Code::NotFound,
                    format!("Ingredient not found: {name}"),
                ));
            }
            dishes.remove_ingredient(d.id, name).map_err(failure)?;
            Ok(V::Dish(convert(resolve_dish(&dishes, identifier)?)?))
        }
        Op::PlanCreate {
            date,
            meal_type,
            title,
            cook,
            dishes: refs,
            uses_leftovers,
        } => {
            for r in refs {
                resolve_dish(&dishes, r)?;
            }
            let draft = core::meal_plans::MealPlanDraft {
                date: *date,
                meal_type: convert(meal_type)?,
                title: title.clone(),
                cook: cook.clone(),
                dish_references: refs.clone(),
                uses_leftovers: *uses_leftovers,
                created_by: context.created_by.clone(),
            };
            Ok(V::Plan(plan_view(
                plans.create_with_dishes(&draft, &dishes).map_err(failure)?,
                &dishes,
            )?))
        }
        Op::PlansList {
            from,
            to,
            meal_type,
        } => {
            dates(*from, *to)?;
            Ok(V::Plans(convert(
                plans
                    .list_range_filtered(*from, *to, convert(meal_type)?)
                    .map_err(failure)?,
            )?))
        }
        Op::PlanGet {
            identifier,
            meal_type,
        } => {
            let found = if let Ok(id) = Uuid::parse_str(identifier) {
                vec![plan(&plans, id)?]
            } else {
                let date = NaiveDate::parse_from_str(identifier, "%Y-%m-%d")
                    .map_err(|_| invalid("Expected a plan UUID or YYYY-MM-DD"))?;
                if let Some(meal_type) = meal_type {
                    plans
                        .get_by_date_and_type(date, convert(meal_type)?)
                        .map_err(failure)?
                        .into_iter()
                        .collect()
                } else {
                    plans.get_by_date(date).map_err(failure)?
                }
            };
            if found.is_empty() {
                return Err(error(Code::NotFound, "Meal plan not found"));
            }
            Ok(V::PlanMatches(
                found
                    .into_iter()
                    .map(|p| plan_view(p, &dishes))
                    .collect::<Result<_, _>>()?,
            ))
        }
        Op::PlanUpdate { id, fields } => {
            let mut p = plan(&plans, *id)?;
            core::meal_plans::MealPlanUpdate {
                date: fields.date,
                meal_type: convert(fields.meal_type)?,
                title: fields.title.clone(),
                cook: fields.cook.clone(),
                uses_leftovers: fields.uses_leftovers,
            }
            .apply_to(&mut p);
            Ok(V::Plan(plan_view(
                plans.update(&p).map_err(failure)?,
                &dishes,
            )?))
        }
        Op::PlanDelete { id } => {
            let p = plan(&plans, *id)?;
            plans.delete(*id).map_err(failure)?;
            Ok(V::Plan(plan_view(p, &dishes)?))
        }
        Op::PlanAddDish { id, dish } | Op::PlanRemoveDish { id, dish } => {
            plan(&plans, *id)?;
            let d = resolve_dish(&dishes, dish)?;
            if matches!(operation, Op::PlanAddDish { .. }) {
                plans.add_dish(*id, d.id)
            } else {
                plans.remove_dish(*id, d.id)
            }
            .map_err(failure)?;
            Ok(V::Plan(plan_view(plan(&plans, *id)?, &dishes)?))
        }
        Op::MealLogPlan { plan_id, notes } => {
            let p = plan(&plans, *plan_id)?;
            Ok(V::Meal(meal_view(
                logs.log_from_plan(&p, &dishes, &context.created_by, notes.as_deref())
                    .map_err(failure)?,
            )?))
        }
        Op::MealLogUnplanned {
            date,
            meal_type,
            dishes: refs,
            notes,
        } => {
            if refs.is_empty() {
                return Err(invalid("At least one dish is required"));
            }
            for r in refs {
                resolve_dish(&dishes, r)?;
            }
            let draft = core::meal_logs::MealLogDraft {
                date: *date,
                meal_type: convert(meal_type)?,
                dish_references: refs.clone(),
                created_by: context.created_by.clone(),
                notes: notes.clone(),
            };
            Ok(V::Meal(meal_view(
                logs.log_unplanned(&draft, &dishes).map_err(failure)?,
            )?))
        }
        Op::MealsHistory { from, to } => {
            dates(*from, *to)?;
            let mut found = logs.list_range(*from, *to).map_err(failure)?;
            core::meal_logs::hydrate_referenced_dishes(&mut found, &dishes).map_err(failure)?;
            Ok(V::Meals(
                found.into_iter().map(meal_view).collect::<Result<_, _>>()?,
            ))
        }
        Op::MealDelete { id } => {
            let log = logs
                .get_by_id(*id)
                .map_err(failure)?
                .ok_or_else(|| error(Code::NotFound, "Meal log not found"))?;
            logs.delete(*id).map_err(failure)?;
            Ok(V::Meal(meal_view(log)?))
        }
        Op::ShoppingList { week } => {
            let result = shopping
                .list_for_week(week_start(*week)?, &plans, &dishes)
                .map_err(failure)?;
            Ok(V::Shopping(api::Shopping {
                cart: convert(result.cart)?,
                items: convert(result.items)?,
            }))
        }
        Op::ShoppingAdd { week, item } => {
            name(&item.name)?;
            let changed = shopping
                .add_manual_item(&week_start(*week)?.to_string(), convert(item)?)
                .map_err(failure)?;
            Ok(mutation(changed, usize::from(changed)))
        }
        Op::ShoppingRemove { week, name } => {
            let changed = shopping
                .remove_manual_item(&week_start(*week)?.to_string(), name)
                .map_err(failure)?;
            Ok(mutation(changed, usize::from(changed)))
        }
        Op::ShoppingSetChecked {
            week,
            name: n,
            checked,
        } => {
            name(n)?;
            let changed = shopping
                .set_checked(&week_start(*week)?.to_string(), n, *checked)
                .map_err(failure)?;
            Ok(mutation(changed, usize::from(changed)))
        }
        Op::ShoppingClearChecked { week } => {
            let count = shopping
                .clear_checked(&week_start(*week)?.to_string())
                .map_err(failure)?;
            Ok(mutation(count > 0, count))
        }
        Op::WaterAdd { amount, unit, at } => {
            if !amount.is_finite() || *amount <= 0.0 {
                return Err(invalid("Amount must be positive and finite"));
            }
            let entry =
                core::WaterEntry::from_amount(*amount, convert(unit)?, at.unwrap_or_else(Utc::now))
                    .map_err(invalid)?;
            Ok(V::WaterEntry(convert(
                water.create_entry(&entry).map_err(failure)?,
            )?))
        }
        Op::WaterRecent { limit } => {
            if *limit > 10000 {
                return Err(invalid("Limit must not exceed 10000"));
            }
            water.get_settings().map_err(failure)?;
            Ok(V::WaterEntries(convert(
                water.recent_entries(*limit).map_err(failure)?,
            )?))
        }
        Op::WaterSettingsGet => Ok(V::WaterSettings(convert(
            water.get_settings().map_err(failure)?,
        )?)),
        Op::WaterSettingsUpdate { fields } => {
            if fields.goal.is_some_and(|n| !n.is_finite() || n <= 0.0)
                || fields.presets.iter().any(|n| !n.is_finite() || *n <= 0.0)
            {
                return Err(invalid("Goal and presets must be positive and finite"));
            }
            let mut settings = water.get_settings().map_err(failure)?;
            core::hydration::HydrationSettingsUpdate {
                goal: fields.goal,
                unit: convert(fields.unit)?,
                display_unit: convert(fields.display_unit)?,
                timezone: fields.timezone.clone(),
                presets: fields.presets.clone(),
            }
            .apply_to(&mut settings);
            settings.validate().map_err(invalid)?;
            Ok(V::WaterSettings(convert(
                water.save_settings(&settings).map_err(failure)?,
            )?))
        }
        Op::WaterDelete { id } => {
            let entry = water
                .get_by_id(*id)
                .map_err(failure)?
                .ok_or_else(|| error(Code::NotFound, "Water entry not found"))?;
            water.delete_entry(*id).map_err(failure)?;
            Ok(V::WaterEntry(convert(entry)?))
        }
        Op::WaterToday | Op::WaterHistory { .. } => {
            let settings = water.get_settings().map_err(failure)?;
            let timezone: chrono_tz::Tz = settings
                .timezone
                .parse()
                .map_err(|_| invalid("Invalid stored timezone"))?;
            let today = Utc::now().with_timezone(&timezone).date_naive();
            let (from, to) = if let Op::WaterHistory { from, to } = operation {
                (*from, *to)
            } else {
                (today, today)
            };
            dates(from, to)?;
            if (to - from).num_days() > 3660 {
                return Err(invalid("Water history range exceeds 3661 days"));
            }
            to.checked_sub_signed(Duration::days(6))
                .ok_or_else(|| invalid("Seven-day average is outside the supported date range"))?;
            let all = water.list_entries().map_err(failure)?;
            let mut entries = core::hydration::entries_in_date_range(&all, from, to, timezone);
            entries.sort_by_key(|e| e.consumed_at);
            let mut days = vec![];
            let mut date = from;
            loop {
                days.push(api::WaterDay {
                    date,
                    total_ml: core::daily_total_ml_in_timezone(&all, date, timezone),
                    goal_progress: core::goal_progress_in_timezone(
                        &all,
                        date,
                        settings.daily_goal_ml,
                        timezone,
                    ),
                });
                if date == to {
                    break;
                }
                date = date.succ_opt().ok_or_else(|| invalid("Date overflow"))?;
            }
            Ok(V::WaterReport(api::WaterReport {
                entries: convert(entries)?,
                days,
                streak_days: core::streak_days_in_timezone(
                    &all,
                    to,
                    settings.daily_goal_ml,
                    timezone,
                ),
                average_daily_ml_7d: core::average_daily_ml_in_timezone(&all, to, 7, timezone),
                settings: convert(settings)?,
            }))
        }
        Op::ConfigGet | Op::SyncStart | Op::Status | Op::Changes { .. } => Err(error(
            Code::Unavailable,
            "Host operation must be handled by the daemon",
        )),
    }
}
