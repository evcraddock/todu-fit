//! Core-backed application operations and reusable durable transactions.
//! No CLI parser, terminal output, transport, or platform service lifecycle.
mod application;
pub mod store;
pub use application::{execute, Context};
use todu_fit_protocol as api;

pub fn error(code: api::ErrorCode, message: impl Into<String>) -> api::ApiError {
    api::ApiError {
        retryable: matches!(code, api::ErrorCode::Storage | api::ErrorCode::Unavailable),
        code,
        message: message.into(),
    }
}
/// Execute one application operation in a disposable workspace, committing its
/// documents and retry receipt together. Embedding hosts supply their owner lock.
pub fn transact(
    store: &mut store::Store,
    root: &std::path::Path,
    context: &Context,
    request: &api::Request,
) -> api::Response {
    let result = (|| {
        if request.version != api::VERSION {
            return Err(error(
                api::ErrorCode::UnsupportedVersion,
                "Expected application protocol version 2",
            ));
        }
        let payload = serde_json::to_string(&request.operation).map_err(internal)?;
        let key = format!("v2:{}", request.id);
        if let Some(saved) = store.receipt(&key, &payload).map_err(storage)? {
            return serde_json::from_value(saved).map_err(internal);
        }
        let before = store.snapshot().map_err(storage)?;
        let workspace = store::materialize(&before, root).map_err(storage)?;
        let value = execute(workspace.path(), context, &request.operation)?;
        let after = store::collect(workspace.path()).map_err(storage)?;
        let persist = before != after || request.operation.remembers_result();
        let revision = store.revision().map_err(storage)? + u64::from(persist);
        let response = api::Response {
            version: api::VERSION,
            id: request.id,
            revision,
            outcome: api::Outcome::Ok {
                value: Box::new(value),
            },
        };
        let encoded = serde_json::to_value(&response).map_err(internal)?;
        if serde_json::to_vec(&encoded).map_err(internal)?.len() > 8 * 1024 * 1024 {
            return Err(error(
                api::ErrorCode::InvalidInput,
                "Response exceeds 8 MiB",
            ));
        }
        if persist {
            store
                .commit(
                    &after,
                    request.operation.remembers_result().then_some((
                        key.as_str(),
                        payload.as_str(),
                        &encoded,
                    )),
                )
                .map_err(storage)?;
        }
        Ok(response)
    })();
    result.unwrap_or_else(|error| api::Response {
        version: api::VERSION,
        id: request.id,
        revision: store.revision().unwrap_or(0),
        outcome: api::Outcome::Error { error },
    })
}
fn internal(e: impl std::fmt::Display) -> api::ApiError {
    error(api::ErrorCode::Internal, e.to_string())
}
fn storage(e: impl std::fmt::Display) -> api::ApiError {
    let message = e.to_string();
    error(
        if message.starts_with("RETRY_CONFLICT:") {
            api::ErrorCode::Conflict
        } else {
            api::ErrorCode::Storage
        },
        message,
    )
}
