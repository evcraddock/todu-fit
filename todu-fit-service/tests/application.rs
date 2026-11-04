use serde_json::{json, Value};
use todu_fit_protocol::{self as api, Outcome};
use todu_fit_service::{
    store::{clean_workspaces, Store},
    transact, Context,
};
struct Fixture {
    root: tempfile::TempDir,
    store: Store,
    context: Context,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        clean_workspaces(root.path()).unwrap();
        let store = Store::open(&root.path().join("db.sqlite")).unwrap();
        Self {
            root,
            store,
            context: Context {
                created_by: "api-test".into(),
                default_timezone: || "America/Chicago".into(),
            },
        }
    }
    fn send(&mut self, operation: Value) -> api::Response {
        self.request(api::Request {
            version: 2,
            id: uuid::Uuid::new_v4(),
            operation: serde_json::from_value(operation).unwrap(),
        })
    }
    fn request(&mut self, r: api::Request) -> api::Response {
        transact(&mut self.store, self.root.path(), &self.context, &r)
    }
    fn ok(&mut self, op: Value) -> Value {
        match self.send(op).outcome {
            Outcome::Ok { value } => serde_json::to_value(value).unwrap()["data"].clone(),
            Outcome::Error { error } => panic!("{error:?}"),
        }
    }
    fn init(&mut self) {
        self.ok(json!({"type":"identity_create"}));
        self.ok(json!({"type":"group_create","name":"Home"}));
    }
}
#[test]
fn identity_group_selection_join_leave_and_explicit_replacement() {
    let mut f = Fixture::new();
    assert_eq!(
        f.ok(json!({"type":"identity_get"}))["state"],
        "uninitialized"
    );
    let identity = f.ok(json!({"type":"identity_create"}));
    let root = identity["root_id"].clone();
    assert!(matches!(
        f.send(json!({"type":"identity_create"})).outcome,
        Outcome::Error {
            error: api::ApiError {
                code: api::ErrorCode::Conflict,
                ..
            }
        }
    ));
    let first = f.ok(json!({"type":"group_create","name":"Home"}));
    assert_eq!(first["selected"], true);
    f.ok(json!({"type":"group_create","name":"Other"}));
    f.ok(json!({"type":"group_select","name":"other"}));
    assert_eq!(f.ok(json!({"type":"group_get"}))["name"], "Other");
    f.ok(json!({"type":"group_leave","name":"Other"}));
    assert_eq!(
        f.ok(json!({"type":"groups_list"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let joined = todu_fit_core::DocumentId::new().to_bs58check();
    let g = f.ok(json!({"type":"group_join","root_id":joined,"name":"Remote"}));
    assert!(g["dishes_doc_id"].is_null());
    assert_eq!(f.ok(json!({"type":"identity_get"}))["root_id"], root);
    let before = f.store.snapshot().unwrap();
    assert!(matches!(
        f.send(json!({"type":"identity_join","root_id":"invalid","replace":true}))
            .outcome,
        Outcome::Error {
            error: api::ApiError {
                code: api::ErrorCode::InvalidInput,
                ..
            }
        }
    ));
    assert_eq!(before, f.store.snapshot().unwrap());
    let exact = todu_fit_core::DocumentId::new().to_bs58check();
    let view = f.ok(json!({"type":"identity_join","root_id":exact,"replace":true}));
    assert_eq!(view["root_id"], exact);
    assert_eq!(view["state"], "pending_sync");
    assert_eq!(f.store.snapshot().unwrap().len(), 1);
}
#[test]
fn dish_fields_search_tags_ingredients_and_delete_return_structured_data() {
    let mut f = Fixture::new();
    f.init();
    let dish=f.ok(json!({"type":"dish_create","name":"Pasta","fields":{"instructions":"Boil","prep_time":10,"cook_time":20,"servings":2,"image_url":"image","source_url":"source","add_tags":["Quick"],"nutrients":[{"name":"calories","amount":200.0,"unit":"kcal"}]}}));
    assert_eq!(dish["created_by"], "api-test");
    let id = dish["id"].clone();
    f.ok(json!({"type":"dish_add_ingredient","identifier":id,"ingredient":{"name":"Salt","quantity":2.0,"unit":"tsp"}}));
    assert_eq!(
        f.ok(json!({"type":"dishes_list","query":"salt","tag":"quick"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let update=f.ok(json!({"type":"dish_update","identifier":"PASTA","name":"New pasta","fields":{"remove_tags":["QUICK"],"add_tags":["Dinner"],"nutrients":[]}}));
    assert_eq!(update["id"], id);
    // Existing Core normalizes an empty nutrient list to None.
    assert!(update["nutrients"].is_null());
    assert_eq!(update["tags"], json!(["Dinner"]));
    f.ok(json!({"type":"dish_remove_ingredient","identifier":id,"name":"SALT"}));
    assert_eq!(
        f.ok(json!({"type":"dish_get","identifier":id}))["ingredients"],
        json!([])
    );
    assert_eq!(
        f.ok(json!({"type":"dish_delete","identifier":id}))["id"],
        id
    );
    assert_eq!(f.ok(json!({"type":"dishes_list"})), json!([]));
}
#[test]
fn plans_logs_nutrients_and_shopping_keep_shared_core_semantics() {
    let mut f = Fixture::new();
    f.init();
    let dish=f.ok(json!({"type":"dish_create","name":"Soup","fields":{"nutrients":[{"name":"protein","amount":12.5,"unit":"g"}]}}));
    f.ok(json!({"type":"dish_add_ingredient","identifier":"Soup","ingredient":{"name":"Beans","quantity":2.0,"unit":"cups"}}));
    let p = f.ok(
        json!({"type":"plan_create","date":"2026-11-03","meal_type":"dinner","dishes":["Soup"]}),
    );
    let pid = p["plan"]["id"].clone();
    assert_eq!(p["plan"]["title"], "Dinner on 2026-11-03");
    assert_eq!(p["plan"]["cook"], "api-test");
    assert_eq!(
        f.ok(json!({"type":"plan_get","identifier":"2026-11-03","meal_type":"dinner"}))[0]["plan"]
            ["id"],
        pid
    );
    assert_eq!(
        f.ok(
            json!({"type":"plans_list","from":"2026-11-03","to":"2026-11-03","meal_type":"dinner"})
        )
        .as_array()
        .unwrap()
        .len(),
        1
    );
    f.ok(json!({"type":"plan_update","id":pid,"fields":{"title":"Updated","cook":"Guest","date":"2026-11-04","meal_type":"lunch","uses_leftovers":true}}));
    assert!(
        f.ok(json!({"type":"shopping_list","week":"2026-11-04"}))["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    f.ok(json!({"type":"plan_update","id":pid,"fields":{"uses_leftovers":false}}));
    assert_eq!(
        f.ok(json!({"type":"shopping_list","week":"2026-11-04"}))["items"][0]["quantity"],
        2.0
    );
    f.ok(json!({"type":"plan_remove_dish","id":pid,"dish":"Soup"}));
    f.ok(json!({"type":"plan_add_dish","id":pid,"dish":dish["id"]}));
    let log = f.ok(json!({"type":"meal_log_plan","plan_id":pid,"notes":"planned"}));
    assert_eq!(log["nutrients"]["protein"], 12.5);
    let unplanned=f.ok(json!({"type":"meal_log_unplanned","date":"2026-11-04","meal_type":"dinner","dishes":["Soup"],"notes":"unplanned"}));
    assert_eq!(
        f.ok(json!({"type":"meals_history","from":"2026-11-04","to":"2026-11-04"}))
            .as_array()
            .unwrap()
            .len(),
        2
    );
    f.ok(json!({"type":"meal_delete","id":log["log"]["id"]}));
    f.ok(json!({"type":"meal_delete","id":unplanned["log"]["id"]}));
    f.ok(json!({"type":"shopping_add","week":"2026-11-04","item":{"name":"Soap","quantity":"2","unit":"bars"}}));
    let checked = f.ok(
        json!({"type":"shopping_set_checked","week":"2026-11-04","name":"SOAP","checked":true}),
    );
    assert_eq!(checked["changed"], true);
    f.ok(json!({"type":"shopping_set_checked","week":"2026-11-04","name":"SOAP","checked":false}));
    f.ok(json!({"type":"shopping_set_checked","week":"2026-11-04","name":"SOAP","checked":true}));
    assert_eq!(
        f.ok(json!({"type":"shopping_clear_checked","week":"2026-11-04"}))["count"],
        1
    );
    assert_eq!(
        f.ok(json!({"type":"shopping_remove","week":"2026-11-04","name":"soap"}))["changed"],
        true
    );
    f.ok(json!({"type":"plan_delete","id":pid}));
}
#[test]
fn hydration_settings_timezone_totals_recent_today_and_delete() {
    let mut f = Fixture::new();
    f.init();
    assert_eq!(
        f.ok(json!({"type":"water_settings_get"}))["timezone"],
        "America/Chicago"
    );
    let settings=f.ok(json!({"type":"water_settings_update","fields":{"goal":1000.0,"unit":"ml","display_unit":"oz","timezone":"America/Chicago","presets":[250.0,500.0]}}));
    assert_eq!(settings["daily_goal_ml"], 1000);
    let water =
        f.ok(json!({"type":"water_add","amount":500.0,"unit":"ml","at":"2026-07-26T03:20:18Z"}));
    let id = water["id"].clone();
    let history = f.ok(json!({"type":"water_history","from":"2026-07-25","to":"2026-07-25"}));
    assert_eq!(history["days"][0]["total_ml"], 500);
    assert_eq!(history["days"][0]["goal_progress"], 0.5);
    assert_eq!(history["entries"][0]["id"], id);
    assert_eq!(f.ok(json!({"type":"water_recent","limit":1}))[0]["id"], id);
    assert_eq!(
        f.ok(json!({"type":"water_today"}))["settings"]["preferred_unit"],
        "oz"
    );
    f.ok(json!({"type":"water_delete","id":id}));
    assert_eq!(f.ok(json!({"type":"water_recent","limit":10})), json!([]));
    let before = f.store.snapshot().unwrap();
    let r = f.send(json!({"type":"water_settings_update","fields":{"timezone":"Invalid/Zone"}}));
    assert!(matches!(
        r.outcome,
        Outcome::Error {
            error: api::ApiError {
                code: api::ErrorCode::InvalidInput,
                ..
            }
        }
    ));
    assert_eq!(before, f.store.snapshot().unwrap());
}
#[test]
fn durable_retry_including_no_op_cannot_apply_later_again() {
    let mut f = Fixture::new();
    f.init();
    let request = api::Request {
        version: 2,
        id: uuid::Uuid::new_v4(),
        operation: serde_json::from_value(
            json!({"type":"shopping_remove","week":"2026-11-04","name":"Soap"}),
        )
        .unwrap(),
    };
    let first = f.request(request.clone());
    f.ok(json!({"type":"shopping_add","week":"2026-11-04","item":{"name":"Soap"}}));
    let mut reopened = Store::open(&f.root.path().join("db.sqlite")).unwrap();
    let retried = transact(&mut reopened, f.root.path(), &f.context, &request);
    assert_eq!(
        serde_json::to_value(first).unwrap(),
        serde_json::to_value(retried).unwrap()
    );
    assert_eq!(
        f.ok(json!({"type":"shopping_list","week":"2026-11-04"}))["cart"]["manual_items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut conflict = request;
    conflict.operation = api::Operation::IdentityGet;
    assert!(matches!(
        f.request(conflict).outcome,
        Outcome::Error {
            error: api::ApiError {
                code: api::ErrorCode::Conflict,
                ..
            }
        }
    ));
}
#[test]
fn failed_application_and_failed_sql_commit_have_no_success_or_partial_state() {
    let mut f = Fixture::new();
    f.init();
    let before = f.store.snapshot().unwrap();
    let r = f.send(
        json!({"type":"plan_create","date":"2026-11-03","meal_type":"dinner","dishes":["missing"]}),
    );
    assert!(matches!(
        r.outcome,
        Outcome::Error {
            error: api::ApiError {
                code: api::ErrorCode::NotFound,
                ..
            }
        }
    ));
    assert_eq!(before, f.store.snapshot().unwrap());
    f.store.db.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'injected disk error'); END;").unwrap();
    let r = f.send(json!({"type":"dish_create","name":"Not acknowledged"}));
    assert!(matches!(
        r.outcome,
        Outcome::Error {
            error: api::ApiError {
                code: api::ErrorCode::Storage,
                ..
            }
        }
    ));
    assert_eq!(before, f.store.snapshot().unwrap());
}

#[test]
fn date_boundaries_and_missing_ingredients_return_errors_without_committing() {
    let mut f = Fixture::new();
    f.init();
    f.ok(json!({"type":"dish_create","name":"Soup"}));
    let revision = f.store.revision().unwrap();
    for operation in [
        json!({"type":"shopping_list","week":chrono::NaiveDate::MIN}),
        json!({"type":"shopping_list","week":chrono::NaiveDate::MAX}),
        json!({"type":"water_history","from":chrono::NaiveDate::MIN,"to":chrono::NaiveDate::MIN}),
        json!({"type":"dish_remove_ingredient","identifier":"Soup","name":"Absent"}),
    ] {
        assert!(matches!(f.send(operation).outcome, Outcome::Error { .. }));
        assert_eq!(f.store.revision().unwrap(), revision);
    }
}

#[test]
fn plan_lookup_by_date_returns_all_matches_and_type_filter_preserves_cli_selection() {
    let mut f = Fixture::new();
    f.init();
    for meal_type in ["lunch", "dinner"] {
        f.ok(json!({"type":"plan_create","date":"2026-11-03","meal_type":meal_type}));
    }
    let plans = f.ok(json!({"type":"plan_get","identifier":"2026-11-03"}));
    assert_eq!(plans.as_array().unwrap().len(), 2);
    let lunch = f.ok(json!({"type":"plan_get","identifier":"2026-11-03","meal_type":"lunch"}));
    assert_eq!(lunch.as_array().unwrap().len(), 1);
    assert_eq!(lunch[0]["plan"]["meal_type"], "lunch");
}

#[test]
fn notes_only_unplanned_meal_preserves_cli_behavior_without_a_group() {
    let mut f = Fixture::new();
    f.ok(json!({"type":"identity_create"}));
    let meal = f.ok(json!({"type":"meal_log_unplanned","date":"2026-11-03","meal_type":"lunch","dishes":[],"notes":"Lunch away from home"}));
    assert_eq!(meal["log"]["dishes"], json!([]));
    assert_eq!(meal["log"]["notes"], "Lunch away from home");
    assert_eq!(meal["nutrients"], json!({}));
    let history = f.ok(json!({"type":"meals_history","from":"2026-11-03","to":"2026-11-03"}));
    assert_eq!(history, json!([meal]));
}

#[test]
fn empty_legacy_group_selection_uses_the_same_fallback_as_core() {
    let mut f = Fixture::new();
    f.init();
    let mut snapshot = f.store.snapshot().unwrap();
    snapshot.insert("current_group".into(), b" \n".to_vec());
    f.store.commit(&snapshot, None).unwrap();
    assert_eq!(f.ok(json!({"type":"group_get"}))["name"], "Home");
    f.ok(json!({"type":"dish_create","name":"Soup"}));
    assert_eq!(f.ok(json!({"type":"dishes_list"}))[0]["name"], "Soup");
}

#[test]
fn desktop_form_saves_are_atomic_and_preserve_historical_snapshots() {
    let mut f = Fixture::new();
    f.init();
    let dish = f.ok(json!({"type":"dish_create","name":"Soup","fields":{"ingredients":[{"name":"Lentils","quantity":2,"unit":"cup"}],"nutrients":[{"name":"calories","amount":300,"unit":"kcal"}]}}));
    let id = dish["id"].as_str().unwrap();
    let before = f.store.snapshot().unwrap();
    assert!(matches!(f.send(json!({"type":"dish_update","identifier":id,"name":"Should not save","fields":{"ingredients":[{"name":"Bad","quantity":-1,"unit":"cup"}]}})).outcome, Outcome::Error { .. }));
    assert_eq!(f.store.snapshot().unwrap(), before);
    let plan =
        f.ok(json!({"type":"plan_create","date":"2026-11-04","meal_type":"dinner","dishes":[id]}));
    let pid = &plan["plan"]["id"];
    let before = f.store.snapshot().unwrap();
    assert!(matches!(f.send(json!({"type":"plan_update","id":pid,"fields":{"title":"Should not save","dishes":["missing dish"]}})).outcome, Outcome::Error { .. }));
    assert_eq!(f.store.snapshot().unwrap(), before);
    let meal = f.ok(json!({"type":"meal_save","date":"2026-11-04","meal_type":"dinner","dishes":[id],"portions":{id:0.5},"plan_id":pid}));
    assert_eq!(meal["nutrients"]["calories"], 150.0);
    f.ok(json!({"type":"dish_update","identifier":id,"fields":{"nutrients":[{"name":"calories","amount":900,"unit":"kcal"}]}}));
    f.ok(json!({"type":"dish_delete","identifier":id}));
    let cleared =
        f.ok(json!({"type":"plan_update","id":pid,"fields":{"dishes":[],"uses_leftovers":true}}));
    assert_eq!(cleared["plan"]["dish_ids"], json!([]));
    f.ok(json!({"type":"plan_delete","id":pid}));
    let edited = f.ok(json!({"type":"meal_save","plan_id":pid,"id":meal["log"]["id"],"date":"2026-11-04","meal_type":"lunch","dishes":[id],"portions":{id:2},"notes":"Updated notes"}));
    assert_eq!(edited["log"]["mealplan_id"], *pid);
    assert_eq!(edited["nutrients"]["calories"], 600.0);
    assert_eq!(edited["log"]["dishes"][0]["name"], "Soup");
    let before = f.store.snapshot().unwrap();
    assert!(matches!(f.send(json!({"type":"meal_save","date":"2026-11-04","meal_type":"dinner","dishes":[],"portions":{id:1}})).outcome, Outcome::Error { .. }));
    assert_eq!(f.store.snapshot().unwrap(), before);
}

#[test]
fn desktop_manual_item_edits_keep_check_state_and_reject_collisions() {
    let mut f = Fixture::new();
    f.init();
    for name in ["Paper", "Soap"] {
        f.ok(json!({"type":"shopping_add","week":"2026-11-04","item":{"name":name}}));
    }
    f.ok(json!({"type":"shopping_set_checked","week":"2026-11-04","name":"Paper","checked":true}));
    f.ok(json!({"type":"shopping_edit","week":"2026-11-04","name":"Paper","item":{"name":"Towels","quantity":"a few","unit":"rolls"}}));
    let cart = f.ok(json!({"type":"shopping_list","week":"2026-11-04"}));
    assert_eq!(cart["cart"]["checked"], json!(["towels"]));
    let before = f.store.snapshot().unwrap();
    assert!(matches!(f.send(json!({"type":"shopping_edit","week":"2026-11-04","name":"Towels","item":{"name":"soap"}})).outcome,Outcome::Error{..}));
    assert_eq!(f.store.snapshot().unwrap(), before);
}

#[test]
fn desktop_can_explicitly_clear_optional_dish_numbers() {
    let mut f = Fixture::new();
    f.init();
    let d=f.ok(json!({"type":"dish_create","name":"Optional fields","fields":{"prep_time":10,"cook_time":20,"servings":4}}));
    let updated=f.ok(json!({"type":"dish_update","identifier":d["id"],"fields":{"clear_prep_time":true,"clear_cook_time":true,"clear_servings":true}}));
    for field in ["prep_time", "cook_time", "servings"] {
        assert!(updated[field].is_null());
    }
}
