// src-tauri/src/auth/mod.rs

use tauri::{AppHandle, Window, Emitter, Manager};
use tokio::{sync::oneshot, io::{AsyncReadExt, AsyncWriteExt}};
use url::Url;
use std::{collections::HashMap, net::TcpListener, sync::Arc, sync::Mutex as StdMutex};
use oauth2::{
    basic::BasicClient,
    AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, TokenUrl,
    TokenResponse
};
use keyring::Entry;
use serde::{Serialize, Deserialize};
use tauri_plugin_opener::OpenerExt;
use crate::core::error::AppError;
use crate::api::rate_limiter::ApiHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::StreamExt;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tracing::{info, warn, error, debug};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscordStatus {
    pub is_running: bool,
    pub rpc_available: bool,
    pub browser_detected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    pub avatar: Option<String>,
    pub email: Option<String>,
}

#[tauri::command]
pub async fn start_qr_login_flow(app_handle: AppHandle, window: Window) -> Result<(), AppError> {
    info!("Initializing QR code login flow via Discord Remote Auth Gateway...");
    
    let url = "wss://remote-auth-gateway.discord.gg/?v=1";
    let (ws_stream, _) = connect_async(url).await.map_err(|e| {
        error!("Failed to connect to Discord Remote Auth Gateway: {}", e);
        AppError {
            user_message: "Failed to connect to Discord login server.".to_string(),
            error_code: "gateway_connection_failure".to_string(),
            technical_details: Some(e.to_string()),
        }
    })?;

    let (_write, mut read) = ws_stream.split();
    let window_clone = window.clone();
    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(msg) = read.next().await {
            if let Ok(Message::Text(text)) = msg {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) {
                    match payload["op"].as_str() {
                        Some("hello") => debug!("Gateway handshake successful."),
                        Some("fingerprint") => {
                            if let Some(fingerprint) = payload["fingerprint"].as_str() {
                                info!("Received fingerprint for QR code generation.");
                                let qr_url = format!("https://discord.com/ra/{}", fingerprint);
                                let _ = window_clone.emit("qr_code_ready", qr_url);
                            }
                        }
                        Some("pending_remote_init") => {
                            info!("User scanned QR code. Awaiting confirmation.");
                            let _ = window_clone.emit("qr_scanned", ());
                        }
                        Some("finish") => {
                            if let Some(token) = payload["token"].as_str() {
                                info!("QR Login successful. Received token.");
                                let _ = login_with_token(app_handle_clone.clone(), window_clone.clone(), token.to_string()).await;
                                break;
                            }
                        }
                        Some("cancel") => {
                            warn!("QR login flow cancelled.");
                            let _ = window_clone.emit("qr_cancelled", ());
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn check_discord_status() -> Result<DiscordStatus, AppError> {
    let mut s = System::new();
    s.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());

    let is_running = s.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        name.contains("discord") && !name.contains("helper")
    });
    let browser_detected = s.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        ["chrome", "firefox", "msedge", "brave"].iter().any(|b| name.contains(b))
    });
    
    let mut rpc_available = false;
    for port in 6463..=6472 {
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.is_ok() {
            rpc_available = true;
            break;
        }
    }

    Ok(DiscordStatus { is_running, rpc_available, browser_detected })
}

#[tauri::command]
pub async fn login_with_token(app_handle: AppHandle, window: Window, token: String) -> Result<DiscordUser, AppError> {
    info!("Attempting to login with manual token...");
    
    let api_handle = app_handle.state::<ApiHandle>();
    let response = api_handle.send_request(reqwest::Method::GET, "https://discord.com/api/users/@me", None, &token).await?;

    if !response.status().is_success() {
        return Err(AppError {
            user_message: "Invalid Discord token provided.".to_string(),
            error_code: "invalid_token".to_string(),
            technical_details: Some(format!("Status: {}", response.status())),
        });
    }

    let user_profile: DiscordUser = response.json().await?;

    let entry = Entry::new("discord_privacy_util", "discord_user")?;
    entry.set_password(&format!("ACCESS_TOKEN={}\nREFRESH_TOKEN=", token))?;

    info!("Successfully logged in via token as {}", user_profile.username);
    let _ = window.emit("auth_success", user_profile.clone());

    Ok(user_profile)
}

fn get_discord_client_id() -> Result<String, AppError> {
    if let Ok(id) = std::env::var("DISCORD_CLIENT_ID") { return Ok(id); }
    Entry::new("discord_privacy_util", "client_id")?.get_password().map_err(|e| {
        error!("Discord Client ID not set in environment or keyring: {}", e);
        AppError {
            user_message: "Discord Client ID not configured. Please enter it in the settings.".to_string(),
            error_code: "credentials_missing".to_string(),
            technical_details: Some(e.to_string()),
        }
    })
}

fn get_discord_client_secret() -> Result<String, AppError> {
    if let Ok(secret) = std::env::var("DISCORD_CLIENT_SECRET") { return Ok(secret); }
    Entry::new("discord_privacy_util", "client_secret")?.get_password().map_err(|e| {
        error!("Discord Client Secret not set in environment or keyring: {}", e);
        AppError {
            user_message: "Discord Client Secret not configured. Please enter it in the settings.".to_string(),
            error_code: "credentials_missing".to_string(),
            technical_details: Some(e.to_string()),
        }
    })
}

#[tauri::command]
pub async fn save_discord_credentials(client_id: String, client_secret: String) -> Result<(), AppError> {
    info!("Saving Discord API credentials to secure keyring...");
    Entry::new("discord_privacy_util", "client_id")?.set_password(&client_id)?;
    Entry::new("discord_privacy_util", "client_secret")?.set_password(&client_secret)?;
    info!("Credentials saved successfully.");
    Ok(())
}

const DISCORD_REDIRECT_PATH: &str = "/auth/callback";

#[tauri::command]
pub async fn start_oauth_flow(app_handle: AppHandle, window: Window) -> Result<DiscordUser, AppError> {
    info!("Starting OAuth2 flow with Discord...");
    let client = BasicClient::new(
        ClientId::new(get_discord_client_id()?),
        Some(ClientSecret::new(get_discord_client_secret()?)),
        AuthUrl::new("https://discord.com/oauth2/authorize".to_string()).unwrap(),
        Some(TokenUrl::new("https://discord.com/api/oauth2/token".to_string()).unwrap()),
    );

    let (pkce_code_challenge, pkce_code_verifier) = PkceCodeChallenge::new_random_sha256();
    let csrf_state = CsrfToken::new_random();
    
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    info!("OAuth callback server listening on port {}", port);

    let redirect_url = RedirectUrl::new(format!("http://127.0.0.1:{}{}", port, DISCORD_REDIRECT_PATH)).unwrap();
    let client = client.set_redirect_uri(redirect_url);

    let (authorize_url, _) = client
        .authorize_url(|| csrf_state.clone())
        .add_scope(oauth2::Scope::new("identify".to_string()))
        .add_scope(oauth2::Scope::new("guilds".to_string()))
        .add_scope(oauth2::Scope::new("email".to_string()))
        .set_pkce_challenge(pkce_code_challenge)
        .url();

    let csrf_state_str = Arc::new(StdMutex::new(csrf_state.secret().to_string()));
    let pkce_code_verifier_str = Arc::new(StdMutex::new(pkce_code_verifier.secret().to_string()));

    let (tx_code, rx_code) = oneshot::channel();
    let (tx_error, rx_error) = oneshot::channel();
    
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener)?;
        let (mut stream, _) = listener.accept().await?;
        let mut buffer = [0; 2048];
        let n = stream.read(&mut buffer).await?;
        let request = String::from_utf8_lossy(&buffer[..n]);

        let request_uri = request.split_whitespace().nth(1).ok_or_else(|| AppError { user_message: "Malformed request".into(), ..Default::default() })?;
        let query_params: HashMap<String, String> = Url::parse(&format!("http://localhost{}", request_uri)).map_err(|e| AppError::from(e))?.query_pairs().into_owned().collect();

        let code = query_params.get("code").ok_or_else(|| AppError { user_message: "Auth code missing".into(), ..Default::default() })?.to_string();
        let received_state = query_params.get("state").ok_or_else(|| AppError { user_message: "State missing".into(), ..Default::default() })?.to_string();

        if received_state != *csrf_state_str.lock().unwrap() {
            let _ = tx_error.send(AppError { user_message: "CSRF mismatch".into(), ..Default::default() });
            return Err(AppError { user_message: "CSRF mismatch".into(), ..Default::default() });
        }

        stream.write_all(b"HTTP/1.1 200 OK\r\n\r\nAuthentication successful! You can close this tab.").await?;
        stream.flush().await?;

        let _ = tx_code.send((code, pkce_code_verifier_str.lock().unwrap().clone()));
        Result::<(), AppError>::Ok(())
    });

    window.emit("auth_started", ())?;
    app_handle.opener().open_url(authorize_url.to_string(), None::<&str>)?;

    let (auth_code, pkce_verifier_string) = tokio::select! {
        code_result = rx_code => code_result.map_err(|e| AppError::from(e))?,
        error_result = rx_error => return Err(error_result.map_err(|e| AppError::from(e))?),
    };
    
    info!("Received authorization code. Exchanging for tokens...");
    let token_response = client
        .exchange_code(oauth2::AuthorizationCode::new(auth_code))
        .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier_string))
        .request_async(oauth2::reqwest::async_http_client)
        .await?;

    let access_token = token_response.access_token().secret().to_string();
    login_with_token(app_handle, window, access_token).await
}

impl Default for AppError {
    fn default() -> Self {
        Self {
            user_message: "An unexpected error occurred.".to_string(),
            error_code: "unknown".to_string(),
            technical_details: None,
        }
    }
}
