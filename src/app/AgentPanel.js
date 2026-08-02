// app/AgentPanel.js
// Read-only conversational access to Reticle's graph context.

import { h } from "../core/dom.js";
import api from "../core/api.js";
import { answerText, buildAgentRequest, errorText, shouldSubmitOnEnter } from "./AgentChatModel.js";

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  ollama: "llama3.2",
};

export function mountAgentContent(root) {
  const provider = h("select", { class: "agent-input", "aria-label": "Provider" },
    h("option", { value: "openai" }, "OpenAI"),
    h("option", { value: "ollama" }, "Ollama"),
  );
  const model = h("input", {
    class: "agent-input",
    type: "text",
    value: DEFAULT_MODELS.openai,
    placeholder: "Model name",
    autocapitalize: "none",
    autocorrect: "off",
    autocomplete: "off",
    spellcheck: "false",
  });
  const apiKey = h("input", {
    class: "agent-input",
    type: "password",
    placeholder: "sk-…",
    autocapitalize: "none",
    autocorrect: "off",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "OpenAI API key",
  });
  const endpoint = h("input", {
    class: "agent-input",
    type: "url",
    value: "http://localhost:11434",
    placeholder: "http://localhost:11434",
    autocapitalize: "none",
    autocorrect: "off",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Ollama endpoint",
  });
  const openAiField = field("OpenAI API key", apiKey,
    "Kept only in this panel until you close or reload Reticle.");
  const ollamaField = field("Ollama endpoint", endpoint);
  const connectionValue = h("span", { class: "agent-settings-value" });
  const settings = h("details", { class: "agent-settings", open: true },
    h("summary", { class: "agent-settings-summary" },
      h("span", {}, "Model connection"),
      connectionValue,
    ),
    h("div", { class: "agent-settings-body" },
      h("div", { class: "agent-settings-row" },
        field("Provider", provider),
        field("Model", model),
      ),
      openAiField,
      ollamaField,
    ),
  );
  const conversation = h("div", {
    class: "agent-conversation",
    role: "log",
    "aria-live": "polite",
    "aria-label": "Agent conversation",
  }, h("div", { class: "agent-empty" },
    "Ask about the shape of your graph, a node's current signals, or what changed."));
  const question = h("textarea", {
    class: "agent-question",
    rows: 3,
    placeholder: "What should I know about this topology?",
    "aria-label": "Question for the agent",
  });
  const send = h("button", { class: "agent-send", type: "submit" }, "Ask agent");
  const form = h("form", { class: "agent-compose" }, question, send);
  let inFlight = false;

  const syncProvider = () => {
    const isOpenAi = provider.value === "openai";
    openAiField.hidden = !isOpenAi;
    ollamaField.hidden = isOpenAi;
    if (!model.value || Object.values(DEFAULT_MODELS).includes(model.value)) {
      model.value = DEFAULT_MODELS[provider.value];
    }
    connectionValue.textContent = `${provider.options[provider.selectedIndex].text} · ${model.value}`;
  };
  provider.addEventListener("change", syncProvider);
  model.addEventListener("input", () => {
    connectionValue.textContent = `${provider.options[provider.selectedIndex].text} · ${model.value || "model"}`;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (inFlight) return;
    const text = question.value.trim();
    const modelName = model.value.trim();
    if (!text || !modelName) return;
    if (provider.value === "openai" && !apiKey.value.trim()) {
      apiKey.focus();
      apiKey.setCustomValidity("Enter an OpenAI API key.");
      apiKey.reportValidity();
      return;
    }
    apiKey.setCustomValidity("");

    conversation.querySelector(".agent-empty")?.remove();
    conversation.append(message("You", text, "user"));
    question.value = "";
    inFlight = true;
    send.disabled = true;
    form.setAttribute("aria-busy", "true");
    send.textContent = "Thinking…";
    const pending = message("Agent", "Inspecting Reticle…", "assistant pending");
    conversation.append(pending);
    pending.scrollIntoView({ block: "end" });

    const request = buildAgentRequest({
      provider: provider.value,
      model: modelName,
      question: text,
      apiKey: apiKey.value,
      endpoint: endpoint.value,
    });

    try {
      const result = await api.agentChat(request);
      pending.replaceWith(message("Agent", answerText(result), "assistant"));
    } catch (error) {
      pending.replaceWith(message("Agent error", errorText(error), "error"));
    } finally {
      inFlight = false;
      send.disabled = false;
      form.removeAttribute("aria-busy");
      send.textContent = "Ask agent";
      conversation.lastElementChild?.scrollIntoView({ block: "end" });
      question.focus();
    }
  });
  question.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (!shouldSubmitOnEnter(event)) return;
    event.preventDefault();
    form.requestSubmit();
  });

  root.append(
    h("section", { class: "agent-intro" },
      h("div", { class: "agent-eyebrow" }, "READ-ONLY GUIDE"),
      h("h2", {}, "Ask Reticle"),
      h("p", {}, "Inspect the graph and current signals. No actions, shells, or topology changes."),
    ),
    settings,
    conversation,
    h("div", { class: "agent-compose-wrap" },
      form,
      h("div", { class: "agent-compose-hint" }, "Enter to send · Shift+Enter for a new line"),
    ),
  );
  syncProvider();
}

function field(label, control, hint = "") {
  return h("label", { class: "agent-field" },
    h("span", { class: "agent-label" }, label),
    control,
    hint ? h("span", { class: "agent-hint" }, hint) : null,
  );
}

function message(author, text, kind) {
  return h("article", { class: `agent-message is-${kind}` },
    h("div", { class: "agent-message-author" }, author),
    h("div", { class: "agent-message-text" }, text),
  );
}
