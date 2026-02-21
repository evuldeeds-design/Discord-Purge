// src-tauri/src/core/vault.rs

use tauri::AppHandle;
use keyring::Entry;
use serde::{Serialize, Deserialize};
use crate::core::error::AppError;

/// Represents a stored Discord identity, containing the unique user ID, 
/// the current session token, and the authentication protocol used (OAuth vs User Token).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscordIdentity {
    pub id: String,
    pub username: String,
    pub token: String,
    pub is_oauth: bool,
}

/// The Vault is the primary security interface for sensitive data persistence.
/// It utilizes the host OS keychain (Windows Credential Manager, macOS Keychain, or Secret Service)
/// to ensure that Discord tokens and application credentials never reside in plain text on the disk.
pub struct Vault;

impl Vault {
    const SERVICE_NAME: &'static str = "com.discordprivacy.util";

    /// Persists a Discord identity to the secure OS vault.
    /// 
    /// # Logic
    /// Encodes the `DiscordIdentity` struct as a JSON string before storage.
    /// Uses the user's Discord ID as the unique account identifier.
    pub fn save_identity(_app: &AppHandle, identity: DiscordIdentity) -> Result<(), AppError> {
        let entry = Entry::new(Self::SERVICE_NAME, &format!("account_{}", identity.id))?;
        let secret = serde_json::to_string(&identity)?;
        entry.set_password(&secret)?;
        
        // Also track this as the most recent 'active' account
        let active_entry = Entry::new(Self::SERVICE_NAME, "active_account")?;
        active_entry.set_password(&identity.id)?;
        Ok(())
    }

    /// Retrieves the currently active Discord token and its type.
    /// 
    /// # Returns
    /// A tuple of `(token_string, is_bearer_token)`.
    pub fn get_active_token(_app: &AppHandle) -> Result<(String, bool), AppError> {
        let active_entry = Entry::new(Self::SERVICE_NAME, "active_account")?;
        let id = active_entry.get_password().map_err(|_| AppError { 
            user_message: "No active session found. Please login.".into(), 
            error_code: "no_active_session".into(),
            ..Default::default()
        })?;
        
        let identity = Self::get_identity(_app, &id)?;
        Ok((identity.token, identity.is_oauth))
    }

    /// Fetches a specific identity from the vault by its Discord ID.
    pub fn get_identity(_app: &AppHandle, id: &str) -> Result<DiscordIdentity, AppError> {
        let entry = Entry::new(Self::SERVICE_NAME, &format!("account_{}", id))?;
        let secret = entry.get_password()?;
        Ok(serde_json::from_str(&secret)?)
    }

    /// Lists all Discord identities currently stored in the system vault.
    /// 
    /// # Performance
    /// This operation is performed synchronously during identity-switch tasks.
    pub fn list_identities(_app: &AppHandle) -> Vec<DiscordIdentity> {
        // Implementation simplified: in a production environment, we would maintain
        // an index of keys. For this utility, we iterate through common patterns.
        // For MVP, we fetch the known accounts.
        // Note: Real key discovery requires OS-specific enumerators.
        Vec::new() // Placeholder for the actual list logic
    }

    /// Removes an identity from the vault, permanently destroying the token link.
    pub fn remove_identity(_app: &AppHandle, id: &str) -> Result<(), AppError> {
        let entry = Entry::new(Self::SERVICE_NAME, &format!("account_{}", id))?;
        entry.delete_credential()?;
        Ok(())
    }

    /// Stores a raw application credential (like Client ID or Secret).
    pub fn set_credential(_app: &AppHandle, key: &str, value: &str) -> Result<(), AppError> {
        let entry = Entry::new(Self::SERVICE_NAME, key)?;
        entry.set_password(value)?;
        Ok(())
    }

    /// Retrieves a raw application credential.
    pub fn get_credential(_app: &AppHandle, key: &str) -> Result<String, AppError> {
        let entry = Entry::new(Self::SERVICE_NAME, key)?;
        entry.get_password().map_err(|_| AppError { 
            user_message: format!("Credential '{}' not found. Please complete Setup.", key), 
            error_code: "credentials_missing".into(),
            ..Default::default()
        })
    }
}
