use std::fmt;
use std::net::IpAddr;
use std::sync::Once;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::OperationalGraph;

const OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MAX_TOOL_ROUNDS: usize = 8;
const MAX_TOOL_ROUNDS: usize = 16;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TIMEOUT: Duration = Duration::from_secs(120);

const SYSTEM_PROMPT: &str = "You are a read-only operational assistant. Use only the provided Reticle tools to inspect the operational graph. Never claim to run actions, commands, or make changes.";
static INSTALL_CRYPTO_PROVIDER: Once = Once::new();

/// Provider configuration for the read-only agent. It intentionally does not
/// implement `Debug` so API keys cannot be included accidentally in debug logs.
pub enum AgentProvider {
    OpenAi { api_key: String },
    Ollama { endpoint: String },
}

/// Configuration with hard upper bounds on network time and tool iterations.
pub struct AgentConfig {
    provider: AgentProvider,
    model: String,
    max_tool_rounds: usize,
    timeout: Duration,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    pub provider: String,
    pub model: String,
    pub question: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    pub answer: String,
    pub rounds: usize,
}

impl AgentConfig {
    pub fn new(
        provider: &str,
        model: impl Into<String>,
        api_key: Option<String>,
        endpoint: Option<String>,
    ) -> Result<Self, AgentError> {
        let provider = match provider {
            "openai" => AgentProvider::OpenAi {
                api_key: api_key.ok_or_else(|| {
                    AgentError::Configuration("provider=openai requires an API key".into())
                })?,
            },
            "ollama" => AgentProvider::Ollama {
                endpoint: endpoint.ok_or_else(|| {
                    AgentError::Configuration("provider=ollama requires an endpoint".into())
                })?,
            },
            _ => {
                return Err(AgentError::Configuration(
                    "provider must be openai or ollama".into(),
                ))
            }
        };
        let config = Self {
            provider,
            model: model.into(),
            max_tool_rounds: DEFAULT_MAX_TOOL_ROUNDS,
            timeout: DEFAULT_TIMEOUT,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn with_limits(
        mut self,
        max_tool_rounds: usize,
        timeout: Duration,
    ) -> Result<Self, AgentError> {
        self.max_tool_rounds = max_tool_rounds;
        self.timeout = timeout;
        self.validate()?;
        Ok(self)
    }

    fn validate(&self) -> Result<(), AgentError> {
        if self.model.trim().is_empty() {
            return Err(AgentError::Configuration("model must not be empty".into()));
        }
        if self.max_tool_rounds > MAX_TOOL_ROUNDS {
            return Err(AgentError::Configuration(format!(
                "max tool rounds must not exceed {MAX_TOOL_ROUNDS}"
            )));
        }
        if self.timeout.is_zero() || self.timeout > MAX_TIMEOUT {
            return Err(AgentError::Configuration(
                "HTTP timeout must be between 1 millisecond and 120 seconds".into(),
            ));
        }
        match &self.provider {
            AgentProvider::OpenAi { api_key } if api_key.trim().is_empty() => Err(
                AgentError::Configuration("OpenAI API key must not be empty".into()),
            ),
            AgentProvider::Ollama { endpoint } => validate_ollama_endpoint(endpoint),
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentResult {
    pub text: String,
    pub rounds: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    Configuration(String),
    Http(String),
    Protocol(String),
    ToolRoundLimitExceeded { max: usize },
}

impl fmt::Display for AgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(message) => {
                write!(formatter, "invalid agent configuration: {message}")
            }
            Self::Http(message) => write!(formatter, "LLM request failed: {message}"),
            Self::Protocol(message) => write!(formatter, "invalid LLM response: {message}"),
            Self::ToolRoundLimitExceeded { max } => {
                write!(formatter, "LLM exceeded the maximum of {max} tool rounds")
            }
        }
    }
}

impl std::error::Error for AgentError {}

/// Validates an Ollama chat endpoint without resolving DNS. Literal loopback
/// IPs and `localhost` are accepted; other hostnames are rejected to avoid DNS
/// rebinding and server-side request forgery.
pub fn validate_ollama_endpoint(endpoint: &str) -> Result<(), AgentError> {
    let url = Url::parse(endpoint)
        .map_err(|error| AgentError::Configuration(format!("invalid Ollama endpoint: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AgentError::Configuration(
            "Ollama endpoint must use http or https".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AgentError::Configuration(
            "Ollama endpoint must not contain credentials".into(),
        ));
    }
    let loopback = match url.host_str() {
        Some(host) if host.eq_ignore_ascii_case("localhost") => true,
        Some(host) => host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false),
        None => false,
    };
    if !loopback {
        return Err(AgentError::Configuration(
            "Ollama endpoint host must be a literal loopback address or localhost".into(),
        ));
    }
    Ok(())
}

/// Returns the exact tools made available to the model.
pub fn tool_catalog(include_signal_history: bool) -> Vec<Value> {
    let mut tools = vec![
        function_tool(
            "reticle_get_graph",
            "Return the current read-only operational graph snapshot.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        function_tool(
            "reticle_get_node",
            "Return one node from the current operational graph by stable node ID.",
            json!({
                "type": "object",
                "properties": { "node_id": { "type": "string" } },
                "required": ["node_id"],
                "additionalProperties": false
            }),
        ),
    ];
    if include_signal_history {
        tools.push(function_tool(
            "reticle_get_signal_history",
            "Return the supplied read-only signal history JSON.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ));
    }
    tools
}

fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters
        }
    })
}

/// Runs a transport-neutral read-only agent loop over an in-memory graph.
pub fn run_agent(
    config: &AgentConfig,
    graph: &OperationalGraph,
    history: Option<&Value>,
    prompt: &str,
) -> Result<AgentResult, AgentError> {
    config.validate()?;
    let transport = HttpTransport::new(config)?;
    run_loop(&transport, graph, history, prompt, config.max_tool_rounds)
}

pub fn run_request(
    request: AgentRequest,
    graph: &OperationalGraph,
    history: Option<&Value>,
) -> Result<AgentResponse, AgentError> {
    if request.question.trim().is_empty() {
        return Err(AgentError::Configuration(
            "question must not be empty".into(),
        ));
    }
    let config = AgentConfig::new(
        &request.provider,
        request.model,
        request.api_key,
        request.endpoint,
    )?;
    let result = run_agent(&config, graph, history, &request.question)?;
    Ok(AgentResponse {
        answer: result.text,
        rounds: result.rounds,
    })
}

#[derive(Clone, Copy)]
enum Protocol {
    OpenAi,
    Ollama,
}

struct HttpTransport<'a> {
    client: Client,
    config: &'a AgentConfig,
    protocol: Protocol,
    endpoint: Url,
}

impl<'a> HttpTransport<'a> {
    fn new(config: &'a AgentConfig) -> Result<Self, AgentError> {
        INSTALL_CRYPTO_PROVIDER.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
        let client = Client::builder()
            .timeout(config.timeout)
            .redirect(Policy::none())
            .build()
            .map_err(|error| AgentError::Http(error.to_string()))?;
        let (protocol, endpoint) = match &config.provider {
            AgentProvider::OpenAi { .. } => {
                (Protocol::OpenAi, Url::parse(OPENAI_ENDPOINT).unwrap())
            }
            AgentProvider::Ollama { endpoint } => {
                let mut endpoint = Url::parse(endpoint).map_err(|error| {
                    AgentError::Configuration(format!("invalid Ollama endpoint: {error}"))
                })?;
                if endpoint.path().is_empty() || endpoint.path() == "/" {
                    endpoint.set_path("/api/chat");
                }
                (Protocol::Ollama, endpoint)
            }
        };
        Ok(Self {
            client,
            config,
            protocol,
            endpoint,
        })
    }
}

#[derive(Clone)]
struct ToolCall {
    id: Option<String>,
    name: String,
    arguments: Value,
}

struct ModelReply {
    content: String,
    tool_calls: Vec<ToolCall>,
}

trait Transport {
    fn complete(&self, messages: &[Value], tools: &[Value]) -> Result<ModelReply, AgentError>;
    fn assistant_message(&self, reply: &ModelReply) -> Value;
    fn tool_message(&self, call: &ToolCall, content: Value) -> Value;
}

impl Transport for HttpTransport<'_> {
    fn complete(&self, messages: &[Value], tools: &[Value]) -> Result<ModelReply, AgentError> {
        let body = match self.protocol {
            Protocol::OpenAi => json!({
                "model": self.config.model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto"
            }),
            Protocol::Ollama => json!({
                "model": self.config.model,
                "messages": messages,
                "tools": tools,
                "stream": false
            }),
        };
        let mut request = self.client.post(self.endpoint.clone()).json(&body);
        if let AgentProvider::OpenAi { api_key } = &self.config.provider {
            request = request.bearer_auth(api_key);
        }
        let response: Value = request
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| AgentError::Http(error.to_string()))?
            .json()
            .map_err(|error| AgentError::Protocol(error.to_string()))?;
        parse_reply(self.protocol, &response)
    }

    fn assistant_message(&self, reply: &ModelReply) -> Value {
        let calls: Vec<Value> = reply
            .tool_calls
            .iter()
            .map(|call| match self.protocol {
                Protocol::OpenAi => json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".into())
                    }
                }),
                Protocol::Ollama => json!({
                    "function": { "name": call.name, "arguments": call.arguments }
                }),
            })
            .collect();
        json!({ "role": "assistant", "content": reply.content, "tool_calls": calls })
    }

    fn tool_message(&self, call: &ToolCall, content: Value) -> Value {
        let content = serde_json::to_string(&content).unwrap_or_else(|_| "null".into());
        match self.protocol {
            Protocol::OpenAi => json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": content
            }),
            Protocol::Ollama => json!({
                "role": "tool",
                "tool_name": call.name,
                "content": content
            }),
        }
    }
}

fn parse_reply(protocol: Protocol, response: &Value) -> Result<ModelReply, AgentError> {
    let message = match protocol {
        Protocol::OpenAi => response
            .pointer("/choices/0/message")
            .ok_or_else(|| AgentError::Protocol("missing choices[0].message".into()))?,
        Protocol::Ollama => response
            .get("message")
            .ok_or_else(|| AgentError::Protocol("missing message".into()))?,
    };
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .map(|call| {
                    let function = call.get("function").ok_or_else(|| {
                        AgentError::Protocol("tool call is missing function".into())
                    })?;
                    let name = function
                        .get("name")
                        .and_then(Value::as_str)
                        .ok_or_else(|| AgentError::Protocol("tool call is missing name".into()))?
                        .to_string();
                    let raw_arguments = function
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    let arguments = match raw_arguments {
                        Value::String(raw) => {
                            serde_json::from_str(&raw).unwrap_or(Value::String(raw))
                        }
                        value => value,
                    };
                    Ok(ToolCall {
                        id: call.get("id").and_then(Value::as_str).map(String::from),
                        name,
                        arguments,
                    })
                })
                .collect::<Result<Vec<_>, AgentError>>()
        })
        .transpose()?
        .unwrap_or_default();
    if matches!(protocol, Protocol::OpenAi) && tool_calls.iter().any(|call| call.id.is_none()) {
        return Err(AgentError::Protocol(
            "OpenAI tool call is missing an id".into(),
        ));
    }
    Ok(ModelReply {
        content,
        tool_calls,
    })
}

fn run_loop<T: Transport>(
    transport: &T,
    graph: &OperationalGraph,
    history: Option<&Value>,
    prompt: &str,
    max_tool_rounds: usize,
) -> Result<AgentResult, AgentError> {
    let tools = tool_catalog(history.is_some());
    let mut messages = vec![
        json!({ "role": "system", "content": SYSTEM_PROMPT }),
        json!({ "role": "user", "content": prompt }),
    ];
    let mut rounds = 0;
    loop {
        let reply = transport.complete(&messages, &tools)?;
        if reply.tool_calls.is_empty() {
            return Ok(AgentResult {
                text: reply.content,
                rounds,
            });
        }
        if rounds >= max_tool_rounds {
            return Err(AgentError::ToolRoundLimitExceeded {
                max: max_tool_rounds,
            });
        }
        messages.push(transport.assistant_message(&reply));
        for call in &reply.tool_calls {
            let result = execute_tool(graph, history, &call.name, &call.arguments);
            messages.push(transport.tool_message(call, result));
        }
        rounds += 1;
    }
}

fn execute_tool(
    graph: &OperationalGraph,
    history: Option<&Value>,
    name: &str,
    arguments: &Value,
) -> Value {
    match name {
        "reticle_get_graph" => serde_json::to_value(graph)
            .unwrap_or_else(|error| json!({ "error": error.to_string() })),
        "reticle_get_node" => {
            let Some(node_id) = arguments.get("node_id").and_then(Value::as_str) else {
                return json!({ "error": "node_id must be a string" });
            };
            graph
                .nodes
                .get(node_id)
                .cloned()
                .unwrap_or_else(|| json!({ "error": "node not found", "nodeId": node_id }))
        }
        "reticle_get_signal_history" => history
            .cloned()
            .unwrap_or_else(|| json!({ "error": "signal history was not supplied" })),
        _ => json!({ "error": "unknown tool" }),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::{BTreeMap, VecDeque};

    use super::*;

    fn graph() -> OperationalGraph {
        OperationalGraph {
            schema_version: 1,
            version: 7,
            generated_at: 100,
            nodes: BTreeMap::from([("api".into(), json!({ "id": "api", "title": "API" }))]),
            edges: BTreeMap::new(),
            signals: BTreeMap::new(),
            actions: BTreeMap::new(),
            collectors: Vec::new(),
        }
    }

    #[test]
    fn ollama_url_accepts_only_http_loopback_hosts() {
        for endpoint in [
            "http://localhost:11434/api/chat",
            "https://127.0.0.1:11434/api/chat",
            "http://127.20.30.40/api/chat",
            "http://[::1]:11434/api/chat",
        ] {
            assert!(validate_ollama_endpoint(endpoint).is_ok(), "{endpoint}");
        }
        for endpoint in [
            "http://ollama.local/api/chat",
            "https://8.8.8.8/api/chat",
            "ftp://localhost/api/chat",
            "http://user:secret@localhost/api/chat",
        ] {
            assert!(validate_ollama_endpoint(endpoint).is_err(), "{endpoint}");
        }
    }

    #[test]
    fn catalog_contains_only_read_only_tools() {
        let without_history = tool_catalog(false);
        let names = |tools: &[Value]| {
            tools
                .iter()
                .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            names(&without_history),
            ["reticle_get_graph", "reticle_get_node"]
        );
        assert_eq!(
            names(&tool_catalog(true)),
            [
                "reticle_get_graph",
                "reticle_get_node",
                "reticle_get_signal_history"
            ]
        );
    }

    #[test]
    fn tools_return_graph_node_and_optional_history() {
        let graph = graph();
        assert_eq!(
            execute_tool(&graph, None, "reticle_get_graph", &json!({}))["version"],
            7
        );
        assert_eq!(
            execute_tool(
                &graph,
                None,
                "reticle_get_node",
                &json!({ "node_id": "api" })
            )["title"],
            "API"
        );
        let history = json!([{ "signalId": "api:health", "state": "ok" }]);
        assert_eq!(
            execute_tool(
                &graph,
                Some(&history),
                "reticle_get_signal_history",
                &json!({})
            ),
            history
        );
    }

    #[test]
    fn missing_nodes_are_structured_tool_errors() {
        assert_eq!(
            execute_tool(
                &graph(),
                None,
                "reticle_get_node",
                &json!({ "node_id": "missing" })
            ),
            json!({ "error": "node not found", "nodeId": "missing" })
        );
    }

    struct MockTransport {
        replies: RefCell<VecDeque<ModelReply>>,
    }

    impl Transport for MockTransport {
        fn complete(
            &self,
            _messages: &[Value],
            _tools: &[Value],
        ) -> Result<ModelReply, AgentError> {
            Ok(self.replies.borrow_mut().pop_front().unwrap())
        }

        fn assistant_message(&self, reply: &ModelReply) -> Value {
            json!({ "role": "assistant", "content": reply.content })
        }

        fn tool_message(&self, _call: &ToolCall, content: Value) -> Value {
            json!({ "role": "tool", "content": content.to_string() })
        }
    }

    fn tool_reply() -> ModelReply {
        ModelReply {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: Some("call-1".into()),
                name: "reticle_get_graph".into(),
                arguments: json!({}),
            }],
        }
    }

    #[test]
    fn loop_returns_final_text_and_executed_rounds() {
        let transport = MockTransport {
            replies: RefCell::new(VecDeque::from([
                tool_reply(),
                ModelReply {
                    content: "healthy".into(),
                    tool_calls: vec![],
                },
            ])),
        };
        assert_eq!(
            run_loop(&transport, &graph(), None, "status?", 2).unwrap(),
            AgentResult {
                text: "healthy".into(),
                rounds: 1
            }
        );
    }

    #[test]
    fn loop_does_not_execute_more_than_the_configured_rounds() {
        let transport = MockTransport {
            replies: RefCell::new(VecDeque::from([tool_reply(), tool_reply()])),
        };
        assert_eq!(
            run_loop(&transport, &graph(), None, "status?", 1).unwrap_err(),
            AgentError::ToolRoundLimitExceeded { max: 1 }
        );
    }
}
