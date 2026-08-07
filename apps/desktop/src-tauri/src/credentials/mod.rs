#[cfg(feature = "tauri-app")]
use crate::RuntimeError;
use crate::RuntimeResult;
use parking_lot::Mutex;
use std::collections::HashMap;

pub trait CredentialStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> RuntimeResult<()>;
    fn get(&self, account: &str) -> RuntimeResult<Option<String>>;
    fn delete(&self, account: &str) -> RuntimeResult<()>;
}

#[derive(Default)]
pub struct MemoryCredentialStore {
    values: Mutex<HashMap<String, String>>,
}
impl CredentialStore for MemoryCredentialStore {
    fn set(&self, account: &str, secret: &str) -> RuntimeResult<()> {
        self.values.lock().insert(account.into(), secret.into());
        Ok(())
    }
    fn get(&self, account: &str) -> RuntimeResult<Option<String>> {
        Ok(self.values.lock().get(account).cloned())
    }
    fn delete(&self, account: &str) -> RuntimeResult<()> {
        self.values.lock().remove(account);
        Ok(())
    }
}

#[cfg(feature = "tauri-app")]
pub struct OsCredentialStore {
    service: String,
}
#[cfg(feature = "tauri-app")]
impl OsCredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }
}
#[cfg(feature = "tauri-app")]
impl CredentialStore for OsCredentialStore {
    fn set(&self, account: &str, secret: &str) -> RuntimeResult<()> {
        keyring::Entry::new(&self.service, account)
            .and_then(|entry| entry.set_password(secret))
            .map_err(|_| RuntimeError::CredentialStore)
    }
    fn get(&self, account: &str) -> RuntimeResult<Option<String>> {
        match keyring::Entry::new(&self.service, account).and_then(|entry| entry.get_password()) {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(RuntimeError::CredentialStore),
        }
    }
    fn delete(&self, account: &str) -> RuntimeResult<()> {
        match keyring::Entry::new(&self.service, account)
            .and_then(|entry| entry.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(RuntimeError::CredentialStore),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_abstraction_never_requires_plaintext_files() {
        let store = MemoryCredentialStore::default();
        store.set("refresh:user-1", "secret-token").unwrap();
        assert_eq!(
            store.get("refresh:user-1").unwrap().as_deref(),
            Some("secret-token")
        );
        store.delete("refresh:user-1").unwrap();
        assert_eq!(store.get("refresh:user-1").unwrap(), None);
    }
}
