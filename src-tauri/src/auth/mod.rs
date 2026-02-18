// src-tauri/src/auth/mod.rs

use tauri::{AppHandle, Window, Emitter, Manager};
use tokio::{sync::oneshot, io::{AsyncReadExt, AsyncWriteExt}};
use url::Url;
use std::{collections::HashMap, net::TcpListener, sync::Arc, sync::Mutex as StdMutex};
use oauth2::{
    basic::BasicClient,
    AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, PkceCodeVerifier, TokenUrl,
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

const KEYRING_SERVICE: &str = "discord_privacy_util_v1";

#[tauri::command]
pub async fn login_with_rpc(app_handle: AppHandle, window: Window) -> Result<DiscordUser, AppError> {
    info!("Attempting Instant Link login via Discord RPC...");
    let client_id = get_discord_client_id()?;
    
    let mut port_found = None;
    for port in 6463..=6472 {
        if let Ok(_) = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await {
            port_found = Some(port);
            break;
        }
    }

    let port = port_found.ok_or_else(|| AppError {
        user_message: "Discord client not detected or RPC is disabled.".into(),
        ..Default::default()
    })?;

    let url = format!("ws://127.0.0.1:{}/?v=1&client_id={}", port, client_id);
    let mut request = url.into_client_request().unwrap();
    request.headers_mut().insert("Origin", "https://discord.com".parse().unwrap());

    let (ws_stream, _) = connect_async(request).await.map_err(|e| AppError {
        user_message: "Failed to connect to Discord RPC.".into(),
        technical_details: Some(e.to_string()),
        ..Default::default()
    })?;

    let (mut write, mut read) = ws_stream.split();

    if let Some(Ok(_)) = read.next().await {}

    let auth_payload = serde_json::json!({
        "cmd": "AUTHORIZE",
        "args": {
            "client_id": client_id,
            "scopes": ["identify", "guilds", "rpc"],
            "prompt": "none"
        },
        "nonce": "1"
    });
    
    use futures_util::SinkExt;
    write.send(Message::Text(auth_payload.to_string().into())).await.map_err(|e| AppError {
        user_message: "Failed to send RPC authorization request.".into(),
        technical_details: Some(e.to_string()),
        ..Default::default()
    })?;

    while let Some(Ok(Message::Text(text))) = read.next().await {
        let payload: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        if payload["nonce"] == "1" {
            if let Some(code) = payload["data"]["code"].as_str() {
                let http_client = reqwest::Client::new();
                let token_res = http_client.post("https://discord.com/api/oauth2/token")
                    .form(&[
                        ("client_id", &client_id),
                        ("client_secret", &get_discord_client_secret()?),
                        ("grant_type", &"authorization_code".to_string()),
                        ("code", &code.to_string()),
                        ("redirect_uri", &"http://127.0.0.1".to_string()),
                    ])
                    .send().await?.json::<serde_json::Value>().await?;

                if let Some(token) = token_res["access_token"].as_str() {
                    let entry = Entry::new(KEYRING_SERVICE, "discord_user")?;
                    entry.set_password(&format!("TOKEN={}\nTYPE=oauth", token))?;
                    return login_with_token(app_handle, window, token.to_string()).await;
                }
            }
            break;
        }
    }

    Err(AppError { user_message: "RPC Authorization failed.".into(), ..Default::default() })
}

#[tauri::command]
pub async fn start_qr_login_flow(app_handle: AppHandle, window: Window) -> Result<(), AppError> {
    info!("Initializing QR code login flow...");
    let url = "wss://remote-auth-gateway.discord.gg/?v=2";
    let mut request = url.into_client_request().unwrap();
    let headers = request.headers_mut();
    headers.insert("Origin", "https://discord.com".parse().unwrap());
    headers.insert("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".parse().unwrap());

    let (ws_stream, _) = connect_async(request).await.map_err(|e| {
        error!("QR Gateway Connection Error: {}", e);
        AppError {
            user_message: "Failed to connect to QR gateway (403 Forbidden).".into(),
            technical_details: Some(e.to_string()),
            ..Default::default()
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
                        Some("hello") => debug!("QR Hello"),
                        Some("fingerprint") => {
                            if let Some(fp) = payload["fingerprint"].as_str() {
                                let _ = window_clone.emit("qr_code_ready", format!("https://discord.com/ra/{}", fp));
                            }
                        }
                        Some("pending_remote_init") => { let _ = window_clone.emit("qr_scanned", ()); }
                        Some("finish") => {
                            if let Some(token) = payload["token"].as_str() {
                                let _ = login_with_token(app_handle_clone.clone(), window_clone.clone(), token.to_string()).await;
                                break;
                            }
                        }
                        Some("cancel") => { let _ = window_clone.emit("qr_cancelled", ()); break; }
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
    let is_running = s.processes().values().any(|p| p.name().to_string_lossy().to_lowercase().contains("discord") && !p.name().to_string_lossy().to_lowercase().contains("helper"));
    let browser_detected = s.processes().values().any(|p| {
        let n = p.name().to_string_lossy().to_lowercase();
        ["chrome", "firefox", "msedge", "brave"].iter().any(|b| n.contains(b))
    });
    let mut rpc_available = false;
    for port in 6463..=6472 {
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.is_ok() {
            rpc_available = true; break;
        }
    }
    Ok(DiscordStatus { is_running, rpc_available, browser_detected })
}

#[tauri::command]
pub async fn login_with_token(app_handle: AppHandle, window: Window, token: String) -> Result<DiscordUser, AppError> {
    let api_handle = app_handle.state::<ApiHandle>();
    let response = api_handle.send_request(reqwest::Method::GET, "https://discord.com/api/users/@me", None, &token, false).await?;
    if !response.status().is_success() {
        return Err(AppError { user_message: "Token validation failed.".into(), ..Default::default() });
    }
    let user_profile: DiscordUser = response.json().await?;
    let entry = Entry::new(KEYRING_SERVICE, "discord_user")?;
    entry.set_password(&format!("TOKEN={}\nTYPE=user", token))?;
    let _ = window.emit("auth_success", user_profile.clone());
    Ok(user_profile)
}

fn get_discord_client_id() -> Result<String, AppError> {
    if let Ok(id) = std::env::var("DISCORD_CLIENT_ID") { return Ok(id); }
    Entry::new(KEYRING_SERVICE, "client_id")?.get_password().map_err(|e| AppError { user_message: "Client ID not found.".into(), technical_details: Some(e.to_string()), ..Default::default() })
}

fn get_discord_client_secret() -> Result<String, AppError> {
    if let Ok(secret) = std::env::var("DISCORD_CLIENT_SECRET") { return Ok(secret); }
    Entry::new(KEYRING_SERVICE, "client_secret")?.get_password().map_err(|e| AppError { user_message: "Client Secret not found.".into(), technical_details: Some(e.to_string()), ..Default::default() })
}

#[tauri::command]
pub async fn save_discord_credentials(client_id: String, client_secret: String) -> Result<(), AppError> {
    let id_entry = Entry::new(KEYRING_SERVICE, "client_id")?;
    id_entry.set_password(&client_id)?;
    let secret_entry = Entry::new(KEYRING_SERVICE, "client_secret")?;
    secret_entry.set_password(&client_secret)?;
    Ok(())
}

#[tauri::command]
pub async fn start_oauth_flow(app_handle: AppHandle, window: Window) -> Result<DiscordUser, AppError> {
    let client_id = get_discord_client_id()?;
    let client_secret = get_discord_client_secret()?;
    let client = BasicClient::new(ClientId::new(client_id), Some(ClientSecret::new(client_secret)), AuthUrl::new("https://discord.com/oauth2/authorize".to_string()).unwrap(), Some(TokenUrl::new("https://discord.com/api/oauth2/token".to_string()).unwrap()));
    let (pkce_ch, pkce_ver) = PkceCodeChallenge::new_random_sha256();
    let csrf = CsrfToken::new_random();
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let (tx_code, rx_code) = oneshot::channel();
    let (tx_err, rx_err) = oneshot::channel();
    let csrf_str = csrf.secret().to_string();
    
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener)?;
        let (mut stream, _) = listener.accept().await?;
        let mut buffer = [0; 2048];
        let n = stream.read(&mut buffer).await?;
        let request = String::from_utf8_lossy(&buffer[..n]);
        let request_uri = request.split_whitespace().nth(1).ok_or(AppError::default())?;
        let query: HashMap<String, String> = Url::parse(&format!("http://localhost{}", request_uri)).map_err(|e| AppError::from(e))?.query_pairs().into_owned().collect();
        if query.get("state") != Some(&csrf_str) { let _ = tx_err.send(AppError::default()); return Err(AppError::default()); }
        stream.write_all(b"HTTP/1.1 200 OK\r\n\r\nAuth success!").await?;
        let _ = tx_code.send((query.get("code").unwrap().to_string(), pkce_ver.secret().to_string()));
        Ok(())
    });

    let (auth_url, _) = client.authorize_url(|| csrf).add_scope(oauth2::Scope::new("identify".into())).add_scope(oauth2::Scope::new("guilds".into())).set_pkce_challenge(pkce_ch).url();
    app_handle.opener().open_url(auth_url.to_string(), None::<&str>)?;
    let (code, ver) = tokio::select! { Ok(res) = rx_code => res, Ok(err) = rx_err => return Err(err), else => return Err(AppError::default()) };
    let token_res = client.exchange_code(oauth2::AuthorizationCode::new(code)).set_pkce_verifier(PkceCodeVerifier::new(ver)).request_async(oauth2::reqwest::async_http_client).await?;
    let token = token_res.access_token().secret().to_string();
    let entry = Entry::new(KEYRING_SERVICE, "discord_user")?;
    entry.set_password(&format!("TOKEN={}\nTYPE=oauth", token))?;
    login_with_token(app_handle, window, token).await
}

impl Default for AppError { fn default() -> Self { Self { user_message: "Error".into(), error_code: "err".into(), technical_details: None } } }
