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
