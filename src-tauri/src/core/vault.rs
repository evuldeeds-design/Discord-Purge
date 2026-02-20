// src-tauri/src/core/vault.rs

use keyring::Entry;
use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use crate::core::error::AppError;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DiscordIdentity {
    pub id: String,
    pub username: String,
    pub token: String,
    pub is_oauth: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct VaultFile {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub active_user_id: Option<String>,
    pub identities: Vec<DiscordIdentity>,
}

pub struct Vault;

impl Vault {
    fn get_vault_path(app_handle: &AppHandle) -> PathBuf {
        app_handle.path().app_local_data_dir().unwrap().join("vault.json")
    }

    fn read_vault(app_handle: &AppHandle) -> VaultFile {
        let path = Self::get_vault_path(app_handle);
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str::<VaultFile>(&content).unwrap_or_default()
        } else {
            VaultFile::default()
        }
    }

    fn write_vault(app_handle: &AppHandle, vault: &VaultFile) -> Result<(), AppError> {
        let path = Self::get_vault_path(app_handle);
        let content = serde_json::to_string_pretty(vault).map_err(|e| AppError {
            user_message: "Vault serialization failure.".into(),
            technical_details: Some(e.to_string()),
            ..Default::default()
        })?;
        fs::write(path, content)?;
        Ok(())
    }

    pub fn set_credential(app_handle: &AppHandle, key: &str, value: &str) -> Result<(), AppError> {
        let mut vault = Self::read_vault(app_handle);
        match key {
            "client_id" => vault.client_id = Some(value.to_string()),
            "client_secret" => vault.client_secret = Some(value.to_string()),
            _ => return Err(AppError { user_message: "Invalid credential key.".into(), ..Default::default() }),
        }
        Self::write_vault(app_handle, &vault)?;
        
        // Mirror to keyring if possible
        if let Ok(entry) = Entry::new("DiscordPrivacyUtilityV5", key) {
            let _ = entry.set_password(value);
        }
        Ok(())
    }

    pub fn get_credential(app_handle: &AppHandle, key: &str) -> Result<String, AppError> {
        // Try keyring first
        if let Ok(entry) = Entry::new("DiscordPrivacyUtilityV5", key) {
            if let Ok(p) = entry.get_password() {
                return Ok(p);
            }
        }
        
        let vault = Self::read_vault(app_handle);
        match key {
            "client_id" => vault.client_id,
            "client_secret" => vault.client_secret,
            _ => None,
        }.ok_or_else(|| AppError { 
            user_message: format!("Credential '{}' missing.", key), 
            error_code: "credentials_missing".into(),
            ..Default::default() 
        })
    }

    pub fn save_identity(app_handle: &AppHandle, identity: DiscordIdentity) -> Result<(), AppError> {
        let mut vault = Self::read_vault(app_handle);
        // Remove existing if same ID
        vault.identities.retain(|i| i.id != identity.id);
        vault.active_user_id = Some(identity.id.clone());
        vault.identities.push(identity.clone());
        Self::write_vault(app_handle, &vault)?;
        
        // Store token in keyring for the active session
        if let Ok(entry) = Entry::new("DiscordPrivacyUtilityV5", "active_token") {
            let data = format!("TOKEN={}\nTYPE={}\nID={}", identity.token, if identity.is_oauth { "oauth" } else { "user" }, identity.id);
            let _ = entry.set_password(&data);
        }
        Ok(())
    }

    pub fn get_active_token(app_handle: &AppHandle) -> Result<(String, bool), AppError> {
        if let Ok(entry) = Entry::new("DiscordPrivacyUtilityV5", "active_token") {
            if let Ok(data) = entry.get_password() {
                let token = data.lines().find(|l| l.starts_with("TOKEN=")).and_then(|l| l.strip_prefix("TOKEN="));
                let is_oauth = data.lines().find(|l| l.starts_with("TYPE=")).map(|l| l.contains("oauth")).unwrap_or(false);
                if let Some(t) = token { return Ok((t.to_string(), is_oauth)); }
            }
        }

        let vault = Self::read_vault(app_handle);
        if let Some(active_id) = &vault.active_user_id {
            if let Some(id) = vault.identities.iter().find(|i| &i.id == active_id) {
                return Ok((id.token.clone(), id.is_oauth));
            }
        }

        Err(AppError { user_message: "No active session.".into(), error_code: "no_session".into(), ..Default::default() })
    }

    pub fn list_identities(app_handle: &AppHandle) -> Vec<DiscordIdentity> {
        Self::read_vault(app_handle).identities
    }

    pub fn remove_identity(app_handle: &AppHandle, id: &str) -> Result<(), AppError> {
        let mut vault = Self::read_vault(app_handle);
        vault.identities.retain(|i| i.id != id);
        if vault.active_user_id.as_deref() == Some(id) {
            vault.active_user_id = None;
            // Keyring cleanup is secondary to vault integrity
        }
        Self::write_vault(app_handle, &vault)
    }
}
