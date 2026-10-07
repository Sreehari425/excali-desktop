use std::{convert::Infallible, net::TcpListener as StdTcpListener, sync::Arc, time::Duration};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::server::conn::http1;
use hyper::{Request, Response, StatusCode, body::Incoming};
use hyper_util::rt::TokioIo;
use reqwest::Client;
use tauri::{Manager, State};
use tokio::sync::RwLock;

#[derive(Default)]
struct ProxyConfig {
    target: String,
    origin: String,
}

struct CollaborationProxy {
    local_url: String,
    config: Arc<RwLock<ProxyConfig>>,
}

#[tauri::command]
fn navigate_to_public_room(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("excalidraw.com" | "www.excalidraw.com")
        )
        || !parsed.path().is_empty() && parsed.path() != "/"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Public collaboration links must use https://excalidraw.com".into());
    }

    let url = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main editor window is unavailable".to_string())?;
    window.navigate(url).map_err(|error| error.to_string())
}

#[tauri::command]
async fn configure_collaboration_proxy(
    target_url: String,
    origin: String,
    proxy: State<'_, CollaborationProxy>,
) -> Result<String, String> {
    let target = reqwest::Url::parse(&target_url).map_err(|error| error.to_string())?;
    if !matches!(target.scheme(), "http" | "https") || target.host_str().is_none() {
        return Err("Room endpoint must be an HTTP or HTTPS URL".into());
    }
    let origin = reqwest::Url::parse(&origin).map_err(|error| error.to_string())?;
    if !matches!(origin.scheme(), "http" | "https") || origin.host_str().is_none() {
        return Err("Website URL must be an HTTP or HTTPS URL".into());
    }
    let mut config = proxy.config.write().await;
    config.target = target_url.trim_end_matches('/').to_string();
    config.origin = origin.origin().ascii_serialization();
    Ok(proxy.local_url.clone())
}

type ProxyResponse = Response<Full<Bytes>>;

fn response(status: StatusCode, body: impl Into<Bytes>) -> ProxyResponse {
    let mut result = Response::new(Full::new(body.into()));
    *result.status_mut() = status;
    let headers = result.headers_mut();
    headers.insert("access-control-allow-origin", "*".parse().unwrap());
    headers.insert(
        "access-control-allow-methods",
        "GET, POST, OPTIONS".parse().unwrap(),
    );
    headers.insert(
        "access-control-allow-headers",
        "Content-Type".parse().unwrap(),
    );
    headers.insert(
        "access-control-allow-private-network",
        "true".parse().unwrap(),
    );
    headers.insert("cache-control", "no-store".parse().unwrap());
    result
}

async fn proxy_request(
    request: Request<Incoming>,
    config: Arc<RwLock<ProxyConfig>>,
    client: Client,
) -> ProxyResponse {
    if request.method() == hyper::Method::OPTIONS {
        return response(StatusCode::NO_CONTENT, Bytes::new());
    }
    if !request.uri().path().starts_with("/socket.io/") {
        return response(StatusCode::NOT_FOUND, "Not found");
    }

    let config = config.read().await;
    if config.target.is_empty() || config.origin.is_empty() {
        return response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Collaboration proxy is not configured",
        );
    }
    let target = format!(
        "{}/socket.io/{}",
        config.target,
        request
            .uri()
            .query()
            .map(|q| format!("?{q}"))
            .unwrap_or_default()
    );
    let origin = config.origin.clone();
    drop(config);

    let method = match reqwest::Method::from_bytes(request.method().as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return response(StatusCode::METHOD_NOT_ALLOWED, "Unsupported method"),
    };
    let mut outbound = client.request(method, target).header("Origin", origin);
    if let Some(content_type) = request.headers().get(hyper::header::CONTENT_TYPE) {
        outbound = outbound.header("Content-Type", content_type.as_bytes());
    }
    if let Some(accept) = request.headers().get(hyper::header::ACCEPT) {
        outbound = outbound.header("Accept", accept.as_bytes());
    }
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(error) => return response(StatusCode::BAD_REQUEST, error.to_string()),
    };
    let upstream = match outbound.body(body).send().await {
        Ok(response) => response,
        Err(error) => return response(StatusCode::BAD_GATEWAY, error.to_string()),
    };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .cloned();
    let body = match upstream.bytes().await {
        Ok(body) => body,
        Err(error) => return response(StatusCode::BAD_GATEWAY, error.to_string()),
    };
    let mut result = response(status, body);
    if let Some(content_type) =
        content_type.and_then(|value| value.to_str().ok().map(str::to_owned))
    {
        if let Ok(value) = content_type.parse() {
            result
                .headers_mut()
                .insert(hyper::header::CONTENT_TYPE, value);
        }
    }
    result
}

fn start_collaboration_proxy(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let listener = StdTcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let config = Arc::new(RwLock::new(ProxyConfig::default()));
    app.manage(CollaborationProxy {
        local_url: format!("http://{address}"),
        config: config.clone(),
    });

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Could not start collaboration proxy: {error}");
                return;
            }
        };
        let client = match Client::builder()
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                eprintln!("Could not create collaboration proxy client: {error}");
                return;
            }
        };
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let config = config.clone();
            let client = client.clone();
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |request| {
                    let config = config.clone();
                    let client = client.clone();
                    async move { Ok::<_, Infallible>(proxy_request(request, config, client).await) }
                });
                if let Err(error) = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await
                {
                    eprintln!("Collaboration proxy connection failed: {error}");
                }
            });
        }
    });
    Ok(())
}

fn main() {
    let offline_editor_url = if cfg!(debug_assertions) {
        "http://127.0.0.1:1420/"
    } else {
        "tauri://localhost/"
    };
    tauri::Builder::default()
        .runtime(tauri_runtime_cef::Cef::default())
        .plugin(
            tauri::plugin::Builder::<tauri::DynRuntime>::new("excalidraw-theme-handoff")
                .initialization_script(format!(
                    r###"(() => {{
                      if (location.hostname !== "excalidraw.com" && location.hostname !== "www.excalidraw.com") return;
                      const requestedTheme = new URLSearchParams(location.search).get("desktop-theme");
                      try {{
                        if (requestedTheme === "dark" || requestedTheme === "light") {{
                          localStorage.setItem("excalidraw-theme", requestedTheme);
                          const cleanUrl = new URL(location.href);
                          cleanUrl.searchParams.delete("desktop-theme");
                          history.replaceState(history.state, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
                        }}
                      }} catch (error) {{
                        console.error("Could not apply desktop theme to Excalidraw", error);
                      }}
                      const returnToOffline = () => {{ location.href = "{offline_editor_url}"; }};
                      window.addEventListener("keydown", (event) => {{
                        if (event.ctrlKey && !event.altKey && !event.shiftKey && event.code === "Space") {{
                          event.preventDefault();
                          event.stopImmediatePropagation();
                          returnToOffline();
                        }}
                      }}, true);
                      const addOfflineButton = () => {{
                        if (document.getElementById("excalidraw-desktop-offline-return")) return;
                        const button = document.createElement("button");
                        button.id = "excalidraw-desktop-offline-return";
                        button.type = "button";
                        button.textContent = "← Return to offline editor";
                        button.title = "Return to your local drawing (Ctrl+Space)";
                        button.setAttribute("aria-label", "Return to offline editor");
                        Object.assign(button.style, {{
                          position: "fixed", left: "16px", top: "72px", zIndex: "2147483647",
                          padding: "9px 13px", border: "1px solid #6865a8", borderRadius: "8px",
                          background: "#24232d", color: "#f4f3ff", font: "500 13px system-ui, sans-serif",
                          boxShadow: "0 3px 14px #0005", cursor: "pointer"
                        }});
                        button.addEventListener("click", returnToOffline);
                        document.body.appendChild(button);
                      }};
                      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addOfflineButton, {{ once: true }});
                      else addOfflineButton();
                    }})();"###,
                    offline_editor_url = offline_editor_url
                ))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(start_collaboration_proxy)
        .invoke_handler(tauri::generate_handler![
            configure_collaboration_proxy,
            navigate_to_public_room
        ])
        .run(tauri::generate_context!())
        .expect("error while running Excalidraw Desktop");
}
