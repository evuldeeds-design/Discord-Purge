// src-tauri/src/api/discord.rs

use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Manager};
use crate::api::rate_limiter::ApiHandle;
use crate::core::error::AppError;
use keyring::Entry;
use tracing::{info, error};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Guild {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub owner: bool,
    pub permissions: String,
}

#[tauri::command]
pub async fn fetch_guilds(app_handle: AppHandle) -> Result<Vec<Guild>, AppError> {
    info!("Fetching user guilds...");

    // 1. Get tokens from keyring
    let entry = Entry::new("discord_privacy_util", "discord_user")?;
    let password = entry.get_password()?;
    
    let access_token = password.lines()
        .find(|line| line.starts_with("ACCESS_TOKEN="))
        .and_then(|line| line.strip_prefix("ACCESS_TOKEN="))
        .ok_or_else(|| AppError {
            user_message: "Access token not found in secure store. Please login again.".to_string(),
            error_code: "access_token_missing".to_string(),
            technical_details: None,
        })?;

    // 2. Use ApiHandle to make the request
    let api_handle = app_handle.state::<ApiHandle>();
    let response = api_handle.send_request(
        reqwest::Method::GET,
        "https://discord.com/api/users/@me/guilds",
        None,
        access_token
    ).await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("Failed to fetch guilds: {} - {}", status, body);
        return Err(AppError {
            user_message: "Failed to fetch guilds from Discord.".to_string(),
            error_code: "guilds_fetch_failure".to_string(),
            technical_details: Some(format!("Status: {}, Body: {}", status, body)),
        });
    }

    let guilds: Vec<Guild> = response.json().await?;
    info!("Successfully fetched {} guilds.", guilds.len());

    Ok(guilds)
}
