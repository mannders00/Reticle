import test from "node:test";
import assert from "node:assert/strict";
import { answerText, buildAgentRequest, errorText, shouldSubmitOnEnter } from "./AgentChatModel.js";

test("OpenAI requests contain only the OpenAI credential", () => {
  assert.deepEqual(buildAgentRequest({
    provider: "openai",
    model: " gpt-4o-mini ",
    question: " What changed? ",
    apiKey: " secret ",
    endpoint: "http://unused",
  }), {
    provider: "openai",
    model: "gpt-4o-mini",
    question: "What changed?",
    apiKey: "secret",
  });
});

test("Ollama requests contain only the endpoint", () => {
  assert.deepEqual(buildAgentRequest({
    provider: "ollama",
    model: " llama3.2 ",
    question: " Any unhealthy nodes? ",
    apiKey: "unused-secret",
    endpoint: " http://localhost:11434 ",
  }), {
    provider: "ollama",
    model: "llama3.2",
    question: "Any unhealthy nodes?",
    endpoint: "http://localhost:11434",
  });
});

test("agent responses and errors become readable text", () => {
  assert.equal(answerText({ answer: "All nodes are healthy." }), "All nodes are healthy.");
  assert.equal(answerText("Direct answer"), "Direct answer");
  assert.equal(errorText(new Error("request failed")), "request failed");
});

test("Enter submits while Shift+Enter and composition keep editing", () => {
  assert.equal(shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(shouldSubmitOnEnter({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: "a", shiftKey: false, isComposing: false }), false);
});
