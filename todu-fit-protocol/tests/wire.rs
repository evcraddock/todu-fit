use serde_json::json;
use todu_fit_protocol::{Operation, Request};
#[test]
fn wire_contract_is_application_data_not_cli_options() {
    let id = "12345678-1234-4234-8234-123456789abc";
    let request: Request = serde_json::from_value(
        json!({"version":2,"id":id,"operation":{"type":"dish_create","name":"Apple"}}),
    )
    .unwrap();
    assert!(matches!(request.operation, Operation::DishCreate { .. }));
    let encoded = serde_json::to_value(request).unwrap();
    assert_eq!(encoded["version"], 2);
    assert_eq!(encoded["operation"]["type"], "dish_create");
    assert!(serde_json::from_value::<Request>(json!({"version":2,"id":id,"operation":{"type":"dish_create","name":"Apple","format":"json"}})).is_err());
    assert!(serde_json::from_value::<Request>(
        json!({"version":2,"id":id,"operation":{"type":"cli","command":{"Dish":{}}}})
    )
    .is_err());
}

#[test]
fn nested_input_fields_are_not_silently_ignored() {
    for operation in [
        json!({"type":"dish_add_ingredient","identifier":"Soup","ingredient":{"name":"Salt","quantity":1.0,"unit":"tsp","quanity":2.0}}),
        json!({"type":"dish_create","name":"Soup","fields":{"nutrients":[{"name":"protein","amount":1.0,"unit":"g","ammount":2.0}]}}),
        json!({"type":"shopping_add","week":"2026-11-03","item":{"name":"Soap","quanity":"2"}}),
    ] {
        assert!(serde_json::from_value::<todu_fit_protocol::Operation>(operation).is_err());
    }
}
