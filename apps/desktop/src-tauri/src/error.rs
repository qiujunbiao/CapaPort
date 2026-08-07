use serde::Serialize;
use thiserror::Error;

pub type RuntimeResult<T> = Result<T, RuntimeError>;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("PATH_NOT_ALLOWED")]
    PathNotAllowed,
    #[error("PATH_SYMLINK_REJECTED")]
    SymlinkRejected,
    #[error("INVALID_INPUT")]
    InvalidInput,
    #[error("LOCAL_MODIFICATION_CONFLICT")]
    LocalModificationConflict,
    #[error("DIGEST_MISMATCH")]
    DigestMismatch,
    #[error("TRANSACTION_FAILED")]
    TransactionFailed,
    #[error("ROLLBACK_FAILED")]
    RollbackFailed,
    #[error("DATABASE_ERROR")]
    Database,
    #[error("CREDENTIAL_STORE_ERROR")]
    CredentialStore,
    #[error("NOT_FOUND")]
    NotFound,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl From<RuntimeError> for CommandError {
    fn from(value: RuntimeError) -> Self {
        let code = value.to_string();
        Self {
            code: code.clone(),
            message: code,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_errors_only_serialize_stable_codes() {
        let secret = "token-that-must-never-leak";
        let absolute_path = "/private/workspace/customer-project";
        let serialized =
            serde_json::to_string(&CommandError::from(RuntimeError::TransactionFailed)).unwrap();
        assert_eq!(
            serialized,
            r#"{"code":"TRANSACTION_FAILED","message":"TRANSACTION_FAILED"}"#
        );
        assert!(!serialized.contains(secret));
        assert!(!serialized.contains(absolute_path));
    }
}
