// src-tauri/src/auth/mod.rs

use tauri::{AppHandle, Window, Emitter, Manager};
use tokio::{sync::oneshot, io::{AsyncReadExt, AsyncWriteExt}};
use url::Url;
use std::net::TcpListener;
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
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use futures_util::{StreamExt, SinkExt};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tracing::{info, warn, error, debug};
use uuid::Uuid;

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

const KEYRING_SERVICE: &str = "discord_privacy_util_v3";

#[tauri::command]
pub async fn login_with_rpc(app_handle: AppHandle, window: Window) -> Result<DiscordUser, AppError> {
    info!("[RPC] Handshake sequence initiated.");
    let client_id = get_discord_client_id()?;
    
    let mut port_found = None;
    for port in 6463..=6472 {
        if let Ok(_) = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await {
            port_found = Some(port);
            debug!("[RPC] Found Discord listener on port {}", port);
            break;
        }
    }

    let port = port_found.ok_or_else(|| {
        error!("[RPC] No Discord client detected on common ports.");
        AppError { user_message: "Discord client not detected.".into(), ..Default::default() }
    })?;

    let url = format!("ws://127.0.0.1:{}/?v=1&client_id={}", port, client_id);
    let mut request = url.into_client_request().unwrap();
    request.headers_mut().insert("Origin", "https://discord.com".parse().unwrap());

    let (ws_stream, _) = connect_async(request).await.map_err(|e| {
        error!("[RPC] WebSocket connection failed: {}", e);
        AppError { user_message: "Failed to connect to RPC.".into(), technical_details: Some(e.to_string()), ..Default::default() }
    })?;

    let (mut write, mut read) = ws_stream.split();

    // 1. READY
    if let Some(msg) = read.next().await {
        debug!("[RPC] Gateway response: {:?}", msg);
    }

    let nonce = Uuid::new_v4().to_string();
    let auth_payload = serde_json::json!({
        "cmd": "AUTHORIZE",
        "args": {
            "client_id": client_id,
            "scopes": ["identify", "guilds"],
            "prompt": "none"
        },
        "nonce": nonce
    });
    
    write.send(Message::Text(auth_payload.to_string().into())).await.map_err(|e| {
        error!("[RPC] Failed to send AUTH: {}", e);
        AppError::from(e)
    })?;

    while let Some(msg) = read.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            _ => continue,
        };
        
        let payload: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        if payload["nonce"].as_str() == Some(&nonce) {
            if let Some(code) = payload["data"]["code"].as_str() {
                info!("[RPC] Code received. Exchanging for token...");
                let http_client = reqwest::Client::new();
                let res = http_client.post("https://discord.com/api/oauth2/token")
                    .form(&[
                        ("client_id", &client_id),
                        ("client_secret", &get_discord_client_secret()?),
                        ("grant_type", &"authorization_code".to_string()),
                        ("code", &code.to_string()),
                        ("redirect_uri", &"http://127.0.0.1".to_string()),
                    ])
                    .send().await?.json::<serde_json::Value>().await?;

                if let Some(token) = res["access_token"].as_str() {
                    return login_with_oauth_token(app_handle, window, token.to_string()).await;
                }
            }
            break;
        }
    }

    Err(AppError { user_message: "RPC Auth failed. Did you click Authorize?".into(), ..Default::default() })
}

#[tauri::command]
pub async fn start_qr_login_flow(app_handle: AppHandle, window: Window) -> Result<(), AppError> {
    info!("[QR] Initializing Remote Auth Gateway session...");
    let url = "wss://remote-auth-gateway.discord.gg/?v=2";
    let mut request = url.into_client_request().unwrap();
    let headers = request.headers_mut();
    headers.insert("Origin", "https://discord.com".parse().unwrap());
    headers.insert("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".parse().unwrap());

    let (ws_stream, _) = connect_async(request).await.map_err(|e| {
        error!("[QR] Connection failed (Check for 403): {}", e);
        AppError { user_message: "Login gateway rejected connection (403).".into(), technical_details: Some(e.to_string()), ..Default::default() }
    })?;

    let (_write, mut read) = ws_stream.split();
    let window_clone = window.clone();
    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(msg) = read.next().await {
            if let Ok(Message::Text(text)) = msg {
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(&text) {
                    match p["op"].as_str() {
                        Some("hello") => debug!("[QR] Handshake complete."),
                        Some("fingerprint") => {
                            if let Some(fp) = p["fingerprint"].as_str() {
                                debug!("[QR] Fingerprint generated.");
                                let _ = window_clone.emit("qr_code_ready", format!("https://discord.com/ra/{}", fp));
                            }
                        }
                        Some("pending_remote_init") => { 
                            info!("[QR] Mobile device detected scan.");
                            let _ = window_clone.emit("qr_scanned", ()); 
                        }
                        Some("finish") => {
                            if let Some(token) = p["token"].as_str() {
                                info!("[QR] Remote auth finalized.");
                                let _ = login_with_user_token(app_handle_clone.clone(), window_clone.clone(), token.to_string()).await;
                                break;
                            }
                        }
                        Some("cancel") => { 
                            warn!("[QR] Session cancelled by remote.");
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
    let is_running = s.processes().values().any(|p| p.name().to_string_lossy().to_ascii_lowercase().contains("discord"));
    let browser_detected = s.processes().values().any(|p| {
        let n = p.name().to_string_lossy().to_ascii_lowercase();
        ["chrome", "firefox", "msedge", "brave"].iter().any(|b| n.contains(b))
    });
    let rpc_available = (6463..=6472).any(|port| std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok());
    Ok(DiscordStatus { is_running, rpc_available, browser_detected })
}

#[tauri::command]
pub async fn login_with_user_token(app_handle: AppHandle, window: Window, token: String) -> Result<DiscordUser, AppError> {
    info!("[AUTH] Attempting User Token validation...");
    let user_profile = validate_token(&app_handle, &token, false).await?;
    let entry = Entry::new(KEYRING_SERVICE, "discord_user")?;
    entry.set_password(&format!("TOKEN={}\nTYPE=user", token))?;
    let _ = window.emit("auth_success", user_profile.clone());
    Ok(user_profile)
}

async fn login_with_oauth_token(app_handle: AppHandle, window: Window, token: String) -> Result<DiscordUser, AppError> {
    info!("[AUTH] Attempting OAuth2 Token validation...");
    let user_profile = validate_token(&app_handle, &token, true).await?;
    let entry = Entry::new(KEYRING_SERVICE, "discord_user")?;
    entry.set_password(&format!("TOKEN={}\nTYPE=oauth", token))?;
    let _ = window.emit("auth_success", user_profile.clone());
    Ok(user_profile)
}

async fn validate_token(app_handle: &AppHandle, token: &str, is_bearer: bool) -> Result<DiscordUser, AppError> {
    let api_handle = app_handle.state::<ApiHandle>();
    let response = api_handle.send_request(reqwest::Method::GET, "https://discord.com/api/users/@me", None, token, is_bearer).await?;
    if !response.status().is_success() {
        error!("[AUTH] Token validation failed with status: {}", response.status());
        return Err(AppError { user_message: "Token validation failed.".into(), ..Default::default() });
    }
    Ok(response.json().await?)
}

fn get_discord_client_id() -> Result<String, AppError> {
    if let Ok(id) = std::env::var("DISCORD_CLIENT_ID") { return Ok(id); }
    Entry::new(KEYRING_SERVICE, "client_id")?.get_password().map_err(|_| AppError { user_message: "Client ID missing.".into(), error_code: "credentials_missing".into(), ..Default::default() })
}

fn get_discord_client_secret() -> Result<String, AppError> {
    if let Ok(secret) = std::env::var("DISCORD_CLIENT_SECRET") { return Ok(secret); }
    Entry::new(KEYRING_SERVICE, "client_secret")?.get_password().map_err(|_| AppError { user_message: "Client Secret missing.".into(), error_code: "credentials_missing".into(), ..Default::default() })
}

#[tauri::command]
pub async fn save_discord_credentials(client_id: String, client_secret: String) -> Result<(), AppError> {
    info!("[CONFIG] Persisting API credentials to keyring...");
    Entry::new(KEYRING_SERVICE, "client_id")?.set_password(&client_id)?;
    Entry::new(KEYRING_SERVICE, "client_secret")?.set_password(&client_secret)?;
    Ok(())
}

#[tauri::command]
pub async fn start_oauth_flow(app_handle: AppHandle, window: Window) -> Result<DiscordUser, AppError> {
    info!("[OAUTH] Initiating browser flow...");
    let client_id = get_discord_client_id()?;
    let client_secret = get_discord_client_secret()?;
    let client = BasicClient::new(ClientId::new(client_id), Some(ClientSecret::new(client_secret)), AuthUrl::new("https://discord.com/oauth2/authorize".to_string()).unwrap(), Some(TokenUrl::new("https://discord.com/api/oauth2/token".to_string()).unwrap()));
    let (pkce_ch, pkce_ver) = PkceCodeChallenge::new_random_sha256();
    let csrf = CsrfToken::new_random();
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let redirect_url = RedirectUrl::new(format!("http://127.0.0.1:{}", port)).unwrap();
    let client = client.set_redirect_uri(redirect_url);
    let (auth_url, csrf_state) = client.authorize_url(CsrfToken::new_random).add_scope(oauth2::Scope::new("identify".into())).add_scope(oauth2::Scope::new("guilds".into())).set_pkce_challenge(pkce_ch).url();

    let (tx, rx) = oneshot::channel();
    let csrf_str = csrf_state.secret().to_string();
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener)?;
        let (mut stream, _) = listener.accept().await?;
        let mut buffer = [0; 1024];
        let n = stream.read(&mut buffer).await?;
        let req = String::from_utf8_lossy(&buffer[..n]);
        if let Some(code) = req.split_whitespace().nth(1).and_then(|path| Url::parse(&format!("http://localhost{}", path)).ok()).and_then(|url| url.query_pairs().find_map(|(k, v)| if k == "code" { Some(v.into_owned()) } else { None })) {
            let _ = tx.send(code);
        }
        stream.write_all(b"HTTP/1.1 200 OK\r\n\r\nSuccess! Returning to app...").await?;
        Ok::<_, AppError>(())
    });

    app_handle.opener().open_url(auth_url.to_string(), None::<&str>)?;
    let code = rx.await.map_err(|e| AppError { user_message: "Auth timeout.".into(), technical_details: Some(e.to_string()), ..Default::default() })?;
    
    let token_res = client.exchange_code(oauth2::AuthorizationCode::new(code)).set_pkce_verifier(PkceCodeVerifier::new(pkce_ver.secret().to_string())).request_async(oauth2::reqwest::async_http_client).await?;
    login_with_oauth_token(app_handle, window, token_res.access_token().secret().to_string()).await
}
