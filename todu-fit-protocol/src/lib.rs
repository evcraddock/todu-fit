//! Application protocol v2. No CLI parser, terminal rendering, filesystem, or Core dependency.
pub mod models;
use chrono::{DateTime, NaiveDate, Utc};
pub use models::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;
pub const VERSION: u32 = 2;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub id: Uuid,
    pub operation: Operation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub version: u32,
    pub id: Uuid,
    pub revision: u64,
    pub outcome: Outcome,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Ok { value: Box<Value> },
    Error { error: ApiError },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidInput,
    UnsupportedVersion,
    NotInitialized,
    PendingSync,
    NotFound,
    Ambiguous,
    Conflict,
    Storage,
    Unavailable,
    Internal,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for ApiError {}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct DishFields {
    pub clear_prep_time: bool,
    pub clear_cook_time: bool,
    pub clear_servings: bool,
    pub ingredients: Option<Vec<Ingredient>>,
    pub instructions: Option<String>,
    pub prep_time: Option<i32>,
    pub cook_time: Option<i32>,
    pub servings: Option<i32>,
    pub image_url: Option<String>,
    pub source_url: Option<String>,
    pub nutrients: Option<Vec<Nutrient>>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct PlanFields {
    pub dishes: Option<Vec<String>>,
    pub date: Option<NaiveDate>,
    pub meal_type: Option<MealType>,
    pub title: Option<String>,
    pub cook: Option<String>,
    pub uses_leftovers: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct HydrationFields {
    pub goal: Option<f64>,
    pub unit: Option<HydrationUnit>,
    pub display_unit: Option<HydrationUnit>,
    pub timezone: Option<String>,
    pub presets: Vec<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    SetupStatus,
    SetupStart {
        root_id: Option<String>,
        server_url: Option<String>,
        group_name: Option<String>,
    },
    IdentityGet,
    IdentityCreate {
        #[serde(default)]
        replace: bool,
    },
    IdentityJoin {
        root_id: String,
        #[serde(default)]
        replace: bool,
    },
    GroupsList,
    GroupGet {
        name: Option<String>,
    },
    GroupCreate {
        name: String,
    },
    GroupJoin {
        root_id: String,
        name: Option<String>,
    },
    GroupSelect {
        name: String,
    },
    GroupLeave {
        name: String,
    },
    ConfigGet,
    DishCreate {
        name: String,
        #[serde(default)]
        fields: DishFields,
    },
    DishesList {
        tag: Option<String>,
        query: Option<String>,
    },
    DishGet {
        identifier: String,
    },
    DishUpdate {
        identifier: String,
        name: Option<String>,
        #[serde(default)]
        fields: DishFields,
    },
    DishDelete {
        identifier: String,
    },
    DishAddIngredient {
        identifier: String,
        ingredient: Ingredient,
    },
    DishRemoveIngredient {
        identifier: String,
        name: String,
    },
    PlanCreate {
        date: NaiveDate,
        meal_type: MealType,
        title: Option<String>,
        cook: Option<String>,
        #[serde(default)]
        dishes: Vec<String>,
        #[serde(default)]
        uses_leftovers: bool,
    },
    PlansList {
        from: NaiveDate,
        to: NaiveDate,
        meal_type: Option<MealType>,
    },
    PlanGet {
        identifier: String,
        meal_type: Option<MealType>,
    },
    PlanUpdate {
        id: Uuid,
        fields: PlanFields,
    },
    PlanDelete {
        id: Uuid,
    },
    PlanAddDish {
        id: Uuid,
        dish: String,
    },
    PlanRemoveDish {
        id: Uuid,
        dish: String,
    },
    MealLogPlan {
        plan_id: Uuid,
        notes: Option<String>,
    },
    MealLogUnplanned {
        date: NaiveDate,
        meal_type: MealType,
        dishes: Vec<String>,
        notes: Option<String>,
    },
    MealSave {
        id: Option<Uuid>,
        date: NaiveDate,
        meal_type: MealType,
        dishes: Vec<String>,
        #[serde(default)]
        portions: HashMap<Uuid, f64>,
        notes: Option<String>,
        plan_id: Option<Uuid>,
    },
    MealsHistory {
        from: NaiveDate,
        to: NaiveDate,
    },
    MealDelete {
        id: Uuid,
    },
    ShoppingList {
        week: NaiveDate,
    },
    ShoppingAdd {
        week: NaiveDate,
        item: ManualItem,
    },
    ShoppingEdit {
        week: NaiveDate,
        name: String,
        item: ManualItem,
    },
    ShoppingRemove {
        week: NaiveDate,
        name: String,
    },
    ShoppingSetChecked {
        week: NaiveDate,
        name: String,
        checked: bool,
    },
    ShoppingClearChecked {
        week: NaiveDate,
    },
    WaterAdd {
        amount: f64,
        unit: HydrationUnit,
        at: Option<DateTime<Utc>>,
    },
    WaterToday,
    WaterRecent {
        limit: usize,
    },
    WaterHistory {
        from: NaiveDate,
        to: NaiveDate,
    },
    WaterSettingsGet,
    WaterSettingsUpdate {
        fields: HydrationFields,
    },
    WaterDelete {
        id: Uuid,
    },
    SyncStart,
    Status,
    Changes {
        after: u64,
    },
}
impl Operation {
    pub fn remembers_result(&self) -> bool {
        !matches!(
            self,
            Self::IdentityGet
                | Self::GroupsList
                | Self::GroupGet { .. }
                | Self::ConfigGet
                | Self::DishesList { .. }
                | Self::DishGet { .. }
                | Self::PlansList { .. }
                | Self::PlanGet { .. }
                | Self::MealsHistory { .. }
                | Self::ShoppingList { .. }
                | Self::WaterToday
                | Self::WaterRecent { .. }
                | Self::WaterHistory { .. }
                | Self::WaterSettingsGet
                | Self::Status
                | Self::Changes { .. }
                | Self::SetupStatus
                | Self::SetupStart { .. }
                | Self::SyncStart
        )
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub selected: bool,
    pub dishes_doc_id: Option<String>,
    pub mealplans_doc_id: Option<String>,
    pub shopping_carts_doc_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityState {
    Uninitialized,
    PendingSync,
    Initialized,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub state: IdentityState,
    pub root_id: Option<String>,
    pub groups: Vec<Group>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Configuration {
    pub created_by: String,
    pub sync_server_url: Option<String>,
    pub auto_sync: bool,
    pub default_timezone: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meal {
    pub log: MealLog,
    pub nutrients: HashMap<String, f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub plan: MealPlan,
    pub dishes: Vec<Dish>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shopping {
    pub cart: ShoppingCart,
    pub items: Vec<ShoppingItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterDay {
    pub date: NaiveDate,
    pub total_ml: i32,
    pub goal_progress: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterReport {
    pub settings: HydrationSettings,
    pub entries: Vec<WaterEntry>,
    pub days: Vec<WaterDay>,
    pub streak_days: usize,
    pub average_daily_ml_7d: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SyncState {
    Idle,
    Running,
    Failed { message: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub revision: u64,
    pub sync: SyncState,
    pub changed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum Value {
    Setup(SetupStatus),
    Identity(Identity),
    Groups(Vec<Group>),
    Group(Group),
    Configuration(Configuration),
    Dish(Dish),
    Dishes(Vec<Dish>),
    Plan(Plan),
    PlanMatches(Vec<Plan>),
    Plans(Vec<MealPlan>),
    Meal(Meal),
    Meals(Vec<Meal>),
    Shopping(Shopping),
    WaterEntry(WaterEntry),
    WaterEntries(Vec<WaterEntry>),
    WaterSettings(HydrationSettings),
    WaterReport(WaterReport),
    Mutation { changed: bool, count: usize },
    Status(Status),
}

/// Initial setup remains staged until every required document is available.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupStatus {
    pub state: String,
    pub message: String,
    pub completed_documents: usize,
}
