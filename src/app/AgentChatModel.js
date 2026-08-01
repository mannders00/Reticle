// Pure request/response shaping for the Agent panel.

export function buildAgentRequest({ provider, model, question, apiKey, endpoint }) {
  const request = {
    provider,
    model: model.trim(),
    question: question.trim(),
  };
  if (provider === "openai") request.apiKey = apiKey.trim();
  else request.endpoint = endpoint.trim();
  return request;
}

export function answerText(result) {
  if (typeof result === "string") return result;
  return result?.answer ?? result?.content ?? result?.message ?? "The agent returned no answer.";
}

export function errorText(error) {
  const text = error instanceof Error ? error.message : String(error || "Unknown error");
  return text.replace(/^Error:\s*/, "") || "Unknown error";
}

export function shouldSubmitOnEnter(event) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
