# Model pricing -- per 1M tokens (USD)
# Update monthly to match provider billing
MODEL_PRICES: dict[str, dict[str, float]] = {
    # -------------------------------------------------------------------------
    # Anthropic
    # -------------------------------------------------------------------------
    "claude-opus-4-6":            {"input": 15.00, "output": 75.00},
    "claude-sonnet-4-6":          {"input": 3.00,  "output": 15.00},
    "claude-haiku-4-5":           {"input": 0.80,  "output": 4.00},
    "claude-haiku-4-5-20251001":  {"input": 0.80,  "output": 4.00},
    "claude-3-5-sonnet-20241022": {"input": 3.00,  "output": 15.00},
    "claude-3-5-haiku-20241022":  {"input": 0.80,  "output": 4.00},
    "claude-3-opus-20240229":     {"input": 15.00, "output": 75.00},
    "claude-3-sonnet-20240229":   {"input": 3.00,  "output": 15.00},
    "claude-3-haiku-20240307":    {"input": 0.25,  "output": 1.25},

    # -------------------------------------------------------------------------
    # OpenAI
    # -------------------------------------------------------------------------
    "gpt-4o":                     {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":                {"input": 0.15,  "output": 0.60},
    "gpt-4o-2024-11-20":          {"input": 2.50,  "output": 10.00},
    "gpt-4-turbo":                {"input": 10.00, "output": 30.00},
    "gpt-4":                      {"input": 30.00, "output": 60.00},
    "gpt-3.5-turbo":              {"input": 0.50,  "output": 1.50},
    "gpt-4.5-preview":            {"input": 75.00, "output": 150.00},
    "o1":                         {"input": 15.00, "output": 60.00},
    "o1-mini":                    {"input": 3.00,  "output": 12.00},
    "o1-preview":                 {"input": 15.00, "output": 60.00},
    "o3":                         {"input": 10.00, "output": 40.00},
    "o3-mini":                    {"input": 1.10,  "output": 4.40},
    "o4-mini":                    {"input": 1.10,  "output": 4.40},
    "gpt-5":                      {"input": 75.00, "output": 150.00},
    "gpt-5.4":                    {"input": 75.00, "output": 150.00},
    "gpt-4.1":                    {"input": 2.00,  "output": 8.00},
    "gpt-4.1-mini":               {"input": 0.40,  "output": 1.60},
    "gpt-4.1-nano":               {"input": 0.10,  "output": 0.40},
    "openai-codex/gpt-5.4":       {"input": 75.00, "output": 150.00},
    "openai-codex/gpt-4.1":       {"input": 2.00,  "output": 8.00},

    # -------------------------------------------------------------------------
    # Google Gemini
    # -------------------------------------------------------------------------
    "gemini-2.0-flash":           {"input": 0.10,  "output": 0.40},
    "gemini-2.0-flash-lite":      {"input": 0.075, "output": 0.30},
    "gemini-2.5-pro":             {"input": 1.25,  "output": 10.00},
    "gemini-2.5-flash":           {"input": 0.15,  "output": 0.60},
    "gemini-1.5-pro":             {"input": 1.25,  "output": 5.00},
    "gemini-1.5-flash":           {"input": 0.075, "output": 0.30},
    "gemini-1.5-flash-8b":        {"input": 0.0375,"output": 0.15},
    "gemini-1.0-pro":             {"input": 0.50,  "output": 1.50},

    # -------------------------------------------------------------------------
    # Meta Llama (via inference providers; price per 1M tokens approximate)
    # -------------------------------------------------------------------------
    "meta-llama/llama-3.3-70b-instruct":  {"input": 0.59,  "output": 0.79},
    "meta-llama/llama-3.1-405b-instruct": {"input": 3.00,  "output": 3.00},
    "meta-llama/llama-3.1-70b-instruct":  {"input": 0.52,  "output": 0.75},
    "meta-llama/llama-3.1-8b-instruct":   {"input": 0.07,  "output": 0.07},
    "meta-llama/llama-3-70b-instruct":    {"input": 0.59,  "output": 0.79},
    "meta-llama/llama-3-8b-instruct":     {"input": 0.07,  "output": 0.07},
    # Short-form aliases used by Ollama / Together / Groq
    "llama-3.3-70b":              {"input": 0.59,  "output": 0.79},
    "llama-3.1-70b":              {"input": 0.52,  "output": 0.75},
    "llama-3.1-8b":               {"input": 0.07,  "output": 0.07},
    "llama-3-70b":                {"input": 0.59,  "output": 0.79},
    "llama-3-8b":                 {"input": 0.07,  "output": 0.07},
    "llama-2-70b":                {"input": 0.70,  "output": 0.90},
    "llama-2-13b":                {"input": 0.20,  "output": 0.20},

    # -------------------------------------------------------------------------
    # Mistral AI
    # -------------------------------------------------------------------------
    "mistral-large-latest":       {"input": 3.00,  "output": 9.00},
    "mistral-large-2411":         {"input": 2.00,  "output": 6.00},
    "mistral-medium":             {"input": 2.75,  "output": 8.10},
    "mistral-small-latest":       {"input": 0.10,  "output": 0.30},
    "mistral-small-2409":         {"input": 0.10,  "output": 0.30},
    "mistral-8x7b-instruct":      {"input": 0.70,  "output": 0.70},
    "mistral-7b-instruct":        {"input": 0.25,  "output": 0.25},
    "codestral-latest":           {"input": 0.20,  "output": 0.60},
    "mistral-nemo":               {"input": 0.15,  "output": 0.15},

    # -------------------------------------------------------------------------
    # Cohere
    # -------------------------------------------------------------------------
    "command-r-plus":             {"input": 2.50,  "output": 10.00},
    "command-r":                  {"input": 0.15,  "output": 0.60},
    "command-r-plus-08-2024":     {"input": 2.50,  "output": 10.00},
    "command-r-08-2024":          {"input": 0.15,  "output": 0.60},
    "command":                    {"input": 1.00,  "output": 2.00},
    "command-light":              {"input": 0.30,  "output": 0.60},

    # -------------------------------------------------------------------------
    # DeepSeek
    # -------------------------------------------------------------------------
    "deepseek-chat":              {"input": 0.27,  "output": 1.10},
    "deepseek-reasoner":          {"input": 0.55,  "output": 2.19},
    "deepseek-coder":             {"input": 0.27,  "output": 1.10},

    # -------------------------------------------------------------------------
    # Groq (hosted open models -- price per 1M tokens)
    # -------------------------------------------------------------------------
    "groq/llama-3.3-70b-versatile":    {"input": 0.59, "output": 0.79},
    "groq/llama-3.1-70b-versatile":    {"input": 0.59, "output": 0.79},
    "groq/llama-3.1-8b-instant":       {"input": 0.05, "output": 0.08},
    "groq/mixtral-8x7b-32768":         {"input": 0.24, "output": 0.24},
    "groq/gemma2-9b-it":               {"input": 0.20, "output": 0.20},

    # -------------------------------------------------------------------------
    # Together AI
    # -------------------------------------------------------------------------
    "together/llama-3.1-405b-instruct": {"input": 3.50, "output": 3.50},
    "together/llama-3.1-70b-instruct":  {"input": 0.88, "output": 0.88},
    "together/mixtral-8x7b-instruct":   {"input": 0.60, "output": 0.60},

    # -------------------------------------------------------------------------
    # AWS Bedrock model IDs
    # -------------------------------------------------------------------------
    "anthropic.claude-3-5-sonnet-20241022-v2:0": {"input": 3.00,  "output": 15.00},
    "anthropic.claude-3-5-haiku-20241022-v1:0":  {"input": 0.80,  "output": 4.00},
    "anthropic.claude-3-opus-20240229-v1:0":      {"input": 15.00, "output": 75.00},
    "amazon.titan-text-express-v1":               {"input": 0.20,  "output": 0.60},
    "amazon.nova-pro-v1:0":                       {"input": 0.80,  "output": 3.20},
    "amazon.nova-lite-v1:0":                      {"input": 0.06,  "output": 0.24},
    "amazon.nova-micro-v1:0":                     {"input": 0.035, "output": 0.14},
    "meta.llama3-70b-instruct-v1:0":              {"input": 0.99,  "output": 0.99},
    "meta.llama3-8b-instruct-v1:0":               {"input": 0.30,  "output": 0.60},
    "mistral.mistral-large-2402-v1:0":            {"input": 4.00,  "output": 12.00},
    "mistral.mixtral-8x7b-instruct-v0:1":         {"input": 0.45,  "output": 0.70},

    # -------------------------------------------------------------------------
    # Azure OpenAI (same prices as OpenAI; keyed on deployment name patterns)
    # -------------------------------------------------------------------------
    "azure/gpt-4o":               {"input": 2.50,  "output": 10.00},
    "azure/gpt-4o-mini":          {"input": 0.15,  "output": 0.60},
    "azure/gpt-4-turbo":          {"input": 10.00, "output": 30.00},

    # -------------------------------------------------------------------------
    # Ollama (local -- $0 cost, captured for latency/quality tracking)
    # -------------------------------------------------------------------------
    "ollama/llama3":              {"input": 0.0, "output": 0.0},
    "ollama/llama3.1":            {"input": 0.0, "output": 0.0},
    "ollama/mistral":             {"input": 0.0, "output": 0.0},
    "ollama/mixtral":             {"input": 0.0, "output": 0.0},
    "ollama/codellama":           {"input": 0.0, "output": 0.0},
    "ollama/phi3":                {"input": 0.0, "output": 0.0},
    "ollama/gemma2":              {"input": 0.0, "output": 0.0},
}

DEFAULT_PRICE = {"input": 2.50, "output": 10.00}  # fallback to gpt-4o pricing


def _fuzzy_lookup(model: str) -> dict[str, float] | None:
    """
    Try progressively looser matches for model strings we don't have exact entries for.
    Handles provider-prefixed names like "openai-codex/gpt-5.4" or "bedrock/claude-3-sonnet".
    """
    # 1. Try stripping a provider prefix (everything before the last "/" or ":")
    if "/" in model:
        short = model.split("/")[-1]
        if short in MODEL_PRICES:
            return MODEL_PRICES[short]

    # 2. Try a case-insensitive substring match - pick the longest matching key
    lower = model.lower()
    best: tuple[int, dict] | None = None
    for key, price in MODEL_PRICES.items():
        kl = key.lower()
        if kl in lower or lower in kl:
            if best is None or len(key) > best[0]:
                best = (len(key), price)
    if best:
        return best[1]

    return None


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate USD cost from token counts. Returns 0.0 if tokens not provided."""
    prices = MODEL_PRICES.get(model) or _fuzzy_lookup(model) or DEFAULT_PRICE
    return (input_tokens * prices["input"] + output_tokens * prices["output"]) / 1_000_000


def get_all_models() -> list[str]:
    return list(MODEL_PRICES.keys())
